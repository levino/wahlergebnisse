/**
 * Produktions-Einstieg: ein Node-Prozess mit
 *   - dem Astro-SSR-Handler (Middleware-Modus, aus dist/server/entry.mjs),
 *   - statischen Dateien aus dist/client,
 *   - der Poller-Schleife für Live-Termine (POLL_INTERVAL_SEKUNDEN, Standard 300),
 *   - dem einmaligen Laden der Archiv-Termine beim Start.
 *
 * Läuft mit Node ≥ 22.18 direkt aus TypeScript (Type-Stripping), kein Build-Schritt
 * für diesen Teil nötig.
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { TERMINE } from "../src/data/termine.ts";
import { mcpHandler } from "./mcp.ts";
import { takt } from "../src/lib/takt.ts";
import { dbPfad, oeffneDb } from "../src/lib/db.ts";
import { pollTermin, terminVollstaendig } from "../src/lib/poll.ts";

const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? "0.0.0.0";
const INTERVALL_S = Number(process.env.POLL_INTERVAL_SEKUNDEN ?? 300);
// Am Wahltag selbst wird häufiger nachgesehen: zwischen 17 und 24 Uhr kommen
// die Schnellmeldungen im Minutentakt. Sonst bliebe der Ticker hinterher, und
// niemand soll dafür von Hand am Deployment drehen.
const WAHLTAG_INTERVALL_S = Number(
	process.env.POLL_INTERVAL_WAHLTAG_SEKUNDEN ?? 60,
);
// An Tagen ohne Wahl ändert sich beim Landkreis nichts. Jede Abfrage wäre dann
// eine Anfrage an einen fremden Server, die nichts einbringt – deshalb ein
// ruhiger Takt, bis der Wahltag da ist.
const RUHIGER_INTERVALL_S = Number(
	process.env.POLL_INTERVAL_RUHIG_SEKUNDEN ?? 1800,
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
let laeuft = false;
const pollLive = async () => {
	if (laeuft) return;
	laeuft = true;
	try {
		for (const termin of TERMINE.filter((t) => t.live)) {
			const t0 = Date.now();
			const s = await pollTermin(db, termin, {
				log,
				nurBehoerden: NUR_BEHOERDEN,
			});
			log(
				`poll ${termin.id}: ${s.anfragen} Anfragen, ${s.geaendert} Änderungen, ${s.fehler.length} Fehler, ${((Date.now() - t0) / 1000).toFixed(1)}s`,
			);
		}
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
		`wahlen läuft auf http://${HOST}:${PORT} (DB: ${dbPfad()}, Poll alle ${INTERVALL_S}s)`,
	);
	// Erst den Server annehmen lassen, dann Daten laden – so bleibt die Readiness-Probe grün.
	setTimeout(async () => {
		await pollLive();
		await ladeArchiv();
	}, 1000);
	// Der Takt wird jede Minute neu bestimmt, damit der Wahlabend ohne Eingriff
	// von außen enger abgefragt wird.
	let laufenderTakt = 0;
	const takten = () => {
		const soll = takt(
			new Date(),
			TERMINE,
			INTERVALL_S,
			WAHLTAG_INTERVALL_S,
			RUHIGER_INTERVALL_S,
		);
		if (soll === laufenderTakt) return;
		if (taktUhr) clearInterval(taktUhr);
		laufenderTakt = soll;
		taktUhr = setInterval(pollLive, soll * 1000);
		log(
			`Abfragetakt: alle ${soll}s${soll === WAHLTAG_INTERVALL_S && soll !== INTERVALL_S ? " (Wahlabend)" : ""}`,
		);
	};
	let taktUhr: NodeJS.Timeout | undefined;
	takten();
	setInterval(takten, 60_000);
});

const stop = () => {
	log("Beende …");
	server.close(() => process.exit(0));
	setTimeout(() => process.exit(0), 5000).unref();
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
