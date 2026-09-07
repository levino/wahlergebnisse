/**
 * Wahltermine, die die App kennt.
 *
 * Ein Termin ist hier ein landesweiter Begriff („Kommunalwahl 2021“), kein
 * Ordner auf einem Server. **Wo** er bei einer Behörde liegt, sagt deren
 * Termin-Index (`<wurzel>/<ags>/api/termine.json`) – und das ist nicht überall
 * gleich:
 *
 *   - Der Ordner ist meist das Wahldatum (`20210912`), bei der Stadt Hannover
 *     aber `Wahl-2021-09-12`. Aus dem Datum lässt er sich also nicht raten.
 *   - Auch das Pfadschema gehört zur Behörde, nicht zum Jahr: Die 2021er
 *     Präsentation liegt fast überall im alten Schema (v22), die Region
 *     Hannover hat sie mit neuer Programmversion (v26) neu erzeugt.
 *   - Der Name unterscheidet sich von Kreis zu Kreis („Kommunalwahlen“,
 *     „Kreiswahl 2021“, „Wahl des Kreistages“, bei Wilhelmshaven steht als
 *     einziger Eintrag des Tages die Seniorenbeiratswahl). Gesucht wird
 *     deshalb über das **Wahldatum**, nicht über den Namen.
 *
 * Die beiden Pfadschemata:
 *
 *   v22 (bis 2022): <basis>/<ags>/api/praesentation/…, CSVs unter <basis>/<ags>/praesentation/
 *   v26 (ab 2023):  <basis>/<ags>/daten/api/…,         CSVs unter <basis>/<ags>/daten/opendata/
 *
 * Ordner und Schema im Termin unten sind die **Vorgabe**: Sie gelten, solange
 * der Index einer Behörde nichts anderes sagt. Der Poller löst den Fundort je
 * Behörde auf (`src/lib/poll.ts`), die Anzeige braucht ihn nicht.
 */
import { KREISE, kreisBySlug } from "./kreise.ts";

export type TerminLayout = "v22" | "v26";

/** Wo die Präsentation eines Termins bei einer bestimmten Behörde liegt. */
export type Fundort = { ordner: string; layout: TerminLayout };

export type Termin = {
	/** URL-Segment und Primärschlüssel, z. B. "2026" */
	id: string;
	titel: string;
	/** ISO-Datum des (ersten) Wahltags */
	datum: string;
	/** Vorgabe für den Ordner auf dem Server (Wahldatum als JJJJMMTT) */
	ordner: string;
	/** Vorgabe für das Pfadschema */
	layout: TerminLayout;
	/** true → wird regelmäßig neu abgefragt; false → einmal vollständig geladen */
	live: boolean;
	beschreibung: string;
};

/**
 * Rückfall-Wurzel der votemanager-Präsentation für Aufrufe ohne eigene
 * Angabe. Welche Wurzel wirklich gilt, weiß der Katalog (`wurzelVon` in
 * kreise.ts) – sie gehört zur Behörde, nicht zum Termin. Für Tests und
 * Offline-Entwicklung biegt VOTEMANAGER_BASIS beides auf den Mock in
 * test/mock-votemanager.ts um; der Termin-Ordner (20210912, …) bleibt gleich.
 */
const votemanagerBasis = (): string =>
	process.env.VOTEMANAGER_BASIS ?? "https://wahlen.kreis-hi.de/wahlen";

