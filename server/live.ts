/**
 * Live-Zustellung an offene Seiten – Server-Sent Events (SSE).
 *
 * **Warum überhaupt zustellen.** Bis hierher fragte jede offene Seite alle 30
 * Sekunden nach dem Stand. Am Wahlabend sind das bei 200 offenen Seiten 400
 * Anfragen je Minute, die fast immer „nichts Neues“ ergeben – und der Stand
 * ist trotzdem bis zu 30 Sekunden alt. Umgekehrt herum ist beides besser: Der
 * Server weiß ohnehin, wann er etwas gespeichert hat, und sagt es denen, die
 * zusehen.
 *
 * **Warum SSE und nicht WebSocket oder HTTP/2-Streaming.** Es geht nur in eine
 * Richtung – der Browser hat dem Server nichts zu sagen. SSE ist gewöhnliches
 * HTTP mit einer offenen Antwort: kein Protokollwechsel, den der Reverse-Proxy
 * mitmachen müsste (Traefik reicht es ohne Sonderregel durch), keine eigene
 * Bibliothek, und die Wiederverbindung nach einem Abriss steckt im Browser
 * (`EventSource`). Ein WebSocket wäre ein zweiter Protokollstapel für einen
 * Rückkanal, den wir nicht brauchen; „HTTP/2-Streaming“ ist kein eigenes
 * Verfahren, sondern genau das, was SSE über eine HTTP/2-Verbindung tut. Der
 * Node-Server spricht HTTP/1.1, dort gilt die Grenze von sechs Verbindungen je
 * Herkunft pro Browser – bei *einer* offenen Verbindung je Seite ist das kein
 * Thema, und Traefik terminiert nach außen ohnehin HTTP/2.
 *
 * **Wo das hier läuft.** Nicht als Astro-Route, sondern im Server-Prozess
 * neben dem Poller. Das Astro-Bundle (`dist/server/entry.mjs`) ist eine
 * eigene Kopie der Module – eine Astro-Route könnte den Poller nicht hören
 * und müsste die Datenbank selbst abfragen. Hier dagegen liegt beides im
 * selben Modulzustand: eine Uhr, eine Datenbankverbindung, egal wie viele
 * Zuschauer.
 *
 * **Was zugestellt wird.** Nur der Versionsstempel des Bereichs (siehe
 * `src/lib/stand.ts`), nicht die Ergebnisse selbst. Die Seite holt sich den
 * neuen Inhalt danach über `navigate()` – so bleibt genau eine Stelle, die
 * HTML erzeugt, und die Karte bleibt stehen. Ergebnisse über die Leitung zu
 * schicken hieße, das Rendern ein zweites Mal im Browser zu bauen.
 *
 * **Last.** Je Verbindung ein Objekt mit vier Feldern und der offene Socket;
 * die Arbeit je Takt hängt an der Zahl der *Termine*, nicht der Zuschauer:
 * ein Blick in die Meta-Tabelle, und nur wenn sich dort etwas geändert hat,
 * wird je Verbindung ihr Bereichsstempel bestimmt (der ist zwischen­gespeichert,
 * siehe `stand.ts`). Test: `test/live.test.ts` öffnet 200 Verbindungen.
 */
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

/**
 * Abstand der Pulse. 20 Sekunden ist deutlich unter dem, was Proxys und
 * Mobilfunknetze an Stille dulden (meist 60), und kostet bei 200 Verbindungen
 * 200 kurze Schreibvorgänge je 20 Sekunden.
 */
const PULS_MS = 20_000;

/**
 * Takt, in dem nachgesehen wird, ob der Poller etwas gespeichert hat. Eine
 * Sekunde ist für den Wahlabend flott genug und kostet einen Punktzugriff auf
 * die Meta-Tabelle je Termin – unabhängig von der Zahl der Zuschauer.
 */
const PRUEF_MS = 1_000;

/**
 * Obergrenze offener Verbindungen. Nicht, weil der Prozess bei mehr umfiele,
 * sondern damit ein Fehler auf der Gegenseite (eine Seite, die im Kreis neu
 * verbindet) nicht unbemerkt Dateideskriptoren frisst.
 */
const HOECHSTENS = 2_000;

/**
 * Wie viel unbestätigte Ausgabe eine Verbindung anhäufen darf, bevor sie
 * getrennt wird. Wer die Leitung nicht leert, ist weg – die Meldungen sind
 * wenige hundert Bytes groß, hier stauen sich also tausende.
 */
const STAU_BYTES = 256 * 1024;

