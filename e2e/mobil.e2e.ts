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

	// Zwei Seiten mit besonders langen Beschriftungen: Kandidatennamen mit
	// Partei, Sitzangaben und die Bewerbertabelle.
	for (const [name, pfad] of [
		["Landratswahl", "/2021/kreis/landrat/"],
		["Gemeindewahl", "/2021/nordstemmen/rat/"],
	] as const) {
		test(`${name}: kein Element ragt über seinen Container hinaus`, async ({
			page,
		}) => {
			await page.goto(pfad);
			await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
			const ueberstand = await page.evaluate(() => {
				const treffer: string[] = [];
				for (const el of document.querySelectorAll<HTMLElement>("main *")) {
					const eltern = el.parentElement;
					if (!eltern) continue;
					// Absichtlich scrollbare Behälter (Tabellen, Karte) ausnehmen
					const stil = getComputedStyle(eltern);
					if (
						stil.overflowX === "auto" ||
						stil.overflowX === "scroll" ||
						stil.overflowX === "hidden"
					)
						continue;
					const a = el.getBoundingClientRect();
					const b = eltern.getBoundingClientRect();
					const b_el = eltern;
					if (a.width === 0 || b.width === 0) continue;
					// 2 px Toleranz: Ränder und Schatten rechnen in Bruchteilen von
					// Pixeln, ein randvoll gefüllter Kasten meldet sonst falschen Alarm.
					if (a.right > b.right + 2 || a.left < b.left - 2) {
						const klassen = String(el.className)
							.split(" ")
							.slice(0, 3)
							.join(".");
						treffer.push(
							`${el.tagName.toLowerCase()}${klassen ? `.${klassen}` : ""} "${(el.textContent || "").trim().slice(0, 20)}" [${Math.round(a.left)}–${Math.round(a.right)}] in [${Math.round(b.left)}–${Math.round(b.right)}] (Eltern: ${b_el.tagName.toLowerCase()}.${String(eltern.className).split(" ").slice(0, 3).join(".")})`,
						);
					}
					if (treffer.length > 5) break;
				}
				return treffer;
			});
			expect(ueberstand, `Ragt heraus: ${ueberstand.join(" | ")}`).toEqual([]);
		});
	}

	// Auf der Übersicht wuchsen die Spalten des äußeren Rasters mit ihrem Inhalt
	// und schoben die Seite über den Bildschirmrand hinaus (fehlendes min-w-0).
	// Mit zwei Behörden in den Fixtures ist der Inhalt zu schmal, als dass sich das
	// zeigen würde – deshalb legt der Test selbst etwas Breites hinein und prüft,
	// dass die Spalte davon unbeeindruckt bleibt.
	for (const pfad of ["/", "/2021/"]) {
		test(`Übersicht ${pfad}: Spalten wachsen nicht mit ihrem Inhalt`, async ({
			page,
		}) => {
			await page.goto(pfad);
			const gewachsen = await page.evaluate(() => {
				const raster = document.querySelector("div.grid.xl\\:grid-cols-3");
				if (!raster) return ["kein Übersichtsraster gefunden"];
				const schlecht: string[] = [];
				for (const spalte of Array.from(raster.children)) {
					const vorher = spalte.getBoundingClientRect().width;
					const klotz = document.createElement("div");
					klotz.style.width = "900px";
					klotz.style.height = "1px";
					spalte.append(klotz);
					const nachher = spalte.getBoundingClientRect().width;
					klotz.remove();
					if (nachher > vorher + 1)
						schlecht.push(
							`${spalte.tagName.toLowerCase()}.${String(spalte.className).split(" ").slice(0, 2).join(".")}: ${Math.round(vorher)} → ${Math.round(nachher)} px`,
						);
				}
				return schlecht;
			});
			expect(
				gewachsen,
				`Diese Spalten wachsen mit ihrem Inhalt (min-w-0 fehlt): ${gewachsen.join(" | ")}`,
			).toEqual([]);
		});
	}

	test("Balken: Name bleibt lesbar, Zahlen rutschen bei Enge darunter", async ({
		page,
	}) => {
		await page.goto("/2021/kreis/landrat/");
		const erster = page.getByRole("listitem").first();
		await expect(erster).toBeVisible();
		const box = await erster.boundingBox();
		expect(box?.width ?? 0).toBeLessThanOrEqual(BREITE);
		await expect(page.getByText("Bernd Lynack")).toBeVisible();
		await expect(page.getByText("41,3 %")).toBeVisible();
	});
});
