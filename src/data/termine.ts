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
};

/**
 * Basis der votemanager-Präsentation. Für Tests und Offline-Entwicklung lässt
 * sich der Server über VOTEMANAGER_BASIS umbiegen (z. B. auf den Mock in
 * test/mock-votemanager.ts); der Termin-Ordner (20210912, …) bleibt gleich.
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

/** Basis-URL des Termins (Server + Termin-Ordner), zur Laufzeit ausgewertet. */
export const terminBasis = (termin: Termin): string =>
	`${votemanagerBasis()}/${termin.ordner}`;

/** Basis der JSON-API einer Behörde für einen Termin. */
export const apiBasis = (termin: Termin, ags: string): string =>
	termin.layout === "v22"
		? `${terminBasis(termin)}/${ags}/api/praesentation`
		: `${terminBasis(termin)}/${ags}/daten/api`;

/** Basis der Open-Data-CSVs einer Behörde für einen Termin. */
export const opendataBasis = (termin: Termin, ags: string): string =>
	termin.layout === "v22"
		? `${terminBasis(termin)}/${ags}/praesentation`
		: `${terminBasis(termin)}/${ags}/daten/opendata`;

/** Link auf die amtliche Präsentation (für Quellenangaben) – immer die echte Seite des Landkreises. */
export const praesentationUrl = (termin: Termin, ags: string): string =>
	`https://wahlen.kreis-hi.de/wahlen/${termin.ordner}/${ags}/praesentation/index.html`;
