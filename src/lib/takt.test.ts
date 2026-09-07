import { describe, expect, it } from "vitest";
import type { Termin } from "../data/termine.ts";
import { berlinerZeit, istWahlabend, takt } from "./takt.ts";

const wahltag: Termin = {
	id: "2026",
	titel: "Kommunalwahl 2026",
	datum: "2026-09-13",
	ordner: "20260913",
	layout: "v26",
	live: true,
	beschreibung: "",
};
const archiv: Termin = {
	...wahltag,
	id: "2021",
	datum: "2021-09-12",
	live: false,
};

describe("berlinerZeit", () => {
	it("rechnet UTC in Berliner Zeit um (Sommerzeit)", () => {
		expect(berlinerZeit(new Date("2026-09-13T15:30:00Z"))).toEqual({
			datum: "2026-09-13",
			stunde: 17,
		});
		// kurz vor Mitternacht in Berlin ist der Tag noch der Wahltag
		expect(berlinerZeit(new Date("2026-09-13T21:59:00Z"))).toEqual({
			datum: "2026-09-13",
			stunde: 23,
		});
		// eine Minute später ist es der Folgetag
		expect(berlinerZeit(new Date("2026-09-13T22:01:00Z"))).toEqual({
			datum: "2026-09-14",
			stunde: 0,
		});
	});
});

describe("istWahlabend", () => {
	const termine = [wahltag, archiv];
	it("gilt am Wahltag ab 17 Uhr Berliner Zeit", () => {
		expect(istWahlabend(new Date("2026-09-13T15:00:00Z"), termine)).toBe(true); // 17 Uhr
		expect(istWahlabend(new Date("2026-09-13T20:00:00Z"), termine)).toBe(true); // 22 Uhr
	});
	it("gilt vorher am selben Tag nicht", () => {
		expect(istWahlabend(new Date("2026-09-13T09:00:00Z"), termine)).toBe(false); // 11 Uhr
	});
	it("gilt an anderen Tagen nicht, auch abends nicht", () => {
		expect(istWahlabend(new Date("2026-09-12T20:00:00Z"), termine)).toBe(false);
		expect(istWahlabend(new Date("2026-09-14T20:00:00Z"), termine)).toBe(false);
	});
	it("zählt nur Live-Termine – der Wahltag 2021 ist Archiv", () => {
		expect(istWahlabend(new Date("2021-09-12T20:00:00Z"), termine)).toBe(false);
	});
});

describe("takt", () => {
	it("wählt den engen Takt nur am Wahlabend", () => {
		expect(takt(new Date("2026-09-13T20:00:00Z"), [wahltag], 300, 60)).toBe(60);
		expect(takt(new Date("2026-09-10T20:00:00Z"), [wahltag], 300, 60)).toBe(
			300,
		);
	});
});
