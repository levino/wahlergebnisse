import type { IncomingMessage, ServerResponse } from "node:http";
import { terminById } from "../src/data/termine.ts";
import { metaGet, oeffneDb } from "../src/lib/db.ts";
import { beitragsMarke } from "../src/lib/beitraege.ts";
import {
	LIVE_EREIGNIS,
	LIVE_PFAD,
	ORT_PARAM,
	type BeitragsPing,
	type LiveEreignis,
	type Ping,
} from "../src/lib/live-kanal.ts";
import {
	type Topic,
	topicAusParametern,
	topicVersion,
	zuschnittVonTopic,
} from "../src/lib/stand.ts";

export { LIVE_PFAD };
export type { BeitragsPing, Ping };

const PULS_MS = 20_000;

const PRUEF_MS = 1_000;

const HOECHSTENS = 2_000;

const STAU_BYTES = 256 * 1024;

type Verbindung = {
	res: ServerResponse;
	termin: string;
	/** Die Kennung, die die Seite mitbringt – die Adresse ihres Zuschnitts. */
	topic: Topic;
	kreis?: string;
	/** Ob diese Kennung eine Wahlleitung nennt – nur dafür entstehen Beiträge. */
	wahlleitung: boolean;
	/** Zuletzt an diese Verbindung gemeldeter Stempel des Zuschnitts. */
	version: string;
	/** Zuletzt an diese Verbindung gemeldete Beitragskennung. */
	beitrag: string;
};

export type LiveDienst = {
	/** Behandelt die Anfrage, wenn sie an den Live-Pfad geht. */
	handhabe: (req: IncomingMessage, res: ServerResponse, url: URL) => boolean;
	/** Offene Verbindungen – für Tests und Betriebsschau. */
	anzahl: () => number;
	/** Sofort nach neuen Zahlen sehen (Tests; sonst erledigt es die Uhr). */
	pruefe: () => void;
	/** Sofort nach fertigen Toasts sehen (Tests; sonst erledigt es die Uhr). */
	pruefeBeitraege: () => void;
	/** Alles schließen und die Uhren anhalten. */
	schliesse: () => void;
};

export type LiveOptionen = {
	beiBetrachtung?: (kreisSlug: string) => void;
	/** Ein Topic wird betrachtet – nur dafür erzeugt der Poller Beiträge. */
	beiTopic?: (topic: string) => void;
	geprueftFuer?: (kreisSlug: string) => number | undefined;
	/** Kennung des neuesten Beitrags zu diesem Topic; ohne Ablage leer. */
	beitragFuer?: (terminId: string, topic: string) => string;
	pulsMs?: number;
	pruefMs?: number;
	hoechstens?: number;
};

const schreibe = (
	v: Verbindung,
	art: LiveEreignis,
	daten: Ping | BeitragsPing,
): boolean => {
	if (v.res.writableEnded || v.res.destroyed) return false;
	if (v.res.writableLength > STAU_BYTES) {
		v.res.destroy();
		return false;
	}
	return v.res.write(`event: ${art}\ndata: ${JSON.stringify(daten)}\n\n`);
};

