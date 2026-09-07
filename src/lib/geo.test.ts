import { describe, expect, test } from "vitest";
import {
	GEMEINDEN,
	KREISE_MIT_GEMEINDEN,
	bbox,
	gemeindenFuerBehoerde,
	gemeindenFuerKreis,
	kreisSchluessel,
	ortsteileFuer,
	ortsteileFuerKreis,
	wahllokalFuer,
	wahllokaleFuerKreis,
} from "./geo.ts";

const HILDESHEIM = "03254";

describe("Gemeindegrenzen", () => {
	test("liegen für alle 45 niedersächsischen Kreise vor", () => {
		expect(KREISE_MIT_GEMEINDEN).toHaveLength(45);
		expect(GEMEINDEN).toHaveLength(964);
		// Jeder Kreis muss mindestens eine Fläche haben – eine leere Datei wäre
		// eine Karte ohne Inhalt, und das soll auffallen.
		for (const k of KREISE_MIT_GEMEINDEN)
			expect(gemeindenFuerKreis(k).length).toBeGreaterThan(0);
	});

	test("haben durchweg eine Geometrie in Niedersachsen", () => {
		for (const f of GEMEINDEN) {
			expect(f.geometry, f.properties.name).toBeTruthy();
			expect(f.properties.ags).toMatch(/^03\d{6}$/);
		}
		const b = bbox(GEMEINDEN);
		expect(b).toBeDefined();
		const [[minLon, minLat], [maxLon, maxLat]] = b as [
			[number, number],
			[number, number],
		];
		expect(minLon).toBeGreaterThan(6);
		expect(maxLon).toBeLessThan(12);
		expect(minLat).toBeGreaterThan(51);
		expect(maxLat).toBeLessThan(54.5);
	});

	test("sind je Kreis stabil nach Gemeindeschlüssel sortiert", () => {
		for (const k of KREISE_MIT_GEMEINDEN) {
			const ags = gemeindenFuerKreis(k).map((f) => f.properties.ags);
			expect(ags).toEqual([...ags].sort());
			expect(new Set(ags).size).toBe(ags.length);
		}
	});

	test("ordnen Samtgemeinde-Mitglieder ihrer Behörde zu", () => {
		const leinebergland = gemeindenFuerBehoerde("032545406");
		expect(leinebergland.map((f) => f.properties.name).sort()).toEqual([
			"Duingen",
			"Eime",
			"Gronau (Leine)",
		]);
		expect(leinebergland.every((f) => f.properties.samtgemeinde)).toBe(true);
		// Einheitsgemeinde: die Behörde ist die Gemeinde selbst
		expect(
			gemeindenFuerBehoerde("03254026").map((f) => f.properties.name),
		).toEqual(["Nordstemmen"]);
	});

	test("finden Behörden auch außerhalb Hildesheims", () => {
		// Stadt Oldenburg (kreisfrei) und Stadt Göttingen: beide liegen in
		// anderen Kreisen, dürfen aber genauso auflösbar sein.
		expect(gemeindenFuerBehoerde("03403000")).toHaveLength(1);
		expect(gemeindenFuerBehoerde("03159016")[0]?.properties.name).toBe(
			"Göttingen",
		);
	});

	test("kreisSchluessel schneidet 8- wie 9-stellige Schlüssel zu", () => {
		expect(kreisSchluessel("03254000")).toBe(HILDESHEIM);
		expect(kreisSchluessel("032545406")).toBe(HILDESHEIM);
		expect(kreisSchluessel(HILDESHEIM)).toBe(HILDESHEIM);
	});
});

describe("Kreis ohne Ortsteil- und Wahllokaldaten", () => {
	// Ortsteile (LGLN-Gemarkungen) und Wahllokale (eigene Geokodierung) sind pro
	// Kreis Handarbeit und gibt es bisher nur für Hildesheim. Überall sonst muss
	// die Karte das klaglos aushalten und einfach nur Gemeinden zeigen.
	const andere = KREISE_MIT_GEMEINDEN.filter((k) => k !== HILDESHEIM);

	test("betrifft alle Kreise außer Hildesheim", () => {
		expect(ortsteileFuerKreis(HILDESHEIM).length).toBeGreaterThan(0);
		expect(wahllokaleFuerKreis(HILDESHEIM).length).toBeGreaterThan(0);
		for (const k of andere) {
			expect(ortsteileFuerKreis(k), k).toEqual([]);
			expect(wahllokaleFuerKreis(k), k).toEqual([]);
		}
	});

	test("liefert leere Listen statt Fehlern", () => {
		const goettingen = gemeindenFuerKreis("03159").map((f) => f.properties.ags);
		expect(ortsteileFuer(goettingen, "Weende")).toEqual([]);
		expect(wahllokalFuer("2026", "03159016", "1")).toBeUndefined();
		// Und die Gemeindeflächen sind trotzdem da – die Karte hat etwas zu zeigen.
		expect(goettingen.length).toBeGreaterThan(0);
	});

	test("unbekannter Kreis ist kein Sonderfall", () => {
		expect(gemeindenFuerKreis("09999")).toEqual([]);
		expect(ortsteileFuerKreis("09999")).toEqual([]);
		expect(wahllokaleFuerKreis("09999")).toEqual([]);
		expect(bbox([])).toBeUndefined();
	});
});
