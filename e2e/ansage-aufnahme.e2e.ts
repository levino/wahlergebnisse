/**
 * Der ganze Weg der Ansage – Browser, Server, Gegenstelle.
 *
 * Die bisherigen Leinwand-Tests hörten an der Servergrenze auf: Sie brachen
 * `/api/ansage` ab und legten dem Browser eine erfundene Antwort auf
 * `/api/ansage/moderation` hin. Damit blieb genau der Teil ungeprüft, um den
 * es geht – dass der Server aus einem Schub **einen** Satz macht und ihn auch
 * sprechen lässt. Denn beide Aufrufe gehen vom Server hinaus, und dorthin
 * kommt `page.route` nicht.
 *
 * Hier steht deshalb die echte Naht: Der Server ruft seine Gegenstelle wirklich
 * auf, nur liegt sie auf `127.0.0.1` und antwortet aus der Konserve
 * (`e2e/mock-openai.ts`). Kennt sie eine Anfrage nicht, scheitert sie laut –
 * ein Test, der sich seine Antwort selbst ausdenkt, wird nie rot.
 *
 * Neu aufnehmen: `OPENAI_API_KEY=… npm run ansage-aufzeichnen`.
 */
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

/**
 * Sechs Folien auf einen Schlag – vier stehen als Einblender da, zwei zählt
 * die Leinwand nur noch. Genau der Fall, über den sich der Betreiber
 * beschwert hat: „und 2 weitere Meldungen" ist keine Ansage.
 */
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
	// Der Server meldet seinen Dienst als vorhanden – sonst prüfte alles
	// Weitere nur den Rückfall.
	await expect(page.locator('[data-db="stimme"]')).toHaveValue("dienst:sage");
	// Vor der ersten Geste lässt kein Browser Ton zu; im Saal fällt sie
	// ohnehin, hier ist es der Pausenknopf.
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

		// Auf der Leinwand steht die Zeile, die der Betreiber nicht hören will.
		await expect(page.locator("[data-meldungen]")).toContainText(
			"und 2 weitere Meldungen",
		);

		await expect
			.poll(async () => (await haken(page))?.grund, { timeout: 20_000 })
			.toBe("dienst");

		const { anfragen, unbekannte } = await gegenstelle();
		expect(unbekannte).toEqual([]);
		// **Ein** Aufruf ans Textmodell für sechs Meldungen, nicht sechs.
		const moderationen = aufrufe(anfragen, "moderation");
		expect(moderationen).toHaveLength(1);
		const aufnahme = AUFNAHMEN.get(moderationen[0].schluessel);
		expect(aufnahme?.text).toContain("Ortsratswahl Heyersum");

		// Gesprochen wird, was das Modell formuliert hat – und dafür ist eine
		// Aufnahme angefordert worden.
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
		// Der wichtigste Riegel des Abends: Was über die Anlage gesagt wird,
		// muss in den Zahlen stehen. Die Aufnahme dazu nennt eine Zahl, die im
		// Kontext nicht vorkommt.
		await oeffne(page);
		const antwort = page.waitForResponse("**/api/ansage/moderation");
		await schubAusloesen(page, ZWEITER_SCHUB, "GRÜNE");
		// Und die Antwort sagt, woran es lag. Ohne das sah jeder Rückfall aus
		// wie jeder andere – daran hat der Betreiber einen Abend gesucht.
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
		// Die Aufnahme taugt wirklich nichts – nicht bloß der Test behauptet es.
		expect(
			erfundeneZahlen(moderationsSatz(aufnahme), aufnahme?.text ?? ""),
		).not.toEqual([]);

		// Und trotzdem wird gesprochen: die feste Formulierung, über den Dienst.
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
		// Die Generalprobe spielt denselben Abend wieder und wieder. Der
		// Zwischenspeicher liegt über dem Schub und nicht über der Uhrzeit –
		// sonst zahlte jeder Durchlauf erneut.
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
