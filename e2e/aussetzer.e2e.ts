import { type ChildProcess, spawn } from "node:child_process";
import { cpSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import { join } from "node:path";
import { type Page, expect, test } from "@playwright/test";
import {
	FIXTURES,
	aufraeumen,
	tempVerzeichnis,
	wahlabendMitBezirken,
} from "../test/helfer.ts";
import { starteMockVotemanager } from "../test/mock-votemanager.ts";
import { NACHSICHT_MS } from "../src/lib/verbindung.ts";
import { testUmgebung } from "./umgebung.ts";

const BEHOERDEN = ["03254000", "03254026"];
const NORDSTEMMEN = "03254026";
const BEZIRKE = [3111, 3112, 3113, 3114, 3115, 3116, 3117, 3118];
const AUSSETZER_MS = [8_000, 15_000, 40_000];

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

test.describe("Leinwand übersteht einen Netzaussetzer", () => {
	test.describe.configure({ timeout: 300_000 });

	let tmp: string;
	let mock: Awaited<ReturnType<typeof starteMockVotemanager>>;
	let app: ChildProcess | undefined;
	let port: number;
	let gemeldet = 2;

	/** Eine Wahlpräsentation mit genau `anzahl` ausgezählten Wahlbezirken. */
	const stufe = (anzahl: number): string => {
		const wurzel = join(tmp, `stufe-${anzahl}`);
		cpSync(FIXTURES, wurzel, { recursive: true });
		wahlabendMitBezirken(wurzel, NORDSTEMMEN, BEZIRKE.slice(0, anzahl));
		return wurzel;
	};

	const meldeWeiterenBezirk = (): void => {
		gemeldet++;
		mock.setzeWurzel(stufe(gemeldet));
	};

	const halteApp = async () => {
		const p = app;
		app = undefined;
		if (!p) return;
		const aus = new Promise((f) => p.once("exit", f));
		p.kill("SIGTERM");
		await aus;
	};

	const standDerFolie = async (page: Page, marke: string): Promise<number> =>
		Number(
			await page
				.locator(`.db-folie[data-marke="${marke}"]`)
				.getAttribute("data-anz"),
		);

	/** Die Fehlerseite des Browsers hat weder Bühne noch eigene Adresse. */
	const leinwandSteht = async (page: Page): Promise<boolean> =>
		page.url().includes("/nordstemmen/dashboard") &&
		(await page.locator(".db-buehne").count()) === 1;

	const zustellungsLage = (page: Page) =>
		page.evaluate(() => {
			const banner = document.querySelector(".abriss-banner");
			return {
				zustand:
					document.getElementById("stand-anzeige")?.dataset.zustand ?? "",
				banner:
					banner instanceof HTMLElement &&
					banner.checkVisibility({ visibilityProperty: true }),
			};
		});

	const oeffneLeinwand = async (page: Page): Promise<void> => {
		await page.goto(
			`http://127.0.0.1:${port}/hildesheim/2026/nordstemmen/dashboard?takt=300`,
		);
		await expect(page.locator(".db-buehne")).toBeVisible();
		await expect
			.poll(() => zustellungsLage(page))
			.toEqual({ zustand: "verbunden", banner: false });
	};

	test.beforeAll(async () => {
		test.setTimeout(300_000);
		tmp = tempVerzeichnis("wahlen-aussetzer-");
		mock = await starteMockVotemanager(stufe(gemeldet));
		port = await freierPort();
		app = spawn(
			process.execPath,
			["--no-warnings", "--experimental-strip-types", "server/main.ts"],
			{
				stdio: "inherit",
				env: testUmgebung({
					PORT: String(port),
					HOST: "127.0.0.1",
					DATABASE_PATH: join(tmp, "wahlen.db"),
					PUBLIC_SITE_URL: "https://wahlergebnisse.example.org",
					VOTEMANAGER_BASIS: mock.url,
					POLL_INTERVAL_SEKUNDEN: "2",
					POLL_INTERVAL_RUHIG_SEKUNDEN: "2",
					POLL_INTERVAL_BETRACHTET_SEKUNDEN: "2",
					POLL_BEHOERDEN: BEHOERDEN.join(","),
					POLL_KREISE_PRO_LAUF: "45",
					SHUTDOWN_FRIST_MS: "1000",
				}),
			},
		);
		await warteAufBereit(port);
		const ende = Date.now() + 120_000;
		while (Date.now() < ende) {
			const r = await fetch(
				`http://127.0.0.1:${port}/api/v1/hildesheim/2026/${NORDSTEMMEN}`,
			);
			if (r.ok && ((await r.json()).wahlen?.length ?? 0) > 0) break;
			await new Promise((f) => setTimeout(f, 500));
		}
	});

	test.afterAll(async () => {
		await halteApp();
		await mock.schliessen();
		aufraeumen(tmp);
	});

	for (const dauer of AUSSETZER_MS) {
		test(`holt den Stand nach, der während ${dauer / 1000} s ohne Netz einging`, async ({
			page,
			context,
		}) => {
			await oeffneLeinwand(page);
			const vorher = await standDerFolie(page, "rat");
			expect(vorher).toBeGreaterThan(0);

			const begonnen = Date.now();
			await context.setOffline(true);
			meldeWeiterenBezirk();

			let aussetzerAngesagt = false;
			while (Date.now() - begonnen < dauer) {
				expect(
					await leinwandSteht(page),
					"Der Aussetzer hat die Leinwand auf eine Fehlerseite geworfen",
				).toBe(true);
				const jetzt = await zustellungsLage(page);
				if (jetzt.zustand === "unterbrochen" && jetzt.banner)
					aussetzerAngesagt = true;
				await page.waitForTimeout(250);
			}
			expect(await leinwandSteht(page)).toBe(true);
			expect(await standDerFolie(page, "rat")).toBe(vorher);
			if (dauer > NACHSICHT_MS + 2_000)
				expect(
					aussetzerAngesagt,
					"Die Leinwand gab alte Zahlen als aktuell aus",
				).toBe(true);

			await context.setOffline(false);

			await expect
				.poll(() => standDerFolie(page, "rat"), { timeout: 90_000 })
				.toBeGreaterThan(vorher);
			await expect
				.poll(() => zustellungsLage(page), { timeout: 60_000 })
				.toEqual({ zustand: "verbunden", banner: false });
		});
	}
});
