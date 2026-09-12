import type { MeldungsArt } from "./meldungen.ts";

export const BEITRAEGE_PFAD = "/api/beitraege";
export const BEITRAG_PFAD = "/api/beitrag";

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

export type BeitragOrt = {
	termin: string;
	/** Die Kennung, die der Server in die Seite geschrieben hat. */
	topic: string;
	/** Eingestellte Partei des Zuschauers – sie schneidet ein eigenes Topic. */
	partei?: string;
};

export const beitraegeUrl = (ort: BeitragOrt, seit: number): string => {
	const p = new URLSearchParams({ termin: ort.termin, topic: ort.topic });
	if (ort.partei) p.set("partei", ort.partei);
	p.set("seit", String(seit));
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
