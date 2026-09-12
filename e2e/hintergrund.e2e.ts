/**
 * Ein Reiter, der hinten liegt, spricht – und holt beim Zurückkommen nichts nach.
 *
 * Chromium meldet unter der Testumgebung auch dann `visible`, wenn ein zweiter
 * Reiter davor liegt: Es gibt keinen Fenstermanager, der eine Verdeckung
 * meldete. Der zweite Reiter kommt trotzdem nach vorn, und die Seite bekommt
 * zusätzlich den Sichtbarkeitszustand gesetzt, den sie im Saal hätte.
 */
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { beitragHinterlegen, haken, kennung, pingen } from "./leinwand.ts";
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
const schluessel = () => `hintergrund-${Date.now()}-${lauf++}`;

/** Eine hörbare Aufnahme der gewünschten Länge, ohne Datei im Baum. */
const aufnahme = (sekunden: number): Buffer => {
	const rate = 8000;
	const n = Math.round(rate * sekunden);
	const kopf = Buffer.alloc(44);
	kopf.write("RIFF", 0);
	kopf.writeUInt32LE(36 + n * 2, 4);
	kopf.write("WAVE", 8);
	kopf.write("fmt ", 12);
	kopf.writeUInt32LE(16, 16);
	kopf.writeUInt16LE(1, 20);
	kopf.writeUInt16LE(1, 22);
	kopf.writeUInt32LE(rate, 24);
	kopf.writeUInt32LE(rate * 2, 28);
	kopf.writeUInt16LE(2, 32);
	kopf.writeUInt16LE(16, 34);
	kopf.write("data", 36);
	kopf.writeUInt32LE(n * 2, 40);
	const daten = Buffer.alloc(n * 2);
	for (let i = 0; i < n; i++)
		daten.writeInt16LE(Math.round(3000 * Math.sin(i / 12)), i * 2);
	return Buffer.concat([kopf, daten]);
};

type Fenster = {
	__gespielt: string[];
	__verstecke: (v: boolean) => void;
};

const zaehlerEinbauen = (page: Page) =>
	page.addInitScript(() => {
		const w = window as unknown as Fenster;
		w.__gespielt = [];
		let versteckt = false;
		Object.defineProperty(document, "visibilityState", {
			configurable: true,
			get: () => (versteckt ? "hidden" : "visible"),
		});
		Object.defineProperty(document, "hidden", {
			configurable: true,
			get: () => versteckt,
		});
		w.__verstecke = (v: boolean) => {
			versteckt = v;
			document.dispatchEvent(new Event("visibilitychange"));
		};
		const echt = HTMLMediaElement.prototype.play;
		HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
			w.__gespielt.push(this.src);
			return echt.call(this);
		};
	});

const gespielt = (page: Page): Promise<number> =>
	page.evaluate(() => (window as unknown as Fenster).__gespielt.length);

const verstecke = (page: Page, v: boolean): Promise<void> =>
	page.evaluate(
		(x) => (window as unknown as Fenster).__verstecke(x),
		v,
	) as Promise<void>;

const melde = async (
	page: Page,
	text: string,
	art = "stand",
): Promise<number> =>
	await beitragHinterlegen({
		termin: TERMIN,
		topic: await kennung(page),
		schluessel: schluessel(),
		toasts: [toast(text, art)],
		aufnahme: "stimme.mp3",
	});

test.describe("Der Reiter im Hintergrund", () => {
	test.beforeAll(async () => {
		test.setTimeout(240_000);
		await warteAufDaten(TERMIN);
	});

	test("spricht, während er hinten liegt, und holt nichts nach", async ({
		page,
		context,
	}) => {
		let laenge = 1;
		await page.route("**/api/beitrag/*.mp3", (r) =>
			r.fulfill({ contentType: "audio/wav", body: aufnahme(laenge) }),
		);
		await zaehlerEinbauen(page);
		await page.goto(SEITE);
		await expect(page.locator(".db-buehne")).toBeVisible();
		// Vor der ersten Geste lässt kein Browser Ton zu.
		await page.getByRole("button", { name: "Pause" }).click();

		await pingen(page, await melde(page, "Einnorden"));
		await expect(page.locator("[data-meldungen] .db-meldung")).toHaveCount(0);

		const zweite = await context.newPage();
		await zweite.goto("about:blank");
		await zweite.bringToFront();
		await verstecke(page, true);
		expect(await page.evaluate(() => document.visibilityState)).toBe("hidden");

		await pingen(page, await melde(page, "16 von 23 ausgezählt"));
		await expect
			.poll(async () => (await haken(page))?.grund, { timeout: 20_000 })
			.toBe("gespielt");
		await expect(page.locator("[data-meldungen]")).toContainText("16 von 23");
		expect(await gespielt(page)).toBe(1);

		// Eine lange Ansage beginnt im Hintergrund, zwei weitere reihen sich
		// dahinter ein – genau das, was sich im Saal angestaut hat.
		laenge = 6;
		await pingen(page, await melde(page, "17 von 23 ausgezählt"));
		await expect.poll(async () => await gespielt(page)).toBe(2);
		laenge = 1;
		for (const text of ["18 von 23", "19 von 23"]) {
			await pingen(page, await melde(page, `${text} ausgezählt`));
			await page.waitForTimeout(700);
		}
		expect(await gespielt(page)).toBe(2);

		await page.bringToFront();
		await verstecke(page, false);
		// Lange genug, dass die laufende Ansage endet und die Wartenden
		// drankämen, wenn sie noch da wären.
		await page.waitForTimeout(8_000);

		// Die laufende Ansage spricht zu Ende; die Wartenden bleiben stumm.
		expect(await gespielt(page)).toBe(2);
		const meldungen = page.locator("[data-meldungen]");
		await expect(meldungen).toContainText("18 von 23");
		await expect(meldungen).toContainText("19 von 23");

		// Was danach hereinkommt, wird wieder gesprochen.
		await pingen(page, await melde(page, "20 von 23 ausgezählt"));
		await expect.poll(async () => await gespielt(page)).toBe(3);
	});
});
