import { type ParteiThema, parteiThema } from "./farben.ts";

/** Wo der Wunsch des Nutzers steht – dieselbe Schublade wie Ton und Ansage. */
export const PARTEI_SCHLUESSEL = "wahlen:partei";

/** Die gewählte Partei, so wie sie in der Auswahl stand. */
export type MeinePartei = {
	/** Normalisierter Kurzname (siehe `parteiKey`) – daran hängt der Vergleich. */
	key: string;
	/** Anzeigename, wie ihn die Wahlleitung schreibt ("CDU", "GRÜNE"). */
	kurz: string;
	/** Farbe dieser Partei, wie sie mit dem Ergebnis kam. */
	farbe: string;
};

export const liesAuswahl = (text: string | null): MeinePartei | undefined => {
	if (!text) return undefined;
	try {
		const roh = JSON.parse(text) as Partial<MeinePartei>;
		if (!roh || typeof roh !== "object") return undefined;
		const { key, kurz, farbe } = roh;
		if (typeof key !== "string" || !key) return undefined;
		if (typeof kurz !== "string" || !kurz) return undefined;
		if (typeof farbe !== "string" || !farbe) return undefined;
		return { key, kurz, farbe };
	} catch {
		return undefined;
	}
};

export const schreibAuswahl = (p: MeinePartei): string => JSON.stringify(p);

export const meinePartei = (): MeinePartei | undefined => {
	try {
		return liesAuswahl(localStorage.getItem(PARTEI_SCHLUESSEL));
	} catch {
		return undefined;
	}
};

export const setzeMeinePartei = (p: MeinePartei | undefined): void => {
	try {
		if (p) localStorage.setItem(PARTEI_SCHLUESSEL, schreibAuswahl(p));
		else localStorage.removeItem(PARTEI_SCHLUESSEL);
	} catch {}
};

/** Die Custom-Properties, unter denen die Stile die Farben finden. */
const MERKMALE: Array<[string, keyof ParteiThema]> = [
	["--partei-farbe", "farbe"],
	["--partei-schrift", "schrift"],
	["--partei-akzent", "akzent"],
	["--partei-grund", "grund"],
];

export const themaAnwenden = (
	partei: MeinePartei | undefined = meinePartei(),
	wurzel: HTMLElement = document.documentElement,
): void => {
	if (!partei) {
		wurzel.removeAttribute("data-partei");
		for (const [merkmal] of MERKMALE) wurzel.style.removeProperty(merkmal);
		return;
	}
	const thema = parteiThema(partei.farbe);
	wurzel.dataset.partei = partei.key;
	for (const [merkmal, wert] of MERKMALE)
		wurzel.style.setProperty(merkmal, thema[wert]);
};
