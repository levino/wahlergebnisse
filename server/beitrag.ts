import { createReadStream, existsSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join, resolve } from "node:path";
import { terminById } from "../src/data/termine.ts";
import { TONPROBE_SATZ } from "../src/lib/ansage.ts";
import {
	ansagePfad,
	ansagenVerzeichnis,
	standardStimme,
} from "../src/lib/ansage-datei.ts";
import type { Db } from "../src/lib/db.ts";
import {
	BEITRAEGE_PFAD,
	BEITRAG_PFAD,
	type BeitragAnsicht,
	type BeitraegeAntwort,
	SEIT_PARAM,
	TONPROBE_PFAD,
	aufnahmeUrl,
} from "../src/lib/beitrag-abruf.ts";
import { ORT_PARAM } from "../src/lib/live-kanal.ts";
import {
	BEITRAEGE_HOECHSTENS,
	type Beitrag,
	fuerPartei,
	letzteKennung,
	beitrag,
	beitraegeSeit,
} from "../src/lib/beitraege.ts";
import { parteiAusParametern, topicAusParametern } from "../src/lib/stand.ts";

export { BEITRAEGE_PFAD, BEITRAG_PFAD, TONPROBE_PFAD, aufnahmeUrl };
export type { BeitragAnsicht, BeitraegeAntwort };

const ansicht = (p: Beitrag, parteiKey?: string): BeitragAnsicht => ({
	id: p.id,
	zeit: p.zeit,
	toasts: fuerPartei(p.toasts, parteiKey),
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
	zwischenspeicher = "public, max-age=31536000, immutable",
): void => {
	res.writeHead(200, {
		"content-type": "audio/mpeg",
		"content-length": String(statSync(pfad).size),
		"cache-control": zwischenspeicher,
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
export const handhabeBeitrag = (
	db: Db,
	req: IncomingMessage,
	res: ServerResponse,
	url: URL,
): boolean => {
	const einzeln = url.pathname.startsWith(`${BEITRAG_PFAD}/`);
	const tonprobe = url.pathname === TONPROBE_PFAD;
	if (url.pathname !== BEITRAEGE_PFAD && !einzeln && !tonprobe) return false;
	if (req.method !== "GET" && req.method !== "HEAD") {
		res.writeHead(405, { allow: "GET" }).end();
		return true;
	}

	if (tonprobe) {
		const pfad = ansagePfad(TONPROBE_SATZ, standardStimme());
		if (!existsSync(pfad)) {
			json(res, 503, { fehler: "keine Tonprobe hinterlegt" });
			return true;
		}
		sendeAufnahme(res, pfad, req.method === "HEAD", "no-store");
		return true;
	}

	if (einzeln) {
		const kennung = kennungAus(url.pathname);
		if (!kennung) {
			json(res, 404, { fehler: "unbekannter Beitrag" });
			return true;
		}
		const p = beitrag(db, kennung.id);
		if (!p) {
			json(res, 404, { fehler: "unbekannter Beitrag" });
			return true;
		}
		if (!kennung.ton) {
			json(res, 200, ansicht(p, parteiAusParametern(url.searchParams)));
			return true;
		}
		const pfad = p.aufnahme ? aufnahmePfad(p.aufnahme) : undefined;
		if (!pfad) {
			json(res, 404, { fehler: "keine Aufnahme zu diesem Beitrag" });
			return true;
		}
		sendeAufnahme(res, pfad, req.method === "HEAD");
		return true;
	}

	const termin = terminById(url.searchParams.get(ORT_PARAM.termin) ?? "");
	if (!termin) {
		json(res, 404, { fehler: "unbekannter Termin" });
		return true;
	}
	const topic = topicAusParametern(url.searchParams);
	const parteiKey = parteiAusParametern(url.searchParams);
	const seit = zahl(url.searchParams.get(SEIT_PARAM));
	const antwort: BeitraegeAntwort = {
		topic,
		letzte: letzteKennung(db, termin.id, topic),
		beitraege: beitraegeSeit(db, {
			termin: termin.id,
			topic,
			seit,
			hoechstens: BEITRAEGE_HOECHSTENS,
		}).map((p) => ansicht(p, parteiKey)),
	};
	json(res, 200, antwort);
	return true;
};
