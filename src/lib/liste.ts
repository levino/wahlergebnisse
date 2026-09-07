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
 * Die Nummern gelten allerdings nur je Wahl: In Nordstemmen ist D13 in
 * Burgstemmen die „Wählergemeinschaft Zukunft Burgstemmen“, in Klein Escherde
 * der „Einzelwahlvorschlag Helbing“. Widersprechen sich zwei Einträge, bleibt
 * die Nummer ungenutzt – ein fehlender Listenplatz ist harmlos, ein falscher
 * nicht.
 */
export const parteienAusOpenData = (
	dateifelder: Array<{
		name: string;
		parteien?: Array<{ feld: string; wert: string }>;
	}>,
	dateiname: string,
): Map<number, string> => {
	const gesucht = normDatei(dateiname);
	const genau =
		dateifelder.find((d) => d.name === dateiname) ??
		dateifelder.find((d) => normDatei(d.name) === gesucht);
	const passend = genau
		? [genau]
		: dateifelder.filter((d) => normDatei(d.name).startsWith(gesucht));

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

/** Nur zur Nutzung in Tests und beim Poller. */
export const parteiSchluessel = parteiKey;
