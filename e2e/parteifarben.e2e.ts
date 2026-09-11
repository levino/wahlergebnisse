import { expect, test } from "@playwright/test";
import { beitragHinterlegen, pingen } from "./leinwand.ts";
import { warteAufDaten } from "./warten.ts";

const DASHBOARD = "/hildesheim/2021/nordstemmen/dashboard?takt=300";
const TERMIN = "2021";
const BEREICH = "hildesheim/03254026";

let lauf = 0;
const schluessel = () => `parteifarben-${Date.now()}-${lauf++}`;

const jubel = (topic: string) =>
	beitragHinterlegen({
		termin: TERMIN,
		topic,
		schluessel: schluessel(),
		toasts: [
			{
				marke: "ortsrat-roessing",
				ort: "Rössing",
				wahl: "Ortsratswahl",
				art: "jubel",
				text: "CDU liegt vorn!",
			},
		],
	});

const stand = (topic: string, text: string) =>
	beitragHinterlegen({
		termin: TERMIN,
		topic,
		schluessel: schluessel(),
		toasts: [
			{
				marke: "ortsrat-roessing",
				ort: "Rössing",
				wahl: "Ortsratswahl",
				art: "stand",
				text,
			},
		],
	});

/**
 * Die Leinwand öffnen und einnorden. Die Archivseite hält keine Leitung, also
 * meldet erst der Ping nach dem ersten etwas.
 */
const oeffne = async (page: import("@playwright/test").Page) => {
	await page.goto(DASHBOARD);
	await expect(page.locator(".db-buehne")).toBeVisible();
};

/** Der Wert einer Custom-Property am `<html>`-Element. */
const merkmal = (page: import("@playwright/test").Page, name: string) =>
	page.evaluate(
		(n) => document.documentElement.style.getPropertyValue(n),
		name,
	);

test.describe("Meine Partei", () => {
	test.beforeAll(async () => {
		test.setTimeout(240_000);
		await warteAufDaten("2021");
	});

	test("färbt die Oberfläche – und lässt die Balken in Ruhe", async ({
		page,
	}) => {
		await page.goto(`${DASHBOARD}#rat`);
		await expect(page.locator(".db-buehne")).toBeVisible();
		await expect(page.locator("html")).not.toHaveAttribute("data-partei");

		const balken = page.locator(".db-folie--aktiv .db-fuellung").first();
		const balkenFarbe = await balken.evaluate(
			(el) => getComputedStyle(el).backgroundColor,
		);
		const leiste = page.locator(".db-leiste");
		const vorher = await leiste.evaluate(
			(el) => getComputedStyle(el).backgroundColor,
		);

		const auswahl = page.getByLabel("Meine Partei");
		await auswahl.selectOption({ label: "CDU" });

		await expect(page.locator("html")).toHaveAttribute("data-partei", "cdu");
		const gewaehlt = await page
			.locator('.db-partei option[value="cdu"]')
			.getAttribute("data-farbe");
		expect(await merkmal(page, "--partei-farbe")).toBe(gewaehlt);
		await expect
			.poll(() => leiste.evaluate((el) => getComputedStyle(el).backgroundColor))
			.not.toBe(vorher);

		expect(
			await balken.evaluate((el) => getComputedStyle(el).backgroundColor),
		).toBe(balkenFarbe);
	});

	test("übersteht den Seitentausch, mit dem die neuen Zahlen kommen", async ({
		page,
	}) => {
		await page.goto(DASHBOARD);
		await page.getByLabel("Meine Partei").selectOption({ label: "CDU" });
		await expect(page.locator("html")).toHaveAttribute("data-partei", "cdu");
		const farbe = await merkmal(page, "--partei-farbe");

		await page.evaluate(() => {
			const a = document.createElement("a");
			a.href = `${location.pathname}?takt=299`;
			document.body.append(a);
			a.click();
		});
		await expect(page).toHaveURL(/takt=299/);
		await expect(page.locator(".db-buehne")).toBeVisible();
		await expect(page.locator("html")).toHaveAttribute("data-partei", "cdu");
		expect(await merkmal(page, "--partei-farbe")).toBe(farbe);
		await expect(page.getByLabel("Meine Partei")).toHaveValue("cdu");
	});

	test("gilt auch auf der Wahlseite und nach dem Neuladen", async ({
		page,
	}) => {
		await page.goto(DASHBOARD);
		await page.getByLabel("Meine Partei").selectOption({ label: "CDU" });

		await page.goto("/hildesheim/2021/nordstemmen/rat/");
		await expect(page.locator("html")).toHaveAttribute("data-partei", "cdu");
		await expect
			.poll(() =>
				page
					.getByRole("banner")
					.evaluate((el) => getComputedStyle(el).backgroundColor),
			)
			.toBe("rgb(0, 0, 0)");

		await page.reload();
		await expect(page.locator("html")).toHaveAttribute("data-partei", "cdu");
	});

	test("jubelt, wenn die eigene Partei vorbeizieht", async ({ page }) => {
		// Der Jubel entsteht auf dem Server und kommt über das Topic der
		// eingestellten Partei – die Leinwand rechnet ihn sich nicht selbst aus.
		await oeffne(page);
		await page.getByLabel("Meine Partei").selectOption({ label: "CDU" });
		await pingen(page, await jubel(`${BEREICH}#cdu`));

		await pingen(page, await jubel(`${BEREICH}#cdu`));

		const meldung = page.locator(".db-meldung--jubel");
		await expect(meldung).toContainText("CDU liegt vorn!", { timeout: 30_000 });
		await expect(meldung).toContainText("Ortsratswahl Rössing");
	});

	test("meldet nichts über die eigene Partei, solange keine gewählt ist", async ({
		page,
	}) => {
		// Ohne Auswahl hängt die Leinwand am Topic ohne Partei; was für eine
		// Partei gebaut wurde, geht sie nichts an.
		await oeffne(page);
		await pingen(page, await stand(BEREICH, "Einnorden"));

		await pingen(page, await jubel(`${BEREICH}#cdu`));
		await pingen(page, await stand(BEREICH, "7 von 23 ausgezählt"));

		const kasten = page.locator("[data-meldungen]");
		await expect(kasten).toContainText("7 von 23", { timeout: 30_000 });
		await expect(kasten).not.toContainText("CDU liegt vorn!");
	});
});
