import type { Page } from "@playwright/test";
import { STEUERUNG } from "./ports.ts";

export type Haken = {
	url: string;
	grund:
		| "gespielt"
		| "keine-aufnahme"
		| "gesperrt"
		| "aus"
		| "verfallen"
		| "verdraengt"
		| "nachzug";
	meldung?: string;
};

export const haken = (page: Page): Promise<Haken | null> =>
	page.evaluate(
		() => (window as unknown as { __ansage?: Haken }).__ansage ?? null,
	);

/** Die Kennung, die der Server in die Leinwand geschrieben hat. */
export const kennung = async (page: Page): Promise<string> => {
	const wert = await page
		.locator("[data-dashboard]")
		.getAttribute("data-topic");
	if (!wert) throw new Error("Die Leinwand nennt keine Kennung");
	return wert;
};

export type NeuerToast = {
	marke: string;
	ort: string;
	wahl: string;
	art: string;
	text: string;
};

/**
 * Einen Beitrag hinterlegen, wie es der Poller täte.
 *
 * Den Weg dorthin nimmt die Steuerung des Testaufbaus, nicht die Anwendung:
 * Sie legt ihn über das Ablagemodul in dieselbe Datenbank. Die Anwendung
 * bekommt so keinen Pfad, über den sich von außen etwas hinterlegen ließe.
 */
export const beitragHinterlegen = async (args: {
	termin: string;
	topic: string;
	schluessel: string;
	toasts: NeuerToast[];
	aufnahme?: string;
}): Promise<number> => {
	const antwort = await fetch(`${STEUERUNG}/beitrag`, {
		method: "POST",
		body: JSON.stringify(args),
	});
	const daten = (await antwort.json()) as { id?: number; fehler?: string };
	if (!daten.id) throw new Error(`Beitrag nicht hinterlegt: ${daten.fehler}`);
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
