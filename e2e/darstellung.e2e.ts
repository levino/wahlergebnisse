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
		await page.goto("/hildesheim/2021/kreis/landrat/");

		const zeile = page
			.getByRole("listitem")
			.filter({ hasText: "Bernd Lynack" })
			.first();
		const name = zeile.getByText("Bernd Lynack", { exact: true });
		const partei = zeile.getByText("SPD", { exact: true });

		await expect(name).toBeVisible();
		await expect(partei).toBeVisible();
		await expect(name).toHaveText("Bernd Lynack");
		await expect(partei).toHaveText("SPD");

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
		await page.goto("/hildesheim/2021/nordstemmen/rat/");
		const tabelle = gebietsTabelle(page);
		await expect(
			tabelle.getByRole("heading", { name: "Ergebnisse nach Gebiet" }),
		).toBeVisible();

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

		await expect(page).toHaveURL(/\/2021\/nordstemmen\/rat\/$/);
	});

	test("Untergebiete: Spaltenkopf sortiert die Tabelle um", async ({
		page,
	}) => {
		await page.goto("/hildesheim/2021/nordstemmen/rat/");
		const tabelle = gebietsTabelle(page);
		await tabelle.getByRole("button", { name: "Ortsteile" }).click();

		const vorher = await ersteSpalte(tabelle);
		expect(vorher[0]).toBe("Adensen");

		await tabelle.getByRole("columnheader", { name: "CDU" }).click();

		await expect(tabelle.getByText("Sortiert nach CDU")).toBeVisible();
		const nachher = await ersteSpalte(tabelle);
		expect(nachher[0]).not.toBe(vorher[0]);
		expect(nachher[0]).toBe("Klein Escherde");
		expect([...nachher].sort()).toEqual([...vorher].sort());

		await tabelle.getByRole("columnheader", { name: "CDU" }).click();
		expect(await ersteSpalte(tabelle)).toEqual(vorher);
	});

	test("Bewerber: Anteil an allen gültigen Stimmen, Gewählten-Haken und Listenplatz-Sortierung", async ({
		page,
	}) => {
		await page.goto("/hildesheim/2021/nordstemmen/rat/");
		const bereich = bewerberBereich(page);
		await expect(
			bereich.getByRole("heading", { name: "Bewerberinnen und Bewerber" }),
		).toBeVisible();

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

		await expect(ludewig.getByLabel("gewählt")).toBeVisible();
		await expect(ludewig.getByLabel("gewählt")).toHaveText("✓");

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
		await page.goto("/hildesheim/2021/nordstemmen/rat/");
		const auswahl = page.getByLabel("Anderes Gebiet anzeigen");
		await expect(auswahl).toBeVisible();

		await auswahl.selectOption({ label: "09 - Rössing - DGH" });

		await page.waitForURL(/\/2021\/nordstemmen\/rat\/ebene_6_id_\d+\/$/);
		await expect(page.getByRole("heading", { level: 1 })).toHaveText(
			"09 - Rössing - DGH",
		);
		await expect(page.getByLabel("Anderes Gebiet anzeigen")).toHaveValue(
			/ebene_6_id_/,
		);
	});

	test("Karte bleibt beim Wechsel in ein Untergebiet bestehen", async ({
		page,
	}) => {
		const fehler: string[] = [];
		page.on("pageerror", (e) => fehler.push(e.message));

		await page.goto("/hildesheim/2021/kreis/kreistag/");
		const karte = page.getByRole("application", {
			name: "Karte der Wahlergebnisse",
		});
		await expect(karte).toBeVisible();
		await expect(page.locator(".leaflet-interactive").first()).toBeVisible();

		await karte.evaluate((el) => el.setAttribute("data-e2e-karte", "gemerkt"));
		await expect(page.locator('[data-e2e-karte="gemerkt"]')).toHaveCount(1);

		await gebietsTabelle(page)
			.getByRole("link", { name: "Gemeinde Nordstemmen" })
			.click();

		await expect(page).toHaveURL(/\/2021\/nordstemmen\/kreistag\/$/);
		await expect(page.getByRole("heading", { level: 1 })).toHaveText(
			"Gemeinde Nordstemmen",
		);

		await expect(page.locator('[data-e2e-karte="gemerkt"]')).toHaveCount(1);
		await expect(karte).toBeVisible();
		await expect(page.locator(".leaflet-interactive").first()).toBeVisible();
		expect(fehler).toEqual([]);
	});

	test("Termin 2020: Übersicht und Bürgermeisterwahl Nordstemmen", async ({
		page,
	}) => {
		await page.goto("/hildesheim/2020/");
		await expect(page).toHaveURL(/\/hildesheim\/2020\/nordstemmen\/$/);
		await expect(page.getByRole("heading", { level: 1 })).toHaveText(
			"Gemeinde Nordstemmen",
		);
		await expect(
			page.getByRole("link", { name: "Bürgermeisterwahl" }).first(),
		).toBeVisible();

		await page.goto("/hildesheim/2020/nordstemmen/buergermeister/");
		await expect(page.getByRole("heading", { level: 1 })).toHaveText(
			"Gemeinde Nordstemmen",
		);
		await expect(
			page.getByText("18 von 18 Schnellmeldungen", { exact: true }),
		).toBeVisible();

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

		await expect(
			page.locator(
				'a[href="/hildesheim/2020/nordstemmen/buergermeister-stichwahl/"]',
			),
		).toBeVisible();
	});
});

