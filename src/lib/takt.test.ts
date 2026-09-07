import { describe, expect, it } from "vitest";
import type { Termin } from "../data/termine.ts";
import {
	type Abstaende,
	berlinerZeit,
	faelligeKreise,
	istWahlabend,
	stufe,
} from "./takt.ts";

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

describe("stufe", () => {
	const termine = [wahltag, archiv];
	it("unterscheidet gewöhnliche Tage, Wahltag und Wahlabend", () => {
		expect(stufe(new Date("2026-09-10T20:00:00Z"), termine)).toBe("ruhig");
		expect(stufe(new Date("2026-09-13T09:00:00Z"), termine)).toBe("wahltag");
		expect(stufe(new Date("2026-09-13T20:00:00Z"), termine)).toBe("wahlabend");
	});
});

describe("faelligeKreise", () => {
	const termine = [wahltag];
	const kreise = ["hildesheim", "holzminden", "braunschweig"];
	const abstaende: Abstaende = {
		ruhig: { betrachtet: 900, uebrig: 86_400 },
		wahltag: { betrachtet: 300, uebrig: 3_600 },
		wahlabend: { betrachtet: 60, uebrig: 900 },
	};
	const ruhig = new Date("2026-09-10T12:00:00Z");
	const abend = new Date("2026-09-13T20:00:00Z");
	const vorHin = (bezug: Date, sekunden: number) =>
		bezug.getTime() - sekunden * 1000;

	it("nimmt beim ersten Lauf alle mit – noch ist nichts geholt", () => {
		expect(
			faelligeKreise({
				jetzt: ruhig,
				termine,
				kreise,
				gesehen: new Map(),
				geholt: new Map(),
				abstaende,
			}),
		).toHaveLength(3);
	});

	it("lässt an gewöhnlichen Tagen einen frisch geholten Kreis liegen", () => {
		const geholt = new Map(kreise.map((k) => [k, vorHin(ruhig, 3600)]));
		expect(
			faelligeKreise({
				jetzt: ruhig,
				termine,
				kreise,
				gesehen: new Map(),
				geholt,
				abstaende,
			}),
		).toEqual([]);
		// erst nach einem Tag wieder
		expect(
			faelligeKreise({
				jetzt: ruhig,
				termine,
				kreise,
				gesehen: new Map(),
				geholt: new Map(kreise.map((k) => [k, vorHin(ruhig, 90_000)])),
				abstaende,
			}),
		).toHaveLength(3);
	});

	it("zieht den gerade betrachteten Kreis vor", () => {
		const geholt = new Map(kreise.map((k) => [k, vorHin(ruhig, 3600)]));
		const gesehen = new Map([["holzminden", vorHin(ruhig, 60)]]);
		expect(
			faelligeKreise({
				jetzt: ruhig,
				termine,
				kreise,
				gesehen,
				geholt,
				abstaende,
			}),
		).toEqual(["holzminden"]);
	});

	it("vergisst einen Kreis wieder, wenn niemand mehr hinsieht", () => {
		const geholt = new Map(kreise.map((k) => [k, vorHin(ruhig, 3600)]));
		// Der Aufruf liegt länger zurück als die Frist von 15 Minuten.
		const gesehen = new Map([["holzminden", vorHin(ruhig, 1800)]]);
		expect(
			faelligeKreise({
				jetzt: ruhig,
				termine,
				kreise,
				gesehen,
				geholt,
				abstaende,
			}),
		).toEqual([]);
	});

	it("fragt am Wahlabend alle Kreise ab, den betrachteten zuerst", () => {
		const geholt = new Map(kreise.map((k) => [k, vorHin(abend, 1000)]));
		const gesehen = new Map([["braunschweig", vorHin(abend, 30)]]);
		expect(
			faelligeKreise({
				jetzt: abend,
				termine,
				kreise,
				gesehen,
				geholt,
				abstaende,
			}),
		).toEqual(["braunschweig", "hildesheim", "holzminden"]);
		// Nach 100 Sekunden ist nur noch der betrachtete dran.
		expect(
			faelligeKreise({
				jetzt: abend,
				termine,
				kreise,
				gesehen,
				geholt: new Map(kreise.map((k) => [k, vorHin(abend, 100)])),
				abstaende,
			}),
		).toEqual(["braunschweig"]);
	});

	it("deckelt, wie viele Kreise ein Lauf anfasst, und nimmt die überfälligsten", () => {
		const geholt = new Map([
			["hildesheim", vorHin(ruhig, 100_000)],
			["holzminden", vorHin(ruhig, 200_000)],
			["braunschweig", vorHin(ruhig, 300_000)],
		]);
		expect(
			faelligeKreise({
				jetzt: ruhig,
				termine,
				kreise,
				gesehen: new Map(),
				geholt,
				abstaende,
				hoechstens: 2,
			}),
		).toEqual(["braunschweig", "holzminden"]);
	});
});
