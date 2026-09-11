import { expect, test } from "@playwright/test";
import { BASIS } from "./ports.ts";

/** Wartet, bis der Poller die Stadt geholt hat (sie ist nicht der erste Kreis in der Reihe). */
const warteAufEmden = async (sekunden = 180): Promise<void> => {
	for (let i = 0; i < sekunden; i++) {
		try {
			const r = await fetch(`${BASIS}/api/v1/emden/2026/wahlen`);
			if (r.ok && (await r.text()).includes("Stadtratswahl")) return;
		} catch {
			/* Server startet noch */
		}
		await new Promise((res) => setTimeout(res, 1000));
	}
	throw new Error("Die Daten der Stadt Emden wurden nicht geladen");
};

test.describe("Kreisfreie Stadt", () => {
	test.beforeAll(async () => {
		test.setTimeout(240_000);
		await warteAufEmden();
	});

	test("zeigt ihre eigenen Wahlen statt „noch nicht geladen“", async ({
		page,
	}) => {
		await page.goto("/emden/");
		await expect(page.getByText("noch nicht geladen")).toHaveCount(0);

		const ob = page.getByRole("link", { name: "Oberbürgermeisterwahl" });
		await expect(ob).toHaveAttribute(
			"href",
			"/emden/2026/kreis/buergermeister/",
		);
		await expect(
			page.getByRole("link", { name: "Stadtratswahl", exact: true }),
		).toHaveAttribute("href", "/emden/2026/kreis/rat/");

		const ortsraete = page.locator("section").filter({
			has: page.getByRole("heading", { name: "Ortsräte und Stadtbezirke" }),
		});
		await expect(ortsraete).toBeVisible();
		await expect(
			ortsraete.getByRole("link", { name: "Ortschaft Borssum" }),
		).toHaveAttribute("href", "/emden/2026/kreis/ortsrat-borssum/");

		await ob.click();
		await expect(page).toHaveURL(/\/emden\/2026\/kreis\/buergermeister\/$/);
		await expect(page.getByRole("heading", { level: 1 })).toHaveText(
			"Stadt Emden",
		);
		await expect(page.getByText("Anke Meyer")).toBeVisible();
	});

	test("zeigt auf der Karte die stärksten Parteien, nicht die erstgenannten", async ({
		page,
	}) => {
		await page.goto("/emden/");
		const karte = page
			.locator("section")
			.filter({ has: page.getByRole("link", { name: "Stadtratswahl" }) })
			.first();
		await expect(karte.getByText("AfD")).toBeVisible();
		await expect(karte.getByText("Die PARTEI")).toHaveCount(0);
	});

	test("bietet keinen Archivtermin an, den es dort nicht gibt", async ({
		page,
	}) => {
		await page.goto("/emden/");
		const termine = page.getByLabel("Wahltermine");
		await expect(termine.getByRole("link", { name: /2026/ })).toHaveCount(1);
		await expect(termine.getByRole("link", { name: /2021/ })).toHaveCount(1);
		await expect(termine.getByRole("link", { name: /2020/ })).toHaveCount(0);

		const r = await fetch(`${BASIS}/emden/2020/`, { redirect: "manual" });
		expect(r.status).toBe(404);
	});
});

test.describe("Unbekannte Adressen", () => {
	test("führen zur richtigen 404-Seite, nicht zu nacktem Text", async ({
		page,
	}) => {
		const antwort = await page.goto("/gibtsnicht/");
		expect(antwort?.status()).toBe(404);
		await expect(page.getByRole("heading", { level: 1 })).toHaveText(
			"Seite nicht gefunden",
		);
		await expect(
			page.getByRole("link", { name: "Auswahl der Kreise" }),
		).toBeVisible();
	});

	test("gilt auch für eine Wahl, die es in diesem Kreis nicht gibt", async ({
		page,
	}) => {
		const antwort = await page.goto("/hildesheim/2021/kreis/gibtsnicht/");
		expect(antwort?.status()).toBe(404);
		await expect(page.getByRole("heading", { level: 1 })).toHaveText(
			"Seite nicht gefunden",
		);
	});
});
