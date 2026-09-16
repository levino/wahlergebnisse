import { type ChildProcess, spawn } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { aufraeumen, tempVerzeichnis } from "../test/helfer.ts";
import { testUmgebung } from "./umgebung.ts";

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

test.describe("Wahlabend-Schicht abgestellt", () => {
	test.describe.configure({ timeout: 180_000 });

	let app: ChildProcess;
	let tmp: string;
	let port: number;
	const adresse = (pfad: string) => `http://127.0.0.1:${port}${pfad}`;

	test.beforeAll(async () => {
		tmp = tempVerzeichnis("wahlen-wahlabend-aus-");
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
					WAHLABEND: "0",
					WAHLEN_ABGESCHLOSSEN: "2026",
					POLL_BEHOERDEN: "03254026",
					SHUTDOWN_FRIST_MS: "1000",
				}),
			},
		);
		await warteAufBereit(port);
	});

	test.afterAll(async () => {
		app?.kill("SIGTERM");
		await new Promise((f) => setTimeout(f, 500));
		aufraeumen(tmp);
	});

	test("Die Leinwand ist nicht mehr zu erreichen", async ({ page }) => {
		const antwort = await page.goto(
			adresse("/hildesheim/2026/nordstemmen/dashboard"),
		);
		expect(antwort?.status()).toBe(404);
		await expect(page.locator(".db-buehne")).toHaveCount(0);
	});

	test("Leitung und Beitragspfade gibt es nicht", async ({ request }) => {
		expect((await request.get(adresse("/api/live?termin=2026"))).status()).toBe(
			404,
		);
		expect(
			(await request.get(adresse("/api/beitraege?termin=2026"))).status(),
		).toBe(404);
		expect((await request.get(adresse("/api/tonprobe.mp3"))).status()).toBe(
			404,
		);
	});

	test("Die Ergebnisseiten bleiben, ohne Leinwand-Knopf", async ({ page }) => {
		await page.goto(adresse("/hildesheim/2026/nordstemmen/"));
		await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
		await expect(
			page.getByRole("link", { name: "Wahlabend-Dashboard" }),
		).toHaveCount(0);
	});
});
