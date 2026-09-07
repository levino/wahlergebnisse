import { type Page, expect, test } from "@playwright/test";
import { warteAufDaten } from "./warten.ts";

/**
 * Auf dem Telefon darf nichts über den Bildschirmrand hinausragen. Der Test
 * misst die tatsächliche Breite des Dokuments und nennt außerdem die Elemente,
 * die zu breit sind – sonst sucht man sie von Hand.
 */
const BREITE = 360; // schmales Gerät (iPhone SE quer schmaler als die meisten)

const zuBreiteElemente = (page: Page) =>
	page.evaluate((breite) => {
		const treffer: string[] = [];
		const gesehen = new Set<Element>();
		for (const el of document.querySelectorAll<HTMLElement>("body *")) {
			const r = el.getBoundingClientRect();
			if (r.width === 0 || r.height === 0) continue;
			if (r.right <= breite + 1 && r.left >= -1) continue;
			// Nur das äußerste betroffene Element eines Zweigs melden
			if (el.parentElement && gesehen.has(el.parentElement)) {
				gesehen.add(el);
				continue;
			}
			gesehen.add(el);
			const klassen = String(el.className).split(" ").slice(0, 3).join(".");
			treffer.push(
				`${el.tagName.toLowerCase()}${klassen ? `.${klassen}` : ""} [${Math.round(r.width)}px]`,
			);
			if (treffer.length > 8) break;
		}
		return treffer;
	}, BREITE);

const seiten = [
	["Startseite", "/2021/"],
	["Kreistagswahl", "/2021/kreis/kreistag/"],
	["Wahlbereich", "/2021/kreis/kreistag/ebene_9_id_57/"],
	["Gemeindewahl", "/2021/nordstemmen/rat/"],
	["Wahlbezirk", "/2021/nordstemmen/rat/ebene_6_id_3119/"],
	["Bürgermeisterwahl 2020", "/2020/nordstemmen/buergermeister/"],
	["API-Doku", "/api"],
] as const;

test.describe("Auf dem Telefon", () => {
	test.use({ viewport: { width: BREITE, height: 780 } });

	test.beforeAll(async () => {
		test.setTimeout(240_000);
		await warteAufDaten("2021");
	});

	for (const [name, pfad] of seiten) {
		test(`${name} passt in die Bildschirmbreite`, async ({ page }) => {
			await page.goto(pfad);
			await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
			// Karten und Tabellen dürfen in sich scrollen; die Seite selbst nicht.
			const breite = await page.evaluate(() => ({
				dokument: document.documentElement.scrollWidth,
				fenster: window.innerWidth,
			}));
			const zuBreit = await zuBreiteElemente(page);
			expect(
				breite.dokument,
				`Seite ist breiter als der Bildschirm. Betroffen: ${zuBreit.join(", ") || "unbekannt"}`,
			).toBeLessThanOrEqual(breite.fenster + 1);
		});
	}

	test("Balken bleiben lesbar: Name, Prozent und Stimmen brechen um statt zu überlaufen", async ({
		page,
	}) => {
		await page.goto("/2021/kreis/landrat/");
		const erster = page.getByRole("listitem").first();
		await expect(erster).toBeVisible();
		const box = await erster.boundingBox();
		expect(box?.width ?? 0).toBeLessThanOrEqual(BREITE);
		// Der Kandidatenname bleibt sichtbar, wird also nicht weggeschnitten
		await expect(page.getByText("Bernd Lynack")).toBeVisible();
	});
});
