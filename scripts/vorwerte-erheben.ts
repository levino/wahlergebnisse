/**
 * Erhebt je Behörde und je Amt die **letzte Wahl vor dem 13.09.2026**.
 *
 *   node --experimental-strip-types scripts/vorwerte-erheben.ts [--ziel <datei>] [--kreise a,b]
 *
 * Warum das nötig ist: Die Seite vergleicht jedes Ergebnis mit der passenden
 * früheren Wahl. Als Archiv laden wir bisher nur die Kommunalwahl 2021 (plus
 * Nordstemmen 2020). Direktwahlen – Bürgermeister, Oberbürgermeister,
 * Landräte – laufen aber in eigenen Zyklen: Wer 2019, 2022, 2023, 2024 oder
 * 2025 gewählt wurde, hätte bei uns keinen Vorwert. Welche Termine dafür
 * fehlen, lässt sich nicht ausrechnen, sondern nur bei den Wahlleitungen
 * nachsehen.
 *
 * Sparsam erhoben: **ein** Termin-Index je Behörde, danach seine Ordner von
 * neu nach alt, und abgebrochen, sobald für jedes 2026 anstehende Amt ein
 * Vorwert gefunden ist. Für die allermeisten Behörden sind das vier Abrufe –
 * Bundestag 2025, Europa 2024, Landtag 2022 und dann der Ordner, in dem 2021
 * alles steht.
 *
 * **Am Namen wird nichts ausgeschlossen.** Das war der erste Versuch und er
 * war falsch: Wendeburg führt seine Bürgermeisterwahl unter „Europawahl und
 * Wahl des/der Bürgermeisters/in“, und wer den Eintrag wegen „Europa“
 * überspringt, nimmt als Vorwert die Wahl von 2016 statt der von 2019. Ein
 * Fehlgriff, den niemand bemerkt hätte. Vier Abrufe je Behörde sind billiger
 * als diese Wette.
 *
 * Gearbeitet wird über den **Ordner**, nicht über das Datum des
 * Index-Eintrags. Beide fallen auseinander: Die Stichwahl vom 26.09.2021 zeigt
 * überall auf denselben Ordner `20210912` zurück, und Peine führt seine
 * Wiederholungswahl vom 03.10.2021 in einem eigenen Ordner `0120210912`.
 * Maßgeblich ist deshalb das `datum_string` der Präsentation selbst.
 *
 * Ergebnis: `scripts/quellen/nds-vorwerte.json` – je Behörde und Amt Datum,
 * Ordner, Schema und der amtliche Wahltitel.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { KREISE, wurzelVon } from "../src/data/kreise.ts";
import { parseTerminIndex } from "../src/data/termine.ts";
import { hostDrossel } from "../src/lib/drossel.ts";
import { type Wahltyp, erkenneWahltyp } from "../src/lib/wahltyp.ts";

const HIER = dirname(fileURLToPath(import.meta.url));

/** Der kommende Wahltag – alles davor kommt als Vorwert in Frage. */
const WAHLTAG = "2026-09-13";

/**
 * Wie weit zurück gesucht wird. Eine Amtszeit dauert in Niedersachsen fünf
 * Jahre; wer 2006 gewählt wurde, steht 2026 sicher nicht mehr im Amt. Die
 * Grenze verhindert nur, dass für ein Amt, das es 2021 gar nicht gab, die
 * ganze Index-Historie bis 2008 abgeklappert wird.
 */
const FRUEHESTENS = "2006-01-01";

/** Ämter, für die ein Vorwert gesucht wird (Stichwahlen zählen zum Amt). */
const AEMTER: Wahltyp[] = [
	"landrat",
	"kreistag",
	"buergermeister",
	"rat",
	"ortsrat",
];

