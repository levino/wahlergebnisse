import { type Page, expect, test } from "@playwright/test";
import { haken, stimmenNachstellen } from "./leinwand.ts";
import { warteAufDaten } from "./warten.ts";

const SEITE = "/hildesheim/2021/nordstemmen/dashboard?takt=300";

const auswahl = (page: Page) => page.locator('[data-db="stimme"]');

test.describe("Stimme der Ansage", () => {
	test.beforeAll(async () => {
		test.setTimeout(240_000);
		await warteAufDaten("2021");
	});

	test.beforeEach(async ({ page }) => {
		await page.route("**/api/ansage/stand*", (route) =>
			route.fulfill({
				json: {
					verfuegbar: false,
					modell: "gpt-4o-mini-tts",
					standard: "sage",
					stimmen: [{ id: "sage", beschreibung: "Sage – gewählt" }],
				},
			}),
		);
	});

	test("sagt, solange der Ton gesperrt ist – und gibt ihn an der ersten Geste frei", async ({
		page,
	}) => {
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

		expect(gefragt).toEqual([]);
		expect((await haken(page))?.grund ?? "gesperrt").toBe("gesperrt");

		await page.getByRole("button", { name: "Pause" }).click();
		await expect(page.locator("[data-stimmhinweis]")).not.toContainText(
			"Ton noch gesperrt",
		);
	});

	test("die erste Geste darf nicht an der Hinweiszeile verlorengehen", async ({
		page,
	}) => {
		await stimmenNachstellen(page, [{ name: "Anna (Premium)", lang: "de-DE" }]);
		await page.goto(SEITE);
		await expect(page.locator("[data-stimmhinweis]")).toContainText(
			"Ton noch gesperrt",
		);
		await page.getByRole("button", { name: "Probe" }).click();
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

		await expect(auswahl(page).locator("option")).toHaveText([
			"keine Ansage",
			"Anna (Premium)",
			"Anna (Kompakt)",
		]);
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

		expect(
			await page.evaluate(() => localStorage.getItem("wahlen:stimme")),
		).toBe("browser:Petra (Erweitert)");
		expect(await haken(page)).toMatchObject({
			stimme: "Petra (Erweitert)",
			grund: "browser",
		});

		await page.reload();
		await expect(auswahl(page)).toHaveValue("browser:Petra (Erweitert)");
		await page.getByRole("button", { name: "Probe" }).click();
		expect(await haken(page)).toMatchObject({ stimme: "Petra (Erweitert)" });
	});

	test("bleibt still, wenn es keine deutsche Stimme gibt", async ({ page }) => {
		await stimmenNachstellen(page, [{ name: "Samantha", lang: "en-US" }]);
		await page.goto(SEITE);
		await page.getByRole("button", { name: "Probe" }).click();
		expect(await haken(page)).toMatchObject({
			stimme: "",
			grund: "kein-dienst",
		});
		const hinweis = page.locator("[data-stimmhinweis]");
		await expect(hinweis).toContainText("keine deutsche Stimme");
		await expect(hinweis).toContainText("Stimmen verwalten");
	});

	test("bleibt still, wenn der Ansagedienst mitten am Abend wegfällt", async ({
		page,
	}) => {
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

		await expect
			.poll(async () => (await haken(page))?.grund, { timeout: 10_000 })
			.toBe("kein-dienst");
		expect(await haken(page)).toMatchObject({ stimme: "" });
		await expect(page.locator("[data-stimmhinweis]")).toContainText(
			"keine Ansage",
		);
		await expect(auswahl(page)).toHaveValue("");
	});

	test("spricht die Browserstimme, wenn sie ausdrücklich gewählt ist", async ({
		page,
	}) => {
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
		await expect(auswahl(page)).toHaveValue("dienst:sage");

		await page.getByRole("button", { name: "Probe" }).click();
		await expect(page.locator("[data-stimmhinweis]")).toBeHidden();
		await expect
			.poll(() => gefragt.length, { timeout: 10_000 })
			.toBeGreaterThan(0);
		const url = new URL(gefragt[0]);
		expect(url.searchParams.get("stimme")).toBe("sage");
		expect(url.searchParams.get("behoerde")).toBe("03254026");
		expect(url.searchParams.get("text")).toContain("Rössing");

		await expect
			.poll(async () => (await haken(page))?.grund, { timeout: 10_000 })
			.toBe("kein-dienst");
	});

	test("lässt den ganzen Schub formulieren und sagt, was zurückkommt", async ({
		page,
	}) => {
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
		const schuebe: Array<Record<string, unknown>> = [];
		await page.route("**/api/ansage/moderation", (route) => {
			schuebe.push(route.request().postDataJSON());
			return route.fulfill({
				json: {
					satz: "Da kommen neue Zahlen rein – Rössing ist durch.",
					quelle: "modell",
				},
			});
		});
		const gefragt: string[] = [];
		await page.route("**/api/ansage?*", (route) => {
			gefragt.push(route.request().url());
			return route.abort();
		});

		await page.goto(SEITE);
		await expect(page.locator(".db-buehne")).toBeVisible();
		await page.getByRole("button", { name: "Pause" }).click();
		await page.getByLabel("Meine Partei").selectOption({ label: "CDU" });

		const setze = (staende: string) =>
			page.evaluate((s) => {
				const folie = document.querySelector<HTMLElement>(
					'.db-folie[data-marke="ortsrat-roessing"]',
				);
				if (!folie) throw new Error("Folie fehlt");
				folie.dataset.parteien = s;
				document.dispatchEvent(new Event("astro:page-load"));
			}, staende);
		await setze("cdu:2:30.0:-|spd:1:34.0:-");
		await expect.poll(() => gefragt.length, { timeout: 10_000 }).toBe(1);
		schuebe.length = 0;
		gefragt.length = 0;
		await setze("cdu:1:34.0:-|spd:2:30.0:-");

		await expect.poll(() => schuebe.length, { timeout: 10_000 }).toBe(1);
		const schub = schuebe[0] as {
			behoerde: string;
			partei: string;
			fest: string;
			wahlen: Array<{
				marke: string;
				vorher: { parteien: Array<{ key: string; platz: number }> };
			}>;
		};
		expect(schub.behoerde).toBe("03254026");
		expect(schub.partei).toBe("CDU");
		expect(schub.fest).toContain("CDU liegt vorn");
		expect(schub.wahlen[0].marke).toBe("ortsrat-roessing");
		expect(
			schub.wahlen[0].vorher.parteien.find((p) => p.key === "cdu")?.platz,
		).toBe(2);

		await expect.poll(() => gefragt.length, { timeout: 10_000 }).toBe(1);
		expect(new URL(gefragt[0]).searchParams.get("text")).toBe(
			"Da kommen neue Zahlen rein – Rössing ist durch.",
		);
	});

	test("sagt die feste Formulierung, wenn kein Satz zurückkommt", async ({
		page,
	}) => {
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
		await page.route("**/api/ansage/moderation", (route) => route.abort());
		const gefragt: string[] = [];
		await page.route("**/api/ansage?*", (route) => {
			gefragt.push(route.request().url());
			return route.abort();
		});

		await page.goto(SEITE);
		await expect(page.locator(".db-buehne")).toBeVisible();
		await page.getByRole("button", { name: "Pause" }).click();
		await page.getByLabel("Meine Partei").selectOption({ label: "CDU" });
		const setze = (staende: string) =>
			page.evaluate((s) => {
				const folie = document.querySelector<HTMLElement>(
					'.db-folie[data-marke="ortsrat-roessing"]',
				);
				if (!folie) throw new Error("Folie fehlt");
				folie.dataset.parteien = s;
				document.dispatchEvent(new Event("astro:page-load"));
			}, staende);
		await setze("cdu:2:30.0:-|spd:1:34.0:-");
		await expect.poll(() => gefragt.length, { timeout: 10_000 }).toBe(1);
		gefragt.length = 0;
		await setze("cdu:1:34.0:-|spd:2:30.0:-");

		await expect.poll(() => gefragt.length, { timeout: 10_000 }).toBe(1);
		expect(new URL(gefragt[0]).searchParams.get("text")).toContain(
			"CDU liegt vorn",
		);
	});
});

test("Stimmhinweis und Tastenhilfe stehen nie übereinander", async ({
	page,
}) => {
	await page.goto("/hildesheim/2021/nordstemmen/dashboard");
	const hinweis = page.locator(".db-stimmhinweis");
	const hilfe = page.locator(".db-hilfe");
	await expect(page.locator(".db-buehne")).toBeVisible();

	await page.evaluate(() => {
		const el = document.querySelector<HTMLElement>("[data-stimmhinweis]");
		if (!el) throw new Error("Stimmhinweis fehlt");
		el.textContent = "Ton noch gesperrt – einmal klicken";
		el.hidden = false;
	});
	await expect(hinweis).toBeVisible();
	await expect(hilfe).toBeHidden();

	await page.evaluate(() => {
		const el = document.querySelector<HTMLElement>("[data-stimmhinweis]");
		if (el) el.hidden = true;
	});
	await expect(hilfe).toBeVisible();
});
