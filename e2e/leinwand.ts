/**
 * Handgriffe, die jeder Leinwand-Test braucht.
 *
 * Playwright kann nicht hören. Prüfbar ist, was `lib/stimme.ts` in
 * `window.__ansage` ablegt: welcher Satz mit welcher Stimme **angefordert**
 * wurde und warum es gegebenenfalls still blieb.
 */
import type { Page } from "@playwright/test";
import { STEUERUNG } from "./ports.ts";

export type Haken = {
	text: string;
	stimme: string;
	grund:
		| "dienst"
		| "browser"
		| "wartet"
		| "keine-stimme"
		| "kein-dienst"
		| "gesperrt";
};

/**
 * Eine Sprachausgabe mit den Stimmen, die auf einem Mac stünden.
 *
 * Ein headless Chromium hat keine einzige Stimme, und ein Test, der von den
 * Stimmen des Testrechners abhinge, sagte nichts.
 */
export const stimmenNachstellen = async (
	page: Page,
	stimmen: { name: string; lang: string }[],
): Promise<void> => {
	await page.addInitScript((liste) => {
		class Rede {
			text: string;
			voice: unknown = null;
			lang = "";
			rate = 1;
			pitch = 1;
			constructor(t: string) {
				this.text = t;
			}
		}
		const gesprochen: unknown[] = [];
		Object.defineProperty(window, "SpeechSynthesisUtterance", {
			configurable: true,
			value: Rede,
		});
		Object.defineProperty(window, "speechSynthesis", {
			configurable: true,
			value: {
				pending: false,
				getVoices: () =>
					liste.map((s) => ({ ...s, voiceURI: s.name, localService: true })),
				speak: (r: unknown) => gesprochen.push(r),
				cancel: () => {},
				addEventListener: () => {},
				removeEventListener: () => {},
			},
		});
	}, stimmen);
};

export const haken = (page: Page): Promise<Haken | null> =>
	page.evaluate(
		() => (window as unknown as { __ansage?: Haken }).__ansage ?? null,
	);

/**
 * Einen Schub auslösen: Auf allen genannten Folien wechselt die Spitze.
 *
 * Ein einziges `astro:page-load` für alle – genau darum geht es. Mehrere
 * Meldungen, ein Schub, ein gesprochener Satz.
 */
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
