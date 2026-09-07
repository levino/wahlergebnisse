/**
 * Wahltermine, die die App kennt. Die Daten kommen aus der votemanager-
 * Wahlpräsentation des Landkreises (wahlen.kreis-hi.de). Die beiden Termine
 * benutzen unterschiedliche Programmversionen mit unterschiedlichem Pfad-Layout:
 *
 *   v22 (2021): <basis>/<ags>/api/praesentation/…, CSVs unter <basis>/<ags>/praesentation/
 *   v26 (2026): <basis>/<ags>/daten/api/…,         CSVs unter <basis>/<ags>/daten/opendata/
 */
export type TerminLayout = "v22" | "v26";

export type Termin = {
	/** URL-Segment und Primärschlüssel, z. B. "2026" */
	id: string;
	titel: string;
	/** ISO-Datum des (ersten) Wahltags */
	datum: string;
	/** Ordner des Termins auf dem votemanager-Server (Wahldatum als JJJJMMTT) */
	ordner: string;
	layout: TerminLayout;
	/** true → wird regelmäßig neu abgefragt; false → einmal vollständig geladen */
	live: boolean;
	beschreibung: string;
	/**
	 * Kreise, für die dieser Termin vorliegt (Slugs). Fehlt die Angabe, gilt er
	 * landesweit. Die Archivtermine sind nur für Hildesheim eingelesen – für die
	 * übrigen 44 Kreise hätte ein Archivlauf mehrere hunderttausend Anfragen an
	 * fremde Server bedeutet, ohne dass sie jemand angefragt hätte.
	 */
	nurKreise?: string[];
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
		nurKreise: ["hildesheim"],
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
		nurKreise: ["hildesheim"],
		beschreibung:
			"Wahl des Bürgermeisters der Gemeinde Nordstemmen am 13. September 2020 mit Stichwahl am 27. September 2020",
	},
];

export const terminById = (id: string): Termin | undefined =>
	TERMINE.find((t) => t.id === id);

/**
 * Liegt dieser Termin für den Kreis vor? Ohne `nurKreise` gilt er landesweit.
 * Der Poller entscheidet danach, wen er überhaupt abfragt; Schnittstelle und
 * MCP-Endpunkt sagen damit „gibt es hier nicht“ statt eine leere Liste zu
 * liefern, die wie ein Ergebnis aussieht.
 */
export const terminGiltFuer = (termin: Termin, kreisSlug: string): boolean =>
	!termin.nurKreise || termin.nurKreise.includes(kreisSlug);

/**
 * Basis-URL des Termins (Wurzel + Termin-Ordner), zur Laufzeit ausgewertet.
 * `wurzel` (mit Schrägstrich am Ende) kommt aus dem Katalog; ohne Angabe gilt
 * die Rückfall-Wurzel.
 */
export const terminBasis = (termin: Termin, wurzel?: string): string =>
	wurzel
		? `${wurzel}${termin.ordner}`
		: `${votemanagerBasis()}/${termin.ordner}`;

/** Basis der JSON-API einer Behörde für einen Termin. */
export const apiBasis = (
	termin: Termin,
	ags: string,
	wurzel?: string,
): string =>
	termin.layout === "v22"
		? `${terminBasis(termin, wurzel)}/${ags}/api/praesentation`
		: `${terminBasis(termin, wurzel)}/${ags}/daten/api`;

/** Basis der Open-Data-CSVs einer Behörde für einen Termin. */
export const opendataBasis = (
	termin: Termin,
	ags: string,
	wurzel?: string,
): string =>
	termin.layout === "v22"
		? `${terminBasis(termin, wurzel)}/${ags}/praesentation`
		: `${terminBasis(termin, wurzel)}/${ags}/daten/opendata`;

/**
 * Link auf die amtliche Präsentation (für Quellenangaben) – immer die echte
 * Seite der Wahlleitung, auch wenn wir gerade gegen einen Mock laufen.
 */
export const praesentationUrl = (
	termin: Termin,
	ags: string,
	wurzel = "https://wahlen.kreis-hi.de/wahlen/",
): string => `${wurzel}${termin.ordner}/${ags}/praesentation/index.html`;