export const starteLive = (opt: LiveOptionen = {}): LiveDienst => {
	const verbindungen = new Set<Verbindung>();
	const globalerStand = new Map<string, string>();
	/** Getrennt vom Stand der Zahlen – sonst hinge das eine am anderen. */
	const beitragsStand = new Map<string, string>();
	const hoechstens = opt.hoechstens ?? HOECHSTENS;
	const beitragVon = (v: Pick<Verbindung, "termin" | "topic">): string =>
		opt.beitragFuer?.(v.termin, v.topic) ?? "";

	const standVon = (v: Verbindung): Ping => {
		const eigen = v.kreis ? opt.geprueftFuer?.(v.kreis) : undefined;
		return {
			termin: v.termin,
			topic: v.topic,
			version: v.version,
			geprueft: eigen
				? new Date(eigen).toISOString()
				: (metaGet(oeffneDb(), `termin:${v.termin}:zuletzt`) ?? ""),
		};
	};

	const beitragsPingVon = (v: Verbindung): BeitragsPing => ({
		kennung: v.beitrag,
	});

	/** Die Zahlen. Hängt allein an der Terminversion. */
	const pruefe = () => {
		if (verbindungen.size === 0) return;
		const db = oeffneDb();
		const geaendert = new Set<string>();
		for (const termin of new Set([...verbindungen].map((v) => v.termin))) {
			const stand = metaGet(db, `termin:${termin}:version`) ?? "";
			if (globalerStand.get(termin) !== stand) {
				globalerStand.set(termin, stand);
				geaendert.add(termin);
			}
		}
		if (geaendert.size === 0) return;
		for (const v of verbindungen) {
			if (!geaendert.has(v.termin)) continue;
			const version = topicVersion(v.termin, v.topic);
			if (version === v.version) continue;
			v.version = version;
			schreibe(v, LIVE_EREIGNIS.stand, standVon(v));
		}
	};

	/**
	 * Die Moderationsbeiträge. Eigener Auslöser, eigener Zustand.
	 *
	 * Die Marke bewegt der Poller erst, wenn ein Beitrag **vollständig** liegt –
	 * Toast und Aufnahme. Wer hier gerufen wird, kann sofort laden.
	 */
	const pruefeBeitraege = () => {
		if (verbindungen.size === 0) return;
		const db = oeffneDb();
		const geaendert = new Set<string>();
		for (const termin of new Set([...verbindungen].map((v) => v.termin))) {
			const stand = metaGet(db, beitragsMarke(termin)) ?? "";
			if (beitragsStand.get(termin) !== stand) {
				beitragsStand.set(termin, stand);
				geaendert.add(termin);
			}
		}
		if (geaendert.size === 0) return;
		for (const v of verbindungen) {
			if (!geaendert.has(v.termin)) continue;
			const beitrag = beitragVon(v);
			if (beitrag === v.beitrag) continue;
			v.beitrag = beitrag;
			schreibe(v, LIVE_EREIGNIS.beitrag, beitragsPingVon(v));
		}
	};

	const pulse = () => {
		for (const v of verbindungen) {
			if (v.kreis) opt.beiBetrachtung?.(v.kreis);
			if (v.wahlleitung) opt.beiTopic?.(v.topic);
			schreibe(v, LIVE_EREIGNIS.puls, standVon(v));
		}
	};

	const uhrPruef = setInterval(() => {
		pruefe();
		pruefeBeitraege();
	}, opt.pruefMs ?? PRUEF_MS);
	const uhrPuls = setInterval(pulse, opt.pulsMs ?? PULS_MS);
	uhrPruef.unref?.();
	uhrPuls.unref?.();

	const handhabe = (
		req: IncomingMessage,
		res: ServerResponse,
		url: URL,
	): boolean => {
		if (url.pathname !== LIVE_PFAD) return false;
		if (req.method !== "GET" && req.method !== "HEAD") {
			res.writeHead(405, { allow: "GET" }).end();
			return true;
		}
		const termin = terminById(url.searchParams.get(ORT_PARAM.termin) ?? "");
		if (!termin) {
			res
				.writeHead(404, { "content-type": "application/json; charset=utf-8" })
				.end(JSON.stringify({ fehler: "unbekannter Termin" }));
			return true;
		}
		if (verbindungen.size >= hoechstens) {
			res.writeHead(503, { "retry-after": "30" }).end();
			return true;
		}
		const topic = topicAusParametern(url.searchParams);
		res.writeHead(200, {
			"content-type": "text/event-stream; charset=utf-8",
			"cache-control": "no-store",
			"content-encoding": "identity",
			connection: "keep-alive",
			"x-accel-buffering": "no",
			"access-control-allow-origin": "*",
		});
		res.socket?.setNoDelay(true);
		res.setTimeout?.(0);

		const zuschnitt = zuschnittVonTopic(topic);
		const v: Verbindung = {
			res,
			termin: termin.id,
			topic,
			kreis: zuschnitt.kreis?.slug,
			wahlleitung: Boolean(zuschnitt.behoerde),
			version: topicVersion(termin.id, topic),
			beitrag: beitragVon({ termin: termin.id, topic }),
		};
		verbindungen.add(v);
		if (v.kreis) opt.beiBetrachtung?.(v.kreis);
		if (v.wahlleitung) opt.beiTopic?.(v.topic);
		res.write("retry: 3000\n\n");
		schreibe(v, LIVE_EREIGNIS.stand, standVon(v));
		// Wo der Beitragskanal gerade steht, damit ein wiederkehrender Browser
		// weiß, ab welcher Kennung er nachholen muss – und ein neuer, dass er bei
		// null beginnt. Ohne diese Nachricht nordete erst der erste echte Beitrag
		// die Leinwand ein, und genau der bliebe ungezeigt.
		schreibe(v, LIVE_EREIGNIS.beitrag, { kennung: v.beitrag || "0" });

		const weg = () => {
			verbindungen.delete(v);
		};
		res.on("close", weg);
		res.on("error", weg);
		req.on("error", weg);
		return true;
	};

	return {
		handhabe,
		anzahl: () => verbindungen.size,
		pruefe,
		pruefeBeitraege,
		schliesse: () => {
			clearInterval(uhrPruef);
			clearInterval(uhrPuls);
			for (const v of verbindungen) v.res.end();
			verbindungen.clear();
		},
	};
};
