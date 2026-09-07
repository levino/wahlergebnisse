import { expect, test } from "@playwright/test";

/**
 * Zwei Seiten, die keine Ergebnisse zeigen, aber ohne die das Angebot
 * unvollständig wäre: die Anbieterkennzeichnung und die Begründung, warum es
 * das hier überhaupt gibt.
 */
test.describe("Rechtliches und Anliegen", () => {
	test("Impressum nennt einen Anbieter mit Anschrift und Kontakt", async ({
		page,
	}) => {
		await page.goto("/rechtliches");
		const impressum = page.locator("section", { hasText: "Impressum" }).last();
		await expect(impressum).toContainText("Levin Keller");
		await expect(impressum).toContainText("14199 Berlin");
		await expect(impressum.locator('a[href^="mailto:"]')).toBeVisible();
		// Der Platzhalter darf nicht wieder auftauchen.
		await expect(page.getByText("noch zu ergänzen")).toHaveCount(0);
	});

	test("Haftungsausschluss steht weiterhin da", async ({ page }) => {
		await page.goto("/rechtliches");
		await expect(page.getByText("nicht amtliches")).toBeVisible();
		await expect(
			page.getByText("Verbindlich sind allein die amtlichen Bekanntmachungen"),
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
		// Die Belege stammen aus der Arbeit an dieser Seite – sie sollen konkret
		// bleiben und nicht zu allgemeinen Klagen verwässern.
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
