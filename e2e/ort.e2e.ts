/**
 * Die Ortsseite im Browser: alle Wahlen eines Abends an einem Ort, und die
 * Wege dorthin.
 */
import { expect, test } from "@playwright/test";
import { warteAufDaten } from "./warten.ts";

test.describe("Ortschaft", () => {
	test.beforeAll(async () => {
		test.setTimeout(240_000);
		await warteAufDaten("2021");
	});

	test("trägt alle Wahlen eines Ortes zusammen", async ({ page }) => {
		await page.goto("/hildesheim/2021/nordstemmen/ort/roessing");
		await expect(page.getByRole("heading", { level: 1 })).toHaveText("Rössing");
		for (const wahl of [
			"Ortsratswahl",
			"Gemeindewahl",
			"Kreistagswahl",
			"Landratswahl",
		])
			await expect(
				page.getByRole("heading", { level: 2, name: wahl }),
			).toBeVisible();
		// Bei allem außer dem eigenen Ortsrat steht dabei, dass es ein
		// Ausschnitt ist.
		await expect(page.getByText("Anteil von Rössing").first()).toBeVisible();
		// Sitze gibt es nur im eigenen Ortsrat.
		await expect(
			page.getByRole("heading", { level: 3, name: "Sitze im Ortsrat" }),
		).toHaveCount(1);
		// Die Wahlbezirke des Ortes stehen am Fuß.
		await expect(page.getByText("09 - Rössing - DGH")).toBeVisible();
	});

	test("blättert zum Nachbarort", async ({ page }) => {
		await page.goto("/hildesheim/2021/nordstemmen/ort/roessing");
		await page
			.getByRole("navigation", { name: "Ortschaften" })
			.getByRole("link", { name: "Adensen" })
			.click();
		await expect(page).toHaveURL(/\/ort\/adensen$/);
		await expect(page.getByRole("heading", { level: 1 })).toHaveText("Adensen");
	});

	test("ist von der Ortsratswahl und von der Gemeinde aus erreichbar", async ({
		page,
	}) => {
		await page.goto("/hildesheim/2021/nordstemmen/ortsrat-roessing/");
		await page.getByRole("link", { name: /Alle Wahlen in Rössing/ }).click();
		await expect(page).toHaveURL(/\/ort\/roessing$/);

		await page.goto("/hildesheim/2021/nordstemmen/");
		const orte = page.getByRole("heading", {
			level: 2,
			name: "Ergebnisse nach Ortschaft",
		});
		await expect(orte).toBeVisible();
		await page.getByRole("link", { name: "Mahlerten", exact: true }).click();
		await expect(page.getByRole("heading", { level: 1 })).toHaveText(
			"Mahlerten",
		);
	});

	test("einen Ort, den es nicht gibt, gibt es nicht", async ({ page }) => {
		const antwort = await page.goto(
			"/hildesheim/2021/nordstemmen/ort/gibtesnicht",
		);
		expect(antwort?.status()).toBe(404);
	});
});
