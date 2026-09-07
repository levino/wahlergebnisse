import { describe, expect, it } from "vitest";
import {
	ordneCsvsZuWahlen,
	ordneListenplaetze,
	parseCsv,
	parteienAusOpenData,
	summiereKandidatenspalten,
} from "./liste.ts";

describe("parseCsv", () => {
	it("liest Semikolon-CSV mit BOM", () => {
		const r = parseCsv("﻿a;b\n1;2\n3;4\n");
		expect(r).toEqual([
			{ a: "1", b: "2" },
			{ a: "3", b: "4" },
		]);
	});
});

describe("summiereKandidatenspalten", () => {
	it("nimmt nur D<partei>_<platz> und summiert über alle Zeilen", () => {
		const r = summiereKandidatenspalten([
			{
				D1_liste: "100",
				D1_summe_kandidaten: "50",
				D1_1: "10",
				D1_2: "5",
				D2_1: "7",
			},
			{ D1_liste: "20", D1_1: "3", D1_2: "", D2_1: "1" },
		]);
		expect(r).toEqual([
			{ partei: 1, platz: 1, stimmen: 13 },
			{ partei: 1, platz: 2, stimmen: 5 },
			{ partei: 2, platz: 1, stimmen: 8 },
		]);
	});
});

describe("ordneListenplaetze", () => {
	const parteien = [
		{
			key: "spd",
			lang: "Sozialdemokratische Partei Deutschlands",
			kandidaten: [
				{ name: "Gerald Ludewig", stimmen: 1052 },
				{ name: "Dr. Cornelia Ott", stimmen: 744 },
				{ name: "Andreas Arlt", stimmen: 629 },
			],
		},
	];
	const nummern = new Map([[1, "Sozialdemokratische Partei Deutschlands"]]);

	it("ordnet über die Stimmenzahl den Listenplatz zu", () => {
		// CSV in Listenreihenfolge: Platz 1 = 1052, Platz 2 = 744, Platz 3 = 574, … Platz 9 = 629
		const spalten = [
			{ partei: 1, platz: 1, stimmen: 1052 },
			{ partei: 1, platz: 2, stimmen: 744 },
			{ partei: 1, platz: 3, stimmen: 574 },
			{ partei: 1, platz: 9, stimmen: 629 },
		];
		expect(ordneListenplaetze(parteien, spalten, nummern)).toEqual([
			{ parteiKey: "spd", platz: 1, name: "Gerald Ludewig", stimmen: 1052 },
			{ parteiKey: "spd", platz: 2, name: "Dr. Cornelia Ott", stimmen: 744 },
			{ parteiKey: "spd", platz: 9, name: "Andreas Arlt", stimmen: 629 },
		]);
	});

	it("lässt bei gleicher Stimmenzahl den Platz offen, statt zu raten", () => {
		const gleich = [
			{
				key: "cdu",
				lang: "CDU",
				kandidaten: [
					{ name: "A", stimmen: 100 },
					{ name: "B", stimmen: 100 },
				],
			},
		];
		const r = ordneListenplaetze(
			gleich,
			[
				{ partei: 1, platz: 1, stimmen: 100 },
				{ partei: 1, platz: 2, stimmen: 100 },
			],
			new Map([[1, "CDU"]]),
		);
		expect(r).toEqual([]);
	});

	it("überspringt Parteien ohne Zuordnung in der CSV", () => {
		expect(ordneListenplaetze(parteien, [], nummern)).toEqual([]);
		expect(
			ordneListenplaetze(
				parteien,
				[{ partei: 7, platz: 1, stimmen: 1052 }],
				new Map(),
			),
		).toEqual([]);
	});
});

