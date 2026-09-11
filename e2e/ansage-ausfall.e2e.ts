/**
 * Wenn die Gegenstelle den Schlüssel abweist.
 *
 * Ein Schlüssel kann ablaufen, ein Kontingent auslaufen – mitten am Abend,
 * während die Leinwand läuft. Dann springt **nicht** die Browserstimme ein:
 * Der Betreiber hat sie gehört und abgelehnt. Es wird still, die Leiste sagt
 * warum, und die Einblender laufen weiter – die Nachricht geht nie verloren,
 * nur der Ton.
 *
 * **Warum diese Probe für sich steht.** Ein abgewiesener Schlüssel riegelt den
 * Serverprozess für seine Laufzeit ab (siehe `ansage-datei.ts`); alles, was
 * danach liefe, fände eine tote Gegenstelle vor. Deshalb eine eigene Datei,
 * die nach `ansage-aufnahme.e2e.ts` an die Reihe kommt.
 */
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

		// Die Nachricht steht trotzdem auf der Leinwand.
		await expect(page.locator("[data-meldungen]")).toContainText(
			"zieht an SPD vorbei",
		);
		// Und die Leiste sagt, warum es still ist – statt so zu tun, als wäre
		// alles in Ordnung.
		const hinweis = page.locator("[data-stimmhinweis]");
		await expect(hinweis).toContainText("antwortet nicht");
		await expect(hinweis).toContainText("keine Ansage");
		// Das Feld behauptet nicht, es spräche eine Stimme.
		await expect(page.locator('[data-db="stimme"]')).toHaveValue("");
	});
});
