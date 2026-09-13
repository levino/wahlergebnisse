import { describe, expect, it } from "vitest";
import {
	type Folie,
	type UeberblickFolie,
	type WahlFolie,
	folienFuerDieLeinwand,
} from "../src/lib/dashboard.ts";

const balken = (stimmen: number) => ({
	key: "cdu",
	kurz: "CDU",
	lang: "CDU",
	farbe: "#000",
	name: "CDU",
	stimmen,
	prozent: stimmen > 0 ? 50 : 0,
});

const wahlfolie = (marke: string, stimmen: number[]): WahlFolie =>
	({
		art: "wahl",
		key: marke,
		marke,
		ort: "Nordstemmen",
		wahl: "Ortsratswahl",
		href: `/x/${marke}`,
		zuschnitt: "eigen",
		test: false,
		personenwahl: false,
		balken: stimmen.map(balken),
		weitere: 0,
		anz: 0,
		max: 24,
		quelle: { behoerde: "03254026", wahlId: 1, gesamtGebietId: "g" },
		datenstand: {} as WahlFolie["datenstand"],
	}) as WahlFolie;

const ueberblick = {
	art: "ueberblick",
	marke: "ueberblick",
} as UeberblickFolie;

describe("Was auf die Leinwand geht", () => {
	it("überspringt eine Wahl, für die noch keine Stimme gezählt ist", () => {
		const folien: Folie[] = [
			ueberblick,
			wahlfolie("rat", [120]),
			wahlfolie("ortsrat-adensen", [0]),
			wahlfolie("ortsrat-roessing", [0, 0]),
		];
		expect(folienFuerDieLeinwand(folien).map((f) => f.marke)).toEqual([
			"ueberblick",
			"rat",
		]);
	});

	it("holt die Wahl auf die Leinwand, sobald die erste Stimme da ist", () => {
		const vorher = wahlfolie("ortsrat-adensen", [0]);
		const nachher = wahlfolie("ortsrat-adensen", [1]);
		expect(folienFuerDieLeinwand([vorher])).toEqual([]);
		expect(folienFuerDieLeinwand([nachher])).toEqual([nachher]);
	});

	it("lässt die vorgegebene Reihenfolge unangetastet", () => {
		const folien: Folie[] = [
			ueberblick,
			wahlfolie("landrat", [5]),
			wahlfolie("kreistag", [0]),
			wahlfolie("buergermeister", [7]),
			wahlfolie("rat", [9]),
		];
		expect(folienFuerDieLeinwand(folien).map((f) => f.marke)).toEqual([
			"ueberblick",
			"landrat",
			"buergermeister",
			"rat",
		]);
	});

	it("führt die Zeilen des Überblicks auf die richtige Stelle im Karussell", () => {
		// Die Stelle wurde früher aus der Zeilennummer gerechnet. Fällt eine
		// Wahl heraus, verschiebt das alles dahinter – die Zeile sprang dann zur
		// falschen Folie.
		const folien: Folie[] = [
			ueberblick,
			wahlfolie("landrat", [5]),
			wahlfolie("kreistag", [0]),
			wahlfolie("buergermeister", [7]),
		];
		const gezeigt = folienFuerDieLeinwand(folien);
		const stellen = new Map(gezeigt.map((f, i) => [f.marke, i] as const));
		expect(stellen.get("landrat")).toBe(1);
		expect(stellen.get("buergermeister")).toBe(2);
		// Die übersprungene Wahl hat keine Stelle – die Zeile bleibt ohne Sprung.
		expect(stellen.has("kreistag")).toBe(false);
	});

	it("behält die Überblicksfolie, auch wenn noch gar nichts gezählt ist", () => {
		const folien: Folie[] = [ueberblick, wahlfolie("rat", [0])];
		expect(folienFuerDieLeinwand(folien)).toEqual([ueberblick]);
	});
});
