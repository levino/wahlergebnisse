import { expect, test } from "@playwright/test";
import { lies, moderationsSatz } from "./aufnahmen.ts";
import {
	aufrufe,
	gegenstelle,
	gegenstelleZuruecksetzen,
	haken,
	schubAusloesen,
	warteAufDienst,
} from "./leinwand.ts";
import { warteAufDaten } from "./warten.ts";

const SEITE = "/hildesheim/2021/nordstemmen/dashboard?takt=300";

const AUFNAHMEN = lies();

const FUEHRUNGSWECHSEL = ["ortsrat-nordstemmen"];
const ZWEITE_WAHL = ["rat"];
const DRITTE_WAHL = ["ortsrat-adensen", "ortsrat-barnten"];
const VIERTE_WAHL = ["ortsrat-burgstemmen"];

const oeffne = async (page: import("@playwright/test").Page) => {
	await page.goto(SEITE);
	await expect(page.locator(".db-buehne")).toBeVisible();
	await page.getByRole("button", { name: "Pause" }).click();
};

const gesprochen = async (page: import("@playwright/test").Page) => {
	await expect
		.poll(async () => (await haken(page))?.grund, { timeout: 25_000 })
		.toBe("dienst");
	return (await haken(page))?.text ?? "";
};

const einblender = (page: import("@playwright/test").Page) =>
	page.locator("[data-meldungen]");

test.describe("Die Moderation spricht, der Einblender steht", () => {
	test.beforeAll(async () => {
		test.setTimeout(240_000);
		await warteAufDaten("2021");
	});

	test.beforeEach(async () => {
		await gegenstelleZuruecksetzen();
		await warteAufDienst();
	});

	test("liest den Einblender nicht vor", async ({ page }) => {
		await oeffne(page);
		const antwort = page.waitForResponse("**/api/ansage/moderation");
		await schubAusloesen(page, FUEHRUNGSWECHSEL, "CDU");

		const daten = (await (await antwort).json()) as {
			satz: string;
			quelle: string;
			grund?: string;
		};
		expect(daten.grund ?? "").toBe("");
		expect(daten.quelle).toBe("modell");

		const satz = await gesprochen(page);
		expect(satz).toBe(daten.satz);

		const steht = (await einblender(page).innerText()).trim();
		expect(steht).not.toBe("");
		expect(satz).not.toBe(steht);
		for (const zeile of steht.split("\n").filter(Boolean))
			expect(satz).not.toContain(zeile);
	});

	test("spricht mehr als einen Satz und nennt den Auszählstand", async ({
		page,
	}) => {
		await oeffne(page);
		await schubAusloesen(page, ZWEITE_WAHL, "CDU");
		const satz = await gesprochen(page);

		const saetze = satz.split(/[.!?](?:\s|$)/).filter((t) => t.trim());
		expect(saetze.length).toBeGreaterThan(1);
		expect(satz).toMatch(/Prozent|ausgezähl|Auszähl|Wahlbezirk/i);
		// Was gesprochen wird, endet auf einem ganzen Satz.
		expect(satz).toMatch(/[.!?…][»“”"'‘’]?$/);
	});

	test("schreibt beim Führungswechsel die Tatsache, nicht die Deutung", async ({
		page,
	}) => {
		await oeffne(page);
		await schubAusloesen(page, FUEHRUNGSWECHSEL, "GRÜNE");
		await gesprochen(page);

		const steht = await einblender(page).innerText();
		expect(steht).toContain("ausgezählt");
		expect(steht).not.toContain("zieht an");
		expect(steht).not.toContain("vorbei");
	});

	test("gibt dem Modell den Anlass mit, nicht nur den Einblender", async ({
		page,
	}) => {
		await oeffne(page);
		await schubAusloesen(page, DRITTE_WAHL, "CDU");
		await gesprochen(page);

		const { anfragen, unbekannte } = await gegenstelle();
		expect(unbekannte).toEqual([]);
		const moderationen = aufrufe(anfragen, "moderation");
		expect(moderationen).toHaveLength(1);
		const kontext = AUFNAHMEN.get(moderationen[0].schluessel)?.text ?? "";
		expect(kontext).toContain("erzählenswert:");
		expect(kontext).toContain("zieht an");
		expect(kontext).toContain("du liest es nicht vor");
	});

	test("fordert genau den moderierten Satz als Aufnahme an", async ({
		page,
	}) => {
		await oeffne(page);
		await schubAusloesen(page, ZWEITE_WAHL, "GRÜNE");
		const satz = await gesprochen(page);

		const { anfragen, unbekannte } = await gegenstelle();
		expect(unbekannte).toEqual([]);
		const moderationen = aufrufe(anfragen, "moderation");
		expect(moderationen).toHaveLength(1);
		expect(satz).toBe(
			moderationsSatz(AUFNAHMEN.get(moderationen[0].schluessel)),
		);

		const stimmen = aufrufe(anfragen, "stimme");
		expect(stimmen.length).toBeGreaterThan(0);
		expect(AUFNAHMEN.get(stimmen[0].schluessel)?.text).toBe(satz);
	});

	test("kostet drei Zuschauer derselben Leinwand einen Aufruf je Gegenstelle", async ({
		browser,
	}) => {
		const kontexte = await Promise.all([
			browser.newContext(),
			browser.newContext(),
			browser.newContext(),
		]);
		const seiten = await Promise.all(kontexte.map((k) => k.newPage()));
		for (const seite of seiten) await oeffne(seite);

		await Promise.all(
			seiten.map((seite) => schubAusloesen(seite, VIERTE_WAHL, "CDU")),
		);
		const gesagt: string[] = [];
		for (const seite of seiten) gesagt.push(await gesprochen(seite));
		expect(new Set(gesagt).size).toBe(1);

		const { anfragen, unbekannte } = await gegenstelle();
		expect(unbekannte).toEqual([]);
		expect(aufrufe(anfragen, "moderation")).toHaveLength(1);
		expect(
			new Set(aufrufe(anfragen, "stimme").map((a) => a.schluessel)).size,
		).toBe(1);

		for (const k of kontexte) await k.close();
	});

	/**
	 * Die Astro-Route und `server/ansage.ts` sind zwei Modulinstanzen mit je
	 * eigener Sperre für laufende Erzeugungen. Beginnt die Vorproduktion der
	 * Route, bevor die Datei da ist, und fragt der Browser zugleich den
	 * Ansageweg, wird dieselbe Aufnahme zweimal bezahlt.
	 */
	test.fixme("erzeugt dieselbe Aufnahme nur ein einziges Mal", async ({
		browser,
	}) => {
		const kontexte = await Promise.all([
			browser.newContext(),
			browser.newContext(),
			browser.newContext(),
		]);
		const seiten = await Promise.all(kontexte.map((k) => k.newPage()));
		for (const seite of seiten) await oeffne(seite);
		await Promise.all(
			seiten.map((seite) => schubAusloesen(seite, VIERTE_WAHL, "CDU")),
		);
		for (const seite of seiten) await gesprochen(seite);

		const { anfragen } = await gegenstelle();
		expect(aufrufe(anfragen, "stimme")).toHaveLength(1);

		for (const k of kontexte) await k.close();
	});
});
