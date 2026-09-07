/**
 * Die öffentliche Datenschicht (REST und MCP teilen sie sich): Schema,
 * Filter, Tabellenform. Läuft gegen die Fixtures über den Mock-votemanager.
 */
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIXTURES, aufraeumen, tempVerzeichnis } from "./helfer.ts";
import {
	type MockVotemanager,
	starteMockVotemanager,
} from "./mock-votemanager.ts";

let mock: MockVotemanager;
let tmp: string;

beforeAll(async () => {
	tmp = tempVerzeichnis();
	mock = await starteMockVotemanager(FIXTURES);
	process.env.VOTEMANAGER_BASIS = mock.url;
	process.env.DATABASE_PATH = join(tmp, "wahlen.db");
	const { oeffneDb } = await import("../src/lib/db.ts");
	const { pollTermin } = await import("../src/lib/poll.ts");
	const { terminById } = await import("../src/data/termine.ts");
	await pollTermin(oeffneDb(), terminById("2021")!, {
		nurBehoerden: ["03254000", "03254026"],
	});
});

afterAll(async () => {
	const { schliesseDb } = await import("../src/lib/db.ts");
	schliesseDb();
	await mock.schliessen();
	aufraeumen(tmp);
});

describe("Datenschicht", () => {
	it("beschreibt Termine mit Stand und Quelle", async () => {
		const { apiTermine } = await import("../src/lib/api.ts");
		const t = apiTermine();
		expect(t.map((x) => x.id)).toEqual(["2026", "2021", "2020"]);
		expect(t.find((x) => x.id === "2021")).toMatchObject({
			live: false,
			datum: "2021-09-12",
		});
		expect(t[0].quelle).toContain("wahlen.kreis-hi.de");
		expect(
			new Date(t.find((x) => x.id === "2021")!.stand as string).getTime(),
		).toBeGreaterThan(0);
	});

	it("listet Behörden mit ihren Wahlen und dem Auszählstand", async () => {
		const { apiBehoerden } = await import("../src/lib/api.ts");
		const b = apiBehoerden("2021");
		const ns = b.find((x) => x.slug === "nordstemmen")!;
		expect(ns.ags).toBe("03254026");
		expect(ns.schnellmeldungen).toEqual({ eingegangen: 23, erwartet: 23 });
		expect(ns.wahlen.map((w) => w.slug)).toContain("ortsrat-roessing");
		// Jede Wahl steht mit eigener Adresse und eigenem Titel in der Liste.
		// Vorher hießen die neun Ortsratswahlen alle „Ortsratswahl“ und zeigten
		// alle auf dieselbe Adresse.
		expect(new Set(ns.wahlen.map((w) => w.slug)).size).toBe(ns.wahlen.length);
		expect(new Set(ns.wahlen.map((w) => w.titel)).size).toBe(ns.wahlen.length);
		expect(ns.wahlen.map((w) => w.titel)).toContain("Ortsrat Rössing");
	});

	it("filtert Wahlen nach Behörde und Wahlart", async () => {
		const { apiWahlen } = await import("../src/lib/api.ts");
		expect(
			apiWahlen("2021", { behoerde: "nordstemmen", typ: "ortsrat" }),
		).toHaveLength(9);
		expect(
			apiWahlen("2021", { behoerde: "03254026", typ: "kreistag" }),
		).toHaveLength(1);
		expect(
			apiWahlen("2021", { typ: "landrat" })
				.map((w) => w.behoerde.slug)
				.sort(),
		).toEqual(["kreis", "nordstemmen"]);
		const kreistag = apiWahlen("2021", {
			behoerde: "kreis",
			typ: "kreistag",
		})[0];
		expect(kreistag).toMatchObject({
			typLabel: "Kreistagswahl",
			personenwahl: false,
			ergebnis: null,
		});
		expect(kreistag.ebenen).toEqual(
			expect.arrayContaining([
				{ ebene: "gemeinde", anzahl: 18 },
				{ ebene: "wahlbereich", anzahl: 12 },
			]),
		);
	});

	it("gibt ein Ergebnis mit benannten Feldern statt D1_3-Spalten", async () => {
		const { apiWahl } = await import("../src/lib/api.ts");
		const { behoerdeBySlug } = await import("../src/data/behoerden.ts");
		const w = apiWahl("2021", behoerdeBySlug("kreis")!, "kreistag")!;
		const e = w.ergebnis!;
		expect(e.gebiet).toMatchObject({
			id: "ebene_1_id_10",
			name: "Landkreis Hildesheim",
			ebene: "kreis",
		});
		expect(e.stand).toMatchObject({
			vollstaendig: true,
			status: "Amtliches Endergebnis",
		});
		expect(e.stand.schnellmeldungen).toEqual({
			eingegangen: 426,
			erwartet: 426,
		});
		expect(e.kennzahlen).toEqual({
			wahlberechtigte: 225804,
			waehler: 133148,
			wahlbeteiligung: 58.97,
			ungueltig: 1937,
			gueltigeStimmzettel: 131211,
			gueltigeStimmen: 387423,
		});
		const cdu = e.parteien.find((p) => p.key === "cdu")!;
		expect(cdu).toMatchObject({
			kurz: "CDU",
			stimmen: 116658,
			prozent: 30.11,
			sitze: 19,
		});
		expect(cdu.name).toContain("Christlich Demokratische Union");
		expect(cdu.listenstimmen).toBe(52258);
		expect(e.sitze?.gesamt).toBe(64);
		expect(e.sitze?.gewaehlte.length).toBe(64);
	});

	it("trennt bei Personenwahlen Person und Partei", async () => {
		const { apiWahl } = await import("../src/lib/api.ts");
		const { behoerdeBySlug } = await import("../src/data/behoerden.ts");
		const w = apiWahl("2021", behoerdeBySlug("kreis")!, "landrat")!;
		expect(w.personenwahl).toBe(true);
		expect(w.ergebnis?.parteien[0].kandidat).toEqual({
			name: "Bernd Lynack",
			partei: "SPD",
		});
		expect(w.ergebnis?.sitze).toBeNull();
	});

	it("liefert alle Gebiete flach, nach Ebene filterbar", async () => {
		const { apiGebiete, apiGebiet } = await import("../src/lib/api.ts");
		const { behoerdeBySlug } = await import("../src/data/behoerden.ts");
		const ns = behoerdeBySlug("nordstemmen")!;
		const alle = apiGebiete("2021", ns, "rat")!;
		expect(alle.length).toBeGreaterThan(30);
		const bezirke = apiGebiete("2021", ns, "rat", { ebene: "wahlbezirk" })!;
		expect(bezirke.every((g) => g.gebiet.ebene === "wahlbezirk")).toBe(true);
		// 15 Urnen- und 8 Briefwahlbezirke
		expect(bezirke.length).toBe(23);
		const eins = apiGebiet("2021", ns, "rat", "ebene_6_id_3119")!;
		expect(eins.gebiet.name).toBe("09 - Rössing - DGH");
		expect(eins.kennzahlen.waehler).toBe(268);
		expect(apiGebiet("2021", ns, "rat", "ebene_6_id_999999")).toBeUndefined();
	});

	it("schreibt dieselben Daten als flache Tabelle und als CSV", async () => {
		const { apiGebiete, alsTabelle, alsCsv } = await import(
			"../src/lib/api.ts"
		);
		const { behoerdeBySlug } = await import("../src/data/behoerden.ts");
		const gebiete = apiGebiete("2021", behoerdeBySlug("nordstemmen")!, "rat", {
			ebene: "ortsteil",
		})!;
		const tabelle = alsTabelle(gebiete);
		// je Ortsteil eine Zeile pro Partei
		expect(tabelle.length).toBe(
			gebiete.reduce((a, g) => a + g.parteien.length, 0),
		);
		const zeile = tabelle.find(
			(z) => z.gebiet_name === "Rössing" && z.partei_key === "cdu",
		)!;
		expect(zeile).toMatchObject({
			termin: "2021",
			behoerde: "nordstemmen",
			wahl: "rat",
			ebene: "ortsteil",
		});
		expect(typeof zeile.stimmen).toBe("number");
		const csv = alsCsv(tabelle);
		expect(csv.startsWith("﻿")).toBe(true);
		expect(csv.split("\n")[0]).toContain("gebiet_name;ebene");
		expect(csv.split("\n").length).toBe(tabelle.length + 2);
	});

	it("nennt Bewerber mit Listenplatz, Anteil an allen Stimmen und Mandat", async () => {
		const { apiWahl } = await import("../src/lib/api.ts");
		const { behoerdeBySlug } = await import("../src/data/behoerden.ts");
		const w = apiWahl("2021", behoerdeBySlug("nordstemmen")!, "rat")!;
		const spd = w.ergebnis!.parteien.find((p) => p.key === "spd")!;
		const ludewig = spd.kandidaten!.find((k) => k.name === "Gerald Ludewig")!;
		// 1.052 von 18.310 gültigen Stimmen – nicht die 19,55 %, die die
		// Wahlpräsentation als Anteil am Kandidatentopf der SPD ausweist
		expect(ludewig.prozent).toBeCloseTo(5.75, 1);
		expect(ludewig.prozentInPartei).toBe(19.55);
		expect(ludewig.platz).toBe(1);
		expect(ludewig.gewaehlt).toBe(true);
		// Drittbester nach Stimmen, aber weiter hinten auf der Liste
		const arlt = spd.kandidaten!.find((k) => k.name === "Andreas Arlt")!;
		expect(arlt.platz).toBeGreaterThan(3);
		expect(arlt.gewaehlt).toBe(true);
	});

	it("kennt den Termin 2020, den es nur in Nordstemmen gibt", async () => {
		const { apiBehoerden, apiWahlen } = await import("../src/lib/api.ts");
		const { oeffneDb } = await import("../src/lib/db.ts");
		const { pollTermin } = await import("../src/lib/poll.ts");
		const { terminById } = await import("../src/data/termine.ts");
		await pollTermin(oeffneDb(), terminById("2020")!, {
			nurBehoerden: ["03254000", "03254026"],
		});
		expect(apiBehoerden("2020").map((b) => b.slug)).toEqual(["nordstemmen"]);
		const wahlen = apiWahlen("2020", { behoerde: "nordstemmen" });
		expect(wahlen.map((w) => w.slug)).toEqual([
			"buergermeister",
			"buergermeister-stichwahl",
		]);
		expect(wahlen[0].personenwahl).toBe(true);
	});

	it("beschreibt Wahlräume mit Zuordnung", async () => {
		const { apiWahlraeume } = await import("../src/lib/api.ts");
		const { behoerdeBySlug } = await import("../src/data/behoerden.ts");
		const r = apiWahlraeume("2021", behoerdeBySlug("nordstemmen")!);
		expect(r).toHaveLength(15);
		expect(r[0]).toMatchObject({
			ortsteil: "Nordstemmen",
			kreiswahlbereich: "B",
			barrierefrei: true,
		});
	});

	it("fasst den Fortschritt eines Termins zusammen", async () => {
		const { apiUeberblick } = await import("../src/lib/api.ts");
		const u = apiUeberblick("2021")!;
		expect(u.termin.id).toBe("2021");
		expect(u.schnellmeldungen.eingegangen).toBeGreaterThan(0);
		expect(u.gemeinden.find((g) => g.slug === "nordstemmen")).toMatchObject({
			eingegangen: 23,
			erwartet: 23,
		});
	});
});
