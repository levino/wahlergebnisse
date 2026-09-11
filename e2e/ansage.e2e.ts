import { expect, test } from "@playwright/test";
import { haken } from "./leinwand.ts";
import { warteAufDaten } from "./warten.ts";

const SEITE = "/hildesheim/2021/nordstemmen/dashboard?takt=300";

const OHNE_DIENST = { verfuegbar: false, modell: "gpt-4o-mini-tts" };
const MIT_DIENST = { verfuegbar: true, modell: "gpt-4o-mini-tts" };

const hinweis = (page: import("@playwright/test").Page) =>
	page.locator("[data-stimmhinweis]");

test.describe("Stimme der Ansage", () => {
	test.beforeAll(async () => {
		test.setTimeout(240_000);
		await warteAufDaten("2021");
	});

	test.beforeEach(async ({ page }) => {
		await page.route("**/api/ansage/stand*", (route) =>
			route.fulfill({ json: OHNE_DIENST }),
		);
	});

	test("sagt, solange der Ton gesperrt ist – und gibt ihn an der ersten Geste frei", async ({
		page,
	}) => {
		const gefragt: string[] = [];
		await page.route("**/api/ansage?*", (route) => {
			gefragt.push(route.request().url());
			return route.abort();
		});
		await page.goto(SEITE);
		await expect(page.locator(".db-buehne")).toBeVisible();
		await expect(hinweis(page)).toContainText("Ton noch gesperrt");

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
		await expect(hinweis(page)).not.toContainText("Ton noch gesperrt");
	});

	test("die erste Geste darf nicht an der Hinweiszeile verlorengehen", async ({
		page,
	}) => {
		await page.goto(SEITE);
		await expect(hinweis(page)).toContainText("Ton noch gesperrt");
		await page.getByRole("button", { name: "Probe" }).click();
		expect(await haken(page)).not.toBeNull();
	});

	test("bleibt still, wenn es für die Wahlleitung keinen Dienst gibt", async ({
		page,
	}) => {
		await page.goto(SEITE);
		await page.getByRole("button", { name: "Probe" }).click();
		await expect
			.poll(async () => (await haken(page))?.grund, { timeout: 10_000 })
			.toBe("kein-dienst");
		await expect(hinweis(page)).toContainText("keine Ansage");
		await expect(hinweis(page)).toContainText("Einblender laufen weiter");
	});

	test("nennt die Stimme als erzeugt, solange die Ansage läuft", async ({
		page,
	}) => {
		await page.route("**/api/ansage/stand*", (route) =>
			route.fulfill({ json: MIT_DIENST }),
		);
		await page.goto(SEITE);
		await expect(page.locator(".db-buehne")).toBeVisible();
		await page.getByRole("button", { name: "Pause" }).click();
		await expect(page.locator("[data-stimmnotiz]")).toContainText(
			"synthetische Stimme",
		);
		// Die Auflage des Anbieters verdrängt die Tastenhilfe nicht.
		await expect(page.locator(".db-hilfe")).toBeVisible();
		await expect(page.locator(".db-hilfe")).toContainText("Leertaste: Pause");
		await expect(hinweis(page)).toBeHidden();
	});

	test("nennt sie nicht, wo gar keine Ansage läuft", async ({ page }) => {
		await page.goto(SEITE);
		await expect(page.locator(".db-buehne")).toBeVisible();
		await page.getByRole("button", { name: "Pause" }).click();
		await expect(page.locator("[data-stimmnotiz]")).toBeHidden();
	});

	test("bleibt still, wenn der Ansagedienst mitten am Abend wegfällt", async ({
		page,
	}) => {
		await page.route("**/api/ansage/stand*", (route) =>
			route.fulfill({ json: MIT_DIENST }),
		);
		await page.route("**/api/ansage?*", (route) =>
			route.fulfill({
				status: 503,
				json: { fehler: "kein Ansagedienst", dienst: false },
			}),
		);

		await page.goto(SEITE);
		await page.getByRole("button", { name: "Probe" }).click();

		await expect
			.poll(async () => (await haken(page))?.grund, { timeout: 10_000 })
			.toBe("kein-dienst");
		await expect(hinweis(page)).toContainText("antwortet nicht");
	});

	test("eine langsame Aufnahme schaltet den Dienst nicht ab", async ({
		page,
	}) => {
		await page.route("**/api/ansage/stand*", (route) =>
			route.fulfill({ json: MIT_DIENST }),
		);
		let gefragt = 0;
		await page.route("**/api/ansage?*", (route) => {
			gefragt++;
			return route.fulfill({
				status: 503,
				json: { fehler: "Aufnahme nicht binnen 10000 ms fertig", dienst: true },
			});
		});

		await page.goto(SEITE);
		await expect(page.locator(".db-buehne")).toBeVisible();
		await page.getByRole("button", { name: "Probe" }).click();
		await expect.poll(() => gefragt, { timeout: 10_000 }).toBe(1);

		await page.getByRole("button", { name: "Probe" }).click();
		await expect.poll(() => gefragt, { timeout: 10_000 }).toBe(2);
		// Der Dienst gilt weiter als vorhanden: keine Fehlerzeile, die Notiz steht.
		await expect(hinweis(page)).toBeHidden();
		await expect(page.locator("[data-stimmnotiz]")).toContainText(
			"synthetische Stimme",
		);
	});

	test("fragt eine Adresse ohne Stimme – für alle Zuschauer dieselbe", async ({
		page,
	}) => {
		await page.route("**/api/ansage/stand*", (route) =>
			route.fulfill({ json: MIT_DIENST }),
		);
		const gefragt: string[] = [];
		await page.route("**/api/ansage?*", (route) => {
			gefragt.push(route.request().url());
			return route.abort();
		});

		await page.goto(SEITE);
		await page.getByRole("button", { name: "Probe" }).click();
		await expect
			.poll(() => gefragt.length, { timeout: 10_000 })
			.toBeGreaterThan(0);

		const url = new URL(gefragt[0]);
		expect(url.searchParams.get("stimme")).toBeNull();
		expect(url.searchParams.get("behoerde")).toBe("03254026");
		expect(url.searchParams.get("text")).toContain("Rössing");
	});

	test("lässt den ganzen Schub formulieren und sagt, was zurückkommt", async ({
		page,
	}) => {
		await page.route("**/api/ansage/stand*", (route) =>
			route.fulfill({ json: MIT_DIENST }),
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
		await page.route("**/api/ansage/stand*", (route) =>
			route.fulfill({ json: MIT_DIENST }),
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
	const zeile = page.locator(".db-stimmhinweis");
	const hilfe = page.locator(".db-hilfe");
	await expect(page.locator(".db-buehne")).toBeVisible();

	await page.evaluate(() => {
		const el = document.querySelector<HTMLElement>("[data-stimmhinweis]");
		if (!el) throw new Error("Stimmhinweis fehlt");
		el.textContent = "Ton noch gesperrt – einmal klicken";
		el.hidden = false;
	});
	await expect(zeile).toBeVisible();
	await expect(hilfe).toBeHidden();

	await page.evaluate(() => {
		const el = document.querySelector<HTMLElement>("[data-stimmhinweis]");
		if (el) el.hidden = true;
	});
	await expect(hilfe).toBeVisible();
});
