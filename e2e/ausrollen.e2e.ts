/**
 * Der Beleg: Ein Ausrollen unterbricht die Seite nicht.
 *
 * Behauptet ist das schnell, und behauptet wäre es wertlos — am 13.09.2026
 * läuft die Seite auf einem Beamer, während der Betreiber die laufende
 * Anwendung nachbessert. Also wird der Wechsel hier wirklich vollzogen und
 * dabei ohne Pause abgefragt. **Der Test scheitert, sobald eine einzige
 * Anfrage fehlschlägt.**
 *
 * ## Was hier nachgestellt wird
 *
 * Kein Kubernetes — die Prüfung soll in der CI laufen, ohne Cluster. Aber
 * genau die Mechanik, auf die es ankommt:
 *
 *   Poller (schreibt)  ─┐
 *   Web A (liest)      ─┼─  dieselbe SQLite-Datei, WAL
 *   Web B (liest)      ─┘
 *
 *   Probe ──▶ Verteiler ──▶ die Web-Prozesse, die bereit sind
 *
 * Der Verteiler verhält sich wie ein Kubernetes-Dienst hinter Traefik:
 *
 *  - Ein Ziel bekommt Verkehr erst, wenn sein `/readyz` grün ist
 *    (`maxUnavailable: 0` steht und fällt damit).
 *  - Ein Ziel wird aus der Verteilung genommen, **bevor** sein Prozess SIGTERM
 *    bekommt, und seine Keep-Alive-Verbindungen werden dabei abgeräumt – das
 *    ist die Rolle, die im Cluster der `preStop`-Schlaf spielt.
 *  - Solange beide bereit sind, bekommen beide Verkehr; ein alter und ein
 *    neuer Stand laufen also wirklich gleichzeitig auf derselben Datenbank.
 *
 * ## Was der Test nicht zeigt
 *
 * Traefik selbst, echte Last und den einmaligen Übergang vom bisherigen
 * Ein-Pod-Betrieb. Das steht in docs/rollierendes-ausrollen.md unter „Was
 * geprüft ist — und was nicht".
 */
import { type ChildProcess, spawn } from "node:child_process";
import { Agent, type IncomingMessage, createServer, request } from "node:http";
import { createServer as createNetServer } from "node:net";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
	aufraeumen,
	tempVerzeichnis,
	wahlabendFixtures,
} from "../test/helfer.ts";
import { starteMockVotemanager } from "../test/mock-votemanager.ts";

/** Behörden mit Fixtures – mehr braucht der Lauf nicht. */
const BEHOERDEN = ["03254000", "03254026"];
/** Adressen, die die Probe abruft: statisch, gerendert, API. */
const PROBEN_PFADE = [
	"/",
	"/hildesheim/",
	"/hildesheim/2026/",
	"/api/v1/hildesheim/2026",
	"/favicon.svg",
];

const freierPort = (): Promise<number> =>
	new Promise((fertig, fehler) => {
		const s = createNetServer();
		s.on("error", fehler);
		s.listen(0, "127.0.0.1", () => {
			const port = (s.address() as { port: number }).port;
			s.close(() => fertig(port));
		});
	});

/**
 * Die Probe: ruft ohne Pause ab und schreibt jeden Fehlschlag mit.
 *
 * `spuren` Schleifen nebeneinander, damit während des Wechsels immer eine
 * Anfrage unterwegs ist und nicht nur zufällig eine.
 */
const starteProbe = (basis: string, pfade: string[], spuren = 4) => {
	const fehler: string[] = [];
	let anfragen = 0;
	let laeuft = true;
	const spur = async (versatz: number) => {
		let i = versatz;
		while (laeuft) {
			const pfad = pfade[i++ % pfade.length];
			anfragen++;
			try {
				const r = await fetch(`${basis}${pfad}`, {
					signal: AbortSignal.timeout(15_000),
				});
				await r.arrayBuffer();
				if (r.status !== 200) fehler.push(`${pfad} → HTTP ${r.status}`);
			} catch (e) {
				fehler.push(`${pfad} → ${(e as Error).message}`);
			}
		}
	};
	const spurenLaufen = Array.from({ length: spuren }, (_, n) => spur(n));
	return {
		fehler,
		zahl: () => anfragen,
		halte: async () => {
			laeuft = false;
			await Promise.all(spurenLaufen);
			return { anfragen, fehler };
		},
	};
};

