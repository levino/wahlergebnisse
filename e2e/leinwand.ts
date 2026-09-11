import type { Page } from "@playwright/test";
import { STEUERUNG } from "./ports.ts";

export type Haken = {
	text: string;
	grund: "dienst" | "kein-dienst" | "gesperrt";
	meldung?: string;
};

export const haken = (page: Page): Promise<Haken | null> =>
	page.evaluate(
		() => (window as unknown as { __ansage?: Haken }).__ansage ?? null,
	);

export const schubAusloesen = (
	page: Page,
	marken: string[],
	spitze: string,
): Promise<void> =>
	page.evaluate(
		({ marken, spitze }) => {
			for (const marke of marken) {
				const folie = document.querySelector<HTMLElement>(
					`.db-folie[data-marke="${marke}"]`,
				);
				if (!folie) throw new Error(`Folie fehlt: ${marke}`);
				folie.dataset.spitze = spitze;
			}
			document.dispatchEvent(new Event("astro:page-load"));
		},
		{ marken, spitze },
	);

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
