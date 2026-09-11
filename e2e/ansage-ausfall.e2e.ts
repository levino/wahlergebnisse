import { expect, test } from "@playwright/test";
import {
	gegenstelleAusfall,
	gegenstelleZuruecksetzen,
	haken,
	schubAusloesen,
	stimmenNachstellen,
} from "./leinwand.ts";
import { warteAufDaten } from "./warten.ts";

const SEITE = "/hildesheim/2021/nordstemmen/dashboard?takt=300";

test.describe("Gegenstelle weist den Schlüssel ab", () => {
	test.beforeAll(async () => {
		test.setTimeout(240_000);
		await warteAufDaten("2021");
		await gegenstelleZuruecksetzen();
		await gegenstelleAusfall(401);
	});

	test.afterAll(async () => {
		await gegenstelleAusfall(0);
	});

	test("bleibt still, und die Leiste sagt es", async ({ page }) => {
		await stimmenNachstellen(page, [{ name: "Anna (Premium)", lang: "de-DE" }]);
		await page.goto(SEITE);
		await expect(page.locator(".db-buehne")).toBeVisible();
		await page.getByRole("button", { name: "Pause" }).click();

		await schubAusloesen(page, ["ortsrat-nordstemmen"], "CDU");

		await expect
			.poll(async () => (await haken(page))?.grund, { timeout: 20_000 })
			.toBe("kein-dienst");
		expect(await haken(page)).toMatchObject({ stimme: "" });

		const meldungen = page.locator("[data-meldungen]");
		await expect(meldungen).toContainText("ausgezählt");
		await expect(meldungen).not.toContainText("zieht an");

		const hinweis = page.locator("[data-stimmhinweis]");
		await expect(hinweis).toContainText("antwortet nicht");
		await expect(hinweis).toContainText("keine Ansage");
		await expect(page.locator('[data-db="stimme"]')).toHaveValue("");
	});
});
