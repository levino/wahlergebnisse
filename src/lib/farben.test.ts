import { describe, expect, it } from "vitest";
import {
	LEINWAND_GRUND,
	helligkeit,
	kontrast,
	mische,
	parteiThema,
} from "./farben.ts";

const CDU = "#000000";
const AFD = "#000063";
const FDP = "#fbee31";
const SPD = "#d60029";

describe("mische", () => {
	it("gibt an den Enden genau die eine oder die andere Farbe", () => {
		expect(mische("#000000", "#ffffff", 0)).toBe("#000000");
		expect(mische("#000000", "#ffffff", 1)).toBe("#ffffff");
	});

	it("trifft die Mitte", () => {
		expect(mische("#000000", "#ffffff", 0.5)).toBe("#808080");
	});

	it("lässt Unbrauchbares stehen, statt Unsinn zu erzeugen", () => {
		expect(mische("blau", "#ffffff", 0.5)).toBe("blau");
	});
});

describe("parteiThema", () => {
	it("hellt dunkle Parteifarben auf, bis sie auf dem Grund zu sehen sind", () => {
		for (const farbe of [CDU, AFD]) {
			const thema = parteiThema(farbe);
			expect(helligkeit(thema.akzent)).toBeGreaterThan(
				helligkeit(LEINWAND_GRUND) + 80,
			);
		}
	});

	it("lässt helle Parteifarben unangetastet", () => {
		expect(parteiThema(FDP).akzent).toBe(FDP);
	});

	it("gibt die Parteifarbe selbst für Flächen unverändert weiter", () => {
		expect(parteiThema(SPD).farbe).toBe(SPD);
	});

	it("wählt eine Schrift, die auf der Fläche lesbar ist", () => {
		expect(parteiThema(CDU).schrift).toBe(kontrast(CDU));
		expect(parteiThema(CDU).schrift).toBe("#fff");
		expect(parteiThema(FDP).schrift).toBe("#000");
	});

	it("tönt den Grund in Richtung Parteifarbe, ohne ihn zu ersetzen", () => {
		const grund = parteiThema(SPD).grund;
		expect(grund).not.toBe(LEINWAND_GRUND);
		expect(helligkeit(grund)).toBeLessThan(helligkeit(SPD));
	});
});
