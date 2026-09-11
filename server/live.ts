import type { IncomingMessage, ServerResponse } from "node:http";
import { terminById } from "../src/data/termine.ts";
import { metaGet, oeffneDb } from "../src/lib/db.ts";
import {
	type Bereich,
	bereichAusParametern,
	bereichsName,
	bereichsVersion,
} from "../src/lib/stand.ts";

/** Pfad, unter dem die Seiten die Zustellung abonnieren. */
export const LIVE_PFAD = "/api/live";

const PULS_MS = 20_000;

const PRUEF_MS = 1_000;

const HOECHSTENS = 2_000;

const STAU_BYTES = 256 * 1024;

type Verbindung = {
	res: ServerResponse;
	termin: string;
	bereich: Bereich;
	kreis?: string;
	/** Zuletzt an diese Verbindung gemeldeter Bereichsstempel. */
	version: string;
	/** Zuletzt an diese Verbindung gemeldete Paketkennung. */
	paket: string;
};

/**
 * Alles, was über die Leitung geht: Kennungen, keine Inhalte. Weder Einblender
 * noch Ansagetext noch Ton – die holt sich der Browser einzeln ab.
 */
export type Ping = {
	termin: string;
	bereich: string;
	version: string;
	geprueft: string;
	paket: string;
};

export type LiveDienst = {
	/** Behandelt die Anfrage, wenn sie an den Live-Pfad geht. */
	handhabe: (req: IncomingMessage, res: ServerResponse, url: URL) => boolean;
	/** Offene Verbindungen – für Tests und Betriebsschau. */
	anzahl: () => number;
	/** Sofort nachsehen und zustellen (Tests; sonst erledigt es die Uhr). */
	pruefe: () => void;
	/** Alles schließen und die Uhren anhalten. */
	schliesse: () => void;
};

export type LiveOptionen = {
	beiBetrachtung?: (kreisSlug: string) => void;
	geprueftFuer?: (kreisSlug: string) => number | undefined;
	/**
	 * Kennung des neuesten Pakets zu diesem Bereich. Ohne Paketablage bleibt
	 * sie leer; der Ping trägt das Feld trotzdem.
	 */
	paketFuer?: (terminId: string, bereich: Bereich) => string;
	pulsMs?: number;
	pruefMs?: number;
	hoechstens?: number;
};

const schreibe = (v: Verbindung, art: string, daten: Ping): boolean => {
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
	const hoechstens = opt.hoechstens ?? HOECHSTENS;
	const paketVon = (v: Pick<Verbindung, "termin" | "bereich">): string =>
		opt.paketFuer?.(v.termin, v.bereich) ?? "";

	const standVon = (v: Verbindung): Ping => {
		const eigen = v.kreis ? opt.geprueftFuer?.(v.kreis) : undefined;
		return {
			termin: v.termin,
			bereich: bereichsName(v.bereich),
			version: v.version,
			geprueft: eigen
				? new Date(eigen).toISOString()
				: (metaGet(oeffneDb(), `termin:${v.termin}:zuletzt`) ?? ""),
			paket: v.paket,
		};
	};

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
			const version = bereichsVersion(v.termin, v.bereich);
			const paket = paketVon(v);
			if (version === v.version && paket === v.paket) continue;
			v.version = version;
			v.paket = paket;
			schreibe(v, "stand", standVon(v));
		}
	};

	const pulse = () => {
		for (const v of verbindungen) {
			if (v.kreis) opt.beiBetrachtung?.(v.kreis);
			schreibe(v, "puls", standVon(v));
		}
	};

	const uhrPruef = setInterval(pruefe, opt.pruefMs ?? PRUEF_MS);
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
		const termin = terminById(url.searchParams.get("termin") ?? "");
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
		const bereich = bereichAusParametern(url.searchParams);
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

		const v: Verbindung = {
			res,
			termin: termin.id,
			bereich,
			kreis: bereich.kreis?.slug,
			version: bereichsVersion(termin.id, bereich),
			paket: paketVon({ termin: termin.id, bereich }),
		};
		verbindungen.add(v);
		if (v.kreis) opt.beiBetrachtung?.(v.kreis);
		res.write("retry: 3000\n\n");
		schreibe(v, "stand", standVon(v));

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
		schliesse: () => {
			clearInterval(uhrPruef);
			clearInterval(uhrPuls);
			for (const v of verbindungen) v.res.end();
			verbindungen.clear();
		},
	};
};
