/** Was im Speicher steht, muss auch nach einem Update noch tragen. */
import { describe, expect, it } from "vitest";
import { type MeinePartei, liesAuswahl, schreibAuswahl } from "./partei.ts";

const cdu: MeinePartei = { key: "cdu", kurz: "CDU", farbe: "#000000" };

describe("liesAuswahl", () => {
	it("liest zurück, was geschrieben wurde", () => {
		expect(liesAuswahl(schreibAuswahl(cdu))).toEqual(cdu);
	});

	it("nimmt nichts an, wo nichts gewählt wurde", () => {
		expect(liesAuswahl(null)).toBe(undefined);
		expect(liesAuswahl("")).toBe(undefined);
	});

	it("verwirft Unvollständiges, statt in eine halbe Farbe zu laufen", () => {
		expect(liesAuswahl('{"key":"cdu"}')).toBe(undefined);
		expect(liesAuswahl('{"key":"cdu","kurz":"CDU"}')).toBe(undefined);
		expect(liesAuswahl('{"key":"","kurz":"CDU","farbe":"#000"}')).toBe(
			undefined,
		);
	});

	it("verschluckt sich nicht an Unfug im Speicher", () => {
		expect(liesAuswahl("keine partei")).toBe(undefined);
		expect(liesAuswahl("null")).toBe(undefined);
		expect(liesAuswahl("[1,2]")).toBe(undefined);
	});
});
