import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { TERMINE, istAbgeschlossen, istLive } from "../src/data/termine.ts";
import {
	type Kreis,
	STANDARD_KREIS,
	VORHANDENE_KREISE,
	kreisBySlug,
} from "../src/data/kreise.ts";
import type { Behoerde } from "../src/data/behoerden.ts";
import { kreisHatDaten } from "../src/lib/abfragen.ts";
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
import { handhabeAnsage } from "./ansage.ts";
import {
	type Db,
	dbPfad,
	jetzt,
	metaGet,
	metaSet,
	oeffneDb,
} from "../src/lib/db.ts";
import { pollTermin, terminVollstaendig } from "../src/lib/poll.ts";
import { rolle, schreibtDieserProzess } from "../src/lib/rolle.ts";
import {
	NULLPUNKT_SCHLUESSEL,
	demoAn,
	demoBehoerden,
	demoNeustart,
	demoZyklusSekunden,
	nullpunkt,
	zyklusVon,
} from "../src/lib/demo.ts";
import {
	type DemoWahl,
	baueVorlage,
	legeWahlenAn,
	raeumeDemoTermin,
	spieleStand,
} from "../src/lib/demo-abend.ts";
import {
	betrachtetVerzeichnis,
	liesBetrachtet,
	starteMelder,
} from "../src/lib/betrachtet.ts";
import { liesGeprueft, merkeGeprueft } from "../src/lib/geprueft.ts";
import { uebernimmSchnappschuss } from "../src/lib/schnappschuss.ts";
import { uebernimmDemoBestand } from "../src/lib/demo-bestand.ts";

const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? "0.0.0.0";
const ROLLE = rolle();
const POLLT = schreibtDieserProzess();
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
const HOECHSTENS_PRO_LAUF = process.env.POLL_KREISE_PRO_LAUF
	? Number(process.env.POLL_KREISE_PRO_LAUF)
	: STANDARD_HOECHSTENS;
const TAKT_S = Math.max(
	1,
	Math.min(
		GRUNDTAKT_S,
		...Object.values(ABSTAENDE).flatMap((a) => [a.betrachtet, a.uebrig]),
	),
);
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

if (POLLT) await uebernimmSchnappschuss({ ziel: dbPfad(), log });
if (POLLT) await uebernimmDemoBestand({ ziel: dbPfad(), log });

const db = await oeffneWennDa();

const KREIS_SLUGS = new Set(VORHANDENE_KREISE.map((k) => k.slug));
const gesehen = new Map<string, number>();
const geholt = POLLT ? new Map(liesGeprueft(db)) : new Map<string, number>();

