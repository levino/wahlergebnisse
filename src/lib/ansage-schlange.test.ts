/** Die Reihenfolge der Ansagen – reine Logik, ohne Audio und ohne DOM. */
import { describe, expect, it } from "vitest";
import {
	ANSAGE_GILT_MS,
	type Wartend,
	einreihen,
	naechste,
} from "./ansage-schlange.ts";

const w = (last: string, seit: number, dringend = false): Wartend<string> => ({
	last,
	seit,
	dringend,
});

describe("einreihen", () => {
	it("hängt Gewöhnliches hinten an", () => {
		const s = einreihen(einreihen([], w("a", 1)), w("b", 2));
		expect(s.map((e) => e.last)).toEqual(["a", "b"]);
	});

	it("stellt Dringendes an den Anfang, nicht mitten ins Wort", () => {
		// Eine laufende Ansage abzuschneiden ist im Saal schlimmer als drei
		// Sekunden zu warten; überholt wird nur, wer noch wartet.
		const s = einreihen(einreihen([], w("stand", 1)), w("fertig", 2, true));
		expect(s.map((e) => e.last)).toEqual(["fertig", "stand"]);
	});

	it("hält die Reihenfolge mehrerer Dringender ein", () => {
		let s = einreihen([], w("a", 1, true));
		s = einreihen(s, w("b", 2, true));
		expect(s.map((e) => e.last)).toEqual(["b", "a"]);
	});

	it("wirft das Älteste heraus, wenn der Deckel erreicht ist", () => {
		let s: Wartend<string>[] = [];
		for (const [name, seit] of [
			["a", 1],
			["b", 2],
			["c", 3],
			["d", 4],
		] as const)
			s = einreihen(s, w(name, seit), 3);
		expect(s).toHaveLength(3);
		expect(s.map((e) => e.last)).toEqual(["b", "c", "d"]);
	});

	it("lässt sich nicht auf null deckeln", () => {
		expect(einreihen([], w("a", 1), 0)).toHaveLength(1);
	});
});

describe("naechste", () => {
	it("gibt die vorderste heraus und behält den Rest", () => {
		const s = [w("a", 100), w("b", 200)];
		const g = naechste(s, 300);
		expect(g.naechste?.last).toBe("a");
		expect(g.rest.map((e) => e.last)).toEqual(["b"]);
		expect(g.verfallen).toEqual([]);
	});

	it("wirft ab, was beim Drankommen überholt ist", () => {
		// Eine Zahl von vorhin vorzulesen ist schlechter als Schweigen.
		const jetzt = 1_000_000;
		const s = [w("alt", jetzt - ANSAGE_GILT_MS - 1), w("frisch", jetzt - 100)];
		const g = naechste(s, jetzt);
		expect(g.naechste?.last).toBe("frisch");
		expect(g.verfallen.map((e) => e.last)).toEqual(["alt"]);
	});

	it("gibt nichts heraus, wenn alles verfallen ist – nennt es aber", () => {
		const jetzt = 1_000_000;
		const g = naechste([w("alt", jetzt - ANSAGE_GILT_MS - 1)], jetzt);
		expect(g.naechste).toBeUndefined();
		expect(g.verfallen).toHaveLength(1);
		expect(g.rest).toEqual([]);
	});

	it("kommt mit einer leeren Schlange aus", () => {
		expect(naechste([], 1).naechste).toBeUndefined();
	});

	it("lässt die Frist einstellen", () => {
		const g = naechste([w("a", 0)], 50, 100);
		expect(g.naechste?.last).toBe("a");
		expect(naechste([w("a", 0)], 150, 100).naechste).toBeUndefined();
	});
});
