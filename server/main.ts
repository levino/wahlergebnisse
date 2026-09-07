/**
 * Produktions-Einstieg: ein Node-Prozess mit
 *   - dem Astro-SSR-Handler (Middleware-Modus, aus dist/server/entry.mjs),
 *   - statischen Dateien aus dist/client,
 *   - der gestaffelten Poller-Schleife für Live-Termine (siehe src/lib/takt.ts),
 *   - dem einmaligen Laden der Archiv-Termine beim Start.
 *
 * Läuft mit Node ≥ 22.18 direkt aus TypeScript (Type-Stripping), kein Build-Schritt
 * für diesen Teil nötig.
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { TERMINE } from "../src/data/termine.ts";
import { VORHANDENE_KREISE } from "../src/data/kreise.ts";
import { mcpHandler } from "./mcp.ts";
import {
	BETRACHTET_S,
	GRUNDTAKT_S,
	STANDARD_ABSTAENDE,
	STANDARD_HOECHSTENS,
	faelligeKreise,
	stufe,
} from "../src/lib/takt.ts";
import { dbPfad, oeffneDb } from "../src/lib/db.ts";
import { pollTermin, terminVollstaendig } from "../src/lib/poll.ts";

const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? "0.0.0.0";
// Die Abstände, in denen ein Kreis abgefragt wird, gestaffelt nach Wahltag,
// Tageszeit und der Frage, ob ihn gerade jemand ansieht (src/lib/takt.ts).
// Die drei bisherigen Stellschrauben gelten weiter – sie steuern jetzt die
// *übrigen* Kreise, also die Grundlast.
const ABSTAENDE = {
	ruhig: {
		betrachtet: Number(
			process.env.POLL_INTERVAL_BETRACHTET_SEKUNDEN ??
				STANDARD_ABSTAENDE.ruhig.betrachtet,
		),
		uebrig: Number(
			process.env.POLL_INTERVAL_RUHIG_SEKUNDEN ??
				STANDARD_ABSTAENDE.ruhig.uebrig,
		),
	},
	wahltag: {
		betrachtet: Number(
			process.env.POLL_INTERVAL_BETRACHTET_SEKUNDEN ??
				STANDARD_ABSTAENDE.wahltag.betrachtet,
		),
		uebrig: Number(
			process.env.POLL_INTERVAL_SEKUNDEN ?? STANDARD_ABSTAENDE.wahltag.uebrig,
		),
	},
	wahlabend: {
		betrachtet: Number(
			process.env.POLL_INTERVAL_WAHLTAG_SEKUNDEN ??
				STANDARD_ABSTAENDE.wahlabend.betrachtet,
		),
		uebrig: Number(
			process.env.POLL_INTERVAL_WAHLABEND_SEKUNDEN ??
				STANDARD_ABSTAENDE.wahlabend.uebrig,
		),
	},
};
// Wie viele Kreise ein einzelner Lauf höchstens anfasst. Deckelt die Spitze
// nach einem Neustart (dann sind alle 38 fällig) und wenn viele gleichzeitig
// dran wären; der Rest rückt beim nächsten Lauf vor. Je Stufe eine Zahl –
// POLL_KREISE_PRO_LAUF überschreibt alle drei.
const HOECHSTENS_PRO_LAUF = process.env.POLL_KREISE_PRO_LAUF
	? Number(process.env.POLL_KREISE_PRO_LAUF)
	: STANDARD_HOECHSTENS;
// Die Uhr muss nicht feiner ticken als der kürzeste Abstand.
const TAKT_S = Math.max(
	1,
	Math.min(
		GRUNDTAKT_S,
		...Object.values(ABSTAENDE).flatMap((a) => [a.betrachtet, a.uebrig]),
	),
);
// Optionale Einschränkung auf einzelne Behörden (AGS, komma-getrennt). Gedacht
// für Vorschau-Umgebungen, die mit leerem Volume starten und nicht jedes Mal
// das komplette Archiv ziehen sollen.
const NUR_BEHOERDEN = process.env.POLL_BEHOERDEN?.split(",")
	.map((s) => s.trim())
	.filter(Boolean);
const DIST = new URL("../dist/", import.meta.url);
const CLIENT = join(DIST.pathname, "client");

const log = (msg: string) => console.log(`${new Date().toISOString()} ${msg}`);

const MIME: Record<string, string> = {
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".ico": "image/x-icon",
	".woff2": "font/woff2",
	".woff": "font/woff",
	".txt": "text/plain; charset=utf-8",
	".webmanifest": "application/manifest+json",
};

const { handler } = (await import(new URL("server/entry.mjs", DIST).href)) as {
	handler: (
		req: import("node:http").IncomingMessage,
		res: import("node:http").ServerResponse,
		next: () => void,
	) => void;
};

const db = oeffneDb(dbPfad());

// --- Poller ---
//
// Der Kreis, den gerade jemand ansieht, wird häufig abgefragt, die übrigen
// selten. Woher der Server weiß, dass jemand hinsieht: Jede Anfrage, deren
// erstes Pfadsegment ein bekannter Kreis ist, setzt hier einen Zeitstempel.
// Mehr wird nicht festgehalten – kein Zähler, keine Kennung, nichts, was
// einen Besucher wiedererkennt.
const KREIS_SLUGS = new Set(VORHANDENE_KREISE.map((k) => k.slug));
const gesehen = new Map<string, number>();
const geholt = new Map<string, number>();

const merkeAufruf = (pfad: string): void => {
	const erstes = pfad.split("/")[1] ?? "";
	if (KREIS_SLUGS.has(erstes)) gesehen.set(erstes, Date.now());
};

let laeuft = false;
const pollLive = async () => {
	if (laeuft) return;
	laeuft = true;
	const begonnen = Date.now();
	try {
		const live = TERMINE.filter((t) => t.live);
		const faellig = faelligeKreise({
			jetzt: new Date(),
			termine: TERMINE,
			kreise: [...KREIS_SLUGS],
			gesehen,
			geholt,
			abstaende: ABSTAENDE,
			betrachtetS: BETRACHTET_S,
			hoechstens: HOECHSTENS_PRO_LAUF,
		});
		if (faellig.length === 0) return;
		for (const termin of live) {
			const t0 = Date.now();
			const s = await pollTermin(db, termin, {
				log,
				nurBehoerden: NUR_BEHOERDEN,
				nurKreise: faellig,
			});
			log(
				`poll ${termin.id} [${stufe(new Date(), TERMINE)}] ${faellig.length} Kreis(e) (${faellig.slice(0, 5).join(", ")}${faellig.length > 5 ? " …" : ""}): ${s.anfragen} Anfragen, ${s.geaendert} Änderungen, ${s.fehler.length} Fehler, ${((Date.now() - t0) / 1000).toFixed(1)}s`,
			);
		}
		const fertig = Date.now();
		for (const k of faellig) geholt.set(k, fertig);
		// Am Wahlabend soll ein Lauf in einen Grundtakt passen. Dauert er
		// länger, fallen Uhrschläge aus und die Kreise altern über das
		// Beabsichtigte hinaus – meist, weil ein Host bremst (drossel.ts) oder
		// langsam antwortet. Das gehört im Protokoll sichtbar, sonst sucht am
		// Abend niemand an der richtigen Stelle.
		const dauer = (fertig - begonnen) / 1000;
		if (dauer > TAKT_S)
			log(
				`poll: der Lauf über ${faellig.length} Kreis(e) hat ${dauer.toFixed(1)}s gebraucht, mehr als der Grundtakt von ${TAKT_S}s – die übrigen Kreise altern entsprechend`,
			);
	} catch (e) {
		log(`poll fehlgeschlagen: ${(e as Error).message}`);
	} finally {
		laeuft = false;
	}
};

const ladeArchiv = async () => {
	for (const termin of TERMINE.filter((t) => !t.live)) {
		if (terminVollstaendig(db, termin)) continue;
		log(`Archiv ${termin.id} wird geladen …`);
		const s = await pollTermin(db, termin, {
			log,
			nurBehoerden: NUR_BEHOERDEN,
		});
		log(
			`Archiv ${termin.id}: ${s.anfragen} Anfragen, ${s.fehler.length} Fehler`,
		);
	}
};

// --- HTTP ---
/** Body einer Anfrage einlesen (für MCP; JSON-RPC über POST). */
const leseBody = (req: import("node:http").IncomingMessage): Promise<unknown> =>
	new Promise((resolve, reject) => {
		const teile: Buffer[] = [];
		let groesse = 0;
		req.on("data", (c: Buffer) => {
			groesse += c.length;
			if (groesse > 1_000_000) {
				reject(new Error("Anfrage zu groß"));
				req.destroy();
				return;
			}
			teile.push(c);
		});
		req.on("end", () => {
			const text = Buffer.concat(teile).toString("utf8");
			if (!text) return resolve(undefined);
			try {
				resolve(JSON.parse(text));
			} catch {
				reject(new Error("Ungültiges JSON"));
			}
		});
		req.on("error", reject);
	});

