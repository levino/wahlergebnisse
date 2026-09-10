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
		// Der Abend fängt mit der eigenen Wahl an …
		await expect(sichtbar(page).getByRole("heading")).toHaveText("Nordstemmen");
		await expect(sichtbar(page)).toContainText("Gemeinderatswahl");
		await expect(sichtbar(page)).toContainText("Endergebnis");

		// … dann die Ortsräte, in der Reihenfolge, in der im Saal gefragt wird.
		await page.getByRole("button", { name: "Nächste Ansicht" }).click();
		await expect(sichtbar(page)).toHaveCount(1);
		await expect(sichtbar(page).getByRole("heading")).toHaveText("Adensen");
		await expect(sichtbar(page)).toContainText("Ortsratswahl");

		await page.getByRole("button", { name: "Vorherige Ansicht" }).click();
		await expect(sichtbar(page)).toContainText("Gemeinderatswahl");
	});

	test("führt die Stelle in der Adresse mit – und lässt sich verlinken", async ({
		page,
	}) => {
		// Ein Verweis auf eine Folie ist das, was im Saal herumgeschickt wird:
		// „schau dir Rössing an". Ohne Marke in der Adresse gäbe es dafür nur
		// „öffne das Dashboard und klick zwölfmal weiter".
		await page.goto("/hildesheim/2021/nordstemmen/dashboard#ortsrat-roessing");
		await expect(sichtbar(page).getByRole("heading")).toHaveText("Rössing");

		// Wer blättert, legt einen Verlaufseintrag an – zurück führt dorthin,
		// wo er herkam.
		await page.getByRole("button", { name: "Pause" }).click();
		await page.getByRole("button", { name: "Nächste Ansicht" }).click();
		await expect(page).toHaveURL(/#kreistag-kreis$/);
		await page.goBack();
		await expect(page).toHaveURL(/#ortsrat-roessing$/);
		await expect(sichtbar(page).getByRole("heading")).toHaveText("Rössing");
	});

	test("blendet ein, was neu hereingekommen ist", async ({ page }) => {
		// Am Wahlabend tauscht die Live-Zustellung den Seiteninhalt aus, sobald
		// neue Zahlen da sind (Layout.astro). Hier wird genau dieser Augenblick
		// nachgestellt: geänderte Zahlen an den Folien, dann das Ereignis, das
		// Astro nach jedem Tausch feuert.
		await page.goto("/hildesheim/2021/nordstemmen/dashboard?takt=300");
		await expect(page.locator(".db-buehne")).toBeVisible();
		await expect(page.locator(".db-meldung")).toHaveCount(0);

		await page.evaluate(() => {
			const folie = document.querySelector<HTMLElement>(
				'.db-folie[data-marke="ortsrat-roessing"]',
			);
			if (!folie) throw new Error("Folie fehlt");
			folie.dataset.anz = "1";
			folie.dataset.max = "3";
			document.dispatchEvent(new Event("astro:page-load"));
		});
		await expect(page.locator(".db-meldung")).toHaveCount(0);

		await page.evaluate(() => {
			const folie = document.querySelector<HTMLElement>(
				'.db-folie[data-marke="ortsrat-roessing"]',
			);
			if (!folie) throw new Error("Folie fehlt");
			folie.dataset.anz = "3";
			document.dispatchEvent(new Event("astro:page-load"));
		});
		const meldung = page.locator(".db-meldung");
		await expect(meldung).toHaveCount(1);
		await expect(meldung).toContainText("Rössing ist fertig ausgezählt!");
		await expect(meldung).toHaveClass(/db-meldung--fertig/);
	});

	test("schaltet von selbst weiter und hält auf Tastendruck an", async ({
		page,
	}) => {
		// Kürzester zulässiger Takt, damit der Test nicht auf 18 Sekunden wartet.
		await page.goto("/hildesheim/2021/nordstemmen/dashboard?takt=5");
		await expect(sichtbar(page)).toContainText("Gemeinderatswahl");
		await expect(sichtbar(page)).toContainText("Ortsratswahl", {
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

	test("zeigt im Kreiswahlbereich die Personen, nicht die Mehrheiten", async ({
		page,
	}) => {
		// Im Wahlbereich entscheidet sich, wer aus dieser Gegend in den Kreistag
		// kommt – nicht, wie der Kreistag zusammengesetzt ist.
		await page.goto(
			"/hildesheim/2021/nordstemmen/dashboard#kreistag-wahlbereich-b",
		);
		await page.getByRole("button", { name: "Pause" }).click();
		await expect(sichtbar(page).getByRole("heading")).toHaveText(
			"Wahlbereich B",
		);
		await expect(sichtbar(page)).toContainText("Gewählt in den Kreistag");
		await expect(sichtbar(page)).toContainText("Arlt, Andreas");
		// Keine Sitzverteilung: Wie viele Sitze auf einen Wahlbereich entfallen,
		// veröffentlicht die Wahlleitung nicht.
		await expect(sichtbar(page)).not.toContainText("Sitze");
	});

	test("führt von jeder Folie in die volle Wahlseite", async ({ page }) => {
		await page.goto("/hildesheim/2021/nordstemmen/dashboard");
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
		await expect(sichtbar(page).getByRole("heading")).toHaveText("Adensen");
		const stelle = await sichtbar(page).getAttribute("data-key");

		await sichtbar(page).getByRole("heading").click();
		// Die volle Wahlseite, nicht die Folie gleichen Namens: Seit die Stelle
		// in der Adresse steht, endet auch die Dashboard-Adresse auf
		// „ortsrat-adensen" – als Marke hinter dem Rautenzeichen.
		await expect(page).toHaveURL(/\/nordstemmen\/ortsrat-adensen\/$/);
		await page.goBack();

		await expect(page.locator(".db-buehne")).toBeVisible();
		await expect(sichtbar(page)).toHaveCount(1);
		// Nicht `getAttribute`: Das Server-HTML bringt Folie 1 aktiv mit, und
		// erst das Skript blendet auf die Stelle um, an der man war. Ein Blick
		// ohne Wiederholung träfe die Zwischenstellung.
		await expect(sichtbar(page)).toHaveAttribute("data-key", stelle ?? "");
		await expect(page.locator(".db-buehne")).toHaveAttribute(
			"data-pausiert",
			"1",
		);
	});
});
