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

	it("nennt Regionsversammlung und Regionspräsident bei ihrem Namen", () => {
		expect(deuteWahl("2026", "03241000", 44)).toMatchObject({
			typ: "kreistag",
			wahl: "Regionsversammlungswahl",
		});
		expect(deuteWahl("2026", "03241000", 43)).toMatchObject({
			typ: "landrat",
			wahl: "Regionspräsidentenwahl",
		});
	});

	it("unterscheidet Stadtrat, Gemeinderat und Fleckenrat nach Behörde", () => {
		expect(deuteWahl("2026", "03254002", 143)).toMatchObject({
			typ: "rat",
			wahl: "Stadtratswahl",
		});
		expect(deuteWahl("2026", "03254003", 93)).toMatchObject({
			typ: "rat",
			wahl: "Gemeinderatswahl",
		});
	});

	it("benennt Mitgliedsgemeinden einer Samtgemeinde nach ihrer eigenen Art", () => {
		expect(deuteWahl("2026", "033585401", 261)).toMatchObject({
			typ: "rat",
			wahl: "Samtgemeinderatswahl",
			gebiet: "",
		});
		expect(deuteWahl("2026", "033585401", 264)).toMatchObject({
			typ: "rat",
			wahl: "Fleckenratswahl",
			gebiet: "Ahlden (Aller)",
		});
		expect(deuteWahl("2026", "033585402", 278)).toMatchObject({
			typ: "rat",
			wahl: "Stadtratswahl",
			gebiet: "Rethem (Aller)",
		});
	});

	it("trägt die Stadtbezirke Hannovers ohne ihre Nummer", () => {
		expect(deuteWahl("2026", "03241001", 37)).toMatchObject({
			typ: "ortsrat",
			wahl: "Stadtbezirksratswahl",
			gebiet: "Mitte",
			gremium: "Stadtbezirksrat",
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
