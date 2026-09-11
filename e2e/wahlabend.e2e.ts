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

const ratsAdresse = async (
	request: { get: (url: string) => Promise<{ json: () => Promise<unknown> }> },
	kreis: string,
	behoerde: string,
): Promise<string> => {
	const d = (await (
		await request.get(`/api/v1/${kreis}/2026/wahlen?behoerde=${behoerde}`)
	).json()) as { wahlen: Array<{ slug: string; typ: string }> };
	const w = d.wahlen.find((x) => x.typ === "rat");
	if (!w) throw new Error(`keine Gemeindewahl bei ${kreis}/${behoerde}`);
	return `/${kreis}/2026/${behoerde}/${w.slug}/`;
};

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

		await page.goto(
			await ratsAdresse(request, "holzminden", MELDER.holzminden),
		);
		await expect(page.getByText("Noch keine Ergebnisse.")).toBeVisible();
		await expect(page.locator("#stand-anzeige")).toHaveAttribute(
			"data-live",
			"1",
		);

		await steuere("wahlabend-viele");
		await expect(
			page.getByText("2 von 23 Schnellmeldungen", { exact: true }),
		).toBeVisible({ timeout: 60_000 });

		await page.goto(await ratsAdresse(request, "goslar", MELDER.goslar));
		await expect(
			page.getByText("2 von 23 Schnellmeldungen", { exact: true }),
		).toBeVisible({ timeout: 60_000 });

		const adresse = await ratsAdresse(request, "goslar", MELDER.goslar);
		const api = await request.get(`/api/v1${adresse.replace(/\/$/, "")}`);
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
		const r = await request.get("/peine/2026/");
		expect(r.status()).toBe(200);
		await page.goto("/peine/2026/");
		await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

		const api = await request.get("/api/v1/peine/2026");
		expect(api.ok()).toBeTruthy();
		expect((await api.json()).kreis.slug).toBe("peine");

		const lauf = await request.get("/api/version.json?termin=2026");
		expect(lauf.ok()).toBeTruthy();
	});
});
