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
	jetzt: JETZT,
	...a,
});

describe("zustandVon", () => {
	it("nennt eine offene Leitung mit frischem Puls verbunden", () => {
		expect(zustandVon(lage())).toBe("verbunden");
	});

	it("erkennt den hängenden Socket, den der Browser für gesund hält", () => {
		// Kein Fehler, kein Abriss – nur seit einer Minute kein Puls. Das ist
		// der Zustand, in dem eine Leinwand stillsteht und „Live" behauptet.
		expect(
			zustandVon(lage({ jetzt: JETZT + PULS_AUSBLEIBEN_MS + 1_000 })),
		).toBe("unterbrochen");
	});

	it("gibt einem Pod-Wechsel ein paar Sekunden, bevor sie rot wird", () => {
		// Beim Ausrollen reißt die Leitung ab und ist in Sekunden zurück. Rot
		// wäre hier Fehlalarm bei jedem Deploy.
		expect(zustandVon(lage({ readyState: 0, jetzt: JETZT + 3_000 }))).toBe(
			"verbindet",
		);
		expect(
			zustandVon(lage({ readyState: 0, jetzt: JETZT + NACHSICHT_MS + 1_000 })),
		).toBe("unterbrochen");
	});
});

describe("brauchtNeueLeitung", () => {
	it("baut nach einer Fehlerantwort selbst wieder auf", () => {
		// `readyState 2` heißt: Der Browser gibt von sich aus nie wieder an –
		// genau das passiert beim 502 während eines Pod-Wechsels. Ohne diesen
		// Anstoß bliebe die Seite für immer stehen.
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
});

describe("abstandFuer", () => {
	it("klopft zuerst schnell und dann in gleichmäßigem Abstand an", () => {
		expect(abstandFuer(0)).toBe(ABSTAENDE_MS[0]);
		expect(abstandFuer(2)).toBeGreaterThan(abstandFuer(0));
	});

	it("gibt niemals auf", () => {
		// Kein „nach zehn Versuchen ist Schluss": Wer am Wahlabend eine Stunde
		// lang keine Verbindung hatte, soll sie in der nächsten Sekunde wieder
		// bekommen, sobald der Server zurück ist.
		expect(abstandFuer(1_000)).toBe(ABSTAENDE_MS[ABSTAENDE_MS.length - 1]);
		expect(abstandFuer(1_000)).toBeLessThanOrEqual(5_000);
	});
});