describe("parteienAusOpenData", () => {
	it("liest die Partei-Nummern der passenden Datei", () => {
		const felder = [
			{
				name: "Gemeindewahl",
				parteien: [
					{ feld: "D1", wert: "SPD" },
					{ feld: "D2", wert: "CDU" },
				],
			},
			{
				name: "Ortsratswahl (Rössing)",
				parteien: [{ feld: "D1", wert: "SPD" }],
			},
		];
		expect(parteienAusOpenData(felder, "Gemeindewahl")).toEqual(
			new Map([
				[1, "SPD"],
				[2, "CDU"],
			]),
		);
		expect(parteienAusOpenData(felder, "Ortsratswahl (Rössing)")).toEqual(
			new Map([[1, "SPD"]]),
		);
		expect(parteienAusOpenData(felder, "gibtsnicht")).toEqual(new Map());
	});

	it("findet die Ortsratswahlen, die open_data je Ortschaft führt", () => {
		// Echte Einträge aus open_data.json der Gemeinde Nordstemmen 2021. Die
		// CSV-Liste nennt als Wahl nur "Ortsratswahl"; ohne den Rückfall auf die
		// Einträge mit Ortschaft im Namen bliebe die Zuordnung leer.
		const felder = [
			{
				name: "Ortsratswahl (Adensen)",
				parteien: [{ feld: "D5", wert: "Die Unabhängigen in Nordstemmen" }],
			},
			{
				name: "Ortsratswahl (Burgstemmen)",
				parteien: [
					{ feld: "D1", wert: "Sozialdemokratische Partei Deutschlands" },
					{ feld: "D13", wert: "Wählergemeinschaft Zukunft Burgstemmen" },
				],
			},
			{
				name: "Ortsratswahl (Klein Escherde)",
				parteien: [
					{ feld: "D1", wert: "Sozialdemokratische Partei Deutschlands" },
					{
						feld: "D2",
						wert: "Christlich Demokratische Union Deutschlands in Niedersachsen",
					},
					{ feld: "D13", wert: "Einzelwahlvorschlag Helbing" },
				],
			},
		];
		const m = parteienAusOpenData(felder, "Ortsratswahl");
		expect(m.get(1)).toBe("Sozialdemokratische Partei Deutschlands");
		expect(m.get(5)).toBe("Die Unabhängigen in Nordstemmen");
		// D13 meint in Burgstemmen etwas anderes als in Klein Escherde – dann
		// lieber keine Zuordnung als eine falsche.
		expect(m.has(13)).toBe(false);

		// Mit bekanntem Ort gilt allein dessen Eintrag – erst dadurch bekommt
		// die Wählergemeinschaft Zukunft Burgstemmen überhaupt Listenplätze.
		const b = parteienAusOpenData(felder, "Ortsratswahl", "Burgstemmen");
		expect(b.get(13)).toBe("Wählergemeinschaft Zukunft Burgstemmen");
		expect(b.has(2)).toBe(false);
		const k = parteienAusOpenData(felder, "Ortsratswahl", "Klein Escherde");
		expect(k.get(13)).toBe("Einzelwahlvorschlag Helbing");
	});

	it("legt bei unklarem Ort weiter alle Einträge zusammen", () => {
		const felder = [
			{
				name: "Ortsratswahl (Groß Escherde)",
				parteien: [{ feld: "D1", wert: "SPD" }],
			},
			{
				name: "Ortsratswahl (Klein Escherde)",
				parteien: [{ feld: "D1", wert: "SPD" }],
			},
		];
		// "Escherde" steckt in beiden Namen → kein eindeutiger Eintrag.
		expect(parteienAusOpenData(felder, "Ortsratswahl", "Escherde")).toEqual(
			new Map([[1, "SPD"]]),
		);
	});
});

