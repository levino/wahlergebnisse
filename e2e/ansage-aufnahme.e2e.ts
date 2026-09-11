import { expect, test } from "@playwright/test";
import { erfundeneZahlen } from "../src/lib/moderation.ts";
import { lies, moderationsSatz } from "./aufnahmen.ts";
import {
	aufrufe,
	gegenstelle,
	gegenstelleZuruecksetzen,
	haken,
	schubAusloesen,
} from "./leinwand.ts";
import { STEUERUNG } from "./ports.ts";
import { warteAufDaten } from "./warten.ts";

/**
 * Der echte Schub des Abends: eine Schnellmeldung berührt mehrere Wahlen.
 * `/wahlabend-mehr` bringt Nordstemmen von 2 auf 9 von 23 Wahlbezirken.
 */
const ECHTER_SCHUB = "/hildesheim/2026/nordstemmen/dashboard?takt=300";
/** Ausgezählte Stände: Nur dort gibt es eine Spitze, die wechseln kann. */
const AUSGEZAEHLT = "/hildesheim/2021/nordstemmen/dashboard?takt=300";

const steuere = (was: "wahlabend" | "wahlabend-mehr" | "vorher") =>
	fetch(`${STEUERUNG}/${was}`);

/** Ein Führungswechsel, den kein Datenstand von selbst herbeiführt. */
const ERFUNDENE_ZAHL = ["ortsrat-klein-escherde", "ortsrat-mahlerten"];

const AUFNAHMEN = lies();

const oeffne = async (page: import("@playwright/test").Page, seite: string) => {
	await page.goto(seite);
	await expect(page.locator(".db-buehne")).toBeVisible();
	await page.getByRole("button", { name: "Pause" }).click();
};

const gesprochen = async (page: import("@playwright/test").Page) => {
	await expect
		.poll(async () => (await haken(page))?.grund, { timeout: 30_000 })
		.toBe("dienst");
	return (await haken(page))?.text ?? "";
};

test.describe("Ansage aus der Konserve", () => {
	test.beforeAll(async () => {
		test.setTimeout(240_000);
		await warteAufDaten("2026");
		await warteAufDaten("2021");
		await steuere("wahlabend");
	});

	test.afterAll(async () => {
		// Der Datenstand ist global; wer ihn umschaltet, stellt ihn zurück.
		await steuere("vorher");
	});

	test.beforeEach(async () => {
		await gegenstelleZuruecksetzen();
	});

	test("macht aus einer Schnellmeldung über mehrere Wahlen einen Satz", async ({
		page,
	}) => {
		await oeffne(page, ECHTER_SCHUB);
		const antwort = page.waitForResponse("**/api/ansage/moderation");
		await steuere("wahlabend-mehr");

		expect(await (await antwort).json()).toMatchObject({ quelle: "modell" });
		const gesagt = await gesprochen(page);

		const { anfragen, unbekannte } = await gegenstelle();
		expect(unbekannte).toEqual([]);
		// Ein Aufruf ans Textmodell für den ganzen Schub, nicht einer je Folie.
		const moderationen = aufrufe(anfragen, "moderation");
		expect(moderationen).toHaveLength(1);
		const aufnahme = AUFNAHMEN.get(moderationen[0].schluessel);
		expect(aufnahme?.text).toContain("Nordstemmen");

		expect(gesagt).toBe(moderationsSatz(aufnahme));
		const stimmen = aufrufe(anfragen, "stimme");
		expect(stimmen).toHaveLength(1);
		expect(AUFNAHMEN.get(stimmen[0].schluessel)?.text).toBe(gesagt);
	});

	test("spricht die feste Formulierung, wenn das Modell eine Zahl erfindet", async ({
		page,
	}) => {
		await oeffne(page, AUSGEZAEHLT);
		const antwort = page.waitForResponse("**/api/ansage/moderation");
		await schubAusloesen(page, ERFUNDENE_ZAHL, "GRÜNE");
		const daten = (await (await antwort).json()) as {
			quelle: string;
			grund?: string;
		};
		expect(daten.quelle).toBe("fest");
		expect(daten.grund).toContain("Zahlen ohne Deckung");

		const gesagt = await gesprochen(page);

		const { anfragen, unbekannte } = await gegenstelle();
		expect(unbekannte).toEqual([]);
		const moderationen = aufrufe(anfragen, "moderation");
		expect(moderationen).toHaveLength(1);
		const aufnahme = AUFNAHMEN.get(moderationen[0].schluessel);
		expect(
			erfundeneZahlen(moderationsSatz(aufnahme), aufnahme?.text ?? ""),
		).not.toEqual([]);

		expect(gesagt).not.toBe(moderationsSatz(aufnahme));
		expect(gesagt).toContain("Klein Escherde");
		const stimmen = aufrufe(anfragen, "stimme");
		expect(stimmen).toHaveLength(1);
		expect(AUFNAHMEN.get(stimmen[0].schluessel)?.text).toBe(gesagt);
	});

	test("kostet derselbe Schub beim zweiten Mal keinen Aufruf mehr", async ({
		page,
	}) => {
		await oeffne(page, AUSGEZAEHLT);
		await schubAusloesen(page, ["rat"], "CDU");
		const gesagt = await gesprochen(page);
		const erste = await gegenstelle();
		expect(aufrufe(erste.anfragen, "moderation")).toHaveLength(1);
		expect(aufrufe(erste.anfragen, "stimme")).toHaveLength(1);

		await page.reload();
		await expect(page.locator(".db-buehne")).toBeVisible();
		await page.getByRole("button", { name: "Pause" }).click();
		await schubAusloesen(page, ["rat"], "CDU");
		await expect
			.poll(async () => (await haken(page))?.text, { timeout: 30_000 })
			.toBe(gesagt);

		const zweite = await gegenstelle();
		expect(zweite.anfragen).toHaveLength(erste.anfragen.length);
	});
});
