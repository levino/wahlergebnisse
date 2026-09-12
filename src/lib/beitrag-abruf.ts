import { type LiveOrt, ortsParameter } from "./live-kanal.ts";
import type { MeldungsArt } from "./meldungen.ts";

export const BEITRAEGE_PFAD = "/api/beitraege";
export const BEITRAG_PFAD = "/api/beitrag";

/** Die vorbereitete Aufnahme des Probeknopfs – derselbe Weg wie ein Beitrag. */
export const TONPROBE_PFAD = "/api/tonprobe.mp3";

/** Was auf der Leinwand erscheint – und das Einzige, was der Client sieht. */
export type BeitragToast = {
	marke: string;
	ort: string;
	wahl: string;
	art: MeldungsArt;
	text: string;
	anz?: number;
	max?: number;
	prozent?: number;
	/**
	 * Nur für wen diese Einstellung gilt – `undefined` heißt: für alle.
	 *
	 * Steht ausschließlich in der Ablage. Der Abruf gibt jedem Zuschauer die
	 * Einblender für alle plus die seiner eingestellten Partei und streicht das
	 * Feld heraus; der Browser bekommt es nie zu sehen.
	 */
	partei?: string;
};

export type BeitragAnsicht = {
	id: number;
	zeit: string;
	toasts: BeitragToast[];
	/** Adresse der Aufnahme; fehlt, wenn zu diesem Beitrag keine entstand. */
	aufnahme?: string;
};

export type BeitraegeAntwort = {
	topic: string;
	/** Höchste Kennung des Topics – auch dann, wenn der Deckel gekürzt hat. */
	letzte: number;
	beitraege: BeitragAnsicht[];
};

export const aufnahmeUrl = (id: number): string => `${BEITRAG_PFAD}/${id}.mp3`;

/** Derselbe Ort wie an der Leitung – Abruf und Zustellung meinen denselben. */
export type BeitragOrt = LiveOrt & { topic: string };

/** Ab welcher Kennung abgerufen wird. */
export const SEIT_PARAM = "seit";

export const beitraegeUrl = (ort: BeitragOrt, seit: number): string => {
	const p = ortsParameter(ort);
	p.set(SEIT_PARAM, String(seit));
	return `${BEITRAEGE_PFAD}?${p}`;
};

export type BeitragSchub = {
	/** Alles Neue, älteste zuerst. */
	beitraege: BeitragAnsicht[];
	/** Stand, auf den der Zeiger danach steht. */
	kennung: number;
	/** Es gab mehr, als der Deckel hergab – der Zeiger springt. */
	uebersprungen: boolean;
};

/**
 * Der Zeiger auf den zuletzt gesehenen Beitrag.
 *
 * Vor dem ersten Ping steht er auf `undefined`: Die Leinwand meldet beim
 * Aufbau nichts, sondern merkt sich bloß, wo der Abend steht.
 */
export const beitragZeiger = (hole: typeof fetch = fetch) => {
	let kennung: number | undefined;
	let laeuft = false;

	return {
		stand: (): number | undefined => kennung,
		/** Nur für Tests und den Neuaufbau nach einem Seitentausch. */
		setze: (n: number | undefined): void => {
			kennung = n;
		},
		hole: async (
			ort: BeitragOrt,
			bis: number,
		): Promise<BeitragSchub | undefined> => {
			if (kennung === undefined) {
				kennung = bis;
				return undefined;
			}
			if (bis <= kennung || laeuft) return undefined;
			laeuft = true;
			try {
				const antwort = await hole(beitraegeUrl(ort, kennung));
				if (!antwort.ok) return undefined;
				const daten = (await antwort.json()) as BeitraegeAntwort;
				const beitraege = Array.isArray(daten.beitraege) ? daten.beitraege : [];
				const letzte = Number(daten.letzte) || 0;
				const gesehen = beitraege.at(-1)?.id ?? kennung;
				const uebersprungen = letzte > gesehen;
				kennung = Math.max(kennung, letzte, gesehen);
				return { beitraege, kennung, uebersprungen };
			} finally {
				laeuft = false;
			}
		},
	};
};
