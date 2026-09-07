/**
 * Die veröffentlichten Adressen des Landkreises Hildesheim.
 *
 * `fixtures/adressen-hildesheim.json` hält für jede der 20 Behörden der
 * Termine 2020 und 2021 fest, was `termin.json` der Wahlleitung an Wahlen
 * nennt – und welchen Slug die Anwendung dafür seit ihrem Start ausliefert.
 * Diese 210 Adressen sind verlinkt und von Suchmaschinen geführt; sie dürfen
 * sich nie wieder ändern.
 *
 * Der Test ist damit die Bremse für jede künftige Arbeit an der Slug-Bildung:
 * Wer die Regeln anfasst, sieht sofort, ob eine gewachsene Adresse dabei
 * verloren geht. Die Datei ist Bestand, kein Zwischenstand – sie wird
 * ergänzt, wenn ein Termin dazukommt, aber nicht „nachgezogen“, wenn ein Slug
 * anders ausfällt.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { kreisBySlug } from "../src/data/kreise.ts";
import { wahlSlugs } from "../src/lib/wahltyp.ts";

type Bestand = Array<{
	termin: string;
	behoerde: string;
	ags: string;
	wahlen: Array<{
		wahlId: number;
		titel: string;
		gebietTitel: string;
		gebietId: string;
		slug: string;
	}>;
}>;

const BESTAND: Bestand = JSON.parse(
	readFileSync(
		new URL("./fixtures/adressen-hildesheim.json", import.meta.url),
		"utf-8",
	),
);

const hildesheim = kreisBySlug("hildesheim");

const pfade = (): string[] =>
	BESTAND.flatMap((b) => {
		const behoerde = hildesheim?.behoerden.find((x) => x.ags === b.ags);
		expect(behoerde, `Behörde ${b.ags} fehlt im Katalog`).toBeDefined();
		return wahlSlugs(b.wahlen, behoerde?.name ?? "").map(
			(w) => `/hildesheim/${b.termin}/${b.behoerde}/${w.slug}/`,
		);
	});

describe("veröffentlichte Adressen im Landkreis Hildesheim", () => {
	it("hält alle 210 Adressen der Termine 2020 und 2021", () => {
		const erwartet = BESTAND.flatMap((b) =>
			b.wahlen.map((w) => `/hildesheim/${b.termin}/${b.behoerde}/${w.slug}/`),
		);
		expect(erwartet).toHaveLength(210);
		expect(pfade()).toEqual(erwartet);
	});

	it("nennt die drei Adressen, an denen der Bestand hängt", () => {
		// Aus docs/ausbau-niedersachsen.md und der Aufgabenstellung – dieselben
		// Adressen noch einmal ausgeschrieben, damit ein Bruch im Diff steht
		// und nicht nur in einer Zählung.
		const alle = new Set(pfade());
		expect(alle).toContain("/hildesheim/2021/nordstemmen/rat/");
		expect(alle).toContain("/hildesheim/2021/kreis/kreistag/");
		expect(alle).toContain("/hildesheim/2021/nordstemmen/ortsrat-roessing/");
	});

	it("vergibt jede Adresse nur einmal", () => {
		const alle = pfade();
		expect(new Set(alle).size).toBe(alle.length);
	});

	it("bleibt gleich, egal in welcher Reihenfolge die Wahlen ankommen", () => {
		// Der Termin-Index ist eine Liste; die Wahlleitung darf sie umsortieren.
		// Ein Slug, der davon abhinge, wäre über ein Neubefüllen der Datenbank
		// hinweg nicht haltbar.
		for (const b of BESTAND) {
			const behoerde = hildesheim?.behoerden.find((x) => x.ags === b.ags);
			const vorwaerts = wahlSlugs(b.wahlen, behoerde?.name ?? "");
			const rueckwaerts = wahlSlugs(
				[...b.wahlen].reverse(),
				behoerde?.name ?? "",
			);
			expect(rueckwaerts.map((w) => w.slug).reverse()).toEqual(
				vorwaerts.map((w) => w.slug),
			);
		}
	});
});