/** Stichwahl und Hauptwahl besetzen dasselbe Amt. */
const amtVon = (typ: Wahltyp): Wahltyp | undefined => {
	if (typ === "landrat-stichwahl") return "landrat";
	if (typ === "buergermeister-stichwahl") return "buergermeister";
	return AEMTER.includes(typ) ? typ : undefined;
};

/**
 * „12.09.2021“ → „2021-09-12“.
 *
 * Nimmt das **erste** Datum der Zeichenkette: Wo Haupt- und Stichwahl in
 * derselben Präsentation stehen, schreibt die Wahlleitung beide Tage in
 * `datum_string` („12.09.2021 / 26.09.2021“). Gemeint ist der Wahltag.
 */
const isoVon = (deutsch: string): string => {
	const m = deutsch.match(/(\d{2})\.(\d{2})\.(\d{4})/);
	return m ? `${m[3]}-${m[2]}-${m[1]}` : deutsch;
};

const drossel = hostDrossel();
let anfragen = 0;

const hole = async (url: string): Promise<unknown | undefined> => {
	const host = new URL(url).host;
	await drossel.nimm(host);
	anfragen++;
	for (let versuch = 0; versuch < 3; versuch++) {
		try {
			const res = await fetch(url, {
				signal: AbortSignal.timeout(30_000),
				headers: { "user-agent": "wahlergebnisse-erhebung/1.0" },
			});
			if (!res.ok) return undefined;
			const text = await res.text();
			const anfang = text.trimStart()[0];
			if (anfang !== "{" && anfang !== "[") return undefined;
			return JSON.parse(text);
		} catch {
			if (versuch === 2) return undefined;
			await new Promise((r) => setTimeout(r, 500 * (versuch + 1)));
		}
	}
	return undefined;
};

type RohTermin = {
	datum_string?: string;
	wahleintraege?: Array<{ wahl?: { titel?: string } }>;
};

/**
 * Die Wahlen eines Termins bei einer Behörde – mit dem Schema, unter dem sie
 * gefunden wurden. Geraten wird nichts: erst das nach dem Datum erwartete
 * Schema, dann das andere. Beides ist nötig, weil drei Kreisbehörden ihre
 * 2021er Präsentation in v26 neu erzeugt haben.
 */
const holeTermin = async (
	wurzel: string,
	ordner: string,
	ags: string,
	datum: string,
): Promise<
	{ layout: "v22" | "v26"; datum: string; titel: string[] } | undefined
> => {
	const erst = datum <= "2022-10-09" ? "v22" : "v26";
	for (const layout of [erst, erst === "v22" ? "v26" : "v22"] as const) {
		const url =
			layout === "v22"
				? `${wurzel}${ordner}/${ags}/api/praesentation/termin.json`
				: `${wurzel}${ordner}/${ags}/daten/api/termin.json`;
		const roh = (await hole(url)) as RohTermin | undefined;
		if (!roh?.wahleintraege) continue;
		return {
			layout,
			// Das Datum der Präsentation selbst, nicht das des Index-Eintrags:
			// Der Stichwahl-Eintrag vom 26.09.2021 zeigt auf den Ordner der
			// Hauptwahl zurück und trüge sonst ein falsches Wahldatum ein.
			datum: roh.datum_string ? isoVon(roh.datum_string) : datum,
			titel: roh.wahleintraege
				.map((e) => e.wahl?.titel ?? "")
				.filter((t) => t !== ""),
		};
	}
	return undefined;
};

