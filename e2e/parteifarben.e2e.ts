/**
 * „Meine Partei“ im Browser: die Auswahl, die Farbe – und der Jubel.
 *
 * Zwei Dinge daran sind nicht durch einen reinen Test zu sichern und deshalb
 * hier: dass die Parteifarbe den Seitentausch der Live-Zustellung übersteht
 * (Astro räumt beim Tausch alle Merkmale vom `<html>`-Element ab), und dass
 * die Balken dabei ihre eigenen Farben behalten – eine Leinwand, die je nach
 * Zuschauer ein anderes Ergebnis zeigt, wäre kein Ergebnis mehr.
 */
import { expect, test } from "@playwright/test";
import { warteAufDaten } from "./warten.ts";

const DASHBOARD = "/hildesheim/2021/nordstemmen/dashboard?takt=300";

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
		// Auf einer Wahlfolie: Der Überblick davor führt keine Balken.
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

		// Die Farbe steht am `<html>`-Element: Von dort aus färbt sie jede
		// Seite, nicht nur die Leinwand.
		await expect(page.locator("html")).toHaveAttribute("data-partei", "cdu");
		const gewaehlt = await page
			.locator('.db-partei option[value="cdu"]')
			.getAttribute("data-farbe");
		expect(await merkmal(page, "--partei-farbe")).toBe(gewaehlt);
		await expect
			.poll(() => leiste.evaluate((el) => getComputedStyle(el).backgroundColor))
			.not.toBe(vorher);

		// Und der Balken steht unverändert da.
		expect(
			await balken.evaluate((el) => getComputedStyle(el).backgroundColor),
		).toBe(balkenFarbe);
	});

	test("übersteht den Seitentausch, mit dem die neuen Zahlen kommen", async ({
		page,
	}) => {
		// Am Wahlabend tauscht die Live-Zustellung den Seiteninhalt alle paar
		// Minuten aus (siehe Layout.astro). Astro räumt dabei alle Merkmale vom
		// `<html>`-Element ab – ohne das Zurückschreiben fiele die Leinwand bei
		// jeder Schnellmeldung aus der Parteifarbe.
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
		// Und die Auswahl zeigt weiter, was gewählt ist – sonst stünde am
		// Beamer „Meine Partei …“, während die Seite in Parteifarben leuchtet.
		await expect(page.getByLabel("Meine Partei")).toHaveValue("cdu");
	});

	test("gilt auch auf der Wahlseite und nach dem Neuladen", async ({
		page,
	}) => {
		await page.goto(DASHBOARD);
		await page.getByLabel("Meine Partei").selectOption({ label: "CDU" });

		await page.goto("/hildesheim/2021/nordstemmen/rat/");
		await expect(page.locator("html")).toHaveAttribute("data-partei", "cdu");
		// Der Kopf ist die Fläche, an der man die Einstellung von jeder Seite
		// aus sieht.
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
		await page.goto(DASHBOARD);
		await expect(page.locator(".db-buehne")).toBeVisible();
		await page.getByLabel("Meine Partei").selectOption({ label: "CDU" });

		// Nachgestellt wird der Augenblick, in dem neue Zahlen ankommen:
		// geänderte Stände an der Folie, dann das Ereignis, das Astro nach
		// jedem Seitentausch feuert. Erst der Merkposten …
		const setze = (staende: string) =>
			page.evaluate((s) => {
				const folie = document.querySelector<HTMLElement>(
					'.db-folie[data-marke="ortsrat-roessing"]',
				);
				if (!folie) throw new Error("Folie fehlt");
				folie.dataset.parteien = s;
				document.dispatchEvent(new Event("astro:page-load"));
			}, staende);

		await setze("cdu:2:30.0:-|spd:1:34.0:-");
		// Die Leinwand hat auf diesen Merkposten hin schon gemeldet – sie
		// vergleicht ihn mit dem Stand, den der Server mitgebracht hat. Für
		// den nächsten Schritt zählt nur, was danach kommt.
		await page.evaluate(() => {
			document.querySelector("[data-meldungen]")?.replaceChildren();
		});

		// … und dann zieht die CDU vorbei.
		await setze("cdu:1:34.0:-|spd:2:30.0:-");
		const meldung = page.locator(".db-meldung--jubel");
		await expect(page.locator(".db-meldung")).toHaveCount(1);
		await expect(meldung).toHaveCount(1);
		await expect(meldung).toContainText("CDU liegt vorn!");
		await expect(meldung).toContainText("Ortsratswahl Rössing");
	});

	test("meldet nichts über die eigene Partei, solange keine gewählt ist", async ({
		page,
	}) => {
		// Ohne Einstellung ist der Abend eine Auswertung: dieselben Zahlen,
		// dieselben Einblender wie bisher.
		await page.goto(DASHBOARD);
		await expect(page.locator(".db-buehne")).toBeVisible();
		await page.evaluate(() => {
			const folie = document.querySelector<HTMLElement>(
				'.db-folie[data-marke="ortsrat-roessing"]',
			);
			if (!folie) throw new Error("Folie fehlt");
			folie.dataset.parteien = "cdu:1:34.0:-";
			document.dispatchEvent(new Event("astro:page-load"));
		});
		await expect(page.locator(".db-meldung")).toHaveCount(0);
	});
});
