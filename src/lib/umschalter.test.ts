import { describe, expect, it } from "vitest";
import { kreiseSortiert } from "./pfade.ts";
import { umschalterName } from "./umschalter.ts";

describe("umschalterName", () => {
	it("gibt demselben Kreis denselben Namen", () => {
		expect(umschalterName("hildesheim")).toBe(umschalterName("hildesheim"));
	});

	it("unterscheidet die Kreise voneinander und von „kein Kreis“", () => {
		expect(umschalterName("hildesheim")).not.toBe(umschalterName("nienburg"));
		expect(umschalterName("hildesheim")).not.toBe(umschalterName(undefined));
	});

	it("vergibt für alle Kreise verschiedene Namen", () => {
		const namen = kreiseSortiert().map((k) => umschalterName(k.slug));
		expect(new Set(namen).size).toBe(namen.length);
	});

	it("nennt nichts, was ein Attributwert nicht verträgt", () => {
		for (const k of kreiseSortiert()) {
			expect(umschalterName(k.slug)).toMatch(/^[a-z0-9-]+$/);
		}
	});
});
