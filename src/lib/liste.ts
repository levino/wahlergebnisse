/**
 * Listenplätze der Bewerberinnen und Bewerber.
 *
 * Die Ergebnisdateien nennen die Kandidaten einer Partei nach Stimmen
 * sortiert – der Listenplatz steht dort nicht. Die Open-Data-CSV desselben
 * Wahlgebiets führt dieselben Zahlen dagegen in Listenreihenfolge
 * (`D1_1`, `D1_2`, … = 1., 2., … Bewerber von Partei 1). Aus beidem zusammen
 * ergibt sich der Platz: die Stimmenzahl ist der Schlüssel.
 *
 * Wo zwei Bewerber derselben Liste exakt gleich viele Stimmen haben, ist die
 * Zuordnung nicht eindeutig – dann bleibt der Platz offen, statt zu raten.
 */
import { parteiKey } from "./votemanager.ts";

export type Spaltenwert = { partei: number; platz: number; stimmen: number };

/** Semikolon-CSV der Wahlpräsentation (UTF-8, erste Zeile Spaltennamen). */
export const parseCsv = (text: string): Array<Record<string, string>> => {
	const zeilen = text.replace(/^﻿/, "").trim().split(/\r?\n/);
	if (zeilen.length < 2) return [];
	const spalten = zeilen[0].split(";");
	return zeilen.slice(1).map((z) => {
		const felder = z.split(";");
		return Object.fromEntries(spalten.map((s, i) => [s, felder[i] ?? ""]));
	});
};

/**
 * Summiert die Kandidatenspalten `D<partei>_<platz>` über alle Zeilen.
 * Mehrere Zeilen kommen bei Ortsratswahlen vor (eine je Wahlbezirk).
 * Spalten wie `D1_liste` oder `D1_summe_kandidaten` gehören nicht dazu.
 */
export const summiereKandidatenspalten = (
	zeilen: Array<Record<string, string>>,
): Spaltenwert[] => {
	const summe = new Map<string, number>();
	for (const zeile of zeilen) {
		for (const [spalte, wert] of Object.entries(zeile)) {
			const m = spalte.match(/^D(\d+)_(\d+)$/);
			if (!m || wert === "") continue;
			const n = Number(wert);
			if (!Number.isFinite(n)) continue;
			summe.set(spalte, (summe.get(spalte) ?? 0) + n);
		}
	}
	return [...summe].map(([spalte, stimmen]) => {
		const m = spalte.match(/^D(\d+)_(\d+)$/) as RegExpMatchArray;
		return { partei: Number(m[1]), platz: Number(m[2]), stimmen };
	});
};

export type Wahlvorschlag = {
	parteiKey: string;
	platz: number;
	name: string;
	stimmen: number;
};

/**
 * Führt die nach Stimmen sortierten Kandidaten aus dem Ergebnis mit den
 * Listenspalten der CSV zusammen.
 *
 * @param parteien   aus dem Gesamtergebnis: Kurzname, Langname und Kandidaten
 * @param spalten    aus der CSV: Partei-Nummer, Platz, Stimmen
 * @param parteiVonNummer  aus open_data.json: Partei-Nummer → Langname
 */
export const ordneListenplaetze = (
	parteien: Array<{
		key: string;
		lang: string;
		kandidaten?: Array<{ name: string; stimmen: number }>;
	}>,
	spalten: Spaltenwert[],
	parteiVonNummer: Map<number, string>,
): Wahlvorschlag[] => {
	// Name aus open_data → Wahlvorschlag im Ergebnis. Der gekürzte Vergleich ist
	// nur ein Rückfall für abgeschnittene Namen und zählt nur, wenn genau ein
	// Wahlvorschlag passt: Zwei Einzelwahlvorschläge derselben Gemeinde können
	// in den ersten 25 Zeichen übereinstimmen, und ein Listenplatz an der
	// falschen Liste wäre schlimmer als gar keiner.
	const keyVonNummer = new Map<number, string>();
	for (const [nummer, lang] of parteiVonNummer) {
		const genau = parteien.filter((p) => p.lang === lang);
		const gekuerzt = parteien.filter((p) =>
			p.lang.startsWith(lang.slice(0, 25)),
		);
		const treffer =
			genau.length === 1
				? genau[0]
				: gekuerzt.length === 1
					? gekuerzt[0]
					: undefined;
		if (treffer) keyVonNummer.set(nummer, treffer.key);
	}
	// Eine Partei, auf die zwei Nummern zeigen, ist nicht auflösbar.
	const nummerVonKey = new Map<string, number | undefined>();
	for (const [nummer, key] of keyVonNummer)
		nummerVonKey.set(key, nummerVonKey.has(key) ? undefined : nummer);

	const out: Wahlvorschlag[] = [];
	for (const partei of parteien) {
		const kandidaten = partei.kandidaten ?? [];
		if (kandidaten.length === 0) continue;
		const nummer = nummerVonKey.get(partei.key);
		if (nummer === undefined) continue;
		const plaetze = spalten
			.filter((s) => s.partei === nummer)
			.sort((a, b) => a.platz - b.platz);

		// Stimmenzahl → Platz; doppelte Stimmenzahlen sind nicht auflösbar
		const platzVonStimmen = new Map<number, number | null>();
		for (const p of plaetze) {
			platzVonStimmen.set(
				p.stimmen,
				platzVonStimmen.has(p.stimmen) ? null : p.platz,
			);
		}
		for (const k of kandidaten) {
			const platz = platzVonStimmen.get(k.stimmen);
			if (platz)
				out.push({
					parteiKey: partei.key,
					platz,
					name: k.name,
					stimmen: k.stimmen,
				});
		}
	}
	return out.sort(
		(a, b) => a.parteiKey.localeCompare(b.parteiKey) || a.platz - b.platz,
	);
};

