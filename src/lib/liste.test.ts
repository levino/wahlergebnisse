import { describe, expect, it } from "vitest";
import {
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
});
