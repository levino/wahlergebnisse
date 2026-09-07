/**
 * Produktions-Einstieg: ein Node-Prozess mit
 *   - dem Astro-SSR-Handler (Middleware-Modus, aus dist/server/entry.mjs),
 *   - statischen Dateien aus dist/client,
 *   - der gestaffelten Poller-Schleife für Live-Termine (siehe src/lib/takt.ts),
 *   - dem einmaligen Laden der Archiv-Termine beim Start.
 *
 * **Was dieser Prozess davon tut, entscheidet `WAHLEN_ROLLE`** (siehe
 * `src/lib/rolle.ts`):
 *
 *   beides  – alles, wie bisher. Voreinstellung für `npm start` und die Tests.
 *   poller  – fragt ab und schreibt; genau eine Kopie, `Recreate`.
 *   web     – liefert nur aus, Datenbank nur lesend; mehrere Kopien,
 *             `RollingUpdate` mit `maxUnavailable: 0`.
 *
 * Der Grund für die Trennung steht in `docs/rollierendes-ausrollen.md`: Ein
 * Deploy darf die Seite nicht unterbrechen. Ein Deployment mit einer Replik
 * und `Recreate` tut genau das – und am Wahlabend, wenn ein Beamer läuft und
 * der Betreiber die laufende Anwendung nachbessert, ist das nicht hinnehmbar.
 *
 * Läuft mit Node ≥ 22.18 direkt aus TypeScript (Type-Stripping), kein Build-Schritt
 * für diesen Teil nötig.
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { TERMINE, istAbgeschlossen, istLive } from "../src/data/termine.ts";
import { VORHANDENE_KREISE } from "../src/data/kreise.ts";
import { mcpHandler } from "./mcp.ts";
import { starteLive } from "./live.ts";
import {
	BETRACHTET_S,
	GRUNDTAKT_S,
	STANDARD_ABSTAENDE,
	STANDARD_HOECHSTENS,
	faelligeKreise,
	stufe,
} from "../src/lib/takt.ts";
import { type Db, dbPfad, oeffneDb } from "../src/lib/db.ts";
import { pollTermin, terminVollstaendig } from "../src/lib/poll.ts";
import { rolle, schreibtDieserProzess } from "../src/lib/rolle.ts";
import {
	betrachtetVerzeichnis,
	liesBetrachtet,
	starteMelder,
} from "../src/lib/betrachtet.ts";
import { liesGeprueft, merkeGeprueft } from "../src/lib/geprueft.ts";
import { uebernimmSchnappschuss } from "../src/lib/schnappschuss.ts";

const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? "0.0.0.0";
const ROLLE = rolle();
const POLLT = schreibtDieserProzess();
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

/**
 * Datenbank öffnen – in der Rolle `web` erst, wenn es sie gibt.
 *
 * Eine nur lesende Verbindung kann keine Datei anlegen: Auf einem frischen
 * Volume (Vorschau-Umgebung, erster Start eines Clusters) wirft
 * `node:sqlite`, bis der Poller die Datei erzeugt hat. Statt in eine
 * Neustartschleife zu laufen, wartet der Web-Pod – die Bereitschaftsprüfung
 * ist so lange rot, der Dienst schickt ihm keinen Verkehr, und die alten Pods
 * liefern weiter aus.
 */
const oeffneWennDa = async (): Promise<Db> => {
	for (let versuch = 1; ; versuch++) {
		try {
			return oeffneDb(dbPfad());
		} catch (e) {
			if (POLLT) throw e;
			if (versuch === 1 || versuch % 30 === 0)
				log(
					`Datenbank ${dbPfad()} noch nicht lesbar (${(e as Error).message}) – warte auf den Poller`,
				);
			await new Promise((f) => setTimeout(f, 2000));
		}
	}
};

