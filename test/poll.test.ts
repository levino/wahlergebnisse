import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	FIXTURES,
	aufraeumen,
	tempVerzeichnis,
	wahlabendFixtures,
} from "./helfer.ts";
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
});

afterAll(async () => {
	const { schliesseDb } = await import("../src/lib/db.ts");
	schliesseDb();
	await mock.schliessen();
	aufraeumen(tmp);
});

describe("Poller gegen den Mock-votemanager", () => {
	it("lädt den Archiv-Termin 2021 vollständig und normalisiert", async () => {
		const { oeffneDb } = await import("../src/lib/db.ts");
		const { pollTermin, terminVollstaendig } = await import(
			"../src/lib/poll.ts"
		);
		const { terminById } = await import("../src/data/termine.ts");
		const {
			ergebnis,
			wahleintraege,
			uebersichten,
			wahlraeume,
			ereignisse,
			version,
		} = await import("../src/lib/abfragen.ts");
		const db = oeffneDb();
		const termin = terminById("2021")!;
		const stat = await pollTermin(db, termin, {
			nurBehoerden: ["03254000", "03254026"],
		});
		expect(stat.fehler).toEqual([]);
		expect(stat.anfragen).toBeGreaterThan(100);
		expect(terminVollstaendig(db, termin)).toBe(false); // nur zwei Behörden → nicht als vollständig markiert

		const kreistag = wahleintraege("2021", "03254000").find(
			(w) => w.typ === "kreistag",
		)!;
		expect(kreistag.slug).toBe("kreistag");
		const e = ergebnis("2021", "03254000", kreistag.wahlId, kreistag.gebietId)!;
		expect(e.standAnz).toBe(426);
		expect(e.standMax).toBe(426);
		expect(e.ergebnis.parteien[0]).toMatchObject({
			kurz: "SPD",
			prozent: 34.03,
			stimmen: 131834,
		});
		expect(e.ergebnis.parteien[1]).toMatchObject({
			kurz: "CDU",
			prozent: 30.11,
		});
		expect(e.ergebnis.sitze?.gesamt).toBe(64);
		expect(
			e.ergebnis.sitze?.verteilung.find((v) => v.kurz === "CDU")?.sitze,
		).toBe(19);
		expect(e.ergebnis.kennzahlen.wahlbeteiligung).toBeCloseTo(58.97, 1);

		const { ergebnisseEbene } = await import("../src/lib/abfragen.ts");
		expect(
			ergebnisseEbene("2021", "03254000", kreistag.wahlId, 3),
		).toHaveLength(18);
		expect(
			ergebnisseEbene("2021", "03254000", kreistag.wahlId, 9),
		).toHaveLength(12);
		expect(
			ergebnisseEbene("2021", "03254000", kreistag.wahlId, 3).map(
				(x) => x.titel,
			),
		).toContain("Gemeinde Nordstemmen");

		const landrat = wahleintraege("2021", "03254000").find(
			(w) => w.typ === "landrat",
		)!;
		const l = ergebnis("2021", "03254000", landrat.wahlId, landrat.gebietId)!;
		expect(l.ergebnis.personenwahl).toBe(true);
		expect(l.ergebnis.parteien[0].kandidat).toEqual({
			name: "Bernd Lynack",
			partei: "SPD",
		});

		const ns = wahleintraege("2021", "03254026");
		expect(ns.filter((w) => w.typ === "ortsrat")).toHaveLength(9);
		expect(ns.map((w) => w.slug)).toContain("ortsrat-roessing");
		expect(new Set(ns.map((w) => w.slug)).size).toBe(ns.length);
		expect(ns.find((w) => w.slug === "ortsrat-roessing")?.gebiet).toBe(
			"Rössing",
		);
		expect(ns.find((w) => w.typ === "rat")?.gebiet).toBe("");
		const rat = ns.find((w) => w.typ === "rat")!;
		const r = ergebnis("2021", "03254026", rat.wahlId, rat.gebietId)!;
		expect(r.ergebnis.sitze?.gesamt).toBe(30);
		expect(
			r.ergebnis.parteien.find((p) => p.kurz === "CDU")?.kandidaten?.length,
		).toBeGreaterThan(5);
		const wb = ergebnis("2021", "03254026", rat.wahlId, "ebene_6_id_3119")!;
		expect(wb.titel).toBe("09 - Rössing - DGH");
		expect(wb.standAnz).toBe(1);

		const ue = uebersichten("2021", "03254026", rat.wahlId);
		expect(ue.map((u) => u.titel).sort()).toEqual([
			"Gemeinden",
			"Ortsteile",
			"Wahlbereiche",
			"Wahlbezirke",
		]);
		const raeume = wahlraeume("2021", "03254026");
		expect(raeume).toHaveLength(15);
		expect(raeume[0]).toMatchObject({
			ortsteil: "Nordstemmen",
			kreiswahlbereich: "B",
		});

		expect(ereignisse("2021")).toHaveLength(0);
		expect(version("2021")).not.toBe("");
	});

	it("ergänzt die Listenplätze der Bewerber je Gebiet", async () => {
		const { listenplaetze, wahleintraege } = await import(
			"../src/lib/abfragen.ts"
		);
		const { platzSchluessel } = await import("../src/lib/kandidaten.ts");

		const kreistag = wahleintraege("2021", "03254000").find(
			(w) => w.typ === "kreistag",
		)!;
		const wbB = listenplaetze(
			"2021",
			"03254000",
			kreistag.wahlId,
			"ebene_9_id_57",
		);
		expect(wbB.get(platzSchluessel("cdu", "Jürgen Schulte-Schüren"))).toBe(1);
		expect(wbB.get(platzSchluessel("cdu", "Kai Dräger"))).toBe(2);
		expect(wbB.get(platzSchluessel("cdu", "Bernhard Flegel"))).toBe(4);
		expect(wbB.get(platzSchluessel("cdu", "Hanno Conrad"))).toBe(7);

		const rat = wahleintraege("2021", "03254026").find((w) => w.typ === "rat")!;
		const gemeinde = listenplaetze(
			"2021",
			"03254026",
			rat.wahlId,
			rat.gebietId,
		);
		expect(gemeinde.get(platzSchluessel("spd", "Gerald Ludewig"))).toBe(1);
		expect(
			gemeinde.get(platzSchluessel("spd", "Andreas Arlt")),
		).toBeGreaterThan(3);
	});

	it("gibt jeder der neun Ortsratswahlen Listenplätze, nicht nur der ersten", async () => {
		const { listenplaetze, wahleintraege } = await import(
			"../src/lib/abfragen.ts"
		);
		const { platzSchluessel } = await import("../src/lib/kandidaten.ts");

		const ortsraete = wahleintraege("2021", "03254026").filter(
			(w) => w.typ === "ortsrat",
		);
		expect(ortsraete).toHaveLength(9);
		for (const w of ortsraete)
			expect([
				w.slug,
				listenplaetze("2021", "03254026", w.wahlId, w.gebietId).size,
			]).not.toEqual([w.slug, 0]);

		const platz = (slug: string, partei: string, name: string) => {
			const w = ortsraete.find((o) => o.slug === slug)!;
			return listenplaetze("2021", "03254026", w.wahlId, w.gebietId).get(
				platzSchluessel(partei, name),
			);
		};
		expect(platz("ortsrat-roessing", "spd", "Roman Veselý")).toBe(1);
		expect(platz("ortsrat-roessing", "spd", "Bernd Könneke")).toBe(2);
		expect(platz("ortsrat-roessing", "cdu", "Wolfgang Scholz")).toBe(1);
		expect(
			platz("ortsrat-adensen", "dieunabhängigen", "Oliver Riechelmann"),
		).toBe(1);
		expect(platz("ortsrat-burgstemmen", "wzb", "Reinhild Wagner")).toBe(1);
		expect(platz("ortsrat-burgstemmen", "wzb", "Ulf Moldenhauer")).toBe(5);
	});

	it("holt beim zweiten Lauf nur Listings und bedingte Anfragen", async () => {
		const { oeffneDb } = await import("../src/lib/db.ts");
		const { pollTermin } = await import("../src/lib/poll.ts");
		const { terminById } = await import("../src/data/termine.ts");
		const vorher = mock.anfragen.length;
		const stat = await pollTermin(oeffneDb(), terminById("2021")!, {
			nurBehoerden: ["03254026"],
		});
		expect(stat.geaendert).toBe(0);
		const neue = mock.anfragen.slice(vorher);
		expect(neue.length).toBeLessThan(60);
		expect(neue.filter((p) => p.includes("Open-Data"))).toHaveLength(0);
		expect(
			neue.filter((p) => p.includes("/ergebnis_")).length,
		).toBeLessThanOrEqual(13);
		expect(neue.filter((p) => p.endsWith("/"))).toHaveLength(5); // ein Listing je Wahl (inkl. Stichwahl, die in den Fixtures fehlt → 404)
	});

	it("simuliert den Wahlabend 2026: leere Dateien, dann erste Schnellmeldungen mit Ticker und Hochrechnung", async () => {
		const { oeffneDb } = await import("../src/lib/db.ts");
		const { pollTermin } = await import("../src/lib/poll.ts");
		const { terminById } = await import("../src/data/termine.ts");
		const { ergebnis, wahleintraege, ereignisse, version, fortschritt } =
			await import("../src/lib/abfragen.ts");
		const { ladeWahlSeite } = await import("../src/lib/seite.ts");
		const { kreisBySlug } = await import("../src/data/kreise.ts");
		const hi = kreisBySlug("hildesheim")!;
		const { behoerdeBySlug } = await import("../src/data/behoerden.ts");
		const db = oeffneDb();
		const termin = terminById("2026")!;

		const s1 = await pollTermin(db, termin, {
			nurBehoerden: ["03254000", "03254026"],
		});
		expect(s1.fehler).toEqual([]);
		const ns = wahleintraege("2026", "03254026");
		expect(ns.find((w) => w.typ === "buergermeister")?.slug).toBe(
			"buergermeister",
		);
		expect(ns.find((w) => w.slug === "ortsrat-adensen")).toBeDefined();
		const rat = ns.find((w) => w.typ === "rat")!;
		expect(ergebnis("2026", "03254026", rat.wahlId, rat.gebietId)?.leer).toBe(
			true,
		);
		expect(ereignisse("2026")).toHaveLength(0);
		const v1 = version("2026");
		expect(
			fortschritt("2026").find((f) => f.behoerde.slug === "nordstemmen")?.max,
		).toBe(0);

		const abend = wahlabendFixtures(join(tmp, "wahlabend"));
		mock.setzeWurzel(abend);
		const s2 = await pollTermin(db, termin, { nurBehoerden: ["03254026"] });
		expect(s2.fehler).toEqual([]);
		expect(s2.geaendert).toBeGreaterThan(0);
		const g = ergebnis("2026", "03254026", rat.wahlId, rat.gebietId)!;
		expect(g.leer).toBe(false);
		expect(g.standAnz).toBe(2);
		expect(g.standMax).toBe(23);
		expect(version("2026")).not.toBe(v1);

		const ticker = ereignisse("2026");
		expect(ticker.length).toBeGreaterThanOrEqual(3);
		expect(ticker.map((t) => t.text)).toContain(
			"09 - Rössing - DGH: Gemeindewahl ausgezählt",
		);
		expect(ticker.find((t) => t.gebietId === rat.gebietId)?.text).toContain(
			"2 von 23",
		);

		const m = ladeWahlSeite(hi, termin, behoerdeBySlug("nordstemmen")!, "rat")!;
		expect(m.sitze).toBeUndefined();
		expect(m.sitzeAusstehend?.anz).toBe(2);
		expect(m.sitzeAusstehend?.max).toBe(23);
		expect(m.sitzeAusstehend?.noetig).toBe(5);
		expect(m.datenstand.art).toBe("zwischenstand");
		expect(m.vergleichTermin?.id).toBe("2021");
		expect(m.balken[0].diff).toBeDefined();
		expect(
			m.tabellen.find((t) => t.titel === "Wahlbezirke")?.zeilen.length,
		).toBe(23);
		expect(m.karte?.punkte.length).toBeGreaterThan(0);
		expect(
			m.karte?.ebenen
				.find((e) => e.id === "ortsteile")
				?.flaechen.some((f) => !f.ohneDaten),
		).toBe(true);

		const s3 = await pollTermin(db, termin, { nurBehoerden: ["03254026"] });
		expect(s3.geaendert).toBe(0);
		expect(ereignisse("2026")).toHaveLength(ticker.length);
	});
});
