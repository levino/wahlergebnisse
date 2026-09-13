import { describe, expect, it } from "vitest";
import { formatGeprueft } from "../src/lib/zahlen.ts";

const jetzt = Date.parse("2026-09-13T19:15:30+02:00");
const vor = (sekunden: number) =>
	new Date(jetzt - sekunden * 1000).toISOString();

describe("formatGeprueft", () => {
	it("nennt den Abstand, nicht eine zweite Uhrzeit", () => {
		// Der Fall aus dem Wahlabend: Stand 19:14, geprüft 19:15.
		expect(formatGeprueft(vor(70), jetzt)).toBe("vor 1 Minute geprüft");
	});

	it("sagt bei einer frischen Abfrage, dass sie gerade lief", () => {
		expect(formatGeprueft(vor(0), jetzt)).toBe("gerade geprüft");
		expect(formatGeprueft(vor(59), jetzt)).toBe("gerade geprüft");
	});

	it("zählt Minuten und danach Stunden", () => {
		expect(formatGeprueft(vor(120), jetzt)).toBe("vor 2 Minuten geprüft");
		expect(formatGeprueft(vor(59 * 60), jetzt)).toBe("vor 59 Minuten geprüft");
		expect(formatGeprueft(vor(60 * 60), jetzt)).toBe("vor 1 Stunde geprüft");
		expect(formatGeprueft(vor(3 * 3600), jetzt)).toBe("vor 3 Stunden geprüft");
	});

	it("rechnet eine Abfrage aus der Zukunft nicht negativ", () => {
		// Der Poller schreibt geprueft und version im selben Zug; die
		// Reihenfolge kann eine Millisekunde kippen.
		expect(formatGeprueft(new Date(jetzt + 5).toISOString(), jetzt)).toBe(
			"gerade geprüft",
		);
	});

	it("bleibt bei Unsinn und Leerem stumm", () => {
		expect(formatGeprueft(undefined, jetzt)).toBe("");
		expect(formatGeprueft("", jetzt)).toBe("");
		expect(formatGeprueft("kein Datum", jetzt)).toBe("");
	});
});
