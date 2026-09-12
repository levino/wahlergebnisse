import { ebeneVonGebietId } from "./votemanager.ts";

/** Ebenennummer → Bezeichnung, so wie die Wahlleitung die Ebene benennt. */
export type Ebenennamen = ReadonlyMap<number, string>;

/** Eine Ebene, wie `wahl.json` sie unter `menu_links` ankündigt. */
export type AngekuendigteEbene = { ebene: string; titel: string };

/**
 * Die Schreibweisen, mit denen die niedersächsischen Wahlleitungen ihre
 * Ebenen benennen, auf die Bezeichnungen dieser Anwendung. Was hier nicht
 * steht, behält den Namen der Quelle.
 */
const MUSTER: Array<[RegExp, string]> = [
	[/wahlbereich/i, "Wahlbereich"],
	[/briefwahl/i, "Briefwahl"],
	[/ortsrat|ortschaft|ortsteil/i, "Ortsteil"],
	[/stadtbezirk|stadtteil/i, "Stadtbezirk"],
	[/wahlbezirk|stimmbezirk/i, "Wahlbezirk"],
	[/gemeinde|kommune/i, "Gemeinde"],
	[/kreis/i, "Kreis"],
];

/**
 * Ebenennummern der älteren Präsentationen (`v22`). Ab `v26` vergibt die
 * Quelle je Präsentation eigene, negative Nummern; dann trägt allein die
 * Bezeichnung aus `menu_links`.
 */
const NACH_NUMMER: Record<number, string> = {
	1: "Kreis",
	3: "Gemeinde",
	5: "Wahlbereich",
	6: "Wahlbezirk",
	8: "Ortsteil",
	9: "Wahlbereich",
};

export const ebenenBezeichnung = (titel: string): string =>
	MUSTER.find(([re]) => re.test(titel))?.[1] ?? titel.trim();

const nummerVon = (ebene: string): number => ebeneVonGebietId(`${ebene}_id_0`);

export const ebenennamen = (
	angekuendigt: Iterable<AngekuendigteEbene>,
): Ebenennamen => {
	const namen = new Map<number, string>();
	for (const { ebene, titel } of angekuendigt) {
		const nummer = nummerVon(ebene);
		const name = ebenenBezeichnung(titel);
		if (Number.isFinite(nummer) && name) namen.set(nummer, name);
	}
	return namen;
};

/** Ebenenbezeichnung eines Gebiets ("Wahlbereich", "Wahlbezirk", …). */
export const ebeneVon = (gebietId: string, namen?: Ebenennamen): string => {
	const n = ebeneVonGebietId(gebietId);
	return namen?.get(n) ?? NACH_NUMMER[n] ?? "Gebiet";
};

/**
 * Ebenen, die die Wahlleitung ankündigt, zu denen sie aber kein Gebiet
 * veröffentlicht hat – in der Schreibweise der Quelle ("Kreiswahlbereiche").
 */
export const leereEbenen = (
	angekuendigt: readonly AngekuendigteEbene[],
	gebietIds: Iterable<string>,
): string[] => {
	const belegt = new Set<number>();
	for (const id of gebietIds) belegt.add(ebeneVonGebietId(id));
	return angekuendigt
		.filter(({ ebene }) => {
			const n = nummerVon(ebene);
			return Number.isFinite(n) && !belegt.has(n);
		})
		.map((e) => e.titel);
};
