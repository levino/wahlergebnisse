import { expect, test } from "@playwright/test";

test.describe("Rechtliches und Anliegen", () => {
	test("Impressum nennt einen Anbieter mit Anschrift und Kontakt", async ({
		page,
	}) => {
		await page.goto("/rechtliches");
		const impressum = page.locator("section", { hasText: "Impressum" }).last();
		await expect(impressum).toContainText("Levin Keller");
		await expect(impressum).toContainText("14199 Berlin");
		await expect(impressum.locator('a[href^="mailto:"]')).toBeVisible();
		await expect(page.getByText("noch zu ergänzen")).toHaveCount(0);
	});

	test("Haftungsausschluss steht weiterhin da", async ({ page }) => {
		await page.goto("/rechtliches");
		await expect(page.getByText("nicht amtliches")).toBeVisible();
		await expect(
			page.getByText("Verbindlich sind allein die amtlichen Bekanntmachungen"),
		).toBeVisible();
	});

	test("Hochrechnung ist erklärt und als eigene Rechnung gekennzeichnet", async ({
		page,
	}) => {
		await page.goto("/rechtliches");
		await expect(
			page.getByText("keine Prognose der Wahlleitung"),
		).toBeVisible();
		await expect(
			page.getByText("gegenüber derselben Wahl beim letzten Wahltermin", {
				exact: false,
			}),
		).toBeVisible();
		await expect(
			page.getByText("Urnen- und Briefwahlbezirke werden dabei getrennt", {
				exact: false,
			}),
		).toBeVisible();
		await expect(
			page.getByText("Mindestzahl eingegangener Schnellmeldungen", {
				exact: false,
			}),
		).toBeVisible();
		await expect(
			page.getByText("Neben jeder Hochrechnung steht eine", { exact: false }),
		).toBeVisible();
		await expect(
			page.getByText("Wahlbezirksergebnissen früherer Wahlen nachgerechnet", {
				exact: false,
			}),
		).toBeVisible();
	});

	test("Worum es geht: erreichbar und aus dem Fuß verlinkt", async ({
		page,
	}) => {
		await page.goto("/hildesheim/");
		await page.getByRole("link", { name: "Worum es geht" }).click();
		await expect(
			page.getByRole("heading", { name: "Worum es geht" }),
		).toBeVisible();
		await expect(
			page.getByText("kommunalpolitischen Engagements"),
		).toBeVisible();
		await expect(page.getByText("D1_3")).toBeVisible();
	});

	test("Weiterverwendung nennt Schnittstelle und Quellcode", async ({
		page,
	}) => {
		await page.goto("/rechtliches");
		const abschnitt = page.locator("section", { hasText: "Weiterverwendung" });
		await expect(
			abschnitt.getByRole("link", {
				name: /github\.com\/levino\/wahlergebnisse/,
			}),
		).toBeVisible();
		await expect(
			abschnitt.getByRole("link", { name: /Schnittstelle/ }),
		).toBeVisible();
	});
});
