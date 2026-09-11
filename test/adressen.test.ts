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
