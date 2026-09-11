/**
 * Das Wahlabend-Dashboard im Browser: Karussell, Bedienung, Vollbild – und
 * die eine Eigenschaft, an der auf dem Beamer alles hängt: Neue Zahlen dürfen
 * die Leinwand nicht auf den Anfang zurückwerfen.
 */
import { expect, test } from "@playwright/test";
import { BASIS } from "./ports.ts";
import { warteAufDaten } from "./warten.ts";

/** Die gerade sichtbare Folie – es darf immer nur eine sein. */
const sichtbar = (page: import("@playwright/test").Page) =>
	page.locator(".db-folie--aktiv");

/**
 * Wartet, bis die Bürgermeisterwahl Nordstemmen 2020 im Bestand ist.
 *
 * 2021 wurde in Nordstemmen kein Bürgermeister gewählt; die eine Marke, an der
 * dem Betreiber liegt (`#buergermeister`), gibt es nur an diesem Wahltag.
 */
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
		// Folie 1 fasst zusammen, was auf den folgenden Folien steht.
		await expect(sichtbar(page)).toHaveAttribute("data-marke", "ueberblick");
		await expect(sichtbar(page)).toContainText("Überblick");
		await expect(sichtbar(page).locator(".db-zeile")).toHaveCount(13);

		// … dann die eigene Wahl …
		await page.getByRole("button", { name: "Nächste Ansicht" }).click();
		await expect(sichtbar(page)).toHaveCount(1);
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

	test("springt aus einer Zeile des Überblicks auf ihre Folie", async ({
		page,
	}) => {
		// Wer im Saal etwas genauer sehen will, klickt die Zeile an – und landet
		// nicht auf einer Wahlseite, sondern auf der Folie dazu.
		await page.goto("/hildesheim/2021/nordstemmen/dashboard?takt=300");
		await sichtbar(page)
			.locator(".db-zeile")
			.filter({ hasText: "Rössing" })
			.click();
		await expect(page).toHaveURL(/#ortsrat-roessing$/);
		await expect(sichtbar(page).getByRole("heading")).toHaveText("Rössing");
		// Und bleibt stehen: Wer eine Folie anwählt, will sie nicht nach ein
		// paar Sekunden wieder verlieren.
		await expect(page.locator(".db-buehne")).toHaveAttribute(
			"data-pausiert",
			"1",
		);
	});

	test("meldet nichts über den Überblick, wenn neue Zahlen kommen", async ({
		page,
	}) => {
		// Die Zahlen des Überblicks sind die Summe der übrigen Folien. Meldete
		// er mit, stünde jede Schnellmeldung zweimal auf der Leinwand.
		await page.goto("/hildesheim/2021/nordstemmen/dashboard?takt=300");
		await expect(page.locator(".db-buehne")).toBeVisible();
		await page.evaluate(() => {
			const folie = document.querySelector<HTMLElement>(
				".db-folie[data-ueberblick]",
			);
			if (!folie) throw new Error("Überblick fehlt");
			folie.dataset.anz = "1";
			folie.dataset.max = "60";
			folie.dataset.ort = "Nordstemmen";
			folie.dataset.wahl = "Kommunalwahl 2021";
			document.dispatchEvent(new Event("astro:page-load"));
			folie.dataset.anz = "42";
			document.dispatchEvent(new Event("astro:page-load"));
		});
		await expect(page.locator(".db-meldung")).toHaveCount(0);
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
		await expect(meldung).toContainText(
			"Ortsratswahl Rössing: fertig ausgezählt!",
		);
		await expect(meldung).toHaveClass(/db-meldung--fertig/);

		// Und sie übersteht den nächsten Seitentausch: Die Meldung entsteht in
		// dem Augenblick, in dem Astro den Inhalt austauscht – läge sie im
		// getauschten Teil, wäre sie weg, bevor jemand sie gelesen hat. Hier
		// wird ein echter Wechsel des Routers ausgelöst, keine Attrappe.
		await page.evaluate(() => {
			const a = document.createElement("a");
			a.href = `${location.pathname}?takt=299`;
			document.body.append(a);
			a.click();
		});
		await expect(page).toHaveURL(/takt=299/);
		await expect(page.locator(".db-buehne")).toBeVisible();
		await expect(meldung).toContainText(
			"Ortsratswahl Rössing: fertig ausgezählt!",
		);
	});

	test("schaltet von selbst weiter und hält auf Tastendruck an", async ({
		page,
	}) => {
		// Kürzester zulässiger Takt, damit der Test nicht auf 18 Sekunden wartet.
		await page.goto("/hildesheim/2021/nordstemmen/dashboard?takt=5#rat");
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

	test("führt eine Marke weiterhin unmittelbar auf ihre Wahl", async ({
		page,
	}) => {
		// Der Überblick steht vorn, aber er drängt sich nicht vor: Wer einen
		// Verweis auf die Bürgermeisterwahl öffnet, sieht die Bürgermeisterwahl.
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
		await page.goto("/hildesheim/2021/nordstemmen/dashboard#rat");
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
