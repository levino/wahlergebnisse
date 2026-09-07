/**
 * Browser-Tests der neu gebauten Oberflächenteile: Balken mit getrenntem
 * Kandidatennamen und Partei, umschaltbare und sortierbare Untergebiet-
 * Tabelle, Bewerberliste mit Anteil an allen gültigen Stimmen, Gebiets-
 * Umschalter im Kopf, die über Seitenwechsel hinweg bestehende Karte und der
 * Termin 2020 (nur Gemeinde Nordstemmen).
 */
import { type Page, expect, test } from "@playwright/test";
import { warteAufDaten } from "./warten.ts";

/** Die Untergebiet-Tabelle „Ergebnisse nach Gebiet“ einer Wahlseite. */
const gebietsTabelle = (page: Page) =>
	page.locator("section").filter({
		has: page.getByRole("heading", { name: "Ergebnisse nach Gebiet" }),
	});

/** Der Abschnitt „Bewerberinnen und Bewerber“ einer Wahlseite. */
const bewerberBereich = (page: Page) =>
	page.locator("section").filter({
		has: page.getByRole("heading", { name: "Bewerberinnen und Bewerber" }),
	});

/** Beschriftungen der ersten Spalte aller Datenzeilen einer Tabelle. */
const ersteSpalte = async (
	tabelle: ReturnType<typeof gebietsTabelle>,
): Promise<string[]> => {
	const zeilen = tabelle.getByRole("row");
	const anzahl = await zeilen.count();
	const werte: string[] = [];
	// Zeile 0 ist der Spaltenkopf.
	for (let i = 1; i < anzahl; i++) {
		werte.push(
			(
				(await zeilen.nth(i).getByRole("cell").first().textContent()) ?? ""
			).trim(),
		);
	}
	return werte;
};

/** „5,8 %“ → 5.8 */
const alsProzent = (text: string): number =>
	Number.parseFloat(text.replace(/[^\d,]/g, "").replace(",", "."));