// Ausgangsbestand: Bevor die Datei überhaupt geöffnet wird, bekommt ein leeres
// Volume den eingebackenen Schnappschuss (docs/ausgangsbestand.md). Nur der
// Poller – die Web-Pods öffnen nur lesend und dürfen hier nichts tun. Danach
// läuft alles wie immer: Schema ergänzen, `migriereDatenstand` sieht den
// Datenstand, den der Schnappschuss mitbringt.
if (POLLT) await uebernimmSchnappschuss({ ziel: dbPfad(), log });

const db = await oeffneWennDa();

// --- Wer sieht gerade hin? ---
//
// Der Kreis, den gerade jemand ansieht, wird häufig abgefragt, die übrigen
// selten (src/lib/takt.ts). Woher der Server weiß, dass jemand hinsieht: Jede
// Anfrage, deren erstes Pfadsegment ein bekannter Kreis ist, setzt einen
// Zeitstempel. Mehr wird nicht festgehalten – kein Zähler, keine Kennung,
// nichts, was einen Besucher wiedererkennt.
//
// Neu ist nur der Weg: In der Rolle `web` sitzt der Zuschauer in einem anderen
// Prozess als der Poller. Die Meldung geht deshalb über eine kleine Datei je
// Pod (src/lib/betrachtet.ts) – ohne zweiten Schreiber auf der Datenbank und
// ohne dass ein kurz abwesender Poller etwas verpasst.
const KREIS_SLUGS = new Set(VORHANDENE_KREISE.map((k) => k.slug));
const gesehen = new Map<string, number>();
// Was der Poller vor seinem Neustart schon geholt hatte. Ohne das gälte nach
// jedem Deploy jeder Kreis als „nie geholt" und damit als sofort fällig – 38
// Kreise auf einen Schlag, die größte Spitze überhaupt, ausgerechnet direkt
// nach einem Deploy am Wahlabend. (Als Kopie: `liesGeprueft` gibt seine
// gemerkte Map zurück, und die soll hier niemand fortschreiben.)
const geholt = POLLT ? new Map(liesGeprueft(db)) : new Map<string, number>();

const MELDE_VERZEICHNIS = betrachtetVerzeichnis(dbPfad());
const melder =
	ROLLE === "web"
		? starteMelder({
				verzeichnis: MELDE_VERZEICHNIS,
				// In Kubernetes ist HOSTNAME der Pod-Name; jeder Pod schreibt damit
				// genau seine eigene Datei und niemand die eines anderen.
				id: process.env.HOSTNAME || `pid-${process.pid}`,
			})
		: undefined;

const merkeBetrachtung = (kreis: string): void => {
	if (melder) melder.melde(kreis);
	else gesehen.set(kreis, Date.now());
};

const merkeAufruf = (pfad: string): void => {
	const erstes = pfad.split("/")[1] ?? "";
	if (KREIS_SLUGS.has(erstes)) merkeBetrachtung(erstes);
};

// Zustellung neuer Stände an offene Seiten (SSE, siehe server/live.ts). Eine
// offene Leitung ist nur *eine* Anfrage; damit ein Kreis, den jemand
// stundenlang ansieht, nicht wieder als unbeobachtet gilt, meldet der Dienst
// bei jedem Puls, wer zusieht.
const zustellung = starteLive({
	beiBetrachtung: merkeBetrachtung,
	// „geprüft um …“ soll für den angesehenen Kreis gelten, nicht für den
	// letzten Lauf irgendwo in Niedersachsen. Im Ein-Prozess-Betrieb steht das
	// in `geholt`; ein Web-Pod liest es aus der Meta-Tabelle, die der Poller
	// nach jedem Lauf fortschreibt (src/lib/geprueft.ts).
	geprueftFuer: (kreis) =>
		POLLT ? geholt.get(kreis) : liesGeprueft(db).get(kreis),
});

