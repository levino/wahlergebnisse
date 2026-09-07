/**
 * Integrationstest des Datenwegs: Mock-votemanager → Poller → SQLite →
 * Abfragen. Läuft komplett offline gegen die Fixtures (echte Dateien des
 * Landkreises, siehe scripts/fixtures_holen.py).
 */
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

		// Kreistagswahl: Gesamtergebnis mit Sitzen
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

		// Untergebiete der Kreisebene: 18 Gemeinden (ebene 3) und 12 Kreiswahlbereiche (ebene 9)
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

		// Landratswahl: Personenwahl, Kandidat/Partei getrennt
		const landrat = wahleintraege("2021", "03254000").find(
			(w) => w.typ === "landrat",
		)!;
		const l = ergebnis("2021", "03254000", landrat.wahlId, landrat.gebietId)!;
		expect(l.ergebnis.personenwahl).toBe(true);
		expect(l.ergebnis.parteien[0].kandidat).toEqual({
			name: "Bernd Lynack",
			partei: "SPD",
		});

		// Nordstemmen: Gemeindewahl mit 30 Sitzen, 9 Ortsratswahlen mit eigenen Slugs, Wahlbezirke "1 von 1"
		const ns = wahleintraege("2021", "03254026");
		expect(ns.filter((w) => w.typ === "ortsrat")).toHaveLength(9);
		expect(ns.map((w) => w.slug)).toContain("ortsrat-roessing");
		// Jede Wahl ist über genau eine Adresse erreichbar, und der abgeleitete
		// Gebietsname steht mit in der Datenbank – ohne ihn hießen die Ortsräte
		// in der Umschaltleiste alle gleich.
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

		// Übersichten und Wahlräume
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

		// Archiv: keine Ticker-Ereignisse, aber ein Versionsstempel
		expect(ereignisse("2021")).toHaveLength(0);
		expect(version("2021")).not.toBe("");
	});

	it("ergänzt die Listenplätze der Bewerber je Gebiet", async () => {
		const { listenplaetze, wahleintraege } = await import(
			"../src/lib/abfragen.ts"
		);
		const { platzSchluessel } = await import("../src/lib/kandidaten.ts");

		// Kreistagswahl: jede Partei stellt je Wahlbereich eine eigene Liste.
		// Wahlbereich B (Elze/Nordstemmen) ist ebene_9_id_57.
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
		// Mit 300 Stimmen auf Platz 7 – gewählt wird nach Stimmen, nicht nach Platz
		expect(wbB.get(platzSchluessel("cdu", "Hanno Conrad"))).toBe(7);

		// Gemeindewahl Nordstemmen: Arlt war drittbester, stand aber weiter hinten
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

		// Alle neun laufen 2021 unter derselben Wahl-Id (wahl_29) und
		// unterscheiden sich nur im Gesamtgebiet. Früher holte der Poller nur
		// die CSV der ersten Ortschaft – Adensen –, alle anderen blieben leer.
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
		// Rössing: Bernd Könneke hatte mit 246 Stimmen die meisten der SPD,
		// stand aber nicht oben auf der Liste.
		expect(platz("ortsrat-roessing", "spd", "Roman Veselý")).toBe(1);
		expect(platz("ortsrat-roessing", "spd", "Bernd Könneke")).toBe(2);
		expect(platz("ortsrat-roessing", "cdu", "Wolfgang Scholz")).toBe(1);
		// Adensen: einzige Liste, "Die Unabhängigen in Nordstemmen" (D5)
		expect(
			platz("ortsrat-adensen", "dieunabhängigen", "Oliver Riechelmann"),
		).toBe(1);
		// Burgstemmen: D13 heißt hier "Wählergemeinschaft Zukunft Burgstemmen",
		// in Klein Escherde dagegen "Einzelwahlvorschlag Helbing". Erst die
		// ortsgenaue Auflösung der open_data-Einträge macht sie brauchbar.
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
		// termin, Wahlräume, open_data, je Wahl (wahl.json + Listing), die
		// Gesamtgebiete und die gefüllten Übersichten – alles bedingt (304).
		// Die Open-Data-CSVs entfallen, weil die Listenplätze schon feststehen.
		expect(neue.length).toBeLessThan(60);
		expect(neue.filter((p) => p.includes("Open-Data"))).toHaveLength(0);
		// Ergebnisdateien werden nur bei geändertem Listing-Stand geholt → hier keine
		// Die Gesamtgebiete (Landrat, Stichwahl, Kreiswahl, Rat, 9 Ortsräte = 13) werden immer bedingt
		// per ETag geholt (→ 304), Untergebiete nur bei geändertem Listing-Stand → hier keine weiteren
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

		// Phase 1: vor der Wahl – Strukturen da, Ergebnisse leer
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

		// Phase 2: erste Schnellmeldungen
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

		// Seitenmodell: Hochrechnung nach Hare-Niemeyer mit 30 Sitzen aus 2021 (Vergleich), Karte mit Wahllokalen
		const m = ladeWahlSeite(hi, termin, behoerdeBySlug("nordstemmen")!, "rat")!;
		expect(m.sitze?.quelle).toBe("hochrechnung");
		expect(m.sitze?.gesamt).toBe(30);
		expect(m.sitze?.verteilung.reduce((a, v) => a + v.sitze, 0)).toBe(30);
		expect(m.vergleichTermin?.id).toBe("2021");
		expect(m.balken[0].diff).toBeDefined();
		expect(
			m.tabellen.find((t) => t.titel === "Wahlbezirke")?.zeilen.length,
		).toBe(23);
		expect(m.karte?.punkte.length).toBeGreaterThan(0);
		// Ortsteil-Flächen sind aus den Wahlbezirken aggregiert (2026 hat keine Ortsteil-Übersicht)
		expect(
			m.karte?.ebenen
				.find((e) => e.id === "ortsteile")
				?.flaechen.some((f) => !f.ohneDaten),
		).toBe(true);

		// Kein zweites Ticker-Ereignis ohne neuen Fortschritt
		const s3 = await pollTermin(db, termin, { nurBehoerden: ["03254026"] });
		expect(s3.geaendert).toBe(0);
		expect(ereignisse("2026")).toHaveLength(ticker.length);
	});
});
