import { createReadStream, existsSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join, resolve } from "node:path";
import { terminById } from "../src/data/termine.ts";
import { ansagenVerzeichnis } from "../src/lib/ansage-datei.ts";
import type { Db } from "../src/lib/db.ts";
import {
	BEITRAG_PFAD,
	BEITRAG_TESTGRIFF_PFAD,
	BEITRAEGE_PFAD,
	type BeitragAnsicht,
	type BeitraegeAntwort,
	aufnahmeUrl,
} from "../src/lib/beitrag-abruf.ts";
import {
	PAKETE_HOECHSTENS as BEITRAEGE_HOECHSTENS,
	type NeuesPaket,
	type Paket,
	legePaketAn,
	letzteKennung,
	paket,
	paketeSeit,
} from "../src/lib/pakete.ts";
import { bereichAusParametern, bereichsName } from "../src/lib/stand.ts";

export { BEITRAG_PFAD, BEITRAEGE_PFAD, aufnahmeUrl };
export type { BeitragAnsicht, BeitraegeAntwort };

const ansicht = (p: Paket): BeitragAnsicht => ({
	id: p.id,
	zeit: p.zeit,
	toasts: p.toasts,
	...(p.aufnahme ? { aufnahme: aufnahmeUrl(p.id) } : {}),
});

const json = (res: ServerResponse, code: number, rumpf: unknown): void => {
	res.writeHead(code, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store",
	});
	res.end(JSON.stringify(rumpf));
};

/**
 * Zu einer Kennung gibt es genau eine Aufnahme, und sie ändert sich nie –
 * deshalb darf sie beliebig lange im Zwischenspeicher liegen.
 */
const sendeAufnahme = (
	res: ServerResponse,
	pfad: string,
	nurKopf: boolean,
): void => {
	res.writeHead(200, {
		"content-type": "audio/mpeg",
		"content-length": String(statSync(pfad).size),
		"cache-control": "public, max-age=31536000, immutable",
	});
	if (nurKopf) res.end();
	else createReadStream(pfad).pipe(res);
};

/** Der Dateiname kommt aus der Ablage; er darf trotzdem nicht aus dem Verzeichnis führen. */
const aufnahmePfad = (datei: string): string | undefined => {
	const wurzel = resolve(ansagenVerzeichnis());
	const pfad = resolve(join(wurzel, datei));
	if (!pfad.startsWith(`${wurzel}/`)) return undefined;
	return existsSync(pfad) ? pfad : undefined;
};

const zahl = (wert: string | null): number => {
	const n = Number(wert);
	return Number.isSafeInteger(n) && n >= 0 ? n : 0;
};

const kennungAus = (pfad: string): { id: number; ton: boolean } | undefined => {
	const rest = pfad.slice(`${BEITRAG_PFAD}/`.length);
	const ton = rest.endsWith(".mp3");
	const roh = ton ? rest.slice(0, -".mp3".length) : rest;
	if (!/^[1-9][0-9]{0,14}$/.test(roh)) return undefined;
	return { id: Number(roh), ton };
};

/**
 * Der Abruf dessen, was der Poller hinterlegt hat.
 *
 * Hier entsteht nichts. Eine unbekannte Kennung ist ein 404 und kein Anlass,
 * etwas zu bauen – es gibt von außen keinen Weg, eine bezahlte Aufnahme
 * auszulösen.
 */
const testgriff = (): boolean => process.env.WAHLEN_TESTGRIFF === "1";

const rumpfVon = (req: IncomingMessage): Promise<string> =>
	new Promise((fertig) => {
		let roh = "";
		req.on("data", (s) => {
			roh += s;
		});
		req.on("end", () => fertig(roh));
	});

/** Ohne Erzeuger lässt sich der Abruf nicht prüfen; Stufe 4 macht ihn überflüssig. */
const handhabeTestgriff = (
	db: Db,
	req: IncomingMessage,
	res: ServerResponse,
): boolean => {
	if (!testgriff()) return false;
	void rumpfVon(req).then((roh) => {
		try {
			const angelegt = legePaketAn(db, JSON.parse(roh) as NeuesPaket);
			json(res, 200, { id: angelegt.id });
		} catch (e) {
			json(res, 400, { fehler: (e as Error).message });
		}
	});
	return true;
};

export const handhabeBeitrag = (
	db: Db,
	req: IncomingMessage,
	res: ServerResponse,
	url: URL,
): boolean => {
	if (url.pathname === BEITRAG_TESTGRIFF_PFAD)
		return handhabeTestgriff(db, req, res);
	const einzeln = url.pathname.startsWith(`${BEITRAG_PFAD}/`);
	if (url.pathname !== BEITRAEGE_PFAD && !einzeln) return false;
	if (req.method !== "GET" && req.method !== "HEAD") {
		res.writeHead(405, { allow: "GET" }).end();
		return true;
	}

	if (einzeln) {
		const kennung = kennungAus(url.pathname);
		if (!kennung) {
			json(res, 404, { fehler: "unbekanntes Paket" });
			return true;
		}
		const p = paket(db, kennung.id);
		if (!p) {
			json(res, 404, { fehler: "unbekanntes Paket" });
			return true;
		}
		if (!kennung.ton) {
			json(res, 200, ansicht(p));
			return true;
		}
		const pfad = p.aufnahme ? aufnahmePfad(p.aufnahme) : undefined;
		if (!pfad) {
			json(res, 404, { fehler: "keine Aufnahme zu diesem Paket" });
			return true;
		}
		sendeAufnahme(res, pfad, req.method === "HEAD");
		return true;
	}

	const termin = terminById(url.searchParams.get("termin") ?? "");
	if (!termin) {
		json(res, 404, { fehler: "unbekannter Termin" });
		return true;
	}
	const topic = bereichsName(bereichAusParametern(url.searchParams));
	const seit = zahl(url.searchParams.get("seit"));
	const antwort: BeitraegeAntwort = {
		topic,
		letzte: letzteKennung(db, termin.id, topic),
		pakete: paketeSeit(db, {
			termin: termin.id,
			topic,
			seit,
			hoechstens: BEITRAEGE_HOECHSTENS,
		}).map(ansicht),
	};
	json(res, 200, antwort);
	return true;
};