test.describe("Durchklicken", () => {
	test.beforeAll(async () => {
		test.setTimeout(240_000);
		await warteAufDaten("2021");
	});

	test("Wechsel ins Nachbargebiet: Seite bleibt stehen, Karte zoomt nicht", async ({
		page,
	}) => {
		await page.goto("/hildesheim/2021/nordstemmen/rat/ebene_6_id_3119/");
		await expect(page.getByRole("heading", { level: 1 })).toHaveText(
			"09 - Rössing - DGH",
		);
		await expect(page.locator(".leaflet-container")).toBeVisible();
		await page.waitForTimeout(600);

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
		expect(Math.abs(nachher.scroll - vorher.scroll)).toBeLessThan(40);
		expect(nachher.kartenBild).toBe(vorher.kartenBild);
	});

	test("Gebiets-Menü der Kreistagswahl führt Wahlbereiche mit ihren Gemeinden und Wahllokalen", async ({
		page,
	}) => {
		await page.goto("/hildesheim/2021/kreis/kreistag/");
		const auswahl = page.getByLabel("Anderes Gebiet anzeigen");
		const eintraege = await auswahl.locator("option").allTextContents();
		const bereichB = eintraege.findIndex((t) => t.includes("Wahlbereich B ("));
		expect(bereichB).toBeGreaterThan(-1);
		const danach = eintraege.slice(bereichB + 1, bereichB + 40).join("|");
		expect(danach).toContain("Gemeinde Nordstemmen");
		expect(danach).toContain("Rössing");
		expect(danach).toMatch(/\d\d - Rössing/);
	});

	test("Gebiets-Menü der Kreistagswahl 2026 führt die Wahlbereiche der Wahlleitung", async ({
		page,
	}) => {
		await page.goto("/hildesheim/2026/kreis/kreistag/");
		const eintraege = await page
			.getByLabel("Anderes Gebiet anzeigen")
			.locator("option")
			.allTextContents();
		const bereiche = eintraege.filter((t) =>
			t.trim().startsWith("Wahlbereich"),
		);
		expect(bereiche).toHaveLength(11);
		expect(bereiche.join("|")).toContain("Wahlbereich B");
		expect(bereiche.join("|")).not.toContain("Wahlbereich M");
		expect(bereiche.join("|")).not.toMatch(/Elze|Nordstemmen/);
	});

	test("Der Kreiswahlbereich hat eine eigene Seite und heißt dort so", async ({
		page,
	}) => {
		await page.goto("/hildesheim/2026/kreis/kreistag/ebene_-53_id_162/");
		await expect(page.getByRole("heading", { level: 1 })).toHaveText(
			"Wahlbereich B",
		);
		await expect(page.getByText("Wahlbereich", { exact: true })).toBeVisible();
	});

	test("Jede Seite nennt ihre eigene, öffentliche Adresse", async ({
		page,
	}) => {
		await page.goto("/hildesheim/2021/nordstemmen/rat/");
		const canonical = await page
			.locator('link[rel="canonical"]')
			.getAttribute("href");
		const ogUrl = await page
			.locator('meta[property="og:url"]')
			.getAttribute("content");
		expect(canonical).toBe(
			"https://wahlergebnisse.example.org/hildesheim/2021/nordstemmen/rat/",
		);
		expect(ogUrl).toBe(canonical);
	});
});

test.describe("Rechtliches", () => {
	test("Fuß nennt ein privates Angebot und führt zum Haftungsausschluss", async ({
		page,
	}) => {
		await page.goto("/hildesheim/2021/");
		const fuss = page.locator("footer");
		await expect(fuss).toContainText("Privates Angebot");
		await expect(fuss).not.toContainText("cduhildesheim.de");
		await fuss.getByRole("link", { name: /Rechtliches/ }).click();
		await expect(page.getByRole("heading", { level: 1 })).toHaveText(
			"Rechtliches",
		);
		await expect(
			page.getByRole("heading", { name: "Haftungsausschluss" }),
		).toBeVisible();
		await expect(
			page.getByRole("heading", { name: "Impressum" }),
		).toBeVisible();
	});
});