let laeuft = false;
const pollLive = async () => {
	if (laeuft) return;
	laeuft = true;
	const begonnen = Date.now();
	try {
		// Eingefrorene Termine sind hier nicht dabei: Ihr Ergebnis ist amtlich
		// und endgültig, die Quelle wird nicht mehr angefasst (istLive in
		// src/data/termine.ts). Ist danach kein Termin mehr live, hat der
		// Poller nichts mehr zu tun – die Seite läuft als Archiv.
		const live = TERMINE.filter(istLive);
		if (live.length === 0) return;
		// Was die Web-Pods gemeldet haben, dazunehmen. Im Ein-Prozess-Betrieb
		// gibt es das Verzeichnis nicht und die Schleife bleibt leer.
		for (const [slug, zeit] of liesBetrachtet(MELDE_VERZEICHNIS))
			if ((gesehen.get(slug) ?? 0) < zeit) gesehen.set(slug, zeit);
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
		// Und dasselbe in die Datenbank, damit die Web-Pods „geprüft 18:44"
		// für *diesen* Kreis anzeigen können und ein Neustart des Pollers
		// nicht wieder bei null anfängt (src/lib/geprueft.ts).
		merkeGeprueft(db, faellig, fertig);
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
	for (const termin of TERMINE.filter((t) => !istLive(t))) {
		// Eingefroren heißt: gar nicht mehr nachsehen – auch dann nicht, wenn
		// ein erhöhter DATENSTAND die `vollstaendig`-Marke gerade gelöscht hat.
		// Was dieser Termin an Ableitungen braucht, kommt aus dem
		// Ausgangsbestand, nicht aus der Quelle (docs/ausgangsbestand.md).
		if (istAbgeschlossen(termin)) {
			log(`Archiv ${termin.id}: abgeschlossen, wird nicht mehr abgefragt`);
			continue;
		}
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

// --- Lebt der Prozess, und kann er antworten? ---
//
// Zwei verschiedene Fragen, bis hierher mit einer Antwort. `/healthz` sagte
// „ok", sobald der Server auf dem Port lauschte – und das tut er, bevor
// irgendeine Seite je gerendert wurde. Für die *Lebendigkeit* ist das richtig
// (die Ereignisschleife dreht sich, sonst käme keine Antwort). Für die
// *Bereitschaft* ist es zu wenig: Ein rollendes Ausrollen mit
// `maxUnavailable: 0` steht und fällt damit, dass ein neuer Pod erst Verkehr
// bekommt, wenn er wirklich liefern kann. Sonst tauscht Kubernetes die alten
// Pods gegen neue, die noch nichts können, und der Ausfall ist da – nur
// unauffälliger als vorher.
//
// Deshalb misst `/readyz` das, was zählt:
//   1. Die Datenbank antwortet. (In der Rolle `web` heißt das: Der Poller hat
//      die Datei angelegt und sie ist lesbar.)
//   2. Der Astro-Handler hat mindestens einmal eine echte Seite gerendert.
//      Das prüft in einem Zug, dass das Bundle geladen ist, dass es seine
//      *eigene* Datenbankverbindung öffnen konnte (es ist eine eigene Kopie
//      der Module) und dass die Vorlagen übersetzt sind.
let hatGerendert = false;

/** Eine echte Seite anfordern, bis sie kommt – danach gilt der Pod als bereit. */
const waermeAuf = async (): Promise<void> => {
	for (let versuch = 1; !hatGerendert; versuch++) {
		try {
			const r = await fetch(`http://127.0.0.1:${PORT}/`, {
				signal: AbortSignal.timeout(20_000),
			});
			if (r.ok) {
				// Rumpf abholen, sonst bleibt die Verbindung offen.
				await r.arrayBuffer();
				hatGerendert = true;
				log(`bereit: die Startseite rendert (Versuch ${versuch})`);
				return;
			}
			throw new Error(`HTTP ${r.status}`);
		} catch (e) {
			if (versuch === 1 || versuch % 10 === 0)
				log(`noch nicht bereit (${(e as Error).message}) – neuer Versuch`);
			await new Promise((f) => setTimeout(f, 1000));
		}
	}
};

const server = createServer((req, res) => {
	const url = new URL(req.url ?? "/", "http://localhost");
	merkeAufruf(url.pathname);
	// Lebendigkeit: bewusst ohne Datenbank und ohne Rendern. Was hier scheitert,
	// lässt sich nur durch einen Neustart heilen – und ein Neustart ist das
	// Einzige, was diese Prüfung auslöst.
	if (url.pathname === "/healthz") {
		res.writeHead(200, { "content-type": "text/plain" });
		res.end("ok");
		return;
	}
	if (url.pathname === "/readyz") {
		let grund = "";
		if (!hatGerendert) grund = "die Startseite hat noch nicht gerendert";
		else
			try {
				db.prepare("SELECT 1").get();
			} catch (e) {
				grund = `Datenbank antwortet nicht: ${(e as Error).message}`;
			}
		res.writeHead(grund ? 503 : 200, {
			"content-type": "text/plain; charset=utf-8",
			"cache-control": "no-store",
		});
		res.end(grund || "bereit");
		return;
	}
	// Live-Zustellung. Wie /mcp außerhalb von Astro, weil die Antwort offen
	// bleibt und weil nur hier – im Prozess des Pollers – bekannt ist, wann
	// etwas Neues gespeichert wurde.
	if (zustellung.handhabe(req, res, url)) return;
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
		`wahlen läuft als "${ROLLE}" auf http://${HOST}:${PORT} (DB: ${dbPfad()}${POLLT ? "" : ", nur lesend"}, ${KREIS_SLUGS.size} Kreise${POLLT ? `, Takt ${TAKT_S}s` : ""})`,
	);
	// Erst rendern lassen, dann bereit melden. Der Aufruf geht über den eigenen
	// Port und damit durch denselben Weg wie jede Anfrage von außen.
	void waermeAuf();
	if (!POLLT) return;
	// Erst den Server annehmen lassen, dann Daten laden – so bleibt die Readiness-Probe grün.
	setTimeout(async () => {
		await pollLive();
		await ladeArchiv();
	}, 1000);
	// Die Uhr tickt gleichmäßig; welche Kreise ein Lauf anfasst, entscheidet
	// faelligeKreise. So braucht der Wahlabend keinen Eingriff von außen.
	setInterval(pollLive, TAKT_S * 1000);
});

/**
 * Gnadenfrist beim Beenden.
 *
 * Kubernetes nimmt den Pod aus dem Dienst und schickt SIGTERM – beides
 * gleichzeitig und nicht abgestimmt, weshalb im Deployment ein `preStop`-Schlaf
 * steht, der der Endpunkt-Entfernung Vorsprung gibt. Danach dürfen nur noch
 * angefangene Antworten fertig werden; dass sie das tun, ist der Unterschied
 * zwischen „rollendes Ausrollen" und „unterbrechungsfreies Ausrollen".
 */
const FRIST_MS = Number(process.env.SHUTDOWN_FRIST_MS ?? 10_000);

let beendet = false;
const stop = () => {
	if (beendet) return;
	beendet = true;
	log("Beende …");
	// Offene Live-Leitungen zuerst schließen: server.close() wartet sonst
	// darauf, dass sie von selbst enden – das täten sie nie. Die Seiten
	// verbinden von selbst neu (retry vom Server) und landen dann beim
	// nächsten Pod.
	zustellung.schliesse();
	melder?.schliesse();
	server.close(() => process.exit(0));
	// Angefangene Antworten laufen weiter, ruhende Keep-Alive-Verbindungen
	// dagegen sofort weg: Traefik soll keinen Socket wiederverwenden, den
	// dieser Prozess gleich schließt – das wäre genau der eine
	// fehlgeschlagene Aufruf, den es nicht geben darf.
	server.closeIdleConnections?.();
	setTimeout(() => process.exit(0), FRIST_MS).unref();
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
