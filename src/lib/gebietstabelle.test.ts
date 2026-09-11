import { describe, expect, it } from "vitest";
import { gebietstabelle } from "./gebietstabelle.ts";
import type { Ergebnis, Partei, Uebersicht } from "./votemanager.ts";

const partei = (
	kurz: string,
	prozent: number,
	stimmen = prozent * 10,
): Partei =>
	({
		key: kurz.toLowerCase().replace(/[\s./-]+/g, ""),
		kurz,
		lang: `${kurz} lang`,
		farbe: "#000",
		stimmen,
		prozent,
	}) satisfies Partei;

const ergebnis = (parteien: Partei[]): Ergebnis => ({
	titel: "",
	gebietTitel: "",
	gebietKurz: "",
	zeitstempel: "",
	leer: false,
	personenwahl: false,
	stand: { hinweis: [] },
	kennzahlen: {},
	parteien,
	untergebiete: [],
});

/** Eine Übersicht, wie die Quelle sie liefert: vier Listen und „Sonstige“. */
const quelle = (
	spalten: string[],
	zeilen: Array<{ label: string; gebietId?: string; werte: number[] }>,
): Uebersicht => ({
	titel: "Wahlbezirke",
	zeitstempel: "",
	spalten: spalten.map((kurz) => ({ kurz })),
	zeilen: zeilen.map((z) => ({
		label: z.label,
		gebietId: z.gebietId,
		status: "",
		stimmbezirk: true,
		werte: spalten.map((kurz, i) => ({
			kurz,
			absolut: z.werte[i],
			prozent: z.werte[i],
		})),
	})),
});

describe("gebietstabelle", () => {
	it("nimmt die Spalten aus der angezeigten Wahl, nicht aus der Kopfzeile der Quelle", () => {
		const u = quelle(
			["SPD", "CDU", "GRÜNE", "Die Unabhängigen", "Sonstige"],
			[{ label: "01 - Adlum", gebietId: "ebene_6_id_1", werte: [] }],
		);
		const awg = partei("AWG", 100, 1015);
		const t = gebietstabelle(u, [awg], () => ergebnis([awg]));

		expect(t.spalten.map((s) => s.kurz)).toEqual(["AWG"]);
		expect(t.zeilen[0].werte).toEqual([
			{ kurz: "AWG", absolut: 1015, prozent: 100 },
		]);
	});

	it("sortiert die Spalten nach Stärke und behält so viele Plätze wie die Quelle", () => {
		const parteien = [
			partei("SPD", 20),
			partei("CDU", 40),
			partei("GRÜNE", 15),
			partei("FDP", 10),
			partei("Linke", 9),
			partei("AfD", 6),
		];
		const u = quelle(
			["SPD", "CDU", "GRÜNE", "Die Unabhängigen", "Sonstige"],
			[{ label: "Gemeinde X", gebietId: "ebene_3_id_1", werte: [] }],
		);
		const t = gebietstabelle(u, parteien, () => ergebnis(parteien));

		expect(t.spalten.map((s) => s.kurz)).toEqual([
			"CDU",
			"SPD",
			"GRÜNE",
			"FDP",
			"Sonstige",
		]);
		expect(t.zeilen[0].werte.at(-1)).toEqual({
			kurz: "Sonstige",
			absolut: 150,
			prozent: 15,
		});
	});

	it("führt keine Restspalte, wenn nichts übrig bleibt", () => {
		const parteien = [partei("SPD", 60), partei("CDU", 40)];
		const u = quelle(
			["SPD", "CDU", "GRÜNE", "Die Unabhängigen", "Sonstige"],
			[{ label: "01", gebietId: "ebene_6_id_1", werte: [] }],
		);
		const t = gebietstabelle(u, parteien, () => ergebnis(parteien));
		expect(t.spalten.map((s) => s.kurz)).toEqual(["SPD", "CDU"]);
	});

	it("lässt die Kennzahlenspalte einer Personenwahl stehen", () => {
		const bewerber = [partei("Meier, SPD", 55), partei("Schulz, CDU", 45)];
		const u = quelle(
			["gültig", "Meier, SPD", "Schulz, CDU"],
			[{ label: "01", gebietId: "ebene_6_id_1", werte: [900, 500, 400] }],
		);
		const t = gebietstabelle(u, bewerber, () => ergebnis(bewerber));

		expect(t.spalten.map((s) => s.kurz)).toEqual([
			"gültig",
			"Meier, SPD",
			"Schulz, CDU",
		]);
		expect(t.zeilen[0].werte[0]).toEqual({
			kurz: "gültig",
			absolut: 900,
			prozent: 900,
		});
	});

	it("behält die Zeile der Quelle, solange das Gebietsergebnis fehlt", () => {
		const parteien = [partei("SPD", 60), partei("CDU", 40)];
		const u = quelle(
			["SPD", "CDU", "GRÜNE", "Die Unabhängigen", "Sonstige"],
			[{ label: "01", gebietId: "ebene_6_id_1", werte: [70, 30] }],
		);
		const t = gebietstabelle(u, parteien, () => undefined);
		expect(t.spalten.map((s) => s.kurz)).toEqual(["SPD", "CDU"]);
		expect(t.zeilen[0].werte).toEqual([
			{ kurz: "SPD", absolut: 70, prozent: 70 },
			{ kurz: "CDU", absolut: 30, prozent: 30 },
		]);
	});

	it("rührt die Tabelle nicht an, wenn keine Wahlvorschläge bekannt sind", () => {
		const u = quelle(
			["SPD", "CDU", "GRÜNE", "Die Unabhängigen", "Sonstige"],
			[{ label: "01", gebietId: "ebene_6_id_1", werte: [70, 30] }],
		);
		expect(gebietstabelle(u, [], () => undefined)).toBe(u);
	});
});
