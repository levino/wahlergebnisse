import { ZUORDNUNG_2026 } from "./wahlzuordnung/2026.ts";
import { ZUORDNUNG_ARCHIV } from "./wahlzuordnung/archiv.ts";

export type Wahlart =
	| "landrat"
	| "landrat-stichwahl"
	| "kreistag"
	| "buergermeister"
	| "buergermeister-stichwahl"
	| "rat"
	| "ortsrat"
	| "sonstige"
	| "unbekannt";

/**
 * Was eine Wahl bei uns ist – von Hand hingeschrieben, nicht aus dem Titel der
 * Wahlleitung abgeleitet.
 *
 * `[Wahlart, Beschriftung, Gebiet?, Gremium?, Adresse?]`
 *
 * - **Gebiet** fehlt, wenn die Behörde selbst gewählt wird.
 * - **Gremium** trägt nur die Ortsebene und nur, wenn es nicht der Ortsrat ist.
 * - **Adresse** fehlt, wenn sie sich aus Wahlart und Gebiet ergibt.
 */
export type Zuordnung = readonly [
	art: Wahlart,
	wahl: string,
	gebiet?: string,
	gremium?: string,
	adresse?: string,
];

/** Schlüssel: `Behörde/Wahl-Id`, bei mehreren Gebieten `Behörde/Wahl-Id/Gebiets-Id`. */
export type Zuordnungen = Readonly<Record<string, Zuordnung>>;

const NACH_TERMIN: Record<string, Zuordnungen> = {
	...ZUORDNUNG_ARCHIV,
	"2026": ZUORDNUNG_2026,
};

export const zuordnung = (
	termin: string,
	behoerde: string,
	wahlId: number,
	gebietId = "",
): Zuordnung | undefined => {
	const tabelle = NACH_TERMIN[termin];
	if (!tabelle) return undefined;
	return (
		tabelle[`${behoerde}/${wahlId}/${gebietId}`] ??
		tabelle[`${behoerde}/${wahlId}`]
	);
};

/**
 * Trägt Wahlen nach, die nur ein erfundener Bestand kennt.
 *
 * Die Fixtures der Tests legen Wahlleitungen an, die es nicht gibt; ihre
 * Zuordnung gehört zum Fixture, nicht in die Tabelle. Im Betrieb ruft das
 * niemand auf – dort wird nachgetragen, indem man die Tabelle ändert.
 */
export const ergaenzeZuordnung = (
	termin: string,
	eintraege: Zuordnungen,
): void => {
	NACH_TERMIN[termin] = { ...NACH_TERMIN[termin], ...eintraege };
};

/**
 * Trägt die Wahlen einer Behörde unter einer zweiten Kennung nach.
 *
 * Die Fixtures der Tests spiegeln den Bestand einer Behörde unter fremde
 * Gebietsschlüssel – dieselbe Wahl steht dann unter zwei Kennungen.
 */
export const spiegleZuordnung = (von: string, nach: string): void => {
	for (const [termin, tabelle] of Object.entries(NACH_TERMIN)) {
		const gespiegelt: Record<string, Zuordnung> = { ...tabelle };
		for (const [schluessel, z] of Object.entries(tabelle))
			if (schluessel.startsWith(`${von}/`))
				gespiegelt[`${nach}/${schluessel.slice(von.length + 1)}`] = z;
		NACH_TERMIN[termin] = gespiegelt;
	}
};

/** Testdatensätze der Wahlleitungen – kein Wahlergebnis. */
export const TESTWAHLEN: ReadonlySet<string> = new Set(["2026/03461009/2187"]);