export const TERMINE: Termin[] = [
	{
		id: "2026",
		titel: "Kommunalwahl 2026",
		datum: "2026-09-13",
		ordner: "20260913",
		layout: "v26",
		live: true,
		beschreibung:
			"Landrats-, Kreistags-, Bürgermeister-, Rats- und Ortsratswahlen am 13. September 2026",
	},
	{
		id: "2021",
		titel: "Kommunalwahl 2021",
		datum: "2021-09-12",
		ordner: "20210912",
		layout: "v22",
		live: false,
		beschreibung:
			"Kommunalwahlen am 12. September 2021 mit Stichwahlen am 26. September 2021 – amtliche Endergebnisse",
	},
	{
		// Nur die Gemeinde Nordstemmen: die Amtszeit ihres Bürgermeisters läuft
		// versetzt zur Ratsperiode, deshalb ein eigener Wahltermin. Für die
		// anderen Behörden gibt es unter diesem Datum keine Präsentation.
		id: "2020",
		titel: "Bürgermeisterwahl Nordstemmen 2020",
		datum: "2020-09-13",
		ordner: "20200913",
		layout: "v22",
		live: false,
		beschreibung:
			"Wahl des Bürgermeisters der Gemeinde Nordstemmen am 13. September 2020 mit Stichwahl am 27. September 2020",
	},
];

export const terminById = (id: string): Termin | undefined =>
	TERMINE.find((t) => t.id === id);

/**
 * Liegt dieser Termin für den Kreis vor?
 *
 * Der laufende Termin gilt landesweit – ob eine Wahlleitung ihn schon
 * ausliefert, ist eine Frage des Tages und steht nicht hier (siehe
 * `Kreis.vorhanden` und die Nachschau im Poller). Ein Archivtermin gilt
 * dagegen nur dort, wo er im Termin-Index der Kreisbehörde steht; das hält der
 * Katalog fest (`Kreis.archive`, erhoben von scripts/kreise-erzeugen.ts).
 *
 * Schnittstelle und MCP-Endpunkt sagen damit „gibt es hier nicht“ statt eine
 * leere Liste zu liefern, die wie ein Ergebnis aussieht.
 */
export const terminGiltFuer = (termin: Termin, kreisSlug: string): boolean =>
	termin.live
		? true
		: Boolean(kreisBySlug(kreisSlug)?.archive?.includes(termin.id));

/** Kreis-Slugs, für die dieser Termin vorliegt. */
export const kreiseMitTermin = (termin: Termin): string[] =>
	KREISE.filter((k) => terminGiltFuer(termin, k.slug)).map((k) => k.slug);

/** Der Fundort, der ohne Auskunft des Termin-Index gilt. */
export const vorgabeFundort = (termin: Termin): Fundort => ({
	ordner: termin.ordner,
	layout: termin.layout,
});

/** Wahldatum, wie es im Termin-Index steht: "12.09.2021". */
export const indexDatum = (termin: Termin): string => {
	const [j, m, t] = termin.datum.split("-");
	return `${t}.${m}.${j}`;
};

/** Adresse des Termin-Index einer Behörde. */
export const terminIndexUrl = (ags: string, wurzel?: string): string =>
	wurzel
		? `${wurzel}${ags}/api/termine.json`
		: `${votemanagerBasis()}/${ags}/api/termine.json`;

export type RohTerminIndex = {
	termine?: Array<{ date?: string; name?: string; url?: string }>;
};

export type IndexEintrag = { datum: string; name: string; ordner: string };

/**
 * Termin-Index einer Behörde lesen.
 *
 * Die `url` eines Eintrags ist relativ zu `<wurzel>/<ags>/index.html`, also zu
 * `<wurzel>/`: `../20210912/03254000/praesentation/`. Der erste Abschnitt
 * dahinter ist der Ordner, den wir suchen – bei der Stadt Hannover eben
 * `Wahl-2021-09-12` statt eines Datums.
 */
