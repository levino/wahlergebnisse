import { describe, expect, it } from "vitest";
import { kreiseSortiert } from "./pfade.ts";
import { umschalterName } from "./umschalter.ts";

describe("umschalterName", () => {
	it("gibt demselben Kreis denselben Namen", () => {
		// Nur so nimmt der Router den offenen Aufklapper mit: Die neue Seite
		// muss ein Element mit exakt diesem Namen mitbringen.
		expect(umschalterName("hildesheim")).toBe(umschalterName("hildesheim"));
	});

	it("unterscheidet die Kreise voneinander und von „kein Kreis“", () => {
		// Andernfalls stünde nach einem Kreiswechsel weiter der alte Kreis im
		// Kopf – der Umschalter würde mitgenommen statt ersetzt.
		expect(umschalterName("hildesheim")).not.toBe(umschalterName("nienburg"));
		expect(umschalterName("hildesheim")).not.toBe(umschalterName(undefined));
	});

	it("vergibt für alle Kreise verschiedene Namen", () => {
		const namen = kreiseSortiert().map((k) => umschalterName(k.slug));
		expect(new Set(namen).size).toBe(namen.length);
	});

	it("nennt nichts, was ein Attributwert nicht verträgt", () => {
		// Der Name landet als data-astro-transition-persist im HTML und wird vom
		// Router per querySelector wieder gesucht; Anführungszeichen oder
		// Leerzeichen darin brächen die Suche.
		for (const k of kreiseSortiert()) {
			expect(umschalterName(k.slug)).toMatch(/^[a-z0-9-]+$/);
		}
	});
});