describe("ordneCsvsZuWahlen", () => {
	// Echte Einträge aus open_data.json der Gemeinde Nordstemmen 2021: neun
	// Ortsratswahlen, die dort alle nur "Ortsratswahl" heißen und sich erst in
	// der Ebene durch die Ortschaft unterscheiden.
	const orte = [
		"Adensen",
		"Barnten",
		"Burgstemmen",
		"Groß Escherde",
		"Heyersum",
		"Klein Escherde",
		"Mahlerten",
		"Nordstemmen",
		"Rössing",
	];
	const ortsCsvs = orte.map((o) => ({
		wahl: "Ortsratswahl",
		ebene: `${o}: Übersicht über Wahlbezirke`,
		url: `Open-Data-03254026-Ortsratswahl-${o}.csv`,
	}));
	const gemeindeCsvs = [
		{
			wahl: "Gemeindewahl",
			ebene: "Gemeinde-Ergebnis",
			url: "Open-Data-03254026-Gemeindewahl-Gemeinde.csv",
		},
		{
			wahl: "Gemeindewahl",
			ebene: "Übersicht über Ortsteile",
			url: "Open-Data-03254026-Gemeindewahl-Ortsteil.csv",
		},
		{
			wahl: "Gemeindewahl",
			ebene: "Übersicht über Wahlbereiche",
			url: "Open-Data-03254026-Gemeindewahl-Wahlbereich.csv",
		},
	];
	const ortsWahlen = orte.map((o) => ({
		schluessel: `29|${o}`,
		titel: `Ortsratswahl - ${o}`,
		gebietTitel: o,
	}));
	const gemeindeWahl = {
		schluessel: "27|ebene_3_id_14",
		titel: "Gemeindewahl - Gemeinde Nordstemmen",
		gebietTitel: "Gemeinde Nordstemmen",
	};

	it("gibt jeder der neun Ortsratswahlen genau ihre Datei", () => {
		const z = ordneCsvsZuWahlen(
			[...gemeindeCsvs, ...ortsCsvs],
			[gemeindeWahl, ...ortsWahlen],
		);
		expect(z.size).toBe(10);
		for (const o of orte) {
			const eigen = z.get(`29|${o}`);
			expect(eigen?.csvs.map((c) => c.ebene)).toEqual([
				`${o}: Übersicht über Wahlbezirke`,
			]);
			expect(eigen?.ort).toBe(o);
		}
	});

	it("gibt der einzigen Gemeindewahl alle ihre Ebenen und keinen Ort", () => {
		const z = ordneCsvsZuWahlen(
			[...gemeindeCsvs, ...ortsCsvs],
			[gemeindeWahl, ...ortsWahlen],
		);
		const g = z.get("27|ebene_3_id_14");
		expect(g?.csvs).toHaveLength(3);
		expect(g?.ort).toBeUndefined();
	});

	it("lässt eine Wahl leer ausgehen, deren Datei auch eine andere beansprucht", () => {
		// Gedachte Ortschaft "Escherde" neben Groß und Klein Escherde: Ihr
		// Ortsname steckt in beiden anderen Dateien. Lieber keine Listenplätze
		// als die einer fremden Ortschaft.
		const z = ordneCsvsZuWahlen(ortsCsvs, [
			...ortsWahlen,
			{
				schluessel: "29|Escherde",
				titel: "Ortsratswahl - Escherde",
				gebietTitel: "Escherde",
			},
		]);
		expect(z.has("29|Escherde")).toBe(false);
		expect(z.has("29|Groß Escherde")).toBe(false);
		expect(z.has("29|Klein Escherde")).toBe(false);
		// Die übrigen sieben bleiben eindeutig.
		expect(z.size).toBe(7);
	});

	it("trennt auch gleichnamige Wahlen mit eigener Wahl-Id", () => {
		// Samtgemeinden führen je Mitgliedsgemeinde eine eigene Gemeindewahl.
		const csvs = ["Algermissen", "Harsum"].map((o) => ({
			wahl: "Gemeindewahl",
			ebene: `${o}: Übersicht über Wahlbezirke`,
			url: `Open-Data-Gemeindewahl-${o}.csv`,
		}));
		const z = ordneCsvsZuWahlen(csvs, [
			{
				schluessel: "1|a",
				titel: "Gemeindewahl - Gemeinde Algermissen",
				gebietTitel: "Gemeinde Algermissen",
			},
			{
				schluessel: "2|b",
				titel: "Gemeindewahl - Gemeinde Harsum",
				gebietTitel: "Gemeinde Harsum",
			},
		]);
		expect(z.get("1|a")?.csvs.map((c) => c.url)).toEqual([
			"Open-Data-Gemeindewahl-Algermissen.csv",
		]);
		expect(z.get("2|b")?.csvs.map((c) => c.url)).toEqual([
			"Open-Data-Gemeindewahl-Harsum.csv",
		]);
	});

	it("kennt auch die Schreibweise von 2026 (Ort im Wahl-Feld)", () => {
		const csvs = ["Adensen", "Barnten"].map((o) => ({
			wahl: `Ortsratswahl - ${o}`,
			ebene: "Wahlbezirk",
			url: `Open-Data-Ortsratswahl-${o}.csv`,
		}));
		const z = ordneCsvsZuWahlen(csvs, [
			{
				schluessel: "9|a",
				titel: "Ortsratswahl - Adensen",
				gebietTitel: "Ortschaft Adensen",
			},
			{
				schluessel: "9|b",
				titel: "Ortsratswahl - Barnten",
				gebietTitel: "Ortschaft Barnten",
			},
		]);
		expect(z.get("9|a")?.csvs.map((c) => c.url)).toEqual([
			"Open-Data-Ortsratswahl-Adensen.csv",
		]);
		expect(z.get("9|b")?.ort).toBe("Barnten");
	});
});
