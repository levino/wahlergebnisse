/** Die Regeln, nach denen das Dashboard seine Folien ordnet und taktet. */
import { describe, expect, it } from "vitest";
import type { Behoerde } from "../data/behoerden.ts";
import type { WahlEintragZeile } from "./abfragen.ts";
import {
	LISTEN_JE_FOLIE,
	NAMEN_JE_LISTE,
	TAKT_MAX,
	TAKT_MIN,
	TAKT_STANDARD,
	dashboardReihenfolge,
	listenAus,
	taktAus,
} from "./dashboard.ts";
import type { Partei } from "./votemanager.ts";
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
	zuschnitt: "eigen" as const,
});
const imWahlbereich = (typ: Wahltyp) => ({
	behoerde: landkreis,
	eintrag: { ...wahl(typ), behoerde: landkreis.ags },
	zuschnitt: "wahlbereich" as const,
});
const vomKreis = (typ: Wahltyp) => ({
	behoerde: landkreis,
	eintrag: { ...wahl(typ), behoerde: landkreis.ags },
	zuschnitt: "kreis" as const,
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

	it("stellt bei kreisweiten Wahlen das Kreisergebnis vor den Wahlbereich", () => {
		// Erst die Antwort – „wie sieht der Kreistag aus“ –, dann die
		// Nachfrage: „wer aus unserem Wahlbereich sitzt drin“. Der Wahlbereich
		// ist das kleinere Gebiet und steht trotzdem hinten: Er erklärt das
		// Kreisergebnis, er führt nicht dorthin.
		const folge = dashboardReihenfolge([
			imWahlbereich("kreistag"),
			eigen("kreistag"),
			vomKreis("kreistag"),
		]);
		expect(folge.map((f) => f.zuschnitt)).toEqual([
			"eigen",
			"kreis",
			"wahlbereich",
		]);
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

describe("listenAus", () => {
	/**
	 * Eine Liste in Stimmzettel-Reihenfolge – so, wie die Wahlpräsentation
	 * liefert. Der stärkste Bewerber steht darin gerade nicht vorn.
	 */
	const liste = (
		kurz: string,
		stimmen: number,
		kandidaten: Array<[string, number]>,
	): Partei => ({
		key: kurz.toLowerCase(),
		kurz,
		name: kurz,
		farbe: "#000",
		stimmen,
		prozent: 0,
		kandidaten: kandidaten.map(([name, s]) => ({ name, stimmen: s })),
	});

	const parteien = [
		liste("CDU", 5000, [
			["Wille, Albert", 900],
			["Keller, Levin", 850],
			["Meier, Anna", 300],
			["Schulz, Bert", 100],
		]),
		liste("SPD", 6000, [
			["Lynack, Bernd", 1200],
			["Bertram, Ute", 400],
		]),
		liste("GRÜNE", 2000, [["Flohr, Simone", 500]]),
		liste("FDP", 900, [["Bruns, Thomas", 200]]),
		liste("Linke", 400, [["Machtens, Heinrich", 100]]),
	];

	it("bringt je Liste die vordersten Bewerber nach Stimmen", () => {
		// Wer auf einer Liste steht, will seinen Abstand nach vorn sehen – und
		// die Quelle liefert in Stimmzettel-Reihenfolge, nicht nach Stimmen.
		const cdu = listenAus(parteien).find((l) => l.partei === "CDU");
		expect(cdu?.kandidaten.map((k) => k.name)).toEqual([
			"Wille, Albert",
			"Keller, Levin",
			"Meier, Anna",
		]);
		expect(cdu?.kandidaten[0].stimmen).toBe(900);
	});

	it("verschweigt nicht, wie viele fehlen", () => {
		const cdu = listenAus(parteien).find((l) => l.partei === "CDU");
		expect(cdu?.weitere).toBe(1);
		const spd = listenAus(parteien).find((l) => l.partei === "SPD");
		expect(spd?.weitere).toBe(0);
	});

	it("nimmt die stärksten Listen, nicht die ersten auf dem Zettel", () => {
		const listen = listenAus(parteien);
		expect(listen).toHaveLength(LISTEN_JE_FOLIE);
		expect(listen.map((l) => l.partei)).toEqual(["SPD", "CDU", "GRÜNE", "FDP"]);
	});

	it("lässt eine Liste ohne Bewerber weg", () => {
		// Bei einer Personenwahl (Landrat) gibt es keine Listen – dann bleibt
		// die Folie bei ihren Balken.
		expect(listenAus([liste("CDU", 100, [])])).toEqual([]);
	});

	it("zeigt höchstens so viele Namen, wie auf die Folie passen", () => {
		for (const l of listenAus(parteien))
			expect(l.kandidaten.length).toBeLessThanOrEqual(NAMEN_JE_LISTE);
	});
});
