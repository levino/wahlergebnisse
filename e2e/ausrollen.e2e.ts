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
import { testUmgebung } from "./umgebung.ts";

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
				agent: new Agent({ keepAlive: true, maxSockets: 16 }),
			});
		},
		nimmHeraus: (zielPort: number) => {
			const i = ziele.findIndex((z) => z.port === zielPort);
			if (i < 0) return;
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
				env: testUmgebung({
					WAHLEN_ROLLE: "web",
					PORT: String(port),
					HOST: "127.0.0.1",
					DATABASE_PATH: dbPfad,
					PUBLIC_SITE_URL: "https://wahlergebnisse.example.org",
					SHUTDOWN_FRIST_MS: "3000",
				}),
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
				env: testUmgebung({
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
				}),
			},
		);
		await warteAufBereit(pollerPort);

		verteiler = await starteVerteiler();
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
		expect(d.termin?.stand).toBeTruthy();

		const seite = await fetch(`${verteiler.basis}/hildesheim/2026/`);
		expect(seite.status).toBe(200);
		expect(await seite.text()).toContain("stand-anzeige");
	});

	test("die Probe schlägt an, wenn wirklich etwas fehlt", async () => {
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

		await new Promise((f) => setTimeout(f, 3_000));
		const vorher = probe.zahl();

		const alt = web[0];
		const neu = await starteWeb();
		expect(neu).not.toBe(alt.port);
		await new Promise((f) => setTimeout(f, 2_000));
		verteiler.nimmHeraus(alt.port);
		await new Promise((f) => setTimeout(f, 1_000));
		await beende(alt.prozess);
		web.splice(0, 1);
		await new Promise((f) => setTimeout(f, 3_000));

		const { anfragen, fehler } = await probe.halte();
		console.log(
			`Ausrollprobe: ${anfragen} Anfragen über den Wechsel, ${fehler.length} fehlgeschlagen`,
		);
		expect(
			fehler.length,
			`${anfragen} Anfragen, davon ${fehler.length} fehlgeschlagen:\n${fehler.slice(0, 20).join("\n")}`,
		).toBe(0);
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

		await expect(anzeige).toHaveAttribute("data-zustand", "verbunden", {
			timeout: 45_000,
		});
		await expect(page.locator("body")).toContainText("Wahlergebnisse");
	});
});
