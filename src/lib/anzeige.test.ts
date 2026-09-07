import { describe, expect, it } from "vitest";
import { nachStaerke, staerkste } from "./anzeige.ts";

/**
 * Die Wahlpräsentation liefert die Parteien in Stimmzettel-Reihenfolge. Wer
 * daraus die ersten sechs nimmt, zeigt in jeder elften Wahl eine falsche
 * Partei – geprüft wird deshalb genau der Fall, in dem beides auseinanderfällt.
 */
const stimmzettel = [
	{ kurz: "SPD", prozent: 38.21, stimmen: 14520 },
	{ kurz: "CDU", prozent: 24.61, stimmen: 9350 },
	{ kurz: "GRÜNE", prozent: 12.11, stimmen: 4600 },
	{ kurz: "FDP", prozent: 4.29, stimmen: 1630 },
	{ kurz: "DIE LINKE.", prozent: 3.11, stimmen: 1180 },
	{ kurz: "Die PARTEI", prozent: 1.39, stimmen: 530 },
	{ kurz: "AfD", prozent: 9.79, stimmen: 3720 },
	{ kurz: "FWG", prozent: 6.5, stimmen: 2470 },
];

describe("staerkste", () => {
	it("nimmt die stärksten, nicht die erstgenannten", () => {
		expect(staerkste(stimmzettel, 6).map((p) => p.kurz)).toEqual([
			"SPD",
			"CDU",
			"GRÜNE",
			"AfD",
			"FWG",
			"FDP",
		]);
	});

	it("lässt die Vorlage unangetastet", () => {
		const vorher = stimmzettel.map((p) => p.kurz);
		staerkste(stimmzettel, 3);
		expect(stimmzettel.map((p) => p.kurz)).toEqual(vorher);
	});

	it("gibt bei kurzer Liste alles zurück – sortiert", () => {
		expect(staerkste(stimmzettel.slice(3), 99).map((p) => p.kurz)).toEqual([
			"AfD",
			"FWG",
			"FDP",
			"DIE LINKE.",
			"Die PARTEI",
		]);
	});

	it("entscheidet bei gleichem Anteil nach Stimmen", () => {
		const gleich = [
			{ kurz: "A", prozent: 5, stimmen: 100 },
			{ kurz: "B", prozent: 5, stimmen: 140 },
		];
		expect([...gleich].sort(nachStaerke).map((p) => p.kurz)).toEqual([
			"B",
			"A",
		]);
	});

	it("kommt ohne Stimmenzahl aus (Ticker-Spitze)", () => {
		const spitze = [
			{ kurz: "CDU", prozent: 21.4 },
			{ kurz: "SPD", prozent: 34.8 },
		];
		expect([...spitze].sort(nachStaerke).map((p) => p.kurz)).toEqual([
			"SPD",
			"CDU",
		]);
	});
});
