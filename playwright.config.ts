import { defineConfig, devices } from "@playwright/test";
import { BASIS, APP_PORT } from "./e2e/ports.ts";

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
	projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
