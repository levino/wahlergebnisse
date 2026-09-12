/** Die Reihenfolge der Moderationsbeiträge – reine Logik, ohne Audio und DOM. */
import { describe, expect, it } from "vitest";
import {
	ANSAGE_GILT_MS,
	type Wartend,
	einreihen,
	naechste,
} from "./beitrag-schlange.ts";

const w = (last: string, seit: number, dringend = false): Wartend<string> => ({
	last,
	seit,
	dringend,
});

const rein = (
	schlange: readonly Wartend<string>[],
	neu: Wartend<string>,
	hoechstens?: number,
): Wartend<string>[] => einreihen(schlange, neu, hoechstens).schlange;

describe("einreihen", () => {
	it("hängt Gewöhnliches hinten an", () => {
		const s = rein(rein([], w("a", 1)), w("b", 2));
		expect(s.map((e) => e.last)).toEqual(["a", "b"]);
	});

	it("stellt Dringendes an den Anfang, nicht mitten ins Wort", () => {
		// Eine laufende Ansage abzuschneiden ist im Saal schlimmer als drei
		// Sekunden zu warten; überholt wird nur, wer noch wartet.
		const s = rein(rein([], w("stand", 1)), w("fertig", 2, true));
		expect(s.map((e) => e.last)).toEqual(["fertig", "stand"]);
	});

	it("hält die Reihenfolge mehrerer Dringender ein", () => {
		let s = rein([], w("a", 1, true));
		s = rein(s, w("b", 2, true));
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
			s = rein(s, w(name, seit), 3);
		expect(s).toHaveLength(3);
		expect(s.map((e) => e.last)).toEqual(["b", "c", "d"]);
	});

	it("nennt, was der Deckel hinausgedrängt hat", () => {
		// Der Verdrängte verschwindet nicht lautlos: Sein Einblender gehört noch
		// auf die Leinwand, und seine geladene Datei will freigegeben werden.
		const s = [w("a", 1), w("b", 2), w("c", 3)];
		const { verdraengt } = einreihen(s, w("d", 4), 3);
		expect(verdraengt.map((e) => e.last)).toEqual(["a"]);
	});

	it("wirft auch dann das Ältere heraus, wenn es dringend ist", () => {
		// Am Wahlabend zählt die letzte Zahl. Ein dringender Beitrag von vorhin
		// ist nicht dadurch wertvoll, dass er dringend war.
		const s = [w("alt-dringend", 1, true), w("b", 5), w("c", 6)];
		const { schlange, verdraengt } = einreihen(s, w("d", 7), 3);
		expect(verdraengt.map((e) => e.last)).toEqual(["alt-dringend"]);
		expect(schlange.map((e) => e.last)).toEqual(["b", "c", "d"]);
	});

	it("lässt bei gleichem Zeitpunkt den schon Wartenden fallen", () => {
		// Trifft ein Schwung auf einmal ein, tragen mehrere dieselbe Marke.
		// Dann ist der eben Eingetroffene der spätere – er bleibt.
		const s = [w("a", 5), w("b", 5), w("c", 5)];
		const { schlange, verdraengt } = einreihen(s, w("neu", 5), 3);
		expect(verdraengt.map((e) => e.last)).toEqual(["a"]);
		expect(schlange.map((e) => e.last)).toEqual(["b", "c", "neu"]);
	});

	it("behält auch einen dringenden Neuzugang mit gleicher Marke", () => {
		const s = [w("a", 5), w("b", 5), w("c", 5)];
		const { schlange } = einreihen(s, w("neu", 5, true), 3);
		expect(schlange.map((e) => e.last)).toContain("neu");
	});

	it("lässt sich nicht auf null deckeln", () => {
		expect(rein([], w("a", 1), 0)).toHaveLength(1);
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

	it("misst den Verfall beim Drankommen, nicht beim Einreihen", () => {
		// Ein Schwung, der nach einer Pause auf einmal hereinkommt, wird
		// geschlossen eingereiht. Frisch macht ihn das nicht.
		const entstanden = 1_000_000;
		let s: Wartend<string>[] = [];
		for (const [name, versatz] of [
			["vorvorhin", 0],
			["vorhin", 30_000],
			["eben", 120_000],
		] as const)
			s = einreihen(s, w(name, entstanden + versatz)).schlange;
		const jetzt = entstanden + 121_000;
		const g = naechste(s, jetzt);
		expect(g.naechste?.last).toBe("eben");
		expect(g.verfallen.map((e) => e.last)).toEqual(["vorvorhin", "vorhin"]);
	});

	it("verwirft auch Dringendes, das zu lange lag", () => {
		const jetzt = 1_000_000;
		const g = naechste(
			[w("fertig", jetzt - ANSAGE_GILT_MS - 1, true), w("stand", jetzt - 10)],
			jetzt,
		);
		expect(g.naechste?.last).toBe("stand");
		expect(g.verfallen.map((e) => e.last)).toEqual(["fertig"]);
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
