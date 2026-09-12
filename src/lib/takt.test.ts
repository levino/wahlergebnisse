import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TERMINE, type Termin } from "../data/termine.ts";
import {
	type Abstaende,
	type Lage,
	NACHLAUF_DATEI,
	STANDARD_NACHLAUF,
	berlinerZeit,
	faelligeKreise,
	istWahlabend,
	letzteAenderung,
	liesNachlauf,
	nachlaufPfad,
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
		expect(berlinerZeit(new Date("2026-09-13T21:59:00Z"))).toEqual({
			datum: "2026-09-13",
			stunde: 23,
		});
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

describe("Die Wahlnacht", () => {
	const termine = [wahltag, archiv];
	const kurzVorMitternacht = new Date("2026-09-13T21:59:00Z");
	const kurzNachMitternacht = new Date("2026-09-13T22:01:00Z");
	const zaehltNoch = (jetzt: Date): Lage => ({
		letzteAenderung: jetzt.getTime() - 60_000,
	});

	it("berechnet die beiden Zeitpunkte in Berliner Zeit", () => {
		expect(berlinerZeit(kurzVorMitternacht)).toEqual({
			datum: "2026-09-13",
			stunde: 23,
		});
		expect(berlinerZeit(kurzNachMitternacht)).toEqual({
			datum: "2026-09-14",
			stunde: 0,
		});
	});

	it("hält den schnellen Takt über Mitternacht, solange ausgezählt wird", () => {
		expect(
			stufe(kurzVorMitternacht, termine, zaehltNoch(kurzVorMitternacht)),
		).toBe("wahlabend");
		expect(
			stufe(kurzNachMitternacht, termine, zaehltNoch(kurzNachMitternacht)),
		).toBe("wahlabend");
	});

	it("fragt den betrachteten Kreis auch nach Mitternacht binnen einer Minute erneut", () => {
		const kreise = ["hildesheim", "holzminden"];
		const geholt = new Map(
			kreise.map((k) => [k, kurzNachMitternacht.getTime() - 90_000]),
		);
		const gesehen = new Map([
			["hildesheim", kurzNachMitternacht.getTime() - 30_000],
		]);
		const auftrag = { jetzt: kurzNachMitternacht, termine, kreise, gesehen };
		expect(
			faelligeKreise({
				...auftrag,
				geholt,
				lage: zaehltNoch(kurzNachMitternacht),
			}),
		).toEqual(["hildesheim"]);
		expect(faelligeKreise({ ...auftrag, geholt })).toEqual([]);
	});

	it("braucht vor Mitternacht keine Zahlen – da ist Wahlabend, weil Wahltag ist", () => {
		expect(stufe(kurzVorMitternacht, termine)).toBe("wahlabend");
	});

	it("endet, wenn der Nachlauf ohne eine neue Zahl verstreicht", () => {
		const ausgezaehlt: Lage = {
			letzteAenderung:
				kurzNachMitternacht.getTime() - STANDARD_NACHLAUF.ms - 60_000,
		};
		expect(stufe(kurzNachMitternacht, termine, ausgezaehlt)).toBe("wahltag");
		expect(istWahlabend(kurzNachMitternacht, termine, ausgezaehlt)).toBe(false);
	});

	it("läuft nicht ewig: ab der Ende-Stunde ist auch der Nachzügler Alltag", () => {
		const fuenfUhr = new Date("2026-09-14T03:00:00Z");
		expect(berlinerZeit(fuenfUhr).stunde).toBe(5);
		expect(stufe(fuenfUhr, termine, zaehltNoch(fuenfUhr))).toBe("ruhig");
	});

	it("gilt nur in der Nacht nach einem Wahltag", () => {
		const andereNacht = new Date("2026-09-11T22:01:00Z");
		expect(stufe(andereNacht, termine, zaehltNoch(andereNacht))).toBe("ruhig");
	});

	it("gilt auch in der Nacht nach der Stichwahl", () => {
		const nachDerStichwahl = new Date("2026-09-27T22:01:00Z");
		expect(stufe(nachDerStichwahl, TERMINE, zaehltNoch(nachDerStichwahl))).toBe(
			"wahlabend",
		);
	});
});

describe("letzteAenderung", () => {
	it("nimmt den jüngsten Stempel und übergeht, was keiner ist", () => {
		expect(
			letzteAenderung([
				"2026-09-13T22:00:00.000Z",
				undefined,
				"nichts",
				"2026-09-13T22:05:00.000Z",
			]),
		).toBe(Date.parse("2026-09-13T22:05:00.000Z"));
	});
	it("ergibt ohne brauchbaren Stempel nichts", () => {
		expect(letzteAenderung([undefined, ""])).toBeUndefined();
	});
});

describe("Die Stellschraube neben der Datenbank", () => {
	const mitVerzeichnis = (fn: (dbPfad: string) => void): void => {
		const dir = mkdtempSync(join(tmpdir(), "takt-"));
		try {
			fn(join(dir, "wahlen.db"));
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	};

	it("gilt ohne Datei und ohne Umgebung in der Vorgabe", () => {
		mitVerzeichnis((dbPfad) => {
			expect(liesNachlauf(nachlaufPfad(dbPfad), {})).toEqual(STANDARD_NACHLAUF);
		});
	});

	it("nimmt Minuten und Ende-Stunde aus der Datei – ohne Neustart", () => {
		mitVerzeichnis((dbPfad) => {
			const pfad = nachlaufPfad(dbPfad);
			expect(pfad.endsWith(NACHLAUF_DATEI)).toBe(true);
			writeFileSync(
				pfad,
				JSON.stringify({ nachlaufMinuten: 30, endeStunde: 3 }),
			);
			expect(liesNachlauf(pfad, {})).toEqual({
				ms: 30 * 60_000,
				endeStunde: 3,
			});
		});
	});

	it("lässt die Datei die Umgebung überstimmen und Unsinn die Vorgabe nicht", () => {
		mitVerzeichnis((dbPfad) => {
			const pfad = nachlaufPfad(dbPfad);
			const umgebung = {
				WAHLABEND_NACHLAUF_MINUTEN: "60",
				WAHLABEND_ENDE_STUNDE: "4",
			};
			expect(liesNachlauf(pfad, umgebung)).toEqual({
				ms: 60 * 60_000,
				endeStunde: 4,
			});
			writeFileSync(pfad, JSON.stringify({ nachlaufMinuten: 240 }));
			expect(liesNachlauf(pfad, umgebung)).toEqual({
				ms: 240 * 60_000,
				endeStunde: 4,
			});
			writeFileSync(pfad, "{kaputt");
			expect(liesNachlauf(pfad, umgebung)).toEqual({
				ms: 60 * 60_000,
				endeStunde: 4,
			});
		});
	});

	it("stellt den Wahlabend am Abend um, ohne dass Code neu ausgerollt wird", () => {
		mitVerzeichnis((dbPfad) => {
			const pfad = nachlaufPfad(dbPfad);
			const termine = [wahltag, archiv];
			const jetzt = new Date("2026-09-14T00:30:00Z");
			const lage = (): Lage => ({
				letzteAenderung: jetzt.getTime() - 100 * 60_000,
				nachlauf: liesNachlauf(pfad, {}),
			});
			expect(stufe(jetzt, termine, lage())).toBe("wahlabend");
			writeFileSync(pfad, JSON.stringify({ nachlaufMinuten: 60 }));
			expect(stufe(jetzt, termine, lage())).toBe("wahltag");
		});
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

describe("faelligeKreise: Kreise ohne Daten", () => {
	const jetzt = new Date("2026-09-07T12:00:00Z");
	const vorZweiStunden = jetzt.getTime() - 2 * 3600 * 1000;
	const basis = {
		jetzt,
		termine: [],
		kreise: ["wolfsburg", "peine"],
		gesehen: new Map<string, number>(),
		geholt: new Map([
			["wolfsburg", vorZweiStunden],
			["peine", vorZweiStunden],
		]),
		abstaende: {
			ruhig: { betrachtet: 900, uebrig: 21_600 },
			wahltag: { betrachtet: 300, uebrig: 1800 },
			wahlabend: { betrachtet: 60, uebrig: 180 },
		},
		hoechstens: 10,
	};

	it("ohne die Ausnahme bleibt der leere Kreis sechs Stunden liegen", () => {
		expect(faelligeKreise(basis)).toEqual([]);
	});

	it("mit der Ausnahme ist er nach dem Nachschau-Takt wieder dran", () => {
		expect(
			faelligeKreise({ ...basis, ohneDaten: new Set(["wolfsburg"]) }),
		).toEqual(["wolfsburg"]);
	});

	it("die Ausnahme verkürzt nur, sie verlängert nie", () => {
		const abstaende = {
			...basis.abstaende,
			ruhig: { betrachtet: 60, uebrig: 180 },
		};
		expect(
			faelligeKreise({
				...basis,
				abstaende,
				ohneDaten: new Set(["wolfsburg"]),
			}),
		).toEqual(["wolfsburg", "peine"]);
	});
});

describe("Stichwahltag", () => {
	it("gilt ab 17 Uhr als Wahlabend", () => {
		expect(stufe(new Date("2026-09-27T15:30:00Z"), TERMINE)).toBe("wahlabend"); // 17:30 Berlin
	});
	it("gilt tagsüber als Wahltag", () => {
		expect(stufe(new Date("2026-09-27T08:00:00Z"), TERMINE)).toBe("wahltag");
	});
	it("dazwischen bleibt es ruhig", () => {
		expect(stufe(new Date("2026-09-20T15:30:00Z"), TERMINE)).toBe("ruhig");
	});
});
