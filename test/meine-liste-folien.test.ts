import { describe, expect, it } from "vitest";
import {
	type Folie,
	type UeberblickFolie,
	type WahlFolie,
	NAMEN_MEINE_LISTE,
	meineListenAus,
	meineListenFolien,
} from "../src/lib/dashboard.ts";
import type { Partei } from "../src/lib/votemanager.ts";

const partei = (kurz: string, kandidaten: Array<[string, number]>): Partei =>
	({
		key: kurz.toLowerCase(),
		kurz,
		lang: kurz,
		farbe: "#000",
		stimmen: kandidaten.reduce((s, [, n]) => s + n, 0),
		prozent: 0,
		kandidaten: kandidaten.map(([name, stimmen]) => ({ name, stimmen })),
	}) as Partei;

const folie = (marke: string, parteien: Partei[]): WahlFolie =>
	({
		art: "wahl",
		key: marke,
		marke,
		ort: "Nordstemmen",
		wahl: "Gemeinderatswahl",
		href: `/x/${marke}`,
		zuschnitt: "eigen",
		test: false,
		personenwahl: false,
		balken: [],
		weitere: 0,
		anz: 1,
		max: 2,
		quelle: { behoerde: "03254026", wahlId: 1, gesamtGebietId: "g" },
		datenstand: {} as WahlFolie["datenstand"],
		meineListen: meineListenAus(parteien),
	}) as WahlFolie;

const ueberblick = {
	art: "ueberblick",
	marke: "ueberblick",
} as UeberblickFolie;

describe("Personenstimmen der eigenen Liste", () => {
	it("ordnet nach Personenstimmen, nicht nach dem Listenplatz", () => {
		const [liste] = meineListenAus([
			partei("CDU", [
				["Erster auf der Liste", 12],
				["Zweiter", 300],
				["Dritter", 90],
			]),
		]);
		expect(liste.kandidaten.map((k) => k.name)).toEqual([
			"Zweiter",
			"Dritter",
			"Erster auf der Liste",
		]);
	});

	it("führt jede Liste, nicht nur die stärksten", () => {
		// listenAus zeigt vier Listen; wessen Partei dort fehlt, fand sich nicht
		// wieder. Hier muss auch die kleinste dabei sein.
		const listen = meineListenAus([
			partei("SPD", [["A", 900]]),
			partei("CDU", [["B", 800]]),
			partei("GRÜNE", [["C", 700]]),
			partei("FDP", [["D", 600]]),
			partei("Volt", [["E", 5]]),
		]);
		expect(listen.map((l) => l.key)).toContain("volt");
		expect(listen).toHaveLength(5);
	});

	it("deckelt die Namen und sagt, wie viele fehlen", () => {
		const viele: Array<[string, number]> = Array.from(
			{ length: NAMEN_MEINE_LISTE + 4 },
			(_, i) => [`Bewerber ${i}`, i],
		);
		const [liste] = meineListenAus([partei("CDU", viele)]);
		expect(liste.kandidaten).toHaveLength(NAMEN_MEINE_LISTE);
		expect(liste.weitere).toBe(4);
	});

	it("hängt je Wahl eine Folie an, wenn eine Partei eingestellt ist", () => {
		const folien: Folie[] = [
			ueberblick,
			folie("rat", [partei("CDU", [["Keller", 6]])]),
			folie("ortsrat-roessing", [partei("CDU", [["Wille", 281]])]),
		];
		expect(meineListenFolien(folien, "cdu").map((f) => f.marke)).toEqual([
			"ueberblick",
			"rat",
			"rat-meine-liste",
			"ortsrat-roessing",
			"ortsrat-roessing-meine-liste",
		]);
	});

	it("lässt ohne eingestellte Partei alles, wie es ist", () => {
		const folien: Folie[] = [
			ueberblick,
			folie("rat", [partei("CDU", [["K", 6]])]),
		];
		expect(meineListenFolien(folien, undefined)).toEqual(folien);
	});

	it("hängt nichts an, wo die eigene Liste nicht antritt", () => {
		// Landratswahl: eine Personenwahl ohne Liste der Partei.
		const folien: Folie[] = [folie("landrat", [partei("SPD", [["L", 9]])])];
		expect(meineListenFolien(folien, "cdu").map((f) => f.marke)).toEqual([
			"landrat",
		]);
	});

	it("zeigt auf der Extrafolie genau die eigene Liste", () => {
		const folien: Folie[] = [
			folie("rat", [
				partei("SPD", [["Fremd", 999]]),
				partei("CDU", [["Eigen", 5]]),
			]),
		];
		const extra = meineListenFolien(folien, "cdu")[1] as WahlFolie;
		expect(extra.listen?.map((l) => l.key)).toEqual(["cdu"]);
		expect(extra.listen?.[0].kandidaten[0].name).toBe("Eigen");
		expect(extra.kandidatenTitel).toBe("Personenstimmen CDU");
		// Keine Balken und keine Sitzverteilung – die stehen auf der Wahlfolie.
		expect(extra.balken).toEqual([]);
		expect(extra.sitze).toBeUndefined();
	});
});