type Verbindung = {
	res: ServerResponse;
	termin: string;
	bereich: Bereich;
	kreis?: string;
	/** Zuletzt an diese Verbindung gemeldeter Bereichsstempel. */
	version: string;
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
	/**
	 * Wird bei jedem Puls für jeden Kreis gerufen, den gerade jemand offen
	 * hat. Der Poller fragt betrachtete Kreise häufiger ab (siehe
	 * `src/lib/takt.ts`); früher hielt das die 30-Sekunden-Abfrage der Seite
	 * wach. Ohne diesen Ruf würde ein Kreis, den jemand stundenlang ansieht,
	 * nach kurzer Zeit wieder als unbeobachtet gelten.
	 */
	beiBetrachtung?: (kreisSlug: string) => void;
	/**
	 * Wann dieser Kreis zuletzt bei seiner Wahlleitung nachgefragt wurde
	 * (Millisekunden). Der Poller staffelt die Kreise (`src/lib/takt.ts`), der
	 * Meta-Stempel `termin:<id>:zuletzt` gilt dagegen für den ganzen Lauf –
	 * eine Anzeige „geprüft 18:44“ daraus wäre für einen selten abgefragten
	 * Kreis schlicht falsch. Ohne Angabe gilt der Stempel des Termins.
	 */
	geprueftFuer?: (kreisSlug: string) => number | undefined;
	pulsMs?: number;
	pruefMs?: number;
	hoechstens?: number;
};

const schreibe = (v: Verbindung, art: string, daten: unknown): boolean => {
	if (v.res.writableEnded || v.res.destroyed) return false;
	if (v.res.writableLength > STAU_BYTES) {
		v.res.destroy();
		return false;
	}
	return v.res.write(`event: ${art}\ndata: ${JSON.stringify(daten)}\n\n`);
};

export const starteLive = (opt: LiveOptionen = {}): LiveDienst => {
	const verbindungen = new Set<Verbindung>();
	// Zuletzt gesehener globaler Stempel je Termin. Ändert er sich nicht, kann
	// sich auch kein Bereichsstempel geändert haben – dann bleibt der Takt ein
	// einziger Punktzugriff.
	const globalerStand = new Map<string, string>();
	const hoechstens = opt.hoechstens ?? HOECHSTENS;

	const standVon = (v: Verbindung) => {
		const eigen = v.kreis ? opt.geprueftFuer?.(v.kreis) : undefined;
		return {
			termin: v.termin,
			bereich: bereichsName(v.bereich),
			version: v.version,
			geprueft: eigen
				? new Date(eigen).toISOString()
				: (metaGet(oeffneDb(), `termin:${v.termin}:zuletzt`) ?? ""),
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
			if (version === v.version) continue;
			v.version = version;
			schreibe(v, "stand", standVon(v));
		}
	};

	const pulse = () => {
		for (const v of verbindungen) {
			if (v.kreis) opt.beiBetrachtung?.(v.kreis);
			// Ein Kommentar (":") würde die Leitung ebenso offen halten, löst im
			// Browser aber kein Ereignis aus. Als richtiges Ereignis kann die
			// Seite daran erkennen, dass die Verbindung noch trägt – und eine
			// stillstehende Anzeige als „unterbrochen“ kennzeichnen.
			schreibe(v, "puls", standVon(v));
		}
	};

	const uhrPruef = setInterval(pruefe, opt.pruefMs ?? PRUEF_MS);
	const uhrPuls = setInterval(pulse, opt.pulsMs ?? PULS_MS);
	// Die Uhren dürfen den Prozess nicht am Leben halten.
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
			// Nichts an dieser Antwort darf zwischengespeichert oder gepuffert
			// werden – sie ist nie „fertig“.
			"cache-control": "no-store",
			"content-encoding": "identity",
			connection: "keep-alive",
			"x-accel-buffering": "no",
			"access-control-allow-origin": "*",
		});
		// Kleine Meldungen sofort auf die Leitung, nicht sammeln.
		res.socket?.setNoDelay(true);
		// Der Server soll diese Antwort nicht wegen Untätigkeit abräumen.
		res.setTimeout?.(0);

		const v: Verbindung = {
			res,
			termin: termin.id,
			bereich,
			kreis: bereich.kreis?.slug,
			version: bereichsVersion(termin.id, bereich),
		};
		verbindungen.add(v);
		if (v.kreis) opt.beiBetrachtung?.(v.kreis);
		// Wiederverbindungsabstand für den Browser. Ein abgerissener Wahlabend
		// soll schnell wieder hängen, aber nicht im Sekundentakt hämmern.
		res.write("retry: 3000\n\n");
		// Der erste Stand kommt sofort: Die Seite weiß dann, ob sich zwischen
		// dem Rendern und dem Verbinden etwas geändert hat.
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
