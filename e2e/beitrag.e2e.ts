/**
 * Der Client holt, was der Server hinterlegt hat – und rechnet selbst nichts.
 *
 * Die Steuerung des Testaufbaus legt die Beiträge an; geprüft wird der Weg
 * danach: Ping, Abruf, Einblender, Aufnahme.
 */
import { expect, test } from "@playwright/test";
import { haken, beitragHinterlegen, kennung, pingen } from "./leinwand.ts";
import { warteAufDaten } from "./warten.ts";

const SEITE = "/hildesheim/2021/nordstemmen/dashboard?takt=300";
const TERMIN = "2021";

const toast = (text: string, art = "stand") => ({
	marke: "rat",
	ort: "Nordstemmen",
	wahl: "Gemeinderatswahl",
	art,
	text,
});

let lauf = 0;
const schluessel = () => `probe-${Date.now()}-${lauf++}`;

const oeffne = async (page: import("@playwright/test").Page) => {
	await page.goto(SEITE);
	await expect(page.locator(".db-buehne")).toBeVisible();
	// Vor der ersten Geste lässt kein Browser Ton zu; im Saal ist es der
	// Vollbildknopf, hier die Pause.
	await page.getByRole("button", { name: "Pause" }).click();
};

/**
 * Den Zeiger des Clients einnorden: Der erste Ping meldet nichts, er merkt
 * sich nur, wo der Abend steht.
 */
const einnorden = async (page: import("@playwright/test").Page) => {
	const id = await beitragHinterlegen({
		termin: TERMIN,
		topic: await kennung(page),
		schluessel: schluessel(),
		toasts: [toast("Einnorden")],
	});
	await pingen(page, id);
	await expect(page.locator("[data-meldungen] .db-meldung")).toHaveCount(0);
	return id;
};

test.describe("Der Client holt hinterlegte Moderationsbeiträge", () => {
	test.beforeAll(async () => {
		test.setTimeout(240_000);
		await warteAufDaten(TERMIN);
	});

	test("meldet beim Aufbau nichts und zeigt erst das Nächste", async ({
		page,
	}) => {
		await oeffne(page);
		await einnorden(page);

		const id = await beitragHinterlegen({
			termin: TERMIN,
			topic: await kennung(page),
			schluessel: schluessel(),
			toasts: [toast("15 von 23 ausgezählt")],
		});
		await pingen(page, id);

		const meldungen = page.locator("[data-meldungen]");
		await expect(meldungen).toContainText("15 von 23 ausgezählt");
		await expect(meldungen).toContainText("Gemeinderatswahl Nordstemmen");
	});

	test("spielt die Aufnahme, die der Beitrag nennt", async ({ page }) => {
		await oeffne(page);
		await einnorden(page);

		const id = await beitragHinterlegen({
			termin: TERMIN,
			topic: await kennung(page),
			schluessel: schluessel(),
			toasts: [toast("Rössing ist fertig ausgezählt!", "fertig")],
			aufnahme: "gibt-es-nicht.mp3",
		});
		await pingen(page, id);

		// Die Datei liegt nicht da – geprüft wird, dass der Client sie über die
		// Paketkennung anfordert und den Ausfall benennt, statt still zu sein.
		await expect
			.poll(async () => (await haken(page))?.url, { timeout: 15_000 })
			.toBe(`/api/beitrag/${id}.mp3`);
		expect((await haken(page))?.grund).toBe("keine-aufnahme");
	});

	test("schickt keinen Satz über die Leitung", async ({ page }) => {
		// Der Kern der Umstellung: Der Browser bekommt Toasts und eine Adresse,
		// nie den formulierten Satz.
		const rumpf: string[] = [];
		page.on("response", (r) => {
			const u = r.url();
			if (u.includes("/api/beitr") || u.includes("/api/ansage")) rumpf.push(u);
		});
		await oeffne(page);
		await einnorden(page);

		const id = await beitragHinterlegen({
			termin: TERMIN,
			topic: await kennung(page),
			schluessel: schluessel(),
			toasts: [toast("20 von 23 ausgezählt")],
		});
		await pingen(page, id);
		await expect(page.locator("[data-meldungen]")).toContainText("20 von 23");

		// Kein Aufruf an die alten, textführenden Adressen.
		expect(rumpf.filter((u) => u.includes("/api/ansage"))).toEqual([]);
		expect(rumpf.some((u) => u.includes("/api/beitraege"))).toBe(true);
	});

	test("holt nach, was während einer Unterbrechung anfiel", async ({
		page,
	}) => {
		await oeffne(page);
		await einnorden(page);

		let letzte = 0;
		for (const text of ["16 von 23", "17 von 23", "18 von 23"])
			letzte = await beitragHinterlegen({
				termin: TERMIN,
				topic: await kennung(page),
				schluessel: schluessel(),
				toasts: [toast(`${text} ausgezählt`)],
			});
		await pingen(page, letzte);

		const meldungen = page.locator("[data-meldungen]");
		await expect(meldungen).toContainText("16 von 23");
		await expect(meldungen).toContainText("18 von 23");
	});

	test("zeigt die Einblender auch bei abgeschalteter Ansage", async ({
		page,
	}) => {
		await oeffne(page);
		await page.evaluate(() => localStorage.setItem("wahlen:ansage", "aus"));
		await einnorden(page);

		const id = await beitragHinterlegen({
			termin: TERMIN,
			topic: await kennung(page),
			schluessel: schluessel(),
			toasts: [toast("19 von 23 ausgezählt")],
			aufnahme: "gibt-es-nicht.mp3",
		});
		await pingen(page, id);

		await expect(page.locator("[data-meldungen]")).toContainText("19 von 23");
		await expect
			.poll(async () => (await haken(page))?.grund, { timeout: 15_000 })
			.toBe("aus");
	});
});
