/**
 * Das Wahlabend-Dashboard im Browser: Karussell, Bedienung, Vollbild – und
 * die eine Eigenschaft, an der auf dem Beamer alles hängt: Neue Zahlen dürfen
 * die Leinwand nicht auf den Anfang zurückwerfen.
 */
import { expect, test } from "@playwright/test";
import { warteAufDaten } from "./warten.ts";

/** Die gerade sichtbare Folie – es darf immer nur eine sein. */
const sichtbar = (page: import("@playwright/test").Page) =>
	page.locator(".db-folie--aktiv");

test.describe("Wahlabend-Dashboard", () => {
	test.beforeAll(async () => {
		test.setTimeout(240_000);
		await warteAufDaten("2021");
	});

	test("zeigt eine Folie nach der anderen und lässt sich blättern", async ({
		page,
	}) => {
		await page.goto("/hildesheim/2021/nordstemmen/dashboard");
		await expect(page.locator(".db-buehne")).toBeVisible();
		await expect(sichtbar(page)).toHaveCount(1);
		// Erst der Überblick über alle Wahlen des Abends …
		await expect(sichtbar(page)).toContainText("Überblick");
		await expect(sichtbar(page).getByRole("heading")).toHaveText("Nordstemmen");

		// … dann die Wahlen in der Reihenfolge, in der im Saal gefragt wird.
		await page.getByRole("button", { name: "Nächste Ansicht" }).click();
		await expect(sichtbar(page)).toHaveCount(1);
		await expect(sichtbar(page).getByRole("heading")).toHaveText("Nordstemmen");
		await expect(sichtbar(page)).toContainText("Gemeindewahl");
		await expect(sichtbar(page)).toContainText("Endergebnis");

		await page.getByRole("button", { name: "Nächste Ansicht" }).click();
		await expect(sichtbar(page).getByRole("heading")).toHaveText("Adensen");
		await expect(sichtbar(page)).toContainText("Ortsratswahl");

		await page.getByRole("button", { name: "Vorherige Ansicht" }).click();
		await expect(sichtbar(page)).toContainText("Gemeindewahl");
	});

	test("schaltet von selbst weiter und hält auf Tastendruck an", async ({
		page,
	}) => {
		// Kürzester zulässiger Takt, damit der Test nicht auf 18 Sekunden wartet.
		await page.goto("/hildesheim/2021/nordstemmen/dashboard?takt=5");
		await expect(sichtbar(page)).toContainText("Überblick");
		await expect(sichtbar(page)).toContainText("Gemeindewahl", {
			timeout: 15_000,
		});

		// Leertaste hält an – und dann bleibt die Folie auch stehen.
		await page.keyboard.press(" ");
		await expect(page.locator(".db-buehne")).toHaveAttribute(
			"data-pausiert",
			"1",
		);
		const stehend = await sichtbar(page).getAttribute("data-key");
		await page.waitForTimeout(8_000);
		expect(await sichtbar(page).getAttribute("data-key")).toBe(stehend);

		// Und läuft danach weiter.
		await page.keyboard.press(" ");
		await expect(page.locator(".db-buehne")).toHaveAttribute(
			"data-pausiert",
			"0",
		);
		await expect(sichtbar(page)).not.toContainText("Gemeindewahl", {
			timeout: 15_000,
		});
	});

	test("führt von jeder Folie in die volle Wahlseite", async ({ page }) => {
		await page.goto("/hildesheim/2021/nordstemmen/dashboard");
		await page.getByRole("button", { name: "Nächste Ansicht" }).click();
		await sichtbar(page).getByRole("heading").click();
		await expect(page).toHaveURL(/\/hildesheim\/2021\/nordstemmen\/rat\/$/);
		await expect(page.getByRole("heading", { level: 1 })).toHaveText(
			"Gemeinde Nordstemmen",
		);
	});

	test("räumt im Vollbild die Seitenmöbel weg", async ({ page }) => {
		await page.goto("/hildesheim/2021/nordstemmen/dashboard");
		const menue = page.getByRole("navigation", { name: "Wahltermine" });
		await expect(menue).toBeVisible();
		// Das Vollbild selbst braucht eine Nutzergeste, die kein Test hat –
		// geprüft wird deshalb das Merkmal, das der Vollbildwechsel setzt.
		await page.evaluate(() => {
			document.documentElement.dataset.vollbild = "dashboard";
		});
		await expect(menue).toBeHidden();
		// Die Standanzeige bleibt: Eine Leinwand, die stillsteht und dabei
		// „Live“ behauptet, wäre das Schlechteste.
		await expect(page.locator("#stand-anzeige")).toBeVisible();
		await expect(page.locator("footer")).toBeHidden();
	});

	test("hält die Stelle über einen Seitentausch hinweg", async ({ page }) => {
		// Der Seitentausch ist am Wahlabend der Normalfall: Kommen neue Zahlen,
		// holt sich die Seite ihren Inhalt neu (siehe Layout.astro), und die
		// Folien sind danach andere Elemente. Springt das Karussell dabei
		// zurück auf den Überblick, ist der Beamer unbrauchbar – alle paar
		// Minuten fienge er von vorn an. Geprüft wird derselbe Weg, den auch
		// die Live-Zustellung nimmt: eine Navigation von Astro, kein Neuladen.
		await page.goto("/hildesheim/2021/nordstemmen/dashboard");
		await page.getByRole("button", { name: "Pause" }).click();
		await page.getByRole("button", { name: "Nächste Ansicht" }).click();
		await page.getByRole("button", { name: "Nächste Ansicht" }).click();
		await expect(sichtbar(page).getByRole("heading")).toHaveText("Adensen");
		const stelle = await sichtbar(page).getAttribute("data-key");

		await sichtbar(page).getByRole("heading").click();
		await expect(page).toHaveURL(/ortsrat-adensen/);
		await page.goBack();

		await expect(page.locator(".db-buehne")).toBeVisible();
		await expect(sichtbar(page)).toHaveCount(1);
		expect(await sichtbar(page).getAttribute("data-key")).toBe(stelle);
		await expect(page.locator(".db-buehne")).toHaveAttribute(
			"data-pausiert",
			"1",
		);
	});
});