type Ziel = { port: number; agent: Agent };

/**
 * Der Verteiler vor den Web-Prozessen – ein Kubernetes-Dienst im Kleinen.
 *
 * Reihum über alle eingetragenen Ziele. Streamt statt zu puffern, damit die
 * Live-Zustellung (SSE) durchgeht.
 */
const starteVerteiler = async () => {
	const ziele: Ziel[] = [];
	let naechstes = 0;
	const port = await freierPort();
	const server = createServer((req, res) => {
		const aktuell = [...ziele];
		if (aktuell.length === 0) {
			res.writeHead(503, { "content-type": "text/plain" }).end("kein Ziel");
			return;
		}
		const ziel = aktuell[naechstes++ % aktuell.length];
		const weiter = request(
			{
				host: "127.0.0.1",
				port: ziel.port,
				path: req.url,
				method: req.method,
				headers: { ...req.headers, host: `127.0.0.1:${ziel.port}` },
				agent: ziel.agent,
			},
			(antwort: IncomingMessage) => {
				res.writeHead(antwort.statusCode ?? 502, antwort.headers);
				antwort.pipe(res);
			},
		);
		weiter.on("error", () => {
			// Fehlt die Gegenstelle, ist das genau der Ausfall, den es nicht
			// geben darf – die Probe sieht ihn als 502.
			if (!res.headersSent)
				res.writeHead(502, { "content-type": "text/plain" }).end("Ziel weg");
			else res.destroy();
		});
		req.pipe(weiter);
	});
	await new Promise<void>((f) => server.listen(port, "127.0.0.1", f));
	return {
		basis: `http://127.0.0.1:${port}`,
		nimmAuf: (zielPort: number) => {
			ziele.push({
				port: zielPort,
				// Keep-Alive wie bei einem echten Reverse-Proxy: Nur so ist die
				// Prüfung überhaupt aussagekräftig – eine frische Verbindung je
				// Anfrage würde das Problem wegdefinieren, um das es geht.
				agent: new Agent({ keepAlive: true, maxSockets: 16 }),
			});
		},
		nimmHeraus: (zielPort: number) => {
			const i = ziele.findIndex((z) => z.port === zielPort);
			if (i < 0) return;
			// Nur aus der Verteilung nehmen – genau das, was die
			// Endpunkt-Entfernung im Cluster tut: keine *neue* Anfrage mehr
			// hierhin. Die offenen Verbindungen bleiben, und eine gerade
			// laufende Antwort wird fertig.
			//
			// Der Agent wird ausdrücklich **nicht** hier zerstört. Ein erster
			// Anlauf tat das, und die Probe meldete prompt einen 502 unter 4419
			// Anfragen – aber der kam aus dem Verteiler und nicht aus dem
			// Server: `Agent.destroy()` reißt auch Sockets mit laufender
			// Anfrage ab. Kubernetes tut das nicht. Wer die Prüfung schärfer
			// macht, als die Wirklichkeit ist, prüft am Ende die Attrappe.
			ziele.splice(i, 1);
		},
		schliesse: () => {
			for (const z of ziele) z.agent.destroy();
			server.close();
		},
	};
};

const warteAufBereit = async (port: number, sekunden = 180): Promise<void> => {
	for (let i = 0; i < sekunden * 2; i++) {
		try {
			const r = await fetch(`http://127.0.0.1:${port}/readyz`);
			if (r.ok) {
				await r.text();
				return;
			}
			await r.text();
		} catch {
			/* startet noch */
		}
		await new Promise((f) => setTimeout(f, 500));
	}
	throw new Error(`Prozess auf ${port} wurde nicht bereit`);
};

