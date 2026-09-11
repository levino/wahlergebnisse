import { expect, test } from "@playwright/test";
import { beitragHinterlegen, pingen } from "./leinwand.ts";
import { BASIS } from "./ports.ts";
import { warteAufDaten } from "./warten.ts";

/** Die gerade sichtbare Folie – es darf immer nur eine sein. */
const sichtbar = (page: import("@playwright/test").Page) =>
	page.locator(".db-folie--aktiv");

const warteAufNordstemmen2020 = async (sekunden = 180): Promise<void> => {
	for (let i = 0; i < sekunden; i++) {
		try {
			const r = await fetch(
				`${BASIS}/api/v1/hildesheim/2020/wahlen?behoerde=nordstemmen`,
			);
			if (r.ok && (await r.json()).anzahl > 0) return;
		} catch {
			/* Server startet noch */
		}
		await new Promise((res) => setTimeout(res, 1000));
	}
	throw new Error("Die Bürgermeisterwahl Nordstemmen 2020 kam nicht an");
};

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
		await expect(sichtbar(page)).toHaveAttribute("data-marke", "ueberblick");
		await expect(sichtbar(page)).toContainText("Überblick");
		await expect(sichtbar(page).locator(".db-zeile")).toHaveCount(13);

		await page.getByRole("button", { name: "Nächste Ansicht" }).click();
		await expect(sichtbar(page)).toHaveCount(1);
		await expect(sichtbar(page).getByRole("heading")).toHaveText("Nordstemmen");
		await expect(sichtbar(page)).toContainText("Gemeinderatswahl");
		await expect(sichtbar(page)).toContainText("Endergebnis");

		await page.getByRole("button", { name: "Nächste Ansicht" }).click();
		await expect(sichtbar(page)).toHaveCount(1);
		await expect(sichtbar(page).getByRole("heading")).toHaveText("Adensen");
		await expect(sichtbar(page)).toContainText("Ortsratswahl");

		await page.getByRole("button", { name: "Vorherige Ansicht" }).click();
		await expect(sichtbar(page)).toContainText("Gemeinderatswahl");
	});

	test("springt aus einer Zeile des Überblicks auf ihre Folie", async ({
		page,
	}) => {
		await page.goto("/hildesheim/2021/nordstemmen/dashboard?takt=300");
		await sichtbar(page)
			.locator(".db-zeile")
			.filter({ hasText: "Rössing" })
			.click();
		await expect(page).toHaveURL(/#ortsrat-roessing$/);
		await expect(sichtbar(page).getByRole("heading")).toHaveText("Rössing");
		await expect(page.locator(".db-buehne")).toHaveAttribute(
			"data-pausiert",
			"1",
		);
	});

	test("führt die Stelle in der Adresse mit – und lässt sich verlinken", async ({
		page,
	}) => {
		await page.goto("/hildesheim/2021/nordstemmen/dashboard#ortsrat-roessing");
		await expect(sichtbar(page).getByRole("heading")).toHaveText("Rössing");

		await page.getByRole("button", { name: "Pause" }).click();
		await page.getByRole("button", { name: "Nächste Ansicht" }).click();
		await expect(page).toHaveURL(/#kreistag-kreis$/);
		await page.goBack();
		await expect(page).toHaveURL(/#ortsrat-roessing$/);
		await expect(sichtbar(page).getByRole("heading")).toHaveText("Rössing");
	});

	test("hält einen Einblender über den Seitentausch hinweg", async ({
		page,
	}) => {
		// Die Einblender entstehen genau dann, wenn Astro den Inhalt austauscht;
		// ohne `transition:persist` wäre die Meldung weg, bevor sie jemand liest.
		await page.goto("/hildesheim/2021/nordstemmen/dashboard?takt=300");
		await expect(page.locator(".db-buehne")).toBeVisible();
		await expect(page.locator(".db-meldung")).toHaveCount(0);

		const einnorden = await beitragHinterlegen({
			termin: "2021",
			topic: "hildesheim/03254026",
			schluessel: `einblender-null-${Date.now()}`,
			toasts: [
				{
					marke: "ortsrat-roessing",
					ort: "Rössing",
					wahl: "Ortsratswahl",
					art: "stand",
					text: "1 von 3 ausgezählt",
				},
			],
		});
		await pingen(page, einnorden);
		await expect(page.locator(".db-meldung")).toHaveCount(0);

		const id = await beitragHinterlegen({
			termin: "2021",
			topic: "hildesheim/03254026",
			schluessel: `einblender-${Date.now()}`,
			toasts: [
				{
					marke: "ortsrat-roessing",
					ort: "Rössing",
					wahl: "Ortsratswahl",
					art: "fertig",
					text: "Rössing ist fertig ausgezählt!",
				},
			],
		});
		await pingen(page, id);

		const meldung = page.locator(".db-meldung");
		await expect(meldung).toHaveCount(1);
		await expect(meldung).toContainText("Ortsratswahl Rössing");
		await expect(meldung).toHaveClass(/db-meldung--fertig/);

		await page.evaluate(() => {
			const a = document.createElement("a");
			a.href = `${location.pathname}?takt=299`;
			document.body.append(a);
			a.click();
		});
		await expect(page).toHaveURL(/takt=299/);
		await expect(page.locator(".db-buehne")).toBeVisible();
		await expect(meldung).toContainText("Ortsratswahl Rössing");
	});

	test("schaltet von selbst weiter und hält auf Tastendruck an", async ({
		page,
	}) => {
		await page.goto("/hildesheim/2021/nordstemmen/dashboard?takt=5#rat");
		await expect(sichtbar(page)).toContainText("Gemeinderatswahl");
		await expect(sichtbar(page)).toContainText("Ortsratswahl", {
			timeout: 15_000,
		});

		await page.keyboard.press(" ");
		await expect(page.locator(".db-buehne")).toHaveAttribute(
			"data-pausiert",
			"1",
		);
		const stehend = await sichtbar(page).getAttribute("data-key");
		await page.waitForTimeout(8_000);
		expect(await sichtbar(page).getAttribute("data-key")).toBe(stehend);

		await page.keyboard.press(" ");
		await expect(page.locator(".db-buehne")).toHaveAttribute(
			"data-pausiert",
			"0",
		);
		await expect(sichtbar(page)).not.toContainText("Gemeindewahl", {
			timeout: 15_000,
		});
	});

	test("zeigt im Kreiswahlbereich die Personen, nicht die Mehrheiten", async ({
		page,
	}) => {
		await page.goto(
			"/hildesheim/2021/nordstemmen/dashboard#kreistag-wahlbereich-b",
		);
		await page.getByRole("button", { name: "Pause" }).click();
		await expect(sichtbar(page).getByRole("heading")).toHaveText(
			"Wahlbereich B",
		);
		await expect(sichtbar(page)).toContainText("Gewählt in den Kreistag");
		await expect(sichtbar(page)).toContainText("Arlt, Andreas");
		await expect(sichtbar(page)).not.toContainText("Sitze");
	});

	test("führt eine Marke weiterhin unmittelbar auf ihre Wahl", async ({
		page,
	}) => {
		await warteAufNordstemmen2020();
		await page.goto("/hildesheim/2020/nordstemmen/dashboard#buergermeister");
		await expect(sichtbar(page)).toHaveAttribute(
			"data-marke",
			"buergermeister",
		);
		await expect(sichtbar(page)).toContainText("Bürgermeisterwahl");
	});

	test("führt von jeder Folie in die volle Wahlseite", async ({ page }) => {
		await page.goto("/hildesheim/2021/nordstemmen/dashboard#rat");
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
		await page.evaluate(() => {
			document.documentElement.dataset.vollbild = "dashboard";
		});
		await expect(menue).toBeHidden();
		await expect(page.locator("#stand-anzeige")).toBeVisible();
		await expect(page.locator("footer")).toBeHidden();
	});

	test("hält die Stelle über einen Seitentausch hinweg", async ({ page }) => {
		await page.goto("/hildesheim/2021/nordstemmen/dashboard#rat");
		await page.getByRole("button", { name: "Pause" }).click();
		await page.getByRole("button", { name: "Nächste Ansicht" }).click();
		await expect(sichtbar(page).getByRole("heading")).toHaveText("Adensen");
		const stelle = await sichtbar(page).getAttribute("data-key");

		await sichtbar(page).getByRole("heading").click();
		await expect(page).toHaveURL(/\/nordstemmen\/ortsrat-adensen\/$/);
		await page.goBack();

		await expect(page.locator(".db-buehne")).toBeVisible();
		await expect(sichtbar(page)).toHaveCount(1);
		await expect(sichtbar(page)).toHaveAttribute("data-key", stelle ?? "");
		await expect(page.locator(".db-buehne")).toHaveAttribute(
			"data-pausiert",
			"1",
		);
	});
});
