/** Die Regeln, nach denen das Dashboard seine Folien ordnet und taktet. */
import { describe, expect, it } from "vitest";
import type { Behoerde } from "../data/behoerden.ts";
import type { WahlEintragZeile } from "./abfragen.ts";
import {
	TAKT_MAX,
	TAKT_MIN,
	TAKT_STANDARD,
	dashboardReihenfolge,
	taktAus,
} from "./dashboard.ts";
import type { Wahltyp } from "./wahltyp.ts";

const gemeinde: Behoerde = {
	ags: "03254026",
	slug: "nordstemmen",
	name: "Gemeinde Nordstemmen",
	kurz: "Nordstemmen",
	art: "gemeinde",
};
const landkreis: Behoerde = {
	ags: "03254000",
	slug: "kreis",
	name: "Landkreis Hildesheim",
	kurz: "Hildesheim",
	art: "kreis",
};

const wahl = (typ: Wahltyp, gebiet = ""): WahlEintragZeile => ({
	termin: "2026",
	behoerde: gemeinde.ags,
	wahlId: 1,
	gebietId: "ebene_3_id_1",
	titel: typ,
	gebietTitel: gebiet || "Gemeinde Nordstemmen",
	gebiet,
	typ,
	slug: gebiet ? `${typ}-${gebiet.toLowerCase()}` : typ,
	kurz: typ,
	test: false,
});

const eigen = (typ: Wahltyp, gebiet = "") => ({
	behoerde: gemeinde,
	eintrag: wahl(typ, gebiet),
	fremd: false,
});
const vomKreis = (typ: Wahltyp) => ({
	behoerde: landkreis,
	eintrag: { ...wahl(typ), behoerde: landkreis.ags },
	fremd: true,
});

describe("dashboardReihenfolge", () => {
	it("erzählt den Abend von der eigenen Wahl zur Kreisebene", () => {
		const folge = dashboardReihenfolge([
			vomKreis("landrat"),
			eigen("ortsrat", "Rössing"),
			vomKreis("kreistag"),
			eigen("rat"),
			eigen("buergermeister"),
		]);
		expect(folge.map((f) => f.eintrag.typ)).toEqual([
			"buergermeister",
			"rat",
			"ortsrat",
			"kreistag",
			"landrat",
		]);
	});

	it("sortiert die Ortsräte alphabetisch und nicht nach Wahl-Id", () => {
		const folge = dashboardReihenfolge([
			eigen("ortsrat", "Rössing"),
			eigen("ortsrat", "Adensen"),
			eigen("ortsrat", "Nordstemmen"),
			eigen("ortsrat", "Groß Escherde"),
		]);
		expect(folge.map((f) => f.eintrag.gebiet)).toEqual([
			"Adensen",
			"Groß Escherde",
			"Nordstemmen",
			"Rössing",
		]);
	});

	it("zeigt bei kreisweiten Wahlen erst das eigene Gebiet, dann den Kreis", () => {
		// „Wie hat Nordstemmen gewählt“ steht vor „wer wird Landrat“ – beides
		// gehört auf die Leinwand, und in dieser Reihenfolge wird gefragt.
		const folge = dashboardReihenfolge([
			vomKreis("kreistag"),
			eigen("kreistag"),
		]);
		expect(folge.map((f) => f.fremd)).toEqual([false, true]);
	});

	it("hängt eine Stichwahl an die Wahl desselben Amtes", () => {
		const folge = dashboardReihenfolge([
			eigen("buergermeister-stichwahl"),
			eigen("rat"),
			eigen("buergermeister"),
		]);
		expect(folge.map((f) => f.eintrag.typ)).toEqual([
			"buergermeister",
			"buergermeister-stichwahl",
			"rat",
		]);
	});

	it("stellt unbekannte Wahlarten hinten an, statt sie zu verlieren", () => {
		const folge = dashboardReihenfolge([eigen("sonstige"), eigen("rat")]);
		expect(folge.map((f) => f.eintrag.typ)).toEqual(["rat", "sonstige"]);
	});
});

describe("taktAus", () => {
	it("nimmt den Standard, wenn nichts oder Unfug in der Adresse steht", () => {
		expect(taktAus(null)).toBe(TAKT_STANDARD);
		expect(taktAus("")).toBe(TAKT_STANDARD);
		expect(taktAus("gleich")).toBe(TAKT_STANDARD);
	});

	it("übernimmt eine gewünschte Standzeit", () => {
		expect(taktAus("30")).toBe(30);
	});

	it("stutzt Ausreißer, statt die Leinwand einzufrieren", () => {
		expect(taktAus("0")).toBe(TAKT_MIN);
		expect(taktAus("-5")).toBe(TAKT_MIN);
		expect(taktAus("99999")).toBe(TAKT_MAX);
	});
});