const beende = async (prozess: ChildProcess): Promise<void> => {
	if (prozess.exitCode !== null) return;
	const aus = new Promise<void>((f) => prozess.once("exit", () => f()));
	prozess.kill("SIGTERM");
	await Promise.race([aus, new Promise((f) => setTimeout(f, 15_000))]);
	if (prozess.exitCode === null) prozess.kill("SIGKILL");
};

test.describe.configure({ mode: "serial" });

test.describe("Ausrollen ohne Unterbrechung", () => {
	let tmp = "";
	let dbPfad = "";
	let mock: Awaited<ReturnType<typeof starteMockVotemanager>>;
	let verteiler: Awaited<ReturnType<typeof starteVerteiler>>;
	let poller: ChildProcess;
	const web: Array<{ port: number; prozess: ChildProcess }> = [];

	const starteWeb = async () => {
		const port = await freierPort();
		const prozess = spawn(
			process.execPath,
			["--no-warnings", "--experimental-strip-types", "server/main.ts"],
			{
				stdio: "inherit",
				env: {
					...process.env,
					WAHLEN_ROLLE: "web",
					PORT: String(port),
					HOST: "127.0.0.1",
					DATABASE_PATH: dbPfad,
					PUBLIC_SITE_URL: "https://wahlergebnisse.example.org",
					// Kurze Frist, damit der Test nicht auf einen Prozess wartet,
					// der ohnehin nichts mehr tut.
					SHUTDOWN_FRIST_MS: "3000",
				},
			},
		);
		await warteAufBereit(port);
		web.push({ port, prozess });
		verteiler.nimmAuf(port);
		return port;
	};

	test.beforeAll(async () => {
		test.setTimeout(300_000);
		tmp = tempVerzeichnis("wahlen-ausrollen-");
		dbPfad = join(tmp, "wahlen.db");
		mock = await starteMockVotemanager(wahlabendFixtures(join(tmp, "daten")));

		const pollerPort = await freierPort();
		poller = spawn(
			process.execPath,
			["--no-warnings", "--experimental-strip-types", "server/main.ts"],
			{
				stdio: "inherit",
				env: {
					...process.env,
					WAHLEN_ROLLE: "poller",
					PORT: String(pollerPort),
					HOST: "127.0.0.1",
					DATABASE_PATH: dbPfad,
					PUBLIC_SITE_URL: "https://wahlergebnisse.example.org",
					VOTEMANAGER_BASIS: mock.url,
					POLL_INTERVAL_SEKUNDEN: "2",
					POLL_INTERVAL_RUHIG_SEKUNDEN: "2",
					POLL_INTERVAL_BETRACHTET_SEKUNDEN: "2",
					POLL_BEHOERDEN: BEHOERDEN.join(","),
					POLL_KREISE_PRO_LAUF: "45",
				},
			},
		);
		await warteAufBereit(pollerPort);

		verteiler = await starteVerteiler();
		// Warten, bis wirklich Zahlen da sind – sonst prüfte der Test einen
		// Wechsel auf einer leeren Datenbank.
		for (let i = 0; i < 240; i++) {
			const r = await fetch(
				`http://127.0.0.1:${pollerPort}/api/v1/hildesheim/2026`,
			);
			if (r.ok && (await r.json()).termin?.stand) break;
			await new Promise((f) => setTimeout(f, 500));
		}
		await starteWeb();
	});

	test.afterAll(async () => {
		verteiler?.schliesse();
		for (const w of web) await beende(w.prozess);
		if (poller) await beende(poller);
		await mock?.schliessen();
		if (tmp) aufraeumen(tmp);
	});

	test("Nur-Lese-Pods liefern aus, was der schreibende Poller geholt hat", async () => {
		const r = await fetch(`${verteiler.basis}/api/v1/hildesheim/2026`);
		expect(r.ok).toBeTruthy();
		const d = await r.json();
		// Die Zahlen stehen in der Datei, die ein *anderer* Prozess schreibt.
		expect(d.termin?.stand).toBeTruthy();

		// Und die Seite selbst rendert – das ist es, was `/readyz` misst.
		const seite = await fetch(`${verteiler.basis}/hildesheim/2026/`);
		expect(seite.status).toBe(200);
		expect(await seite.text()).toContain("stand-anzeige");
	});

	test("die Probe schlägt an, wenn wirklich etwas fehlt", async () => {
		// Eine Prüfung, die nie rot werden kann, ist keine. Bevor die grüne
		// Messung unten etwas wert ist, muss feststehen, dass die Probe einen
		// Fehlschlag überhaupt bemerkt.
		const probe = starteProbe(verteiler.basis, ["/gibt-es-nicht"], 1);
		await new Promise((f) => setTimeout(f, 300));
		const { anfragen, fehler } = await probe.halte();
		expect(anfragen).toBeGreaterThan(0);
		expect(fehler.length).toBe(anfragen);
		expect(fehler[0]).toContain("404");
	});

	test("während eines Wechsels schlägt keine einzige Anfrage fehl", async () => {
		test.setTimeout(300_000);
		const probe = starteProbe(verteiler.basis, PROBEN_PFADE);

		// Erst eine Weile im ruhigen Zustand, damit die Keep-Alive-Verbindungen
		// zum alten Prozess wirklich stehen – ohne sie wäre der Wechsel
		// gefahrloser, als er in Wirklichkeit ist.
		await new Promise((f) => setTimeout(f, 3_000));
		const vorher = probe.zahl();

		// --- Der Wechsel, Schritt für Schritt wie im Cluster ---
		const alt = web[0];
		// 1. Neuer Pod hoch; er bekommt erst Verkehr, wenn /readyz grün ist.
		//    (`maxSurge: 1`, `maxUnavailable: 0`)
		const neu = await starteWeb();
		expect(neu).not.toBe(alt.port);
		// 2. Eine Weile laufen beide – alter und neuer Stand auf einer Datenbank.
		await new Promise((f) => setTimeout(f, 2_000));
		// 3. Der alte fliegt aus der Verteilung (Endpunkt-Entfernung) …
		verteiler.nimmHeraus(alt.port);
		// 4. … und erst danach bekommt er das Signal (`preStop`-Vorsprung).
		await new Promise((f) => setTimeout(f, 1_000));
		await beende(alt.prozess);
		web.splice(0, 1);
		// 5. Noch etwas weiterlaufen lassen: Ein Fehler zeigt sich sonst erst
		//    nach dem Ende der Messung.
		await new Promise((f) => setTimeout(f, 3_000));

		const { anfragen, fehler } = await probe.halte();
		console.log(
			`Ausrollprobe: ${anfragen} Anfragen über den Wechsel, ${fehler.length} fehlgeschlagen`,
		);
		expect(
			fehler.length,
			`${anfragen} Anfragen, davon ${fehler.length} fehlgeschlagen:\n${fehler.slice(0, 20).join("\n")}`,
		).toBe(0);
		// Eine Probe, die während des Wechsels kaum abgefragt hat, wäre grün und
		// wertlos.
		expect(anfragen - vorher).toBeGreaterThan(20);
	});

	test("eine offene Seite übersteht den Wechsel und zeigt es ehrlich an", async ({
		page,
	}) => {
		test.setTimeout(300_000);
		await page.goto(`${verteiler.basis}/hildesheim/2026/`);
		const anzeige = page.locator("#stand-anzeige");
		await expect(anzeige).toHaveAttribute("data-zustand", "verbunden", {
			timeout: 30_000,
		});

		const alt = web[0];
		const neu = await starteWeb();
		expect(neu).not.toBe(alt.port);
		verteiler.nimmHeraus(alt.port);
		await new Promise((f) => setTimeout(f, 500));
		await beende(alt.prozess);
		web.splice(
			web.findIndex((w) => w.port === alt.port),
			1,
		);

		// Die Leitung reißt ab, `EventSource` verbindet von selbst neu und
		// landet beim neuen Prozess. Was zählt: Die Anzeige findet von allein
		// zurück auf „verbunden" – ohne Zutun, ohne Neuladen.
		await expect(anzeige).toHaveAttribute("data-zustand", "verbunden", {
			timeout: 45_000,
		});
		// Und die Seite lebt: ein Klick trägt weiterhin.
		await expect(page.locator("body")).toContainText("Wahlergebnisse");
	});
});
