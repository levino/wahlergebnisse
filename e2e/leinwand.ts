import type { Page } from "@playwright/test";
import { BASIS, STEUERUNG } from "./ports.ts";

export type Haken = {
	url: string;
	grund: "gespielt" | "keine-aufnahme" | "gesperrt" | "aus";
	meldung?: string;
};

export const haken = (page: Page): Promise<Haken | null> =>
	page.evaluate(
		() => (window as unknown as { __ansage?: Haken }).__ansage ?? null,
	);

export type NeuerToast = {
	marke: string;
	ort: string;
	wahl: string;
	art: string;
	text: string;
};

/**
 * Ein Paket hinterlegen, wie es der Poller täte – bis Stufe 4 ihn baut.
 * Es geht über den Testgriff des Servers, den es nur unter
 * `WAHLEN_TESTGRIFF=1` gibt.
 */
export const beitragHinterlegen = async (args: {
	termin: string;
	topic: string;
	schluessel: string;
	toasts: NeuerToast[];
	aufnahme?: string;
}): Promise<number> => {
	const antwort = await fetch(`${BASIS}/api/beitrag/testgriff`, {
		method: "POST",
		body: JSON.stringify(args),
	});
	const daten = (await antwort.json()) as { id?: number; fehler?: string };
	if (!daten.id) throw new Error(`Paket nicht hinterlegt: ${daten.fehler}`);
	return daten.id;
};

/** Dem Client sagen, dass es etwas Neues gibt – wie es das Ping täte. */
export const pingen = (page: Page, kennung: number): Promise<void> =>
	page.evaluate(
		(k) =>
			document.dispatchEvent(
				new CustomEvent("wahlen:beitrag", { detail: { kennung: k } }),
			),
		kennung,
	) as Promise<void>;

export type Protokollzeile = {
	art: "stimme" | "moderation" | "unbekannt";
	schluessel: string;
	bekannt: boolean;
};

/** Was die nachgestellte Gegenstelle seit dem letzten Zurücksetzen gesehen hat. */
export const gegenstelle = async (): Promise<{
	anfragen: Protokollzeile[];
	unbekannte: string[];
}> => (await fetch(`${STEUERUNG}/ansage/anfragen`)).json();

/** Zähler **und** erzeugte Dateien zurück auf null. */
export const gegenstelleZuruecksetzen = async (): Promise<void> => {
	await fetch(`${STEUERUNG}/ansage/zuruecksetzen`);
};

/** Die Gegenstelle antwortet ab jetzt mit diesem Status; 0 hebt es auf. */
export const gegenstelleAusfall = async (status: number): Promise<void> => {
	await fetch(`${STEUERUNG}/ansage/ausfall?status=${status}`);
};

export const aufrufe = (
	zeilen: Protokollzeile[],
	art: "stimme" | "moderation",
): Protokollzeile[] => zeilen.filter((z) => z.art === art);
