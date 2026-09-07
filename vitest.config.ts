import { defineConfig } from "vitest/config";

/**
 * Unit-Tests (src/**\/*.test.ts): Parser, Sitzverteilung, Wahltyp.
 * Integrationstests (test/**\/*.test.ts): Mock-votemanager → Poller → SQLite →
 * Seitenmodell, ohne Netz. Die Browser-Tests laufen separat mit Playwright.
 */
export default defineConfig({
	test: {
		environment: "node",
		include: ["src/**/*.test.ts", "test/**/*.test.ts"],
		testTimeout: 30_000,
		hookTimeout: 60_000,
	},
});
