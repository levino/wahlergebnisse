/**
 * Die Probe auf den Wahlabend im Browser – mit mehreren Kreisen.
 *
 * `wahlen.e2e.ts` spielt den Abend für einen Kreis durch. Hier geht es um das,
 * was am 13. September 2026 wirklich passiert: In mehreren Kreisen laufen
 * gleichzeitig Schnellmeldungen ein, jemand sieht sich einen davon an, und ein
 * anderer muss trotzdem aktuell sein, wenn man ihn öffnet.
 *
 * Der Mock schaltet auf ein Kommando beide Kreise gleichzeitig um (siehe
 * e2e/server.ts). Holzminden und Goslar tragen dabei gespiegelte Hildesheimer
 * Dateien; Peine hat gar keine Präsentation und darf trotzdem nichts umwerfen.
 */
import { expect, test } from "@playwright/test";
import { STEUERUNG } from "./ports.ts";
import { warteAufDaten } from "./warten.ts";

const steuere = (was: "vorher" | "wahlabend-viele") =>
	fetch(`${STEUERUNG}/${was}`);

/** Kreis-Slug → Behörde, die dort meldet (siehe e2e/server.ts). */
const MELDER = {
	holzminden: "delligsen",
	goslar: "bad-harzburg",
} as const;

test.describe("Wahlabend in mehreren Kreisen", () => {
	test.beforeAll(async () => {
		test.setTimeout(240_000);
		await warteAufDaten("2026");
	});

	test("Ergebnisse laufen in mehreren Kreisen parallel ein", async ({
		page,
		request,
	}) => {
		test.setTimeout(120_000);
		await steuere("vorher");

		// Der betrachtete Kreis: erst leer, dann meldet er von selbst nach.
		await page.goto(`/holzminden/2026/${MELDER.holzminden}/rat/`);
		await expect(page.getByText("Noch keine Ergebnisse.")).toBeVisible();
		await expect(page.locator("#stand-anzeige")).toHaveAttribute(
			"data-live",
			"1",
		);

		// 18 Uhr: überall gleichzeitig.
		await steuere("wahlabend-viele");
		await expect(
			page.getByText("2 von 23 Schnellmeldungen", { exact: true }),
		).toBeVisible({ timeout: 60_000 });

		// Ein anderer Kreis, den bis eben niemand angesehen hat, ist ebenfalls
		// aktuell – das ist der eigentliche Punkt: Wer ihn jetzt öffnet, sieht
		// keine Zahlen von vor einer Viertelstunde.
		await page.goto(`/goslar/2026/${MELDER.goslar}/rat/`);
		await expect(
			page.getByText("2 von 23 Schnellmeldungen", { exact: true }),
		).toBeVisible({ timeout: 60_000 });

		// Und über die Schnittstelle abgefragt genauso.
		const api = await request.get(`/api/v1/goslar/2026/${MELDER.goslar}/rat`);
		expect(api.ok()).toBeTruthy();
		expect((await api.json()).ergebnis.stand.schnellmeldungen.eingegangen).toBe(
			2,
		);
	});

	test("der Ticker meldet die eingegangenen Schnellmeldungen", async ({
		page,
		request,
	}) => {
		test.setTimeout(120_000);
		await steuere("wahlabend-viele");

		// Ticker des Kreises: nur seine eigenen Wahlleitungen.
		await page.goto("/holzminden/2026/");
		await expect(
			page.getByText("Gemeindewahl", { exact: false }).first(),
		).toBeVisible({ timeout: 60_000 });

		for (const kreis of ["holzminden", "goslar"]) {
			const r = await request.get(`/api/v1/${kreis}/2026/ereignisse?limit=50`);
			expect(r.ok(), kreis).toBeTruthy();
			const ereignisse = (await r.json()).ereignisse as Array<{
				text: string;
			}>;
			expect(ereignisse.length, `${kreis}: Ticker leer`).toBeGreaterThan(0);
			expect(
				ereignisse.some((e) => e.text.includes("Gemeindewahl")),
				`${kreis}: keine Gemeindewahl im Ticker`,
			).toBe(true);
		}
	});

	test("ein Kreis ohne Präsentation bleibt fehlerfrei", async ({
		page,
		request,
	}) => {
		test.setTimeout(60_000);
		// Peine wird abgefragt (er gilt als vorhanden), liefert aber nichts.
		// Weder die Seite noch die Schnittstelle dürfen daran zerbrechen.
		const r = await request.get("/peine/2026/");
		expect(r.status()).toBe(200);
		await page.goto("/peine/2026/");
		await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

		const api = await request.get("/api/v1/peine/2026");
		expect(api.ok()).toBeTruthy();
		expect((await api.json()).kreis.slug).toBe("peine");

		// Und der Poller läuft weiter: der betrachtete Kreis bekommt trotzdem
		// seine Aktualisierungen.
		const lauf = await request.get("/api/version.json?termin=2026");
		expect(lauf.ok()).toBeTruthy();
	});
});