test.describe("Darstellung", () => {
	test.beforeAll(async () => {
		test.setTimeout(240_000);
		await warteAufDaten("2021");
	});

	test("Landratswahl: Name und Parteikürzel stehen getrennt nebeneinander", async ({
		page,
	}) => {
		await page.goto("/2021/kreis/landrat/");

		const zeile = page
			.getByRole("listitem")
			.filter({ hasText: "Bernd Lynack" })
			.first();
		const name = zeile.getByText("Bernd Lynack", { exact: true });
		const partei = zeile.getByText("SPD", { exact: true });

		// Name und Partei sind eigene Elemente – sonst klebte „Bernd LynackSPD“
		// zusammen, weil der Abstand nur aus dem CSS-Gap kommt.
		await expect(name).toBeVisible();
		await expect(partei).toBeVisible();
		await expect(name).toHaveText("Bernd Lynack");
		await expect(partei).toHaveText("SPD");

		// Und der Abstand ist auch gerendert da: die Partei beginnt rechts vom Namen.
		const nameBox = await name.boundingBox();
		const parteiBox = await partei.boundingBox();
		expect(nameBox).not.toBeNull();
		expect(parteiBox).not.toBeNull();
		if (nameBox && parteiBox) {
			expect(parteiBox.x).toBeGreaterThan(nameBox.x + nameBox.width);
		}
	});

	test("Untergebiete: Ebenen-Umschalter tauscht die Tabelle ohne Seitenwechsel", async ({
		page,
	}) => {
		await page.goto("/2021/nordstemmen/rat/");
		const tabelle = gebietsTabelle(page);
		await expect(
			tabelle.getByRole("heading", { name: "Ergebnisse nach Gebiet" }),
		).toBeVisible();

		// Angeboten werden nur Ebenen, die wirklich aufgliedern – in Nordstemmen
		// also Ortsteile und Wahlbezirke, nicht der eine Wahlbereich.
		await expect(
			tabelle.getByRole("button", { name: "Ortsteile" }),
		).toHaveAttribute("aria-pressed", "true");
		await expect(
			tabelle.getByRole("button", { name: "Wahlbereiche" }),
		).toHaveCount(0);
		const vorher = await ersteSpalte(tabelle);
		expect(vorher).toContain("Adensen");
		expect(vorher).toContain("Rössing");

		await tabelle.getByRole("button", { name: "Wahlbezirke" }).click();

		await expect(
			tabelle.getByRole("button", { name: "Wahlbezirke" }),
		).toHaveAttribute("aria-pressed", "true");
		await expect(
			tabelle.getByRole("columnheader", { name: "Wahlbezirke" }),
		).toBeVisible();
		const nachher = await ersteSpalte(tabelle);
		expect(nachher.length).toBeGreaterThan(vorher.length);
		expect(nachher.some((z) => z.includes("Rössing"))).toBe(true);

		// Kein Seitenwechsel: die Adresse bleibt dieselbe.
		await expect(page).toHaveURL(/\/2021\/nordstemmen\/rat\/$/);
	});

	test("Untergebiete: Spaltenkopf sortiert die Tabelle um", async ({
		page,
	}) => {
		await page.goto("/2021/nordstemmen/rat/");
		const tabelle = gebietsTabelle(page);
		await tabelle.getByRole("button", { name: "Ortsteile" }).click();

		const vorher = await ersteSpalte(tabelle);
		expect(vorher[0]).toBe("Adensen");

		await tabelle.getByRole("columnheader", { name: "CDU" }).click();

		await expect(tabelle.getByText("Sortiert nach CDU")).toBeVisible();
		const nachher = await ersteSpalte(tabelle);
		expect(nachher[0]).not.toBe(vorher[0]);
		// Klein Escherde hat mit 55,3 % den höchsten CDU-Anteil.
		expect(nachher[0]).toBe("Klein Escherde");
		expect([...nachher].sort()).toEqual([...vorher].sort());

		// Nochmal klicken stellt die ursprüngliche Reihenfolge wieder her.
		await tabelle.getByRole("columnheader", { name: "CDU" }).click();
		expect(await ersteSpalte(tabelle)).toEqual(vorher);
	});

	test("Bewerber: Anteil an allen gültigen Stimmen, Gewählten-Haken und Listenplatz-Sortierung", async ({
		page,
	}) => {
		await page.goto("/2021/nordstemmen/rat/");
		const bereich = bewerberBereich(page);
		await expect(
			bereich.getByRole("heading", { name: "Bewerberinnen und Bewerber" }),
		).toBeVisible();

		// Spalten der Bewerbertabellen
		for (const spalte of ["Pl.", "Name", "Stimmen", "Anteil"]) {
			await expect(
				bereich
					.getByRole("columnheader", { name: spalte, exact: true })
					.first(),
			).toBeVisible();
		}

		const spd = bereich.locator("section").filter({
			has: page.getByRole("heading", { level: 3, name: "SPD", exact: true }),
		});
		const ludewig = spd.getByRole("row").filter({ hasText: "Gerald Ludewig" });
		await expect(ludewig).toHaveCount(1);

		// Gewählte sind mit einem Haken markiert.
		await expect(ludewig.getByLabel("gewählt")).toBeVisible();
		await expect(ludewig.getByLabel("gewählt")).toHaveText("✓");

		// Anteil an ALLEN gültigen Stimmen (5,8 %) – nicht der parteiinterne
		// Wert der Wahlleitung (19,55 %), der wie ein Wahlergebnis aussähe.
		const anteil = ludewig.getByRole("cell").nth(3);
		await expect(anteil).toHaveText("5,8 %");
		expect(alsProzent((await anteil.textContent()) ?? "")).toBeLessThan(15);
		await expect(bereich.getByText("19,6 %")).toHaveCount(0);
		await expect(bereich.getByText("19,55")).toHaveCount(0);
		await expect(
			bereich.getByText(
				"Anteil = Stimmen dieser Person an allen gültigen Stimmen des Gebiets.",
				{ exact: false },
			),
		).toBeVisible();

		// Umschalter „Ergebnis“ / „Listenplatz“
		const plaetze = async (): Promise<string[]> => {
			const zeilen = spd.getByRole("row");
			const werte: string[] = [];
			for (let i = 1; i <= 3; i++) {
				werte.push(
					(
						(await zeilen.nth(i).getByRole("cell").first().textContent()) ?? ""
					).trim(),
				);
			}
			return werte;
		};

		await expect(
			bereich.getByRole("button", { name: "Ergebnis" }),
		).toHaveAttribute("aria-pressed", "true");
		// Nach Stimmen sortiert stehen die Listenplätze durcheinander.
		expect(await plaetze()).toEqual(["1", "2", "9"]);

		await bereich.getByRole("button", { name: "Listenplatz" }).click();
		await expect(
			bereich.getByRole("button", { name: "Listenplatz" }),
		).toHaveAttribute("aria-pressed", "true");
		expect(await plaetze()).toEqual(["1", "2", "3"]);
	});

	test("Gebiets-Umschalter im Kopf führt auf die Seite des Wahlbezirks", async ({
		page,
	}) => {
		await page.goto("/2021/nordstemmen/rat/");
		const auswahl = page.getByLabel("Anderes Gebiet anzeigen");
		await expect(auswahl).toBeVisible();

		await auswahl.selectOption({ label: "09 - Rössing - DGH" });

		await page.waitForURL(/\/2021\/nordstemmen\/rat\/ebene_6_id_\d+\/$/);
		await expect(page.getByRole("heading", { level: 1 })).toHaveText(
			"09 - Rössing - DGH",
		);
		// Der Umschalter zeigt jetzt das neue Gebiet.
		await expect(page.getByLabel("Anderes Gebiet anzeigen")).toHaveValue(
			/ebene_6_id_/,
		);
	});

	test("Karte bleibt beim Wechsel in ein Untergebiet bestehen", async ({
		page,
	}) => {
		// Die Karte bleibt beim Wechsel in ein Untergebiet dieselbe Instanz
		// (transition:persist + transition:persist-props in WahlSeite.astro);
		// sie fliegt nur zum neuen Gebiet, statt neu aufgebaut zu werden.

		const fehler: string[] = [];
		page.on("pageerror", (e) => fehler.push(e.message));

		await page.goto("/2021/kreis/kreistag/");
		const karte = page.getByRole("application", {
			name: "Karte der Wahlergebnisse",
		});
		await expect(karte).toBeVisible();
		await expect(page.locator(".leaflet-interactive").first()).toBeVisible();

		// Merkmal auf dem Kartencontainer: übersteht es den Seitenaustausch, ist
		// dieselbe Leaflet-Instanz stehen geblieben (transition:persist).
		await karte.evaluate((el) => el.setAttribute("data-e2e-karte", "gemerkt"));
		await expect(page.locator('[data-e2e-karte="gemerkt"]')).toHaveCount(1);

		await gebietsTabelle(page)
			.getByRole("link", { name: "Gemeinde Nordstemmen" })
			.click();

		await expect(page).toHaveURL(/\/2021\/kreis\/kreistag\/ebene_3_id_14\/$/);
		await expect(page.getByRole("heading", { level: 1 })).toHaveText(
			"Gemeinde Nordstemmen",
		);

		// Dieselbe Leaflet-Instanz wie vorher, und sie zeigt das neue Gebiet.
		await expect(page.locator('[data-e2e-karte="gemerkt"]')).toHaveCount(1);
		await expect(karte).toBeVisible();
		await expect(page.locator(".leaflet-interactive").first()).toBeVisible();
		expect(fehler).toEqual([]);
	});

	test("Termin 2020: Übersicht und Bürgermeisterwahl Nordstemmen", async ({
		page,
	}) => {
		await page.goto("/2020/");
		await expect(page.getByRole("heading", { level: 1 })).toHaveText(
			"Bürgermeisterwahl Nordstemmen 2020",
		);
		const nordstemmen = page.getByRole("link", {
			name: "Gemeinde Nordstemmen",
		});
		await expect(nordstemmen).toBeVisible();
		await expect(nordstemmen).toHaveAttribute("href", "/2020/nordstemmen/");

		await page.goto("/2020/nordstemmen/buergermeister/");
		await expect(page.getByRole("heading", { level: 1 })).toHaveText(
			"Gemeinde Nordstemmen",
		);
		await expect(
			page.getByText("18 von 18 Schnellmeldungen", { exact: true }),
		).toBeVisible();

		// Personenwahl: Kandidaten mit Partei, keine Sitzverteilung.
		await expect(page.getByRole("heading", { name: "Stimmen" })).toBeVisible();
		const ludewig = page
			.getByRole("listitem")
			.filter({ hasText: "Gerald Ludewig" })
			.first();
		await expect(
			ludewig.getByText("Gerald Ludewig", { exact: true }),
		).toBeVisible();
		await expect(ludewig.getByText("SPD", { exact: true })).toBeVisible();
		await expect(ludewig.getByText("33,1 %")).toBeVisible();
		await expect(page.getByText("Nicole Dombrowski")).toBeVisible();
		await expect(
			page.getByRole("heading", { name: "Sitzverteilung" }),
		).toHaveCount(0);
		await expect(
			page.getByRole("heading", { name: "Bewerberinnen und Bewerber" }),
		).toHaveCount(0);

		// Die Stichwahl ist als eigene Wahl verlinkt.
		await expect(
			page.locator('a[href="/2020/nordstemmen/buergermeister-stichwahl/"]'),
		).toBeVisible();
	});
});

