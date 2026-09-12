import type { Db } from "./db.ts";
import { jetzt, transaktion } from "./db.ts";
import type { BeitragToast } from "./beitrag-abruf.ts";
import { MELDUNGS_RANG } from "./meldungen.ts";
import { schreibtDieserProzess } from "./rolle.ts";

export type { BeitragToast };

export type Beitrag = {
	id: number;
	termin: string;
	topic: string;
	zeit: string;
	/** Dateiname unter `ansagenVerzeichnis()`; fehlt, wenn keine Aufnahme entstand. */
	aufnahme?: string;
	toasts: BeitragToast[];
};

export type NeuerBeitrag = {
	termin: string;
	/** Die Kennung der Seite, wie `topicFuer` in `stand.ts` sie bildet. */
	topic: string;
	/** Identität des Schubs; derselbe Wert legt keinen zweiten Beitrag an. */
	schluessel: string;
	aufnahme?: string;
	toasts: BeitragToast[];
};

type Zeile = {
	id: number;
	termin: string;
	topic: string;
	zeit: string;
	aufnahme: string | null;
	json: string;
};

/** Nur diese Felder liegen in der Ablage – siehe `BeitragToast`. */
const sauberer = (t: BeitragToast): BeitragToast => ({
	marke: t.marke,
	ort: t.ort,
	wahl: t.wahl,
	art: t.art,
	text: t.text,
	...(t.anz === undefined ? {} : { anz: t.anz }),
	...(t.max === undefined ? {} : { max: t.max }),
	...(t.prozent === undefined ? {} : { prozent: t.prozent }),
	...(t.partei === undefined ? {} : { partei: t.partei }),
});

/**
 * Die Einblender eines Beitrags für einen Zuschauer – die Parteibrille.
 *
 * Ein Beitrag gilt allen, die diese Seite offen haben; ob jemand eine Partei
 * eingestellt hat, ist keine Eigenschaft des Zuschnitts. Deshalb trägt ein
 * Beitrag beides: die Einblender für alle und die je Partei. Wer keine
 * eingestellt hat, bekommt die für alle – und geht nie leer aus.
 */
export const fuerPartei = (
	toasts: readonly BeitragToast[],
	parteiKey?: string,
): BeitragToast[] =>
	toasts
		.filter((t) => !t.partei || t.partei === parteiKey)
		.map(({ partei, ...rest }) => rest)
		.sort(
			(x, y) => MELDUNGS_RANG.indexOf(x.art) - MELDUNGS_RANG.indexOf(y.art),
		);

const ausZeile = (z: Zeile): Beitrag => ({
	id: z.id,
	termin: z.termin,
	topic: z.topic,
	zeit: z.zeit,
	...(z.aufnahme ? { aufnahme: z.aufnahme } : {}),
	toasts: (JSON.parse(z.json) as BeitragToast[]).map(sauberer),
});

const FELDER = "id, termin, topic, zeit, aufnahme, json";

/** Zu einem `schluessel` entsteht genau ein Beitrag; ein zweiter Aufruf liest. */
export const legeBeitragAn = (db: Db, neu: NeuerBeitrag): Beitrag => {
	if (!schreibtDieserProzess())
		throw new Error("Beiträge legt nur der Poller an; diese Rolle liest nur.");
	return transaktion(db, () => {
		const da = db
			.prepare(
				`SELECT ${FELDER} FROM beitraege WHERE termin = ? AND topic = ? AND schluessel = ?`,
			)
			.get(neu.termin, neu.topic, neu.schluessel) as Zeile | undefined;
		if (da) return ausZeile(da);
		const json = JSON.stringify(neu.toasts.map(sauberer));
		const { lastInsertRowid } = db
			.prepare(
				"INSERT INTO beitraege (termin, topic, zeit, schluessel, aufnahme, json) VALUES (?, ?, ?, ?, ?, ?)",
			)
			.run(
				neu.termin,
				neu.topic,
				jetzt(),
				neu.schluessel,
				neu.aufnahme ?? null,
				json,
			);
		return ausZeile(
			db
				.prepare(`SELECT ${FELDER} FROM beitraege WHERE id = ?`)
				.get(Number(lastInsertRowid)) as Zeile,
		);
	});
};

export const beitrag = (db: Db, id: number): Beitrag | undefined => {
	const z = db
		.prepare(`SELECT ${FELDER} FROM beitraege WHERE id = ?`)
		.get(id) as Zeile | undefined;
	return z ? ausZeile(z) : undefined;
};

/**
 * Woran die Zustellung erkennt, dass ein neuer Beitrag vollständig dasteht.
 *
 * Die Terminversion taugt dafür nicht: Sie bewegt sich, sobald die Ergebnisse
 * geschrieben sind, und da ist die Aufnahme noch nicht erzeugt. Diese Marke
 * bewegt der Poller erst, wenn Toasts und Aufnahme beide liegen.
 */
export const beitragsMarke = (terminId: string): string =>
	`termin:${terminId}:beitraege`;

/** So viele Beiträge gibt ein Abruf höchstens zurück. */
export const BEITRAEGE_HOECHSTENS = 20;

export const beitraegeSeit = (
	db: Db,
	args: {
		termin: string;
		topic: string;
		/** Letzte bekannte Kennung; 0 liefert von vorn. */
		seit: number;
		hoechstens?: number;
	},
): Beitrag[] =>
	(
		db
			.prepare(
				`SELECT ${FELDER} FROM beitraege
				 WHERE termin = ? AND topic = ? AND id > ?
				 ORDER BY id LIMIT ?`,
			)
			.all(
				args.termin,
				args.topic,
				args.seit,
				args.hoechstens ?? BEITRAEGE_HOECHSTENS,
			) as Zeile[]
	).map(ausZeile);

/** Höchste vergebene Kennung eines Topics; 0, wenn es noch keine gibt. */
export const letzteKennung = (db: Db, termin: string, topic: string): number =>
	Number(
		(
			db
				.prepare(
					"SELECT MAX(id) AS id FROM beitraege WHERE termin = ? AND topic = ?",
				)
				.get(termin, topic) as { id: number | null }
		).id ?? 0,
	);

export const raeumeBeitraegeAuf = (
	db: Db,
	args: { aelterAlsMs: number; bezogenAuf?: number },
): number => {
	if (!schreibtDieserProzess())
		throw new Error(
			"Beiträge räumt nur der Poller auf; diese Rolle liest nur.",
		);
	const grenze = new Date(
		(args.bezogenAuf ?? Date.now()) - args.aelterAlsMs,
	).toISOString();
	return Number(
		db.prepare("DELETE FROM beitraege WHERE zeit < ?").run(grenze).changes,
	);
};
