/**
 * Die Stimmenauswahl der Leinwand.
 *
 * Playwright kann nicht hören. Geprüft wird deshalb das, was prüfbar ist: dass
 * die Auswahl die vorhandenen Stimmen anbietet, dass sie den Wunsch behält –
 * und dass die **richtige Stimme angefordert** würde. Dafür legt `lib/stimme.ts`
 * das Angeforderte in `window.__ansage` ab.
 *
 * Die Sprachausgabe des Browsers wird nachgestellt: Ein headless Chromium hat
 * keine einzige Stimme, und ein Test, der von den Stimmen des Testrechners
 * abhinge, sagte nichts.
 */
import { type Page, expect, test } from "@playwright/test";
import { warteAufDaten } from "./warten.ts";

const SEITE = "/hildesheim/2021/nordstemmen/dashboard?takt=300";

type Haken = {
	text: string;
	stimme: string;
	grund: "dienst" | "browser" | "wartet" | "keine-stimme";
};

/** Eine Sprachausgabe mit den Stimmen, die auf einem Mac stehen würden. */
const stimmenNachstellen = async (
	page: Page,
	stimmen: { name: string; lang: string }[],
) => {
	await page.addInitScript((liste) => {
		class Rede {
			text: string;
			voice: unknown = null;
			lang = "";
			rate = 1;
			pitch = 1;
			constructor(t: string) {
				this.text = t;
			}
		}
		const gesprochen: unknown[] = [];
		Object.defineProperty(window, "SpeechSynthesisUtterance", {
			configurable: true,
			value: Rede,
		});
		Object.defineProperty(window, "speechSynthesis", {
			configurable: true,
			value: {
				pending: false,
				getVoices: () =>
					liste.map((s) => ({ ...s, voiceURI: s.name, localService: true })),
				speak: (r: unknown) => gesprochen.push(r),
				cancel: () => {},
				addEventListener: () => {},
				removeEventListener: () => {},
			},
		});
	}, stimmen);
};

const haken = (page: Page) =>
	page.evaluate(
		() => (window as unknown as { __ansage?: Haken }).__ansage ?? null,
	);

const auswahl = (page: Page) => page.locator('[data-db="stimme"]');

