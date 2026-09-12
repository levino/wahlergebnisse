import { defineConfig, devices } from "@playwright/test";
import { BASIS, APP_PORT } from "./e2e/ports.ts";

const LANGSAM = ["**/zustellung.e2e.ts", "**/aussetzer.e2e.ts"];

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
		launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
			? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
			: undefined,
		baseURL: BASIS,
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
	},
	webServer: {
		command: "node --experimental-strip-types e2e/server.ts",
		url: `${BASIS}/healthz`,
		timeout: 120_000,
		reuseExistingServer: false,
		stdout: "pipe",
		stderr: "pipe",
	},
	/** Dasselbe Muster einmal aus- und einmal eingeschlossen: Jede Datei fällt
	 * in genau eine Gruppe, keine in beide, keine in keine. */
	projects: [
		{
			name: "chromium",
			testIgnore: LANGSAM,
			use: { ...devices["Desktop Chrome"] },
		},
		{
			name: "neustart",
			testMatch: LANGSAM,
			use: { ...devices["Desktop Chrome"] },
		},
	],
});
