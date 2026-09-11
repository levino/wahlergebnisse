import type { Page } from "@playwright/test";
import { BASIS, STEUERUNG } from "./ports.ts";

export type Haken = {
	text: string;
	grund: "dienst" | "kein-dienst" | "gesperrt";
	meldung?: string;
};

/**
 * Wartet, bis der Server den Ansagedienst wieder als vorhanden meldet.
 *
 * Ein Test mit abgewiesenem Schlüssel schließt den Riegel im App-Prozess. Das
 * Zurücksetzen ist eine eigene Anfrage, und ohne dieses Warten beginnt der
 * nächste Test, bevor sie gewirkt hat.
 */
export const warteAufDienst = async (
	behoerde = "03254026",
	fristMs = 10_000,
): Promise<void> => {
	const ende = Date.now() + fristMs;
	while (Date.now() < ende) {
		const stand = await fetch(
			`${BASIS}/api/ansage/stand?behoerde=${behoerde}`,
		).then((a) => a.json() as Promise<{ verfuegbar?: boolean }>);
		if (stand.verfuegbar) return;
		await new Promise((f) => setTimeout(f, 100));
	}
	throw new Error("Ansagedienst meldet sich nicht als vorhanden");
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
