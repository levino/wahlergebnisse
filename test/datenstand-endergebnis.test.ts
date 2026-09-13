import { describe, expect, it } from "vitest";
import type { ErgebnisZeile } from "../src/lib/abfragen.ts";
import { type SitzModell, datenstandVon } from "../src/lib/wahlkern.ts";

const zeile = (anz: number | null, max: number | null): ErgebnisZeile =>
	({ standAnz: anz, standMax: max }) as ErgebnisZeile;

const sitze = (quelle: SitzModell["quelle"]): SitzModell =>
	({ quelle, art: "amtlich", gesamt: 7, verteilung: [] }) as SitzModell;

describe("Wann ein Datenstand Endergebnis heißen darf", () => {
	it("sagt es nicht, solange Schnellmeldungen fehlen", () => {
		// Ortsratswahl Burgstemmen, Wahlabend 2026: die Wahlleitung führte die
		// Sitzverteilung bei 1 von 2 Schnellmeldungen. Daraus wurde „Endergebnis
		// steht" – angesagt, während daneben „1 von 2" stand.
		const d = datenstandVon(
			zeile(1, 2),
			"Vorläufiges Ergebnis",
			sitze("amtlich"),
			undefined,
		);
		expect(d.art).toBe("zwischenstand");
		expect(d.text).toContain("1 von 2 Schnellmeldungen");
	});

	it("sagt es, sobald alle Schnellmeldungen da sind", () => {
		expect(
			datenstandVon(
				zeile(2, 2),
				"Endgültiges Ergebnis",
				sitze("amtlich"),
				undefined,
			).art,
		).toBe("endergebnis");
	});

	it("sagt es auch ohne bekannten Auszählstand – dann trägt es die Sitzverteilung", () => {
		// Ohne `standMax` gibt es nichts, was der Sitzverteilung widerspricht.
		expect(
			datenstandVon(zeile(null, null), undefined, sitze("amtlich"), undefined)
				.art,
		).toBe("endergebnis");
	});

	it("bleibt bei vollständiger Zählung ohne Sitzverteilung ein Endergebnis", () => {
		expect(
			datenstandVon(zeile(24, 24), "Vorläufiges Ergebnis", undefined, undefined)
				.art,
		).toBe("endergebnis");
	});

	it("nennt eine eigene Hochrechnung nicht Endergebnis", () => {
		expect(
			datenstandVon(zeile(1, 2), undefined, sitze("hochrechnung"), undefined)
				.art,
		).toBe("hochrechnung");
	});
});