type VorwertEintrag = {
	amt: Wahltyp;
	/**
	 * Wahltag, **wie der Termin-Index ihn nennt** – und nur so ist er
	 * brauchbar: Der Poller sucht den Ordner einer Behörde über genau dieses
	 * Datum (`findeOrdner` in src/data/termine.ts). Wo mehrere Einträge auf
	 * denselben Ordner zeigen, gilt der früheste; die Stichwahl zwei Wochen
	 * später ist derselbe Termin.
	 */
	datum: string;
	/**
	 * Was die Präsentation selbst als Datum führt (`datum_string`).
	 *
	 * Steht hier etwas anderes, ist das kein Fehler, sondern eine
	 * Wiederholungswahl: Peine führt seine wiederholte Rats-, Bürgermeister-
	 * und Ortsratswahl vom 03.10.2021 im Ordner `0120210912`, und die
	 * Präsentation darin datiert weiter auf den 12.09.2021.
	 */
	datumString: string;
	ordner: string;
	layout: "v22" | "v26";
	/** Wie der Termin-Index diesen Ordner benennt (alle Einträge dazu) */
	terminNamen: string[];
	/** Die amtlichen Wahltitel dieses Amts an dem Tag (inkl. Stichwahl) */
	wahlen: string[];
	/** Gab es an dem Tag eine Stichwahl zu diesem Amt? */
	stichwahl: boolean;
	/**
	 * Zeigt im Index dieser Behörde noch ein **anderer** Ordner auf dasselbe
	 * Datum?
	 *
	 * Der Poller sucht den Ordner über das Datum und nimmt den ersten Treffer
	 * (`findeOrdner`). Wo zwei Ordner denselben Tag beanspruchen, wäre das ein
	 * Münzwurf – am 26.09.2021 etwa die Bundestagswahl im eigenen Ordner und
	 * die Stichwahl im Ordner der Kommunalwahl. Solche Termine dürfen nicht
	 * über das Datum angesprochen werden; der Erzeuger muss sie erkennen.
	 */
	mehrdeutig: boolean;
	/**
	 * Tag der Stichwahl laut Index, falls er als eigener Eintrag auf denselben
	 * Ordner zeigt („26.09.2021 | Stichwahl des Landrats“).
	 */
	stichwahlTag?: string;
};

type BehoerdeErgebnis = {
	kreis: string;
	ags: string;
	name: string;
	wurzel: string;
	/** Antwortet der Termin-Index der Behörde? */
	index: "ok" | "fehlt";
	/** Ämter, die am 13.09.2026 zur Wahl stehen */
	aemter2026: Wahltyp[];
	/** War die Präsentation zum 13.09.2026 abrufbar? */
	termin2026: boolean;
	/** Ordner des 13.09.2026 laut Index (bei Hannover `Wahl-2026-09-13`) */
	ordner2026?: string;
	vorwerte: VorwertEintrag[];
	/** Wie viele frühere Termine dafür angesehen wurden */
	geprueft: number;
	/** Ämter 2026 ohne jeden Vorwert */
	ohneVorwert: Wahltyp[];
	/**
	 * Termine, die der Index anbietet, deren Präsentation aber nicht mehr da
	 * ist (beide Schemata 404).
	 *
	 * Das ist kein Randfall: Der Landkreis Hameln-Pyrmont führt seine
	 * Landratswahl vom 08.03.2020 im Index, der Landkreis Schaumburg die vom
	 * 09.09.2018 – beide Ordner sind leer. Für diese Ämter gibt es 2026 keinen
	 * Vergleichswert, und das ist eine Tatsache über die Quelle, keine Lücke
	 * unserer Erhebung. Sie gehört deshalb aufgeschrieben.
	 */
	verschwunden: Array<{ datum: string; ordner: string; namen: string[] }>;
};

const argWert = (name: string): string | undefined =>
	process.argv.includes(name)
		? process.argv[process.argv.indexOf(name) + 1]
		: undefined;

const nurKreise = argWert("--kreise")?.split(",").filter(Boolean);
const ziel = argWert("--ziel") ?? join(HIER, "quellen", "nds-vorwerte.json");

