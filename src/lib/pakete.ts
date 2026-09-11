import type { Db } from "./db.ts";
import { jetzt, transaktion } from "./db.ts";
import type { BeitragToast } from "./beitrag-abruf.ts";
import { schreibtDieserProzess } from "./rolle.ts";

export type { BeitragToast };

export type Paket = {
	id: number;
	termin: string;
	topic: string;
	zeit: string;
	/** Dateiname unter `ansagenVerzeichnis()`; fehlt, wenn keine Aufnahme entstand. */
	aufnahme?: string;
	toasts: BeitragToast[];
};

export type NeuesPaket = {
	termin: string;
	/** Wie `bereichsName` in `stand.ts` schneidet: `<kreis>/<ags>` oder `<kreis>`. */
	topic: string;
	/** Identität des Schubs; derselbe Wert legt kein zweites Paket an. */
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

/** Nur diese Felder verlassen den Server – siehe `BeitragToast`. */
const sauberer = (t: BeitragToast): BeitragToast => ({
	marke: t.marke,
	ort: t.ort,
	wahl: t.wahl,
	art: t.art,
	text: t.text,
	...(t.anz === undefined ? {} : { anz: t.anz }),
	...(t.max === undefined ? {} : { max: t.max }),
	...(t.prozent === undefined ? {} : { prozent: t.prozent }),
});

const ausZeile = (z: Zeile): Paket => ({
	id: z.id,
	termin: z.termin,
	topic: z.topic,
	zeit: z.zeit,
	...(z.aufnahme ? { aufnahme: z.aufnahme } : {}),
	toasts: (JSON.parse(z.json) as BeitragToast[]).map(sauberer),
});

const FELDER = "id, termin, topic, zeit, aufnahme, json";

/** Zu einem `schluessel` entsteht genau ein Paket; ein zweiter Aufruf liest. */
export const legePaketAn = (db: Db, neu: NeuesPaket): Paket => {
	if (!schreibtDieserProzess())
		throw new Error("Pakete legt nur der Poller an; diese Rolle liest nur.");
	return transaktion(db, () => {
		const da = db
			.prepare(
				`SELECT ${FELDER} FROM pakete WHERE termin = ? AND topic = ? AND schluessel = ?`,
			)
			.get(neu.termin, neu.topic, neu.schluessel) as Zeile | undefined;
		if (da) return ausZeile(da);
		const json = JSON.stringify(neu.toasts.map(sauberer));
		const { lastInsertRowid } = db
			.prepare(
				"INSERT INTO pakete (termin, topic, zeit, schluessel, aufnahme, json) VALUES (?, ?, ?, ?, ?, ?)",
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
				.prepare(`SELECT ${FELDER} FROM pakete WHERE id = ?`)
				.get(Number(lastInsertRowid)) as Zeile,
		);
	});
};

export const paket = (db: Db, id: number): Paket | undefined => {
	const z = db.prepare(`SELECT ${FELDER} FROM pakete WHERE id = ?`).get(id) as
		| Zeile
		| undefined;
	return z ? ausZeile(z) : undefined;
};

/** So viele Pakete gibt ein Abruf höchstens zurück. */
export const PAKETE_HOECHSTENS = 20;

export const paketeSeit = (
	db: Db,
	args: {
		termin: string;
		topic: string;
		/** Letzte bekannte Kennung; 0 liefert von vorn. */
		seit: number;
		hoechstens?: number;
	},
): Paket[] =>
	(
		db
			.prepare(
				`SELECT ${FELDER} FROM pakete
				 WHERE termin = ? AND topic = ? AND id > ?
				 ORDER BY id LIMIT ?`,
			)
			.all(
				args.termin,
				args.topic,
				args.seit,
				args.hoechstens ?? PAKETE_HOECHSTENS,
			) as Zeile[]
	).map(ausZeile);

/** Höchste vergebene Kennung eines Topics; 0, wenn es noch keine gibt. */
export const letzteKennung = (db: Db, termin: string, topic: string): number =>
	Number(
		(
			db
				.prepare(
					"SELECT MAX(id) AS id FROM pakete WHERE termin = ? AND topic = ?",
				)
				.get(termin, topic) as { id: number | null }
		).id ?? 0,
	);

export const raeumePaketeAuf = (
	db: Db,
	args: { aelterAlsMs: number; bezogenAuf?: number },
): number => {
	if (!schreibtDieserProzess())
		throw new Error("Pakete räumt nur der Poller auf; diese Rolle liest nur.");
	const grenze = new Date(
		(args.bezogenAuf ?? Date.now()) - args.aelterAlsMs,
	).toISOString();
	return Number(
		db.prepare("DELETE FROM pakete WHERE zeit < ?").run(grenze).changes,
	);
};
