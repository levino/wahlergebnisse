/**
 * „Meine Partei“ – die eine Einstellung, die den Wahlabend persönlich macht.
 *
 * Wer im Saal steht, sieht nicht auf ein Nachrichtenportal, sondern auf **sein**
 * Ergebnis. Ist die Partei gewählt, färbt sich die Oberfläche in ihre Farbe,
 * und die Leinwand meldet, was mit ihr passiert: ein Platz nach vorn, ein Sitz
 * mehr, ein Prozentpunkt dazu – mit Ton (siehe `klang.ts`) und Ansage (siehe
 * `stimme.ts`).
 *
 * **Nur im Browser, nicht auf dem Server.** Die Wahl ist der Wunsch dessen, der
 * vor dem Gerät sitzt, und keine Eigenschaft der Zahlen. Sie steht deshalb im
 * `localStorage` – dieselbe Schublade wie Ton und Ansage – und nicht in der
 * Adresse: Ein Verweis auf eine Folie, den jemand im Saal weiterschickt, soll
 * nicht die Parteifarbe des Absenders mitbringen.
 *
 * **Die Balken ändern sich nie.** Gefärbt wird der Rahmen – Leiste, Grund,
 * Akzente. Ein Balken trägt die Farbe seiner Partei, und daran rührt keine
 * Einstellung: Sonst zeigte die Leinwand ein anderes Ergebnis, je nachdem, wer
 * davorsteht.
 */
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

/**
 * Was im Speicher steht, in eine Auswahl zurückverwandeln.
 *
 * Rein und ohne Browser, damit die Regel prüfbar bleibt: Alles, was nicht
 * vollständig ist, gilt als „keine Partei gewählt“. Ein halb gespeicherter
 * Eintrag – etwa aus einer früheren Fassung – darf die Seite nicht in eine
 * Farbe werfen, die niemand gewählt hat.
 */
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
		// Kein Zugriff auf den Speicher (privates Fenster): dann eben keine.
		return undefined;
	}
};

export const setzeMeinePartei = (p: MeinePartei | undefined): void => {
	try {
		if (p) localStorage.setItem(PARTEI_SCHLUESSEL, schreibAuswahl(p));
		else localStorage.removeItem(PARTEI_SCHLUESSEL);
	} catch {
		// Nicht speicherbar – gilt dann nur für diese Sitzung.
	}
};

/** Die Custom-Properties, unter denen die Stile die Farben finden. */
const MERKMALE: Array<[string, keyof ParteiThema]> = [
	["--partei-farbe", "farbe"],
	["--partei-schrift", "schrift"],
	["--partei-akzent", "akzent"],
	["--partei-grund", "grund"],
];

/**
 * Die gewählte Farbe an das `<html>`-Element schreiben.
 *
 * **Warum nach jedem Seitentausch neu.** Astro räumt beim Tausch alle
 * Attribute vom `<html>`-Element ab (`swapRootAttributes`) – Merkmal und
 * Custom-Properties wären danach weg. Am Wahlabend passiert dieser Tausch alle
 * paar Minuten: Die Seite fiele bei jeder neuen Schnellmeldung aus der
 * Parteifarbe. Der Aufruf gehört deshalb in `astro:after-swap` (siehe
 * Layout.astro) und läuft dort, bevor das Bild steht.
 */
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
