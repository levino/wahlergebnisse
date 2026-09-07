import { defineConfig, devices } from "@playwright/test";

/**
 * Browser-Tests gegen den gebauten Produktions-Server (server/main.ts) mit
 * dem Mock-votemanager als Datenquelle. e2e/server.ts startet beides; die
 * App wird vorher mit kurzem Live-Intervall gebaut (npm run e2e).
 */
export default defineConfig({
	testDir: "./e2e",
	testMatch: "**/*.e2e.ts",
	timeout: 60_000,
	expect: { timeout: 10_000 },
	fullyParallel: false,
	workers: 1,
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
	use: {
		// Lokal ohne "playwright install": PLAYWRIGHT_CHROMIUM_PATH auf ein vorhandenes Chromium zeigen lassen.
		launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
			? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
			: undefined,
		baseURL: "http://127.0.0.1:8099",
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
	},
	webServer: {
		command: "node --experimental-strip-types e2e/server.ts",
		url: "http://127.0.0.1:8099/healthz",
		timeout: 120_000,
		reuseExistingServer: false,
		stdout: "pipe",
		stderr: "pipe",
	},
	projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
