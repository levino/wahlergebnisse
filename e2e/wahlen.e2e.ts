import { expect, test } from "@playwright/test";
import { warteAufDaten } from "./warten.ts";
import { STEUERUNG } from "./ports.ts";

const steuere = (was: "vorher" | "wahlabend" | "wahlabend-mehr") =>
	fetch(`${STEUERUNG}/${was}`);

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
			page
				.locator("section")
				.filter({
					has: page.getByRole("heading", { name: "Städte und Gemeinden" }),
				})
				.getByRole("link", { name: "Gemeinde Nordstemmen" }),
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
		const sitze = page.getByRole("img", { name: /Sitzverteilung/ });
		await expect(sitze).toHaveAttribute("aria-label", /CDU 19/);
		await expect(page.getByText("Mehrheit ab 33")).toBeVisible();
		const flaechen = page.locator(".leaflet-interactive");
		await expect(flaechen.first()).toBeVisible();
		expect(await flaechen.count()).toBeGreaterThanOrEqual(20);
		const karte = page.getByRole("application", {
			name: "Karte der Wahlergebnisse",
		});
		await karte
			.locator("xpath=./..")
			.getByRole("button", { name: /Kreiswahlbereiche|Wahlbereiche/ })
			.first()
			.click();
		await expect(page.locator(".leaflet-interactive").first()).toBeVisible();
		await expect(
			page.getByRole("link", { name: "Gemeinde Algermissen" }).first(),
		).toHaveAttribute(
			"href",
			/\/hildesheim\/2021\/kreis\/kreistag\/ebene_3_id_\d+\/$/,
		);

		await page
			.getByRole("link", { name: "Gemeinde Nordstemmen" })
			.first()
			.click();
		await expect(page).toHaveURL(/\/2021\/nordstemmen\/kreistag\/$/);
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
		await expect(page.locator(".leaflet-interactive").first()).toBeVisible();
		expect(
			await page.locator(".leaflet-interactive").count(),
		).toBeGreaterThanOrEqual(9 + 10);
		await page.getByRole("link", { name: "Ortsrat Rössing" }).click();
		await expect(page).toHaveURL(/ortsrat-roessing/);
		await expect(page.getByRole("heading", { level: 1 })).toHaveText("Rössing");
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

	test("Wahlabend 2026: nur der meldende Bereich holt nach, Ticker und Hochrechnung erscheinen", async ({
		context,
	}) => {
		await steuere("vorher");
		const gemeinde = await context.newPage();
		await gemeinde.goto("/hildesheim/2026/nordstemmen/rat/");
		await expect(gemeinde.getByText("Noch keine Ergebnisse.")).toBeVisible();
		const landkreis = await context.newPage();
		await landkreis.goto("/hildesheim/2026/kreis/");
		for (const seite of [gemeinde, landkreis]) {
			await expect(seite.locator("#stand-anzeige")).toHaveAttribute(
				"data-live",
				"1",
			);
			await expect(seite.locator("#stand-anzeige")).toHaveAttribute(
				"data-zustand",
				"verbunden",
			);
		}
		await landkreis.evaluate(() => {
			const m = document.createElement("div");
			m.id = "merkzeichen";
			document.body.append(m);
		});

		await steuere("wahlabend");
		await expect(
			gemeinde.getByText("2 von 23 Schnellmeldungen", { exact: true }),
		).toBeVisible({ timeout: 30_000 });
		await expect(
			gemeinde.getByText("Zwischenstand", { exact: false }).first(),
		).toBeVisible();
		await expect(gemeinde.getByText("Noch keine Sitzverteilung")).toBeVisible();
		await expect(
			gemeinde.getByRole("heading", { name: "Koalitionsrechner" }),
		).toHaveCount(0);
		await expect(
			gemeinde.getByText("Kommunalwahl 2021", { exact: false }).first(),
		).toBeVisible(); // Vergleichswerte

		expect(await landkreis.locator("#merkzeichen").count()).toBe(1);

		await steuere("wahlabend-mehr");
		await expect(
			gemeinde.getByText("9 von 23 Schnellmeldungen", { exact: true }),
		).toBeVisible({ timeout: 30_000 });
		await expect(gemeinde.getByText("Noch keine Sitzverteilung")).toHaveCount(
			0,
		);
		await expect(
			gemeinde.getByRole("heading", { name: "Sitzverteilung" }),
		).toBeVisible();
		await expect(gemeinde.getByText("Hochrechnung").first()).toBeVisible();
		await expect(gemeinde.getByText("Unsicherheit").first()).toBeVisible();
		await expect(gemeinde.getByText("mittel").first()).toBeVisible();
		await expect(
			gemeinde
				.getByText("Keine Prognose der Wahlleitung", { exact: false })
				.first(),
		).toBeVisible();
		await expect(
			gemeinde.getByRole("heading", { name: "Koalitionsrechner" }),
		).toBeVisible();

		await gemeinde.goto("/hildesheim/2026/");
		await expect(
			gemeinde
				.locator(
					'[data-ticker] a[href="/hildesheim/2026/nordstemmen/rat/ebene_6_id_6014/"]',
				)
				.first(),
		).toHaveText("Dorfgemeinschaftshaus Rössing");
		await expect(
			gemeinde.getByText("Gemeindewahl ausgezählt").first(),
		).toBeVisible();
		await expect(
			gemeinde.getByRole("link", { name: "Nordstemmen" }).first(),
		).toBeVisible();
		await gemeinde.close();
		await landkreis.close();
	});

	test("Kommt die Zustellung nicht zustande, sagt die Anzeige es", async ({
		page,
	}) => {
		await page.route("**/api/live*", (route) => route.abort());
		await page.goto("/hildesheim/2026/");
		await expect(page.locator("#stand-anzeige")).toHaveAttribute(
			"data-zustand",
			"unterbrochen",
			{ timeout: 30_000 },
		);
		await expect(page.getByText("Verbindung unterbrochen")).toBeVisible();
		await page.unroute("**/api/live*");
		await expect(page.locator("#stand-anzeige")).toHaveAttribute(
			"data-zustand",
			"verbunden",
			{ timeout: 30_000 },
		);
	});

	test("API, Export und 404", async ({ request }) => {
		const v = await request.get("/api/version.json?termin=2026");
		expect(v.ok()).toBeTruthy();
		expect((await v.json()).termin).toBe("2026");
		const puls = await request.get("/api/version.json");
		expect(puls.ok()).toBeTruthy();
		expect(await puls.json()).toMatchObject({ termin: "2026", topic: "alle" });
		const unbekannt = await request.get("/api/version.json?termin=1999");
		expect(unbekannt.status()).toBe(404);
		const kv = await request.get(
			"/api/version.json?termin=2026&topic=hildesheim/03254026",
		);
		expect((await kv.json()).topic).toBe("hildesheim/03254026");
		const etag = kv.headers().etag;
		expect(etag).toBeTruthy();
		const unveraendert = await request.get(
			"/api/version.json?termin=2026&topic=hildesheim/03254026",
			{ headers: { "if-none-match": etag } },
		);
		expect(unveraendert.status()).toBe(304);
		const live = await request.get("/hildesheim/2026/");
		expect(live.headers()["cache-control"]).toBe("private, no-cache");
		const archiv = await request.get("/hildesheim/2021/kreis/kreistag/");
		expect(archiv.headers()["cache-control"]).toBe("private, max-age=300");
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
		const nochmal = await request.get("/export/wahlen.sqlite", {
			headers: { authorization: "Bearer e2e-token" },
		});
		expect(nochmal.ok()).toBeTruthy();
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