export const parseTerminIndex = (roh: RohTerminIndex): IndexEintrag[] => {
	const eintraege: IndexEintrag[] = [];
	for (const t of roh.termine ?? []) {
		const ordner = t.url?.match(/(?:^|\/)\.\.\/([^/]+)\//)?.[1];
		if (!ordner || !t.date) continue;
		eintraege.push({ datum: t.date, name: t.name ?? "", ordner });
	}
	return eintraege;
};

/**
 * Der Ordner, in dem dieser Termin bei dieser Behörde liegt.
 *
 * Gesucht wird über das Wahldatum. Am selben Tag können mehrere Einträge
 * stehen (die Stichwahl zwei Wochen später verweist auf dieselbe Präsentation
 * zurück) – sie nennen denselben Ordner, deshalb genügt der erste.
 */
export const findeOrdner = (
	eintraege: IndexEintrag[],
	termin: Termin,
): string | undefined =>
	eintraege.find((e) => e.datum === indexDatum(termin))?.ordner;

/** Basis-URL eines Fundorts (Wurzel + Ordner), zur Laufzeit ausgewertet. */
export const fundortBasis = (fundort: Fundort, wurzel?: string): string =>
	wurzel
		? `${wurzel}${fundort.ordner}`
		: `${votemanagerBasis()}/${fundort.ordner}`;

/** Basis der JSON-API einer Behörde an einem Fundort. */
export const apiBasisVon = (
	fundort: Fundort,
	ags: string,
	wurzel?: string,
): string =>
	fundort.layout === "v22"
		? `${fundortBasis(fundort, wurzel)}/${ags}/api/praesentation`
		: `${fundortBasis(fundort, wurzel)}/${ags}/daten/api`;

/** Basis der Open-Data-CSVs einer Behörde an einem Fundort. */
export const opendataBasisVon = (
	fundort: Fundort,
	ags: string,
	wurzel?: string,
): string =>
	fundort.layout === "v22"
		? `${fundortBasis(fundort, wurzel)}/${ags}/praesentation`
		: `${fundortBasis(fundort, wurzel)}/${ags}/daten/opendata`;

/**
 * Adresse der Open-Data-Beschreibung (`open_data.json`).
 *
 * Sie steht **nicht** in beiden Schemata an derselben Stelle: In v22 liegt sie
 * bei der API (`…/api/praesentation/open_data.json`), in v26 bei den CSVs
 * (`…/daten/opendata/open_data.json`). Wer sie in v26 bei der API sucht,
 * bekommt 404 – und damit keine Parteizuordnung zu den Spalten D1, D2, … und
 * keine Listenplätze der Bewerber. Die `url` der CSVs darin ist in beiden
 * Fällen ein blanker Dateiname neben dieser Datei bzw. im CSV-Verzeichnis.
 */
export const openDataUrl = (
	fundort: Fundort,
	ags: string,
	wurzel?: string,
): string =>
	fundort.layout === "v22"
		? `${apiBasisVon(fundort, ags, wurzel)}/open_data.json`
		: `${opendataBasisVon(fundort, ags, wurzel)}/open_data.json`;

/**
 * Basis-URL des Termins mit seiner Vorgabe – für alles, was keinen
 * aufgelösten Fundort hat.
 */
export const terminBasis = (termin: Termin, wurzel?: string): string =>
	fundortBasis(vorgabeFundort(termin), wurzel);

/** Basis der JSON-API einer Behörde für einen Termin (Vorgabe-Fundort). */
export const apiBasis = (
	termin: Termin,
	ags: string,
	wurzel?: string,
): string => apiBasisVon(vorgabeFundort(termin), ags, wurzel);

/** Basis der Open-Data-CSVs einer Behörde für einen Termin (Vorgabe-Fundort). */
export const opendataBasis = (
	termin: Termin,
	ags: string,
	wurzel?: string,
): string => opendataBasisVon(vorgabeFundort(termin), ags, wurzel);

/**
 * Link auf die amtliche Präsentation (für Quellenangaben) – immer die echte
 * Seite der Wahlleitung, auch wenn wir gerade gegen einen Mock laufen.
 */
export const praesentationUrl = (
	termin: Termin,
	ags: string,
	wurzel = "https://wahlen.kreis-hi.de/wahlen/",
): string => `${wurzel}${termin.ordner}/${ags}/praesentation/index.html`;