const server = createServer((req, res) => {
	const url = new URL(req.url ?? "/", "http://localhost");
	merkeAufruf(url.pathname);
	if (url.pathname === "/healthz") {
		res.writeHead(200, { "content-type": "text/plain" });
		res.end("ok");
		return;
	}
	// MCP-Endpunkt (Streamable HTTP). Liegt hier statt in einer Astro-Route,
	// weil das SDK mit Node-Streams arbeitet.
	if (url.pathname === "/mcp") {
		leseBody(req)
			.then((body) => mcpHandler(req, res, body))
			.catch((e) => {
				if (res.headersSent) return;
				res.writeHead(400, { "content-type": "application/json" });
				res.end(
					JSON.stringify({
						jsonrpc: "2.0",
						error: { code: -32700, message: (e as Error).message },
						id: null,
					}),
				);
			});
		return;
	}

	// Statische Assets aus dist/client (Astro legt gehashte Dateien unter /_astro/ ab)
	const rel = normalize(decodeURIComponent(url.pathname)).replace(
		/^(\.\.[/\\])+/,
		"",
	);
	const datei = join(CLIENT, rel);
	if (
		rel !== "/" &&
		datei.startsWith(CLIENT) &&
		existsSync(datei) &&
		statSync(datei).isFile()
	) {
		const ext = extname(datei);
		res.writeHead(200, {
			"content-type": MIME[ext] ?? "application/octet-stream",
			"cache-control": rel.startsWith("/_astro/")
				? "public, max-age=31536000, immutable"
				: "public, max-age=300",
		});
		createReadStream(datei).pipe(res);
		return;
	}
	handler(req, res, () => {
		res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
		res.end("Nicht gefunden");
	});
});

server.listen(PORT, HOST, () => {
	log(
		`wahlen läuft auf http://${HOST}:${PORT} (DB: ${dbPfad()}, ${KREIS_SLUGS.size} Kreise, Takt ${TAKT_S}s)`,
	);
	// Erst den Server annehmen lassen, dann Daten laden – so bleibt die Readiness-Probe grün.
	setTimeout(async () => {
		await pollLive();
		await ladeArchiv();
	}, 1000);
	// Die Uhr tickt gleichmäßig; welche Kreise ein Lauf anfasst, entscheidet
	// faelligeKreise. So braucht der Wahlabend keinen Eingriff von außen.
	setInterval(pollLive, TAKT_S * 1000);
});

const stop = () => {
	log("Beende …");
	server.close(() => process.exit(0));
	setTimeout(() => process.exit(0), 5000).unref();
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