const behoerdeErheben = async (
	kreisSlug: string,
	ags: string,
	name: string,
	wurzel: string,
): Promise<BehoerdeErgebnis> => {
	const basis: BehoerdeErgebnis = {
		kreis: kreisSlug,
		ags,
		name,
		wurzel,
		index: "fehlt",
		aemter2026: [],
		termin2026: false,
		vorwerte: [],
		geprueft: 0,
		ohneVorwert: [],
		verschwunden: [],
	};
	const roh = await hole(`${wurzel}${ags}/api/termine.json`);
	if (!roh) return basis;
	basis.index = "ok";
	const eintraege = parseTerminIndex(roh as never).map((e) => ({
		...e,
		iso: isoVon(e.datum),
	}));

	// Nur wofür 2026 gewählt wird, braucht einen Vorwert.
	const heute = eintraege.find((e) => e.iso === WAHLTAG);
	if (heute) {
		const t = await holeTermin(wurzel, heute.ordner, ags, WAHLTAG);
		basis.ordner2026 = heute.ordner;
		if (t) {
			basis.termin2026 = true;
			for (const titel of t.titel) {
				const amt = amtVon(erkenneWahltyp(titel, name));
				if (amt && !basis.aemter2026.includes(amt)) basis.aemter2026.push(amt);
			}
		}
	}
	// Wo der kommende Termin noch nicht ausgeliefert ist (Region Hannover,
	// Heidekreis, Salzgitter, Wolfsburg …), wird für alle Ämter gesucht: ein
	// Termin zu viel erhoben ist billiger als ein Vergleich, der später fehlt.
	const offen = new Set<Wahltyp>(
		basis.aemter2026.length > 0 ? basis.aemter2026 : AEMTER,
	);
	const gesucht = [...offen];

	// Ein Ordner, nicht ein Index-Eintrag, ist eine Präsentation: Die Stichwahl
	// vom 26.09.2021 zeigt auf denselben Ordner wie der 12.09.2021 zurück, und
	// beide zusammen ergeben einen Abruf, nicht zwei.
	//
	// Welches der Daten den Ordner benennt, ist damit noch nicht entschieden.
	// Der Poller sucht ihn über das Datum, also muss das Datum ihn eindeutig
	// treffen – und der früheste Eintrag tut das nicht immer: Goslar und Melle
	// führen ihre wiederholte Kommunalwahl (Ordner `0120210912`) sowohl unter
	// dem 26.09.2021 als auch unter dem 03.10.2021, und am 26.09.2021 liegt
	// dort außerdem die Bundestagswahl in ihrem eigenen Ordner. Genommen wird
	// deshalb das früheste Datum, das **nur** auf diesen Ordner zeigt.
	const ordnerJeDatum = new Map<string, Set<string>>();
	for (const e of eintraege) {
		const s = ordnerJeDatum.get(e.iso) ?? new Set<string>();
		s.add(e.ordner);
		ordnerJeDatum.set(e.iso, s);
	}
	const eindeutig = (iso: string): boolean =>
		(ordnerJeDatum.get(iso)?.size ?? 0) === 1;

	const ordner = new Map<string, { tage: string[]; namen: string[] }>();
	for (const e of eintraege) {
		if (e.iso >= WAHLTAG || e.iso < FRUEHESTENS) continue;
		const o = ordner.get(e.ordner);
		if (o) {
			o.namen.push(`${e.datum} ${e.name}`);
			o.tage.push(e.iso);
		} else
			ordner.set(e.ordner, {
				tage: [e.iso],
				namen: [`${e.datum} ${e.name}`],
			});
	}
	const kandidaten = [...ordner.entries()]
		.map(([ord, o]) => {
			const tage = [...o.tage].sort();
			const treffer = tage.find(eindeutig);
			return {
				ord,
				namen: o.namen,
				// Ohne eindeutiges Datum bleibt der früheste – dann ist der
				// Eintrag als `mehrdeutig` gekennzeichnet und der Erzeuger lässt
				// ihn liegen, statt den Poller raten zu lassen.
				tag: treffer ?? tage[0],
				mehrdeutig: treffer === undefined,
			};
		})
		.sort((a, b) => (a.tag < b.tag ? 1 : a.tag > b.tag ? -1 : 0));

	for (const info of kandidaten) {
		if (offen.size === 0) break;
		const ord = info.ord;
		const t = await holeTermin(wurzel, ord, ags, info.tag);
		basis.geprueft++;
		if (!t) {
			basis.verschwunden.push({
				datum: info.tag,
				ordner: ord,
				namen: info.namen,
			});
			continue;
		}
		const gefunden = new Map<
			Wahltyp,
			{ wahlen: string[]; stichwahl: boolean }
		>();
		for (const titel of t.titel) {
			const typ = erkenneWahltyp(titel, name);
			const amt = amtVon(typ);
			if (!amt || !offen.has(amt)) continue;
			const g = gefunden.get(amt) ?? { wahlen: [], stichwahl: false };
			g.wahlen.push(titel);
			if (typ.endsWith("-stichwahl")) g.stichwahl = true;
			gefunden.set(amt, g);
		}
		// Der eigene Index-Eintrag der Stichwahl nennt den Tag, an dem sie
		// stattfand – die Präsentation selbst datiert auf die Hauptwahl.
		const stichTag = eintraege.find(
			(e) => e.ordner === ord && /stichwahl/i.test(e.name),
		)?.iso;
		const mehrdeutig = info.mehrdeutig;
		for (const [amt, g] of gefunden) {
			basis.vorwerte.push({
				amt,
				datum: info.tag,
				datumString: t.datum,
				ordner: ord,
				layout: t.layout,
				terminNamen: info.namen,
				wahlen: g.wahlen,
				stichwahl: g.stichwahl,
				mehrdeutig,
				...(g.stichwahl && stichTag ? { stichwahlTag: stichTag } : {}),
			});
			offen.delete(amt);
		}
	}
	basis.ohneVorwert = gesucht.filter((a) => offen.has(a));
	return basis;
};

