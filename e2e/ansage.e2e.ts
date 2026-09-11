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
	grund:
		| "dienst"
		| "browser"
		| "wartet"
		| "keine-stimme"
		| "kein-dienst"
		| "gesperrt";
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

	test("sagt, solange der Ton gesperrt ist – und gibt ihn an der ersten Geste frei", async ({
		page,
	}) => {
		// Keine Seite darf von sich aus Ton machen; erst eine Geste hebt die
		// Sperre. Das ist der Normalzustand jeder frisch geladenen Seite – am
		// Wahlabend also nach jedem Neuladen der Leinwand. Bisher hing die
		// Freigabe daran, dass jemand zufällig die Glocke trifft.
		await stimmenNachstellen(page, [{ name: "Anna (Premium)", lang: "de-DE" }]);
		const gefragt: string[] = [];
		await page.route("**/api/ansage?*", (route) => {
			gefragt.push(route.request().url());
			return route.abort();
		});
		await page.goto(SEITE);
		await expect(page.locator(".db-buehne")).toBeVisible();
		await expect(page.locator("[data-stimmhinweis]")).toContainText(
			"Ton noch gesperrt",
		);

		// Eine echte Meldung auslösen – ohne Geste. `evaluate` ist keine.
		const meldungAusloesen = () =>
			page.evaluate(() => {
				const folie = document.querySelector<HTMLElement>(
					'.db-folie[data-marke="ortsrat-roessing"]',
				);
				if (!folie) throw new Error("Folie fehlt");
				folie.dataset.anz = String(Number(folie.dataset.anz ?? 0) + 1);
				document.dispatchEvent(new Event("astro:page-load"));
			});
		await meldungAusloesen();
		await meldungAusloesen();

		// Nichts angefordert, nichts gesprochen – ein Aufruf an den
		// Ansagedienst für einen Satz, den niemand hören kann, wäre bezahlt
		// und verloren.
		expect(gefragt).toEqual([]);
		expect((await haken(page))?.grund ?? "gesperrt").toBe("gesperrt");

		// Irgendeine Geste gibt frei – hier die, die im Saal ohnehin fällt.
		await page.getByRole("button", { name: "Pause" }).click();
		await expect(page.locator("[data-stimmhinweis]")).not.toContainText(
			"Ton noch gesperrt",
		);
	});

	test("die erste Geste darf nicht an der Hinweiszeile verlorengehen", async ({
		page,
	}) => {
		// Der Hinweis wechselt bei der ersten Geste von einer auf mehrere
		// Zeilen. Lag er im Layout, zog er die Bedienleiste zwischen
		// pointerdown und pointerup nach oben – der Browser feuerte dann gar
		// kein `click`, und ausgerechnet der erste Klick im Saal ging ins
		// Leere. Hier wird genau dieser Klick geprüft: der allererste, und
		// zwar auf den Knopf, der etwas tun soll.
		await stimmenNachstellen(page, [{ name: "Anna (Premium)", lang: "de-DE" }]);
		await page.goto(SEITE);
		await expect(page.locator("[data-stimmhinweis]")).toContainText(
			"Ton noch gesperrt",
		);
		await page.getByRole("button", { name: "Probe" }).click();
		// Angekommen: Der Knopf hat gewirkt, nicht nur der Ton wurde frei.
		expect(await haken(page)).not.toBeNull();
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
			"keine Ansage",
			"Anna (Premium)",
			"Anna (Kompakt)",
		]);
		// Ohne Ansagedienst und ohne eigene Wahl spricht nichts – das Feld
		// behauptet es auch nicht. Die geladene Fassung steht aber vor der
		// Sparfassung, für den, der wählt.
		await expect(auswahl(page)).toHaveValue("");
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
			grund: "kein-dienst",
		});
		// Und der Hinweis rät nicht zu einer Browserstimme, die es hier nicht
		// gibt, sondern sagt, wie man eine bekommt.
		const hinweis = page.locator("[data-stimmhinweis]");
		await expect(hinweis).toContainText("keine deutsche Stimme");
		await expect(hinweis).toContainText("Stimmen verwalten");
	});

	test("bleibt still, wenn der Ansagedienst mitten am Abend wegfällt", async ({
		page,
	}) => {
		// Ein Schlüssel kann ablaufen oder ein Kontingent auslaufen, während die
		// Leinwand läuft. Dann springt **nicht** die Browserstimme ein: Der
		// Betreiber hat sie gehört und abgelehnt, und mitten am Abend die
		// Tonlage zu wechseln wäre schlechter als Stille. Die Einblender laufen
		// unabhängig weiter – die Nachricht geht nie verloren, nur der Ton.
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

		// Nichts gesprochen – und die Leiste sagt, warum.
		await expect
			.poll(async () => (await haken(page))?.grund, { timeout: 10_000 })
			.toBe("kein-dienst");
		expect(await haken(page)).toMatchObject({ stimme: "" });
		await expect(page.locator("[data-stimmhinweis]")).toContainText(
			"keine Ansage",
		);
		// Das Feld behauptet nicht, es spräche eine Stimme.
		await expect(auswahl(page)).toHaveValue("");
	});

	test("spricht die Browserstimme, wenn sie ausdrücklich gewählt ist", async ({
		page,
	}) => {
		// Sie ist kein Rückfall mehr, aber weiterhin eine Wahl – wer sie will,
		// bekommt sie.
		await stimmenNachstellen(page, [{ name: "Anna (Premium)", lang: "de-DE" }]);
		await page.goto(SEITE);
		await auswahl(page).selectOption("browser:Anna (Premium)");
		expect(await haken(page)).toMatchObject({
			stimme: "Anna (Premium)",
			grund: "browser",
		});
		await expect(page.locator("[data-stimmhinweis]")).toContainText(
			"Ihre Wahl",
		);
	});

	test("fragt den Ansagedienst – und bleibt still, wenn er nicht antwortet", async ({
		page,
	}) => {
		// Der Dienst wird mit der richtigen Stimme gefragt. Antwortet er nicht,
		// bleibt es still statt in einer abgelehnten Stimme zu sprechen – die
		// Einblender tragen die Nachricht ohnehin.
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

		await page.getByRole("button", { name: "Probe" }).click();
		// Erst nach der Geste: der Hinweis auf die erzeugte Stimme, den der
		// Anbieter verlangt.
		await expect(page.locator("[data-stimmhinweis]")).toContainText(
			"KI-erzeugte Stimme",
		);
		await expect
			.poll(() => gefragt.length, { timeout: 10_000 })
			.toBeGreaterThan(0);
		const url = new URL(gefragt[0]);
		expect(url.searchParams.get("stimme")).toBe("sage");
		expect(url.searchParams.get("behoerde")).toBe("03254026");
		expect(url.searchParams.get("text")).toContain("Rössing");

		// Und danach bleibt es still – ohne Fehler auf der Leinwand.
		await expect
			.poll(async () => (await haken(page))?.grund, { timeout: 10_000 })
			.toBe("kein-dienst");
	});
});