test.describe("Stimme der Ansage", () => {
	test.beforeAll(async () => {
		test.setTimeout(240_000);
		await warteAufDaten("2021");
	});

	test("bietet die deutschen Stimmen an, beste zuerst", async ({ page }) => {
		await stimmenNachstellen(page, [
			{ name: "Anna (Kompakt)", lang: "de-DE" },
			{ name: "Anna (Premium)", lang: "de-DE" },
			{ name: "Samantha", lang: "en-US" },
		]);
		await page.goto(SEITE);
		await expect(page.locator(".db-buehne")).toBeVisible();

		// Englische Stimmen stehen nicht zur Wahl – sie läsen deutschen Text
		// englisch vor.
		await expect(auswahl(page).locator("option")).toHaveText([
			"Anna (Premium)",
			"Anna (Kompakt)",
		]);
		// Die geladene Fassung ist vorausgewählt, nicht die Sparfassung.
		await expect(auswahl(page)).toHaveValue("browser:Anna (Premium)");
	});

	test("behält den Wunsch und fordert genau diese Stimme an", async ({
		page,
	}) => {
		await stimmenNachstellen(page, [
			{ name: "Anna (Premium)", lang: "de-DE" },
			{ name: "Petra (Erweitert)", lang: "de-DE" },
		]);
		await page.goto(SEITE);
		await auswahl(page).selectOption("browser:Petra (Erweitert)");

		// Gespeichert wie Ton und Ansage – der Abend fängt nicht bei null an.
		expect(
			await page.evaluate(() => localStorage.getItem("wahlen:stimme")),
		).toBe("browser:Petra (Erweitert)");
		// Und die Umstellung spricht gleich zur Probe: So sucht man im Saal aus.
		expect(await haken(page)).toMatchObject({
			stimme: "Petra (Erweitert)",
			grund: "browser",
		});

		// Der Wunsch überlebt das Neuladen.
		await page.reload();
		await expect(auswahl(page)).toHaveValue("browser:Petra (Erweitert)");
		await page.getByRole("button", { name: "Probe" }).click();
		expect(await haken(page)).toMatchObject({ stimme: "Petra (Erweitert)" });
	});

	test("bleibt still, wenn es keine deutsche Stimme gibt", async ({ page }) => {
		// Lieber nichts als eine englische Stimme, die „Ortsratswahl Rössing"
		// vorliest – und dann muss dastehen, warum es still ist.
		await stimmenNachstellen(page, [{ name: "Samantha", lang: "en-US" }]);
		await page.goto(SEITE);
		await page.getByRole("button", { name: "Probe" }).click();
		expect(await haken(page)).toMatchObject({
			stimme: "",
			grund: "keine-stimme",
		});
		await expect(page.locator("[data-stimmhinweis]")).toContainText(
			"Keine deutsche Stimme",
		);
	});

	test("merkt, wenn der Ansagedienst mitten am Abend wegfällt", async ({
		page,
	}) => {
		// Ein Schlüssel kann ablaufen oder ein Kontingent auslaufen, während
		// die Leinwand läuft. Der Server riegelt dann ab (503); die Leiste darf
		// nicht weiter behaupten, es spräche die gute Stimme.
		await stimmenNachstellen(page, [{ name: "Anna (Premium)", lang: "de-DE" }]);
		await page.route("**/api/ansage/stand*", (route) =>
			route.fulfill({
				json: {
					verfuegbar: true,
					modell: "gpt-4o-mini-tts",
					standard: "sage",
					stimmen: [{ id: "sage", beschreibung: "Sage – gewählt" }],
				},
			}),
		);
		await page.route("**/api/ansage?*", (route) =>
			route.fulfill({ status: 503, json: { fehler: "kein Ansagedienst" } }),
		);

		await page.goto(SEITE);
		await expect(auswahl(page)).toHaveValue("dienst:sage");

		await page.getByRole("button", { name: "Probe" }).click();

		// Ohne Neuladen: Die Auswahl steht auf der Browserstimme, die Leiste
		// sagt warum, und gesprochen wird trotzdem.
		await expect(auswahl(page)).toHaveValue("browser:Anna (Premium)");
		await expect(page.locator("[data-stimmhinweis]")).toContainText(
			"antwortet nicht mehr",
		);
		expect(await haken(page)).toMatchObject({
			stimme: "Anna (Premium)",
			grund: "browser",
		});
	});

	test("fragt den Ansagedienst – und spricht selbst, wenn er nicht antwortet", async ({
		page,
	}) => {
		// Der Kern der Zusicherung: Ein Wahlabend hängt an keiner fremden
		// Verfügbarkeit. Der Dienst wird gefragt, fällt aus, und der Satz wird
		// trotzdem gesagt.
		await stimmenNachstellen(page, [{ name: "Anna (Premium)", lang: "de-DE" }]);
		await page.route("**/api/ansage/stand*", (route) =>
			route.fulfill({
				json: {
					verfuegbar: true,
					modell: "gpt-4o-mini-tts",
					standard: "sage",
					stimmen: [{ id: "sage", beschreibung: "Sage – gewählt" }],
				},
			}),
		);
		const gefragt: string[] = [];
		await page.route("**/api/ansage?*", (route) => {
			gefragt.push(route.request().url());
			return route.abort();
		});

		await page.goto(SEITE);
		// Die Dienststimme steht vorn und ist vorausgewählt.
		await expect(auswahl(page)).toHaveValue("dienst:sage");
		await expect(page.locator("[data-stimmhinweis]")).toContainText(
			"KI-erzeugte Stimme",
		);

		await page.getByRole("button", { name: "Probe" }).click();
		await expect
			.poll(() => gefragt.length, { timeout: 10_000 })
			.toBeGreaterThan(0);
		const url = new URL(gefragt[0]);
		expect(url.searchParams.get("stimme")).toBe("sage");
		expect(url.searchParams.get("behoerde")).toBe("03254026");
		expect(url.searchParams.get("text")).toContain("Rössing");

		// Und danach spricht der Browser – ohne Fehler auf der Leinwand.
		await expect
			.poll(async () => (await haken(page))?.grund, { timeout: 10_000 })
			.toBe("browser");
		expect(await haken(page)).toMatchObject({ stimme: "Anna (Premium)" });
	});
});
