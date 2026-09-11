import type { Behoerde } from "./behoerden.ts";
import { type Kreis, KREISE, kreisBySlug, kreisbehoerdeVon } from "./kreise.ts";
import { VORWERT_TERMINE } from "./vorwert-termine.ts";

export type TerminLayout = "v22" | "v26";

/** Wo die Präsentation eines Termins bei einer bestimmten Behörde liegt. */
export type Fundort = { ordner: string; layout: TerminLayout };

export type Termin = {
	/** URL-Segment und Primärschlüssel, z. B. "2026" */
	id: string;
	titel: string;
	/** ISO-Datum des (ersten) Wahltags */
	datum: string;
	stichwahl?: string;
	/** Vorgabe für den Ordner auf dem Server (Wahldatum als JJJJMMTT) */
	ordner: string;
	/** Vorgabe für das Pfadschema */
	layout: TerminLayout;
	/** true → wird regelmäßig neu abgefragt; false → einmal vollständig geladen */
	live: boolean;
	abgeschlossen?: string;
	beschreibung: string;
};

const ausUmgebung = (): Set<string> =>
	new Set(
		(process.env.WAHLEN_ABGESCHLOSSEN ?? "")
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean),
	);

export const istAbgeschlossen = (termin: Termin): boolean =>
	Boolean(termin.abgeschlossen) || ausUmgebung().has(termin.id);

export const istLive = (termin: Termin): boolean =>
	termin.live && !istAbgeschlossen(termin);

const votemanagerBasis = (): string =>
	process.env.VOTEMANAGER_BASIS ?? "https://wahlen.kreis-hi.de/wahlen";

const LANDESWEITE_TERMINE: Termin[] = [
	{
		id: "2026",
		titel: "Kommunalwahl 2026",
		datum: "2026-09-13",
		stichwahl: "2026-09-27",
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

export const TERMINE: Termin[] = [
	...LANDESWEITE_TERMINE,
	...VORWERT_TERMINE,
].sort((a, b) => b.datum.localeCompare(a.datum));

export const terminById = (id: string): Termin | undefined =>
	TERMINE.find((t) => t.id === id);

export const terminGiltFuerKreis = (
	termin: Termin,
	kreisSlug: string,
): boolean => {
	if (termin.live) return true;
	const kreis = kreisBySlug(kreisSlug);
	if (!kreis) return false;
	const kreisbehoerde = kreisbehoerdeVon(kreis);
	return terminGiltFuerBehoerde(termin, kreis, kreisbehoerde ?? {});
};

export const terminGiltFuerBehoerde = (
	termin: Termin,
	kreis: { archive?: string[] },
	behoerde: { archive?: string[] },
): boolean =>
	termin.live
		? true
		: Boolean(
				kreis.archive?.includes(termin.id) ||
					behoerde.archive?.includes(termin.id),
			);

export const terminGiltIrgendwoImKreis = (
	termin: Termin,
	kreisSlug: string,
): boolean => {
	if (termin.live) return true;
	const kreis = kreisBySlug(kreisSlug);
	if (!kreis) return false;
	return (
		Boolean(kreis.archive?.includes(termin.id)) ||
		kreis.behoerden.some((b) => b.archive?.includes(termin.id))
	);
};

/** Kreis-Slugs, für die dieser Termin auf Kreisebene gilt. */
export const kreiseMitTermin = (termin: Termin): string[] =>
	KREISE.filter((k) => terminGiltFuerKreis(termin, k.slug)).map((k) => k.slug);

export const wahlleitungenMitTermin = (termin: Termin): string[] =>
	termin.live
		? []
		: KREISE.flatMap((k) =>
				terminGiltFuerKreis(termin, k.slug)
					? []
					: k.behoerden
							.filter((b) => b.archive?.includes(termin.id))
							.map((b) => `${k.slug}/${b.slug}`),
			);

/** Die Wahlleitungen eines Kreises, die diesen Termin führen. */
export const behoerdenMitTermin = (termin: Termin, kreis: Kreis): Behoerde[] =>
	kreis.behoerden.filter((b) => terminGiltFuerBehoerde(termin, kreis, b));

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

export const parseTerminIndex = (roh: RohTerminIndex): IndexEintrag[] => {
	const eintraege: IndexEintrag[] = [];
	for (const t of roh.termine ?? []) {
		const ordner = t.url?.match(/(?:^|\/)\.\.\/([^/]+)\//)?.[1];
		if (!ordner || !t.date) continue;
		eintraege.push({ datum: t.date, name: t.name ?? "", ordner });
	}
	return eintraege;
};

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

export const openDataUrl = (
	fundort: Fundort,
	ags: string,
	wurzel?: string,
): string =>
	fundort.layout === "v22"
		? `${apiBasisVon(fundort, ags, wurzel)}/open_data.json`
		: `${opendataBasisVon(fundort, ags, wurzel)}/open_data.json`;

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

export const praesentationUrl = (
	termin: Termin,
	ags: string,
	wurzel = "https://wahlen.kreis-hi.de/wahlen/",
): string => `${wurzel}${termin.ordner}/${ags}/praesentation/index.html`;
