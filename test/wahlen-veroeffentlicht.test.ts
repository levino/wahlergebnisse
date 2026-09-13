import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { deuteWahl } from "../src/lib/wahltyp.ts";

type Veroeffentlicht = Record<string, { id: number; titel: string }[]>;

const veroeffentlicht: Veroeffentlicht = JSON.parse(
	readFileSync(
		new URL("./fixtures/wahlen-veroeffentlicht-2026.json", import.meta.url),
		"utf-8",
	),
);

describe("Zuordnung der am 13.09.2026 veröffentlichten Wahlen", () => {
	for (const [ags, wahlen] of Object.entries(veroeffentlicht)) {
		it(`kennt jede Wahl, die ${ags} veröffentlicht`, () => {
			const unbekannt = wahlen
				.filter(({ id }) => deuteWahl("2026", ags, id).typ === "unbekannt")
				.map(({ id, titel }) => `${id} ${titel}`);
			expect(unbekannt).toEqual([]);
		});
	}

	it("trägt Landrat und Kreistag in jeder Behörde des Kreises", () => {
		for (const ags of Object.keys(veroeffentlicht)) {
			expect(deuteWahl("2026", ags, 44)).toMatchObject({ typ: "landrat" });
			expect(deuteWahl("2026", ags, 45)).toMatchObject({ typ: "kreistag" });
		}
	});

	it("unterscheidet Stadtrat und Gemeinderat nach Behörde", () => {
		expect(deuteWahl("2026", "03254002", 143)).toMatchObject({
			typ: "rat",
			wahl: "Stadtratswahl",
		});
		expect(deuteWahl("2026", "03254003", 93)).toMatchObject({
			typ: "rat",
			wahl: "Gemeinderatswahl",
		});
	});

	it("benennt die Ortsratswahlen mit ihrer Ortschaft", () => {
		expect(deuteWahl("2026", "03254002", 180)).toMatchObject({
			typ: "ortsrat",
			gebiet: "Imsen/Wispenstein",
		});
		expect(deuteWahl("2026", "03254042", 168)).toMatchObject({
			typ: "ortsrat",
			gebiet: "Freden (Leine)",
		});
	});
});