const MELDE_VERZEICHNIS = betrachtetVerzeichnis(dbPfad());
const melder =
	ROLLE === "web"
		? starteMelder({
				verzeichnis: MELDE_VERZEICHNIS,
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

const zustellung = starteLive({
	beiBetrachtung: merkeBetrachtung,
	geprueftFuer: (kreis) =>
		POLLT ? geholt.get(kreis) : liesGeprueft(db).get(kreis),
});

let laeuft = false;
const pollLive = async () => {
	if (laeuft) return;
	laeuft = true;
	const begonnen = Date.now();
	try {
		const live = TERMINE.filter(istLive);
		if (live.length === 0) return;
		for (const [slug, zeit] of liesBetrachtet(MELDE_VERZEICHNIS))
			if ((gesehen.get(slug) ?? 0) < zeit) gesehen.set(slug, zeit);
		const ohneDaten = new Set(
			VORHANDENE_KREISE.filter((k) => !kreisHatDaten(k)).map((k) => k.slug),
		);
		const faellig = faelligeKreise({
			jetzt: new Date(),
			termine: TERMINE,
			kreise: [...KREIS_SLUGS],
			gesehen,
			geholt,
			abstaende: ABSTAENDE,
			betrachtetS: BETRACHTET_S,
			hoechstens: HOECHSTENS_PRO_LAUF,
			ohneDaten,
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
		merkeGeprueft(db, faellig, fertig);
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

const DEMO_TAKT_S = 5;
const demoNullpunkt = (): number => {
	const { beginn, merken } = nullpunkt(
		metaGet(db, NULLPUNKT_SCHLUESSEL),
		Date.now(),
		{ neustart: demoNeustart(), darfSchreiben: POLLT },
	);
	if (merken) {
		metaSet(db, NULLPUNKT_SCHLUESSEL, String(beginn));
		log(
			demoNeustart()
				? "demo: Nullpunkt auf jetzt gesetzt (WAHLEN_DEMO_NEUSTART=1) – der Abend beginnt von vorn"
				: "demo: Nullpunkt gemerkt – Neustart und Deploy laufen weiter, wo die Uhr steht",
		);
	}
	return beginn;
};
const DEMO_BEGINN = demoAn() ? demoNullpunkt() : 0;

const DEMO_JE_TAKT = 30;

/** Wahlleitungen, die schon aufgeräumt und angelegt sind (je AGS einmal). */
const demoVorbereitet = new Set<string>();
/** Wo die Runde gerade steht. */
let demoStelle = 0;
let demoListe: Array<{ kreis: Kreis; behoerde: Behoerde }> | undefined;

const DEMO_NACHLAUF_MS = 5 * 60_000;

const demoWahlleitungen = (): Array<{ kreis: Kreis; behoerde: Behoerde }> => {
	const nur = demoBehoerden();
	const jetztMs = Date.now();
	for (const [slug, zeit] of liesBetrachtet(MELDE_VERZEICHNIS))
		if ((gesehen.get(slug) ?? 0) < zeit) gesehen.set(slug, zeit);
	const betrachtet = [...gesehen]
		.filter(([, zeit]) => jetztMs - zeit < DEMO_NACHLAUF_MS)
		.map(([slug]) => slug);
	const slugs = new Set(betrachtet.length > 0 ? betrachtet : [STANDARD_KREIS]);
	return VORHANDENE_KREISE.filter((k) => slugs.has(k.slug)).flatMap((kreis) =>
		kreis.behoerden
			.filter((behoerde) => !nur || nur.includes(behoerde.ags))
			.map((behoerde) => ({ kreis, behoerde })),
	);
};

const demoSchritt = () => {
	const termin = TERMINE.find((t) => t.live);
	if (!termin) return;
	try {
		const liste = demoWahlleitungen();
		if (liste.length === 0) return;
		const vorher = new Set((demoListe ?? []).map((v) => v.kreis.slug));
		const dazu = liste.filter((v) => !vorher.has(v.kreis.slug));
		if (
			!demoListe ||
			demoListe.length !== liste.length ||
			demoListe.some((v, i) => v.behoerde.ags !== liste[i]?.behoerde.ags)
		) {
			demoStelle = 0;
			log(
				`demo: ${liste.length} Wahlleitung(en) in ${new Set(liste.map((v) => v.kreis.slug)).size} betrachteten Kreis(en), ${DEMO_JE_TAKT} je Takt, Zyklus ${demoZyklusSekunden()}s`,
			);
		}
		demoListe = liste;
		const zyklus = zyklusVon(Date.now(), demoZyklusSekunden(), DEMO_BEGINN);
		let geaendert = 0;
		let gespielt = 0;
		const kreiseImTakt = new Set<string>();
		const dranSein = new Map<string, { kreis: Kreis; behoerde: Behoerde }>();
		for (const v of dazu) {
			if (dranSein.size >= DEMO_JE_TAKT) break;
			dranSein.set(v.behoerde.ags, v);
		}
		for (let n = 0; dranSein.size < DEMO_JE_TAKT && n < demoListe.length; n++) {
			const v = demoListe[demoStelle % demoListe.length];
			demoStelle = (demoStelle + 1) % demoListe.length;
			dranSein.set(v.behoerde.ags, v);
		}
		for (const dran of dranSein.values()) {
			const wahlen = baueVorlage(db, dran.kreis, termin, dran.behoerde);
			if (wahlen.length === 0) continue;
			if (!demoVorbereitet.has(dran.behoerde.ags)) {
				raeumeDemoTermin(db, termin, dran.behoerde, wahlen);
				legeWahlenAn(db, termin, dran.behoerde, wahlen);
				demoVorbereitet.add(dran.behoerde.ags);
			}
			geaendert += spieleStand(db, termin, dran.behoerde, wahlen, zyklus);
			kreiseImTakt.add(dran.kreis.slug);
			gespielt++;
		}
		const jetztMs = Date.now();
		for (const slug of kreiseImTakt) geholt.set(slug, jetztMs);
		merkeGeprueft(db, kreiseImTakt, jetztMs);
		if (geaendert > 0) {
			metaSet(db, `termin:${termin.id}:zuletzt`, jetzt());
			metaSet(db, `termin:${termin.id}:version`, jetzt());
			log(
				`demo: Durchlauf ${zyklus.nummer}, ${Math.round(zyklus.fortschritt * 100)} % ausgezählt, ${gespielt} Wahlleitung(en), ${geaendert} Änderungen`,
			);
		}
	} catch (e) {
		log(`demo fehlgeschlagen: ${(e as Error).message}`);
	}
};

const ladeArchiv = async () => {
	for (const termin of TERMINE.filter((t) => !istLive(t))) {
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

let hatGerendert = false;

/** Eine echte Seite anfordern, bis sie kommt – danach gilt der Pod als bereit. */
const waermeAuf = async (): Promise<void> => {
	for (let versuch = 1; !hatGerendert; versuch++) {
		try {
			const r = await fetch(`http://127.0.0.1:${PORT}/`, {
				signal: AbortSignal.timeout(20_000),
			});
			if (r.ok) {
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
	if (zustellung.handhabe(req, res, url)) return;
	if (handhabeAnsage(req, res, url)) return;
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
	void waermeAuf();
	if (!POLLT) return;
	if (demoAn()) {
		setTimeout(demoSchritt, 1000);
		setInterval(demoSchritt, DEMO_TAKT_S * 1000);
		return;
	}
	setTimeout(async () => {
		await pollLive();
		await ladeArchiv();
	}, 1000);
	setInterval(pollLive, TAKT_S * 1000);
});

const FRIST_MS = Number(process.env.SHUTDOWN_FRIST_MS ?? 10_000);

let beendet = false;
const stop = () => {
	if (beendet) return;
	beendet = true;
	log("Beende …");
	zustellung.schliesse();
	melder?.schliesse();
	server.close(() => process.exit(0));
	server.closeIdleConnections?.();
	setTimeout(() => process.exit(0), FRIST_MS).unref();
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
