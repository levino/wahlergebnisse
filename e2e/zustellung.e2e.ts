import { type ChildProcess, spawn } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { join } from "node:path";
import { type Page, expect, test } from "@playwright/test";
import {
	aufraeumen,
	tempVerzeichnis,
	wahlabendFixtures,
} from "../test/helfer.ts";
import { starteMockVotemanager } from "../test/mock-votemanager.ts";

const BEHOERDEN = ["03254000", "03254026"];
/** Ein kurzer Durchlauf: Der Test soll nicht zehn Minuten auf Zahlen warten. */
const DEMO_ZYKLUS = "90";

const freierPort = (): Promise<number> =>
	new Promise((fertig, fehler) => {
		const s = createNetServer();
		s.on("error", fehler);
		s.listen(0, "127.0.0.1", () => {
			const port = (s.address() as { port: number }).port;
			s.close(() => fertig(port));
		});
	});

const warteAufBereit = async (port: number, frist = 60_000): Promise<void> => {
	const ende = Date.now() + frist;
	while (Date.now() < ende) {
		try {
			const r = await fetch(`http://127.0.0.1:${port}/readyz`);
			if (r.ok) return;
		} catch {}
		await new Promise((f) => setTimeout(f, 250));
	}
	throw new Error(`Server auf ${port} wurde nicht bereit`);
};

test.describe("Zustellung überlebt einen Neustart", () => {
	let tmp: string;
	let dbPfad: string;
	let mock: Awaited<ReturnType<typeof starteMockVotemanager>>;
	let app: ChildProcess | undefined;
	let port: number;

	/** Startet den Server auf demselben Port und derselben Datenbank. */
	const starteApp = async (demo: boolean) => {
		app = spawn(
			process.execPath,
			["--no-warnings", "--experimental-strip-types", "server/main.ts"],
			{
				stdio: "inherit",
				env: {
					...process.env,
					PORT: String(port),
					HOST: "127.0.0.1",
					DATABASE_PATH: dbPfad,
					PUBLIC_SITE_URL: "https://wahlergebnisse.example.org",
					VOTEMANAGER_BASIS: mock.url,
					POLL_INTERVAL_SEKUNDEN: "2",
					POLL_INTERVAL_RUHIG_SEKUNDEN: "2",
					POLL_INTERVAL_BETRACHTET_SEKUNDEN: "2",
					POLL_BEHOERDEN: BEHOERDEN.join(","),
					POLL_KREISE_PRO_LAUF: "45",
					SHUTDOWN_FRIST_MS: "1000",
					// Der Poller erzeugt Moderationsbeiträge und ruft dafür einen
					// bezahlten Dienst. Ohne Schlüssel unterbleibt das; sonst
					// zahlte ein Testlauf mit `.env` im Baum echtes Geld.
					OPENAI_API_KEY: "",
					...(demo
						? {
								WAHLEN_DEMO: "1",
								WAHLEN_DEMO_ZYKLUS: DEMO_ZYKLUS,
								WAHLEN_DEMO_BEHOERDEN: BEHOERDEN.join(","),
							}
						: {}),
				},
			},
		);
		await warteAufBereit(port);
	};

	const halteApp = async () => {
		const p = app;
		app = undefined;
		if (!p) return;
		const aus = new Promise((f) => p.once("exit", f));
		p.kill("SIGTERM");
		await aus;
	};

	/** Der Auszählstand einer Folie, wie ihn die Leinwand gerade zeigt. */
	const standDerFolie = async (page: Page, marke: string): Promise<number> =>
		Number(
			await page
				.locator(`.db-folie[data-marke="${marke}"]`)
				.getAttribute("data-anz"),
		);

	test.beforeAll(async () => {
		test.setTimeout(300_000);
		tmp = tempVerzeichnis("wahlen-zustellung-");
		dbPfad = join(tmp, "wahlen.db");
		mock = await starteMockVotemanager(wahlabendFixtures(join(tmp, "daten")));
		port = await freierPort();

		await starteApp(false);
		const ende = Date.now() + 120_000;
		while (Date.now() < ende) {
			const r = await fetch(
				`http://127.0.0.1:${port}/api/v1/hildesheim/2021/03254026`,
			);
			if (r.ok && ((await r.json()).wahlen?.length ?? 0) > 0) break;
			await new Promise((f) => setTimeout(f, 500));
		}
		await halteApp();
		await starteApp(true);
	});

	test.afterAll(async () => {
		await halteApp();
		await mock.schliessen();
		aufraeumen(tmp);
	});

	test("holt neue Zahlen von selbst – auch nachdem der Server weg war", async ({
		page,
	}) => {
		await page.goto(
			`http://127.0.0.1:${port}/hildesheim/2026/nordstemmen/dashboard?takt=300`,
		);
		await expect(page.locator(".db-buehne")).toBeVisible();
		const anzeige = page.locator("#stand-anzeige");
		await expect(anzeige).toHaveAttribute("data-zustand", "verbunden");

		const vorher = await standDerFolie(page, "rat");
		await expect
			.poll(() => standDerFolie(page, "rat"), { timeout: 60_000 })
			.toBeGreaterThan(vorher);

		await halteApp();
		await expect(anzeige).toHaveAttribute("data-zustand", "unterbrochen", {
			timeout: 30_000,
		});
		await expect(page.locator(".abriss-banner")).toBeVisible();

		const beimAbriss = await standDerFolie(page, "rat");
		await starteApp(true);

		await expect(anzeige).toHaveAttribute("data-zustand", "verbunden", {
			timeout: 60_000,
		});
		await expect(page.locator(".abriss-banner")).toBeHidden();
		await expect
			.poll(() => standDerFolie(page, "rat"), { timeout: 90_000 })
			.toBeGreaterThan(beimAbriss);
	});

	test("blendet ein, was in der Zwischenzeit hereingekommen ist", async ({
		page,
	}) => {
		await page.goto(
			`http://127.0.0.1:${port}/hildesheim/2026/nordstemmen/dashboard?takt=300`,
		);
		await expect(page.locator(".db-buehne")).toBeVisible();
		await expect(page.locator(".db-meldung").first()).toBeVisible({
			timeout: 90_000,
		});
	});
});
