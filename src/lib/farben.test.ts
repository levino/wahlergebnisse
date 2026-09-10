/**
 * Parteifarben auf dunklem Grund – die Rechnung, an der hängt, ob am
 * Wahlabend jemand seine Partei auf der Leinwand wiedererkennt.
 */
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
		// Eine Farbe, die die Wahlleitung in einer Form liefert, die wir nicht
		// lesen können, darf die Leinwand nicht einfärben.
		expect(mische("blau", "#ffffff", 0.5)).toBe("blau");
	});
});

describe("parteiThema", () => {
	it("hellt dunkle Parteifarben auf, bis sie auf dem Grund zu sehen sind", () => {
		// Das ist der ganze Zweck: Schwarz (CDU) und Dunkelblau (AfD) sind auf
		// dem dunklen Grund der Leinwand sonst schlicht unsichtbar.
		for (const farbe of [CDU, AFD]) {
			const thema = parteiThema(farbe);
			expect(helligkeit(thema.akzent)).toBeGreaterThan(
				helligkeit(LEINWAND_GRUND) + 80,
			);
		}
	});

	it("lässt helle Parteifarben unangetastet", () => {
		// Gelb aufzuhellen hieße, die FDP in einer Farbe zu zeigen, die sie
		// nicht hat – und nötig ist es nicht.
		expect(parteiThema(FDP).akzent).toBe(FDP);
	});

	it("gibt die Parteifarbe selbst für Flächen unverändert weiter", () => {
		expect(parteiThema(SPD).farbe).toBe(SPD);
	});

	it("wählt eine Schrift, die auf der Fläche lesbar ist", () => {
		// Auf Schwarz Weiß, auf Gelb Schwarz – ohne das wäre die Bedienleiste
		// für die eine Hälfte der Parteien nicht zu entziffern.
		expect(parteiThema(CDU).schrift).toBe(kontrast(CDU));
		expect(parteiThema(CDU).schrift).toBe("#fff");
		expect(parteiThema(FDP).schrift).toBe("#000");
	});

	it("tönt den Grund in Richtung Parteifarbe, ohne ihn zu ersetzen", () => {
		// Der Grund bleibt dunkel: Die Balken liegen darauf, und sie sollen
		// vom Grund abstechen und nicht mit ihm verschwimmen.
		const grund = parteiThema(SPD).grund;
		expect(grund).not.toBe(LEINWAND_GRUND);
		expect(helligkeit(grund)).toBeLessThan(helligkeit(SPD));
	});
});
