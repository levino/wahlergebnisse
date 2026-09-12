/** Wann die Zustellung als tot gilt – und wann wieder angeklopft wird. */
import { describe, expect, it } from "vitest";
import {
	ABSTAENDE_MS,
	NACHSICHT_MS,
	PULS_AUSBLEIBEN_MS,
	abstandFuer,
	brauchtNeueLeitung,
	zustandVon,
} from "./verbindung.ts";

const JETZT = 1_000_000;
const lage = (a: Partial<Parameters<typeof zustandVon>[0]> = {}) => ({
	readyState: 1,
	letzterKontakt: JETZT,
	verbindetSeit: JETZT,
	ohneLeitungSeit: JETZT,
	jetzt: JETZT,
	...a,
});

describe("zustandVon", () => {
	it("nennt eine offene Leitung mit frischem Puls verbunden", () => {
		expect(zustandVon(lage())).toBe("verbunden");
	});

	it("erkennt den hängenden Socket, den der Browser für gesund hält", () => {
		expect(
			zustandVon(lage({ jetzt: JETZT + PULS_AUSBLEIBEN_MS + 1_000 })),
		).toBe("unterbrochen");
	});

	it("gibt einem Pod-Wechsel ein paar Sekunden, bevor sie rot wird", () => {
		expect(zustandVon(lage({ readyState: 0, jetzt: JETZT + 3_000 }))).toBe(
			"verbindet",
		);
		expect(
			zustandVon(lage({ readyState: 0, jetzt: JETZT + NACHSICHT_MS + 1_000 })),
		).toBe("unterbrochen");
	});

	it("schont das frisch geöffnete Fenster, das noch nie Kontakt hatte", () => {
		expect(
			zustandVon(
				lage({ readyState: 0, letzterKontakt: 0, jetzt: JETZT + 3_000 }),
			),
		).toBe("verbindet");
		expect(
			zustandVon(
				lage({
					readyState: 0,
					letzterKontakt: 0,
					jetzt: JETZT + NACHSICHT_MS + 1_000,
				}),
			),
		).toBe("unterbrochen");
	});

	it("bleibt rot, während der nächste Versuch anläuft", () => {
		const abriss = JETZT;
		const jetzt = abriss + 40_000;
		expect(
			zustandVon(
				lage({
					readyState: 0,
					letzterKontakt: abriss - 5_000,
					ohneLeitungSeit: abriss,
					verbindetSeit: jetzt,
					jetzt,
				}),
			),
		).toBe("unterbrochen");
	});

	it("blitzt beim kurzen Aussetzer nicht auf, egal wann der Puls kam", () => {
		expect(
			zustandVon(
				lage({
					readyState: 2,
					letzterKontakt: JETZT - 19_000,
					ohneLeitungSeit: JETZT,
					jetzt: JETZT + 2_000,
				}),
			),
		).toBe("verbindet");
	});

	it("schweigt die tote Leitung nicht mit einem neuen Anlauf schön", () => {
		expect(
			zustandVon(
				lage({
					readyState: 0,
					letzterKontakt: JETZT - PULS_AUSBLEIBEN_MS - 1_000,
					jetzt: JETZT,
				}),
			),
		).toBe("unterbrochen");
	});
});

describe("brauchtNeueLeitung", () => {
	it("baut nach einer Fehlerantwort selbst wieder auf", () => {
		expect(brauchtNeueLeitung(lage({ readyState: 2 }))).toBe(true);
	});

	it("lässt eine gesunde Leitung in Ruhe", () => {
		expect(brauchtNeueLeitung(lage())).toBe(false);
		expect(
			brauchtNeueLeitung(lage({ readyState: 0, jetzt: JETZT + 2_000 })),
		).toBe(false);
	});

	it("ersetzt den hängenden Socket", () => {
		expect(
			brauchtNeueLeitung(lage({ jetzt: JETZT + PULS_AUSBLEIBEN_MS + 1_000 })),
		).toBe(true);
	});

	it("gibt einen Versuch auf, der nie zustande kommt", () => {
		expect(
			brauchtNeueLeitung(
				lage({ readyState: 0, jetzt: JETZT + NACHSICHT_MS + 1_000 }),
			),
		).toBe(true);
	});

	it("lässt dem frischen Versuch im langen Ausfall seine Zeit", () => {
		const jetzt = JETZT + 40_000;
		expect(
			brauchtNeueLeitung(
				lage({
					readyState: 0,
					letzterKontakt: JETZT - 5_000,
					ohneLeitungSeit: JETZT,
					verbindetSeit: jetzt - 2_000,
					jetzt,
				}),
			),
		).toBe(false);
	});
});

describe("abstandFuer", () => {
	it("klopft zuerst schnell und dann in gleichmäßigem Abstand an", () => {
		expect(abstandFuer(0)).toBe(ABSTAENDE_MS[0]);
		expect(abstandFuer(2)).toBeGreaterThan(abstandFuer(0));
	});

	it("gibt niemals auf", () => {
		expect(abstandFuer(1_000)).toBe(ABSTAENDE_MS[ABSTAENDE_MS.length - 1]);
		expect(abstandFuer(1_000)).toBeLessThanOrEqual(5_000);
	});
});