/**
 * Durchklicken von Wahllokal zu Wahllokal: Wer vergleicht, will die Seite
 * nicht bei jedem Klick von vorn sehen.
 */
test.describe("Durchklicken", () => {
	test.beforeAll(async () => {
		test.setTimeout(240_000);
		await warteAufDaten("2021");
	});

	test("Wechsel ins Nachbargebiet: Seite bleibt stehen, Karte zoomt nicht", async ({
		page,
	}) => {
		await page.goto("/2021/nordstemmen/rat/ebene_6_id_3119/");
		await expect(page.getByRole("heading", { level: 1 })).toHaveText(
			"09 - Rössing - DGH",
		);
		// Auf Wahlbezirks-Ebene liegen die meisten Flächen außerhalb des
		// Ausschnitts; es genügt, dass die Karte selbst steht.
		await expect(page.locator(".leaflet-container")).toBeVisible();
		await page.waitForTimeout(600);

		// Kartenansicht und Scrollstand vor dem Wechsel festhalten
		const vorher = await page.evaluate(() => {
			window.scrollTo(0, 400);
			const karte = document.querySelector(".leaflet-container");
			return {
				scroll: window.scrollY,
				kartenBild:
					karte?.querySelector(".leaflet-map-pane")?.getAttribute("style") ??
					"",
			};
		});
		expect(vorher.scroll).toBeGreaterThan(0);

		// Über das Gebiets-Menü ins nächste Wahllokal
		const menue = page.getByLabel("Anderes Gebiet anzeigen");
		const ziel = (await menue.locator("option").allTextContents()).find((t) =>
			t.includes("10 - Rössing"),
		);
		expect(ziel, "Nachbar-Wahllokal steht im Menü").toBeTruthy();
		await menue.selectOption({ label: ziel as string });
		await expect(page).toHaveURL(/ebene_6_id_3120\/$/);
		await expect(page.getByRole("heading", { level: 1 })).toHaveText(
			"10 - Rössing - Gaststätte",
		);

		const nachher = await page.evaluate(() => {
			const karte = document.querySelector(".leaflet-container");
			return {
				scroll: window.scrollY,
				kartenBild:
					karte?.querySelector(".leaflet-map-pane")?.getAttribute("style") ??
					"",
			};
		});
		// Die Seite ist nicht nach oben gesprungen …
		expect(Math.abs(nachher.scroll - vorher.scroll)).toBeLessThan(40);
		// … und die Karte steht still, weil das neue Wahllokal schon sichtbar war
		expect(nachher.kartenBild).toBe(vorher.kartenBild);
	});

	test("Gebiets-Menü der Kreistagswahl führt Wahlbereiche mit ihren Gemeinden und Wahllokalen", async ({
		page,
	}) => {
		await page.goto("/2021/kreis/kreistag/");
		const auswahl = page.getByLabel("Anderes Gebiet anzeigen");
		const eintraege = await auswahl.locator("option").allTextContents();
		const bereichB = eintraege.findIndex((t) => t.includes("Wahlbereich B ("));
		expect(bereichB).toBeGreaterThan(-1);
		const danach = eintraege.slice(bereichB + 1, bereichB + 40).join("|");
		// Unter dem Wahlbereich stehen Gemeinden, Ortsteile und Wahllokale
		expect(danach).toContain("Gemeinde Nordstemmen");
		expect(danach).toContain("Rössing");
		expect(danach).toMatch(/\d\d - Rössing/);
	});
});
