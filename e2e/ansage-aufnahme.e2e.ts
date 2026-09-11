import { expect, test } from "@playwright/test";
import { erfundeneZahlen } from "../src/lib/moderation.ts";
import { lies, moderationsSatz } from "./aufnahmen.ts";
import {
	aufrufe,
	gegenstelle,
	gegenstelleZuruecksetzen,
	haken,
	schubAusloesen,
	stimmenNachstellen,
} from "./leinwand.ts";
import { warteAufDaten } from "./warten.ts";

const SEITE = "/hildesheim/2021/nordstemmen/dashboard?takt=300";

const SCHUB = [
	"rat",
	"ortsrat-adensen",
	"ortsrat-barnten",
	"ortsrat-burgstemmen",
	"ortsrat-gross-escherde",
	"ortsrat-heyersum",
];

/** Ein anderer Schub – und damit eine andere Aufnahme. */
const ZWEITER_SCHUB = ["ortsrat-klein-escherde", "ortsrat-mahlerten"];

const AUFNAHMEN = lies();

const oeffne = async (page: import("@playwright/test").Page) => {
	await stimmenNachstellen(page, [{ name: "Anna (Premium)", lang: "de-DE" }]);
	await page.goto(SEITE);
	await expect(page.locator(".db-buehne")).toBeVisible();
	await expect(page.locator('[data-db="stimme"]')).toHaveValue("dienst:sage");
	await page.getByRole("button", { name: "Pause" }).click();
};

test.describe("Ansage aus der Konserve", () => {
	test.beforeAll(async () => {
		test.setTimeout(240_000);
		await warteAufDaten("2021");
	});

	test.beforeEach(async () => {
		await gegenstelleZuruecksetzen();
	});

	test("macht aus sechs Meldungen einen gesprochenen Satz", async ({
		page,
	}) => {
		await oeffne(page);
		const antwort = page.waitForResponse("**/api/ansage/moderation");
		await schubAusloesen(page, SCHUB, "CDU");
		expect(await (await antwort).json()).toMatchObject({ quelle: "modell" });

		await expect(page.locator("[data-meldungen]")).toContainText(
			"und 2 weitere Meldungen",
		);

		await expect
			.poll(async () => (await haken(page))?.grund, { timeout: 20_000 })
			.toBe("dienst");

		const { anfragen, unbekannte } = await gegenstelle();
		expect(unbekannte).toEqual([]);
		const moderationen = aufrufe(anfragen, "moderation");
		expect(moderationen).toHaveLength(1);
		const aufnahme = AUFNAHMEN.get(moderationen[0].schluessel);
		expect(aufnahme?.text).toContain("Ortsratswahl Heyersum");

		const gesagt = (await haken(page))?.text;
		expect(gesagt).toBe(moderationsSatz(aufnahme));
		expect(gesagt).not.toContain("zieht an");
		const stimmen = aufrufe(anfragen, "stimme");
		expect(stimmen).toHaveLength(1);
		expect(AUFNAHMEN.get(stimmen[0].schluessel)?.text).toBe(gesagt);
	});

	test("spricht die feste Formulierung, wenn das Modell eine Zahl erfindet", async ({
		page,
	}) => {
		await oeffne(page);
		const antwort = page.waitForResponse("**/api/ansage/moderation");
		await schubAusloesen(page, ZWEITER_SCHUB, "GRÜNE");
		const daten = (await (await antwort).json()) as {
			quelle: string;
			grund?: string;
		};
		expect(daten.quelle).toBe("fest");
		expect(daten.grund).toContain("Zahlen ohne Deckung");

		await expect
			.poll(async () => (await haken(page))?.grund, { timeout: 20_000 })
			.toBe("dienst");

		const { anfragen, unbekannte } = await gegenstelle();
		expect(unbekannte).toEqual([]);
		const moderationen = aufrufe(anfragen, "moderation");
		expect(moderationen).toHaveLength(1);
		const aufnahme = AUFNAHMEN.get(moderationen[0].schluessel);
		expect(
			erfundeneZahlen(moderationsSatz(aufnahme), aufnahme?.text ?? ""),
		).not.toEqual([]);

		const gesagt = (await haken(page))?.text ?? "";
		expect(gesagt).not.toBe(moderationsSatz(aufnahme));
		expect(gesagt).toContain("Ortsratswahl Klein Escherde");
		const stimmen = aufrufe(anfragen, "stimme");
		expect(stimmen).toHaveLength(1);
		expect(AUFNAHMEN.get(stimmen[0].schluessel)?.text).toBe(gesagt);
	});

	test("kostet derselbe Schub beim zweiten Mal keinen Aufruf mehr", async ({
		page,
	}) => {
		await oeffne(page);
		await schubAusloesen(page, SCHUB, "CDU");
		await expect
			.poll(async () => (await haken(page))?.grund, { timeout: 20_000 })
			.toBe("dienst");
		const erste = await gegenstelle();
		expect(aufrufe(erste.anfragen, "moderation")).toHaveLength(1);
		expect(aufrufe(erste.anfragen, "stimme")).toHaveLength(1);
		const gesagt = (await haken(page))?.text;

		await page.reload();
		await expect(page.locator(".db-buehne")).toBeVisible();
		await page.getByRole("button", { name: "Pause" }).click();
		await schubAusloesen(page, SCHUB, "CDU");
		await expect
			.poll(async () => (await haken(page))?.text, { timeout: 20_000 })
			.toBe(gesagt);

		const zweite = await gegenstelle();
		expect(zweite.anfragen).toHaveLength(erste.anfragen.length);
	});
});