/**
 * Partei-Nummer → Langname aus den `dateifelder` von open_data.json.
 *
 * Die Ortsratswahlen führt open_data.json je Ortschaft auf („Ortsratswahl
 * (Adensen)“), die CSV-Liste daneben nennt als Wahl aber nur „Ortsratswahl“.
 * Über den Namen allein fände deshalb keine einzige Ortsratswahl ihre
 * Parteinamen – und ohne die steht bei keinem ihrer Bewerber ein Listenplatz.
 * Passt kein Eintrag genau, werden darum alle genommen, deren Name mit dem
 * gesuchten anfängt.
 *
 * Ist der Ort bekannt (er steht in der CSV-Liste nur in der Ebene, siehe
 * `ordneCsvsZuWahlen`) und passt damit genau ein Eintrag, gilt der allein.
 * Erst das macht die ortseigenen Listen nutzbar: In Nordstemmen ist D13 in
 * Burgstemmen die „Wählergemeinschaft Zukunft Burgstemmen“, in Klein Escherde
 * der „Einzelwahlvorschlag Helbing“ – über alle neun Ortschaften zusammen
 * widersprechen sich die beiden und fielen weg.
 *
 * Bleibt der Ort unklar, werden weiter alle Einträge zusammengelegt und
 * widersprüchliche Nummern verworfen – ein fehlender Listenplatz ist harmlos,
 * ein falscher nicht.
 */
export const parteienAusOpenData = (
	dateifelder: Array<{
		name: string;
		parteien?: Array<{ feld: string; wert: string }>;
	}>,
	dateiname: string,
	ort?: string,
): Map<number, string> => {
	const gesucht = normDatei(dateiname);
	const kandidaten = dateifelder.filter((d) =>
		normDatei(d.name).startsWith(gesucht),
	);
	const mitOrt = ort
		? kandidaten.filter((d) => normDatei(d.name).includes(normDatei(ort)))
		: [];
	const genau =
		dateifelder.find((d) => d.name === dateiname) ??
		dateifelder.find((d) => normDatei(d.name) === gesucht);
	const passend = mitOrt.length === 1 ? mitOrt : genau ? [genau] : kandidaten;

	const map = new Map<number, string>();
	const strittig = new Set<number>();
	for (const eintrag of passend) {
		for (const p of eintrag.parteien ?? []) {
			const m = p.feld.match(/^D(\d+)$/);
			if (!m) continue;
			const nummer = Number(m[1]);
			const alt = map.get(nummer);
			if (alt !== undefined && alt !== p.wert) strittig.add(nummer);
			map.set(nummer, p.wert);
		}
	}
	for (const nummer of strittig) map.delete(nummer);
	return map;
};

const normDatei = (s: string) => s.toLowerCase().replace(/[^a-z0-9äöüß]/g, "");

/** Ein Eintrag aus `csvs` in open_data.json. */
export type CsvEintrag = { wahl: string; ebene: string; url: string };

