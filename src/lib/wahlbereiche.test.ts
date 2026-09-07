import { describe, expect, it } from "vitest";
import {
	gemeindenImWahlbereich,
	sammleWahlbereiche,
	wahlbereichKuerzel,
	wahlbereichName,
} from "./wahlbereiche.ts";

/**
 * Wahlräume, wie votemanager sie liefert: eine Zeile je Wahlraum, der
 * Kreiswahlbereich als Buchstabe daneben. Erfunden, aber im Zuschnitt echt –
 * Elze und Nordstemmen teilen sich einen Bereich, die Stadt Hildesheim ist auf
 * mehrere aufgeteilt.
 */
const RAEUME = [
	{ gemeinde: "Sarstedt", kreiswahlbereich: "A" },
	{ gemeinde: "Sarstedt", kreiswahlbereich: "A" },
	{ gemeinde: "Algermissen", kreiswahlbereich: "A" },
	{ gemeinde: "Nordstemmen", kreiswahlbereich: "B" },
	{ gemeinde: "Nordstemmen", kreiswahlbereich: "B" },
	{ gemeinde: "Elze", kreiswahlbereich: "B" },
	{ gemeinde: "Hildesheim", kreiswahlbereich: "F" },
	{ gemeinde: "Hildesheim", kreiswahlbereich: "G" },
	{ gemeinde: "Hildesheim", kreiswahlbereich: "G" },
	{ gemeinde: "Hildesheim", kreiswahlbereich: "H" },
];

const WAHLBEREICHE = sammleWahlbereiche(RAEUME);

describe("sammleWahlbereiche", () => {
	it("fasst die Gemeinden je Buchstabe zusammen, ohne Dubletten", () => {
		expect([...(WAHLBEREICHE.get("A") ?? [])]).toEqual([
			"Algermissen",
			"Sarstedt",
		]);
		expect([...(WAHLBEREICHE.get("B") ?? [])]).toEqual(["Elze", "Nordstemmen"]);
	});

	it("führt eine auf mehrere Bereiche aufgeteilte Stadt in jedem davon", () => {
		expect([...(WAHLBEREICHE.get("F") ?? [])]).toEqual(["Hildesheim"]);
		expect([...(WAHLBEREICHE.get("G") ?? [])]).toEqual(["Hildesheim"]);
		expect([...(WAHLBEREICHE.get("H") ?? [])]).toEqual(["Hildesheim"]);
	});

	it("übergeht Zeilen ohne Kreiswahlbereich", () => {
		// So sehen die Wahlräume eines Termins aus, dessen Präsentation die
		// Spalte (noch) nicht führt.
		const leer = sammleWahlbereiche([
			{ gemeinde: "Holle" },
			{ gemeinde: "Söhlde", kreiswahlbereich: "" },
		]);
		expect(leer.size).toBe(0);
	});

	it("sortiert nach deutschem Alphabet", () => {
		const wb = sammleWahlbereiche([
			{ gemeinde: "Söhlde", kreiswahlbereich: "K" },
			{ gemeinde: "Schellerten", kreiswahlbereich: "K" },
			{ gemeinde: "Holle", kreiswahlbereich: "K" },
		]);
		expect([...(wb.get("K") ?? [])]).toEqual([
			"Holle",
			"Schellerten",
			"Söhlde",
		]);
	});
});

describe("wahlbereichKuerzel", () => {
	it("erkennt den blanken Buchstaben (2021) und die ausgeschriebene Form (2026)", () => {
		expect(wahlbereichKuerzel("B")).toBe("B");
		expect(wahlbereichKuerzel("Wahlbereich B")).toBe("B");
		expect(wahlbereichKuerzel("Kreiswahlbereich B")).toBe("B");
	});

	it("nimmt bei Zusätzen den Buchstaben hinter dem Wort", () => {
		expect(wahlbereichKuerzel("Wahlbereich F Nord")).toBe("F");
	});

	it("rät nicht, wenn nichts erkennbar ist", () => {
		expect(wahlbereichKuerzel("Gemeinde Nordstemmen")).toBeUndefined();
		expect(wahlbereichKuerzel("")).toBeUndefined();
		expect(wahlbereichKuerzel(undefined)).toBeUndefined();
	});
});

describe("gemeindenImWahlbereich", () => {
	it("liefert die Gemeinden zum Kürzel", () => {
		expect([...gemeindenImWahlbereich("B", WAHLBEREICHE)]).toEqual([
			"Elze",
			"Nordstemmen",
		]);
	});

	it("liefert nichts für einen unbekannten Bereich", () => {
		expect(gemeindenImWahlbereich("Z", WAHLBEREICHE)).toEqual([]);
	});
});

describe("wahlbereichName", () => {
	it("hängt die Gemeinden an den Buchstaben", () => {
		expect(wahlbereichName("B", WAHLBEREICHE)).toBe(
			"Wahlbereich B (Elze, Nordstemmen)",
		);
		expect(wahlbereichName("Wahlbereich B", WAHLBEREICHE)).toBe(
			"Wahlbereich B (Elze, Nordstemmen)",
		);
	});

	it("nennt eine geteilte Stadt in jedem ihrer Bereiche", () => {
		expect(wahlbereichName("G", WAHLBEREICHE)).toBe(
			"Wahlbereich G (Hildesheim)",
		);
	});

	it("bleibt beim Buchstaben, wenn die Zuordnung fehlt", () => {
		expect(wahlbereichName("M", WAHLBEREICHE)).toBe("Wahlbereich M");
		expect(wahlbereichName("A", new Map())).toBe("Wahlbereich A");
	});

	it("lässt eine nicht deutbare Bezeichnung unverändert", () => {
		expect(wahlbereichName("Gemeinde Nordstemmen", WAHLBEREICHE)).toBe(
			"Gemeinde Nordstemmen",
		);
	});
});
