import { expect, test } from "@playwright/test";
import { warteAufDaten } from "./warten.ts";

const steuere = (was: "vorher" | "wahlabend") =>
	fetch(`http://127.0.0.1:8098/${was}`);

test.describe("Wahlergebnisse", () => {
	test.beforeAll(async () => {
		test.setTimeout(240_000);
		await warteAufDaten("2021");
	});

	test("Kreis-Startseite zeigt den Live-Termin, Kreiswahlen und Gemeinden", async ({
		page,
	}) => {
		await page.goto("/hildesheim/");
		await expect(page).toHaveTitle(/Kommunalwahl 2026/);
		await expect(page.getByRole("heading", { level: 1 })).toHaveText(
			"Kommunalwahl 2026",
		);
		await expect(
			page.getByRole("heading", { name: "Kreistagswahl" }),
		).toBeVisible();
		await expect(
			page.getByRole("link", { name: "Gemeinde Nordstemmen" }),
		).toBeVisible();
		await expect(page.getByText("Zuletzt eingegangen")).toBeVisible();
	});

	test("Kreistagswahl 2021: Balken, Sitzverteilung, Karte mit klickbaren Gemeinden", async ({
		page,
	}) => {
		await page.goto("/hildesheim/2021/kreis/kreistag/");
		await expect(page.getByRole("heading", { level: 1 })).toHaveText(
			"Landkreis Hildesheim",
		);
		await expect(page.getByText("426 von 426 Schnellmeldungen")).toBeVisible();
		await expect(page.getByText("34,0 %").first()).toBeVisible();
		// Sitzverteilung: 64 Sitze, CDU 19
		const sitze = page.getByRole("img", { name: /Sitzverteilung/ });
		await expect(sitze).toHaveAttribute("aria-label", /CDU 19/);
		await expect(page.getByText("Mehrheit ab 33")).toBeVisible();
		// Karte: Leaflet rendert die 20 Gemeindeflächen als SVG-Pfade
		const flaechen = page.locator(".leaflet-interactive");
		await expect(flaechen.first()).toBeVisible();
		expect(await flaechen.count()).toBeGreaterThanOrEqual(20);
		// Ebenen-Umschalter der Karte (die Gebietstabelle hat gleichnamige Schalter)
		const karte = page.getByRole("application", {
			name: "Karte der Wahlergebnisse",
		});
		await karte
			.locator("xpath=./..")
			.getByRole("button", { name: /Kreiswahlbereiche|Wahlbereiche/ })
			.first()
			.click();
		await expect(page.locator(".leaflet-interactive").first()).toBeVisible();
		// Tabelle der Gemeinden verlinkt auf das Untergebiet
		await page
			.getByRole("link", { name: "Gemeinde Nordstemmen" })
			.first()
			.click();
		await expect(page).toHaveURL(/\/2021\/kreis\/kreistag\/ebene_3_id_14\/$/);
		await expect(page.getByRole("heading", { level: 1 })).toHaveText(
			"Gemeinde Nordstemmen",
		);
		await expect(
			page.getByText("23 von 23 Schnellmeldungen", { exact: true }),
		).toBeVisible();
	});

	test("Koalitionsrechner rechnet Mehrheiten", async ({ page }) => {
		await page.goto("/hildesheim/2021/kreis/kreistag/");
		await expect(page.getByText("Parteien antippen")).toBeVisible();
		await page.getByRole("button", { name: /^SPD 22$/ }).click();
		await expect(page.getByText("11 fehlen zur Mehrheit")).toBeVisible();
		await page.getByRole("button", { name: /^CDU 19$/ }).click();
		await expect(page.getByText("41 von 64 Sitzen – Mehrheit")).toBeVisible();
		await page.getByText("Mögliche Mehrheiten").click();
		await expect(
			page.getByRole("button", { name: /SPD \+ CDU/ }),
		).toBeVisible();
	});

	test("Gemeindewahl Nordstemmen: Ortsteile, Wahllokale, Kandidaten, Wahlbezirk-Seite", async ({
		page,
	}) => {
		await page.goto("/hildesheim/2021/nordstemmen/rat/");
		await expect(page.getByRole("heading", { level: 1 })).toHaveText(
			"Gemeinde Nordstemmen",
		);
		await expect(
			page.getByRole("img", { name: /Sitzverteilung/ }),
		).toHaveAttribute("aria-label", /SPD 12, GRÜNE 4, CDU 9/);
		await expect(page.getByText("Mehrheit ab 16")).toBeVisible();
		await expect(
			page.getByRole("heading", { name: "Bewerberinnen und Bewerber" }),
		).toBeVisible();
		await expect(page.getByText("Gerald Ludewig")).toBeVisible();
		// Wahllokale als Kreise, Ortsteile als Flächen
		await expect(page.locator(".leaflet-interactive").first()).toBeVisible();
		expect(
			await page.locator(".leaflet-interactive").count(),
		).toBeGreaterThanOrEqual(9 + 10);
		// Reiter zu einem Ortsrat
		await page.getByRole("link", { name: "Ortsrat Rössing" }).click();
		await expect(page).toHaveURL(/ortsrat-roessing/);
		await expect(page.getByRole("heading", { level: 1 })).toHaveText("Rössing");
		// Wahlbezirk-Seite über die Tabelle
		await page
			.getByRole("link", { name: "09 - Rössing - DGH" })
			.first()
			.click();
		await expect(page.getByRole("heading", { level: 1 })).toHaveText(
			"09 - Rössing - DGH",
		);
		await expect(
			page.getByText("Wahlbezirk", { exact: false }).first(),
		).toBeVisible();
	});

	test("Landratswahl: Kandidaten mit Partei", async ({ page }) => {
		await page.goto("/hildesheim/2021/kreis/landrat/");
		await expect(page.getByText("Bernd Lynack")).toBeVisible();
		await expect(page.getByText("41,3 %").first()).toBeVisible();
		await expect(
			page.getByRole("heading", { name: "Sitzverteilung" }),
		).toHaveCount(0);
	});

	test("Wahlabend 2026: Seite lädt neue Schnellmeldungen selbst nach, Ticker und Hochrechnung erscheinen", async ({
		page,
	}) => {
		await steuere("vorher");
		await page.goto("/hildesheim/2026/nordstemmen/rat/");
		await expect(page.getByText("Noch keine Ergebnisse.")).toBeVisible();
		await expect(page.locator("#stand-anzeige")).toHaveAttribute(
			"data-live",
			"1",
		);

		await steuere("wahlabend");
		// Poller (2 s) + Client-Intervall (2 s) → Seite lädt sich neu
		await expect(
			page.getByText("2 von 23 Schnellmeldungen", { exact: true }),
		).toBeVisible({ timeout: 30_000 });
		await expect(page.getByText("Hochrechnung").first()).toBeVisible();
		await expect(
			page.getByRole("heading", { name: "Koalitionsrechner" }),
		).toBeVisible();
		await expect(
			page.getByText("Kommunalwahl 2021", { exact: false }).first(),
		).toBeVisible(); // Vergleichswerte

		await page.goto("/hildesheim/2026/");
		await expect(
			page.getByText("09 - Rössing - DGH: Gemeindewahl ausgezählt"),
		).toBeVisible();
		await expect(
			page.getByRole("link", { name: "Nordstemmen" }).first(),
		).toBeVisible();
	});

	test("API, Export und 404", async ({ request }) => {
		const v = await request.get("/api/version.json?termin=2026");
		expect(v.ok()).toBeTruthy();
		expect((await v.json()).termin).toBe("2026");
		const t = await request.get("/api/v1/hildesheim/2026/ereignisse?limit=5");
		expect(t.ok()).toBeTruthy();
		expect(Array.isArray((await t.json()).ereignisse)).toBeTruthy();
		expect((await request.get("/export/wahlen.sqlite")).status()).toBe(403);
		const ex = await request.get("/export/wahlen.sqlite", {
			headers: { authorization: "Bearer e2e-token" },
		});
		expect(ex.ok()).toBeTruthy();
		expect((await ex.body()).subarray(0, 15).toString()).toBe(
			"SQLite format 3",
		);
		expect(
			(await request.get("/hildesheim/2021/gibt-es-nicht/")).status(),
		).toBe(404);
		expect(
			(
				await request.get("/hildesheim/2021/nordstemmen/rat/ebene_6_id_999/")
			).status(),
		).toBe(404);
		expect((await request.get("/healthz")).ok()).toBeTruthy();
	});
});