/** Eine Wahl aus termin.json, so weit sie für die Zuordnung zählt. */
export type CsvWahl = {
	/** Beliebiger Schlüssel, unter dem das Ergebnis wieder auftaucht. */
	schluessel: string;
	/** Titel aus termin.json, z. B. „Ortsratswahl - Adensen“. */
	titel: string;
	/** Titel des Gesamtgebiets, z. B. „Adensen“ oder „Gemeinde Nordstemmen“. */
	gebietTitel: string;
};

export type CsvZuordnung = {
	csvs: CsvEintrag[];
	/**
	 * Gesetzt, wenn die Wahl nur über ihren Ort von gleichnamigen Geschwistern
	 * unterschieden werden konnte. Die zugeordneten Dateien decken dann genau
	 * das Gebiet dieser einen Wahl ab.
	 */
	ort?: string;
};

const normTitel = (s: string): string =>
	s
		.toLowerCase()
		.replace(/[äöü]/g, (c) => ({ ä: "ae", ö: "oe", ü: "ue" })[c] ?? c)
		.replace(/ß/g, "ss")
		.replace(/[^a-z0-9]/g, "");

const ortAusGebiet = (gebietTitel: string): string =>
	gebietTitel.replace(
		/^(Ortschaft|Gemeinde|Stadt|Flecken|Samtgemeinde)\s+/i,
		"",
	);

/**
 * Ordnet die Open-Data-CSVs den Wahlen einer Behörde zu – je Wahl alle Ebenen,
 * die zu ihr gehören.
 *
 * Beide Programmversionen benennen die Dateien unterschiedlich („Gemeindewahl“
 * mit Ebene „Gemeinde-Ergebnis“ 2021, „Gemeindewahl - Gemeinde Nordstemmen“
 * mit Ebene „Gemeinde“ 2026), deshalb wird nur über den Kern vor dem „ - “
 * verglichen.
 *
 * Der heikle Fall sind gleichnamige Wahlen: Nordstemmen hat neun
 * Ortsratswahlen, die in termin.json „Ortsratswahl - <Ort>“ heißen, in der
 * CSV-Liste aber alle nur „Ortsratswahl“ – der Ort steht dort in der Ebene
 * („Adensen: Übersicht über Wahlbezirke“). Solche Wahlen bekommen ihre Dateien
 * nur über den Ortsnamen, und nur wenn die Zuordnung in beide Richtungen
 * eindeutig ist: Beansprucht eine Datei mehr als eine Wahl (denkbar bei
 * Ortsnamen, die ineinander stecken – „Escherde“ in „Groß Escherde“), geht
 * diese Wahl leer aus. Ein fehlender Listenplatz ist harmlos, ein falscher
 * nicht.
 */
export const ordneCsvsZuWahlen = (
	csvs: CsvEintrag[],
	wahlen: CsvWahl[],
): Map<string, CsvZuordnung> => {
	const gruppen = new Map<string, CsvWahl[]>();
	for (const w of wahlen) {
		const kern = normTitel(w.titel.split(" - ")[0]);
		if (!kern) continue;
		gruppen.set(kern, [...(gruppen.get(kern) ?? []), w]);
	}

	const zuordnung = new Map<string, CsvZuordnung>();
	for (const [kern, gruppe] of gruppen) {
		const passend = csvs.filter(
			(c) =>
				normTitel(c.wahl).startsWith(kern) ||
				kern.startsWith(normTitel(c.wahl)),
		);
		if (passend.length === 0) continue;
		// Nur eine Wahl dieses Namens: Alle Ebenen gehören ihr.
		if (gruppe.length === 1) {
			zuordnung.set(gruppe[0].schluessel, { csvs: passend });
			continue;
		}
		const eigene = new Map<string, CsvEintrag[]>();
		const beansprucht = new Map<CsvEintrag, number>();
		for (const w of gruppe) {
			const ort = normTitel(ortAusGebiet(w.gebietTitel));
			const meine = ort
				? passend.filter((c) => normTitel(`${c.wahl}${c.ebene}`).includes(ort))
				: [];
			eigene.set(w.schluessel, meine);
			for (const c of meine) beansprucht.set(c, (beansprucht.get(c) ?? 0) + 1);
		}
		for (const w of gruppe) {
			const meine = eigene.get(w.schluessel) ?? [];
			if (meine.length === 0) continue;
			if (meine.some((c) => (beansprucht.get(c) ?? 0) > 1)) continue;
			zuordnung.set(w.schluessel, {
				csvs: meine,
				ort: ortAusGebiet(w.gebietTitel),
			});
		}
	}
	return zuordnung;
};

/** Nur zur Nutzung in Tests und beim Poller. */
export const parteiSchluessel = parteiKey;