const kreise = KREISE.filter((k) => !nurKreise || nurKreise.includes(k.slug));
const aufgaben: Array<() => Promise<BehoerdeErgebnis>> = [];
for (const kreis of kreise)
	for (const b of kreis.behoerden)
		aufgaben.push(() =>
			behoerdeErheben(kreis.slug, b.ags, b.name, wurzelVon(kreis, b)),
		);

const ergebnisse: BehoerdeErgebnis[] = [];
const GLEICHZEITIG = 12;
let naechste = 0;
const t0 = Date.now();
await Promise.all(
	Array.from({ length: GLEICHZEITIG }, async () => {
		for (;;) {
			const i = naechste++;
			if (i >= aufgaben.length) return;
			ergebnisse.push(await aufgaben[i]());
			if (ergebnisse.length % 25 === 0)
				console.error(
					`  ${ergebnisse.length}/${aufgaben.length} Behörden, ${anfragen} Anfragen, ${((Date.now() - t0) / 1000).toFixed(0)} s`,
				);
		}
	}),
);

ergebnisse.sort((a, b) => a.ags.localeCompare(b.ags));
writeFileSync(ziel, `${JSON.stringify(ergebnisse, null, 1)}\n`);

const ausserhalb = ergebnisse.flatMap((e) =>
	e.vorwerte.filter((v) => v.datum !== "2021-09-12"),
);
console.error(`\nBehörden        ${ergebnisse.length}`);
console.error(
	`Index fehlt     ${ergebnisse.filter((e) => e.index === "fehlt").length}`,
);
console.error(`Anfragen        ${anfragen}`);
console.error(`Dauer           ${((Date.now() - t0) / 1000).toFixed(0)} s`);
console.error(
	`Ämter gesamt    ${ergebnisse.reduce((n, e) => n + e.vorwerte.length, 0)}`,
);
console.error(`davon ≠ 2021    ${ausserhalb.length}`);
console.error(`Datei           ${ziel}`);
