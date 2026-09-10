/**
 * Der Demo-Wahlabend über den ganzen Weg: Vorlage aus den Archivzahlen,
 * Bezirke tröpfeln herein, und am Ende steht das vollständige Bild.
 *
 * Geprüft wird, was die Generalprobe leisten soll – dass sie den echten Abend
 * nachstellt und nicht bloß Zahlen hinschreibt: Der Auszählstand wächst, der
 * Ticker füllt sich, die Anwendung rechnet unterwegs hoch.
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

const DEMO = "03254026";

const spiele = async (fortschritt: number, zyklusNummer = 7) => {
	const { oeffneDb } = await import("../src/lib/db.ts");
	const { baueVorlage, legeWahlenAn, raeumeDemoTermin, spieleStand } =
		await import("../src/lib/demo-abend.ts");
	const { kreisBySlug } = await import("../src/data/kreise.ts");
	const { terminById } = await import("../src/data/termine.ts");
	const db = oeffneDb();
	const kreis = kreisBySlug("hildesheim")!;
	const termin = terminById("2026")!;
	const behoerde = kreis.behoerden.find((b) => b.ags === DEMO)!;
	const wahlen = baueVorlage(db, kreis, termin, behoerde);
	raeumeDemoTermin(db, termin, behoerde);
	legeWahlenAn(db, termin, behoerde, wahlen);
	spieleStand(db, termin, behoerde, wahlen, {
		nummer: zyklusNummer,
		fortschritt,
		// Ein Durchlauf, der irgendwann begonnen hat: Die Zeitstempel der
		// Ergebnisse hängen daran (eingangsZeit in demo.ts).
		beginn: Date.UTC(2026, 8, 13, 16, 0, 0),
		dauer: 600_000,
	});
	return { kreis, termin, behoerde, wahlen };
};

beforeAll(async () => {
	tmp = tempVerzeichnis("demo-");
	mock = await starteMockVotemanager(FIXTURES);
	process.env.VOTEMANAGER_BASIS = mock.url;
	process.env.DATABASE_PATH = join(tmp, "wahlen.db");
	const { oeffneDb } = await import("../src/lib/db.ts");
	const { pollTermin } = await import("../src/lib/poll.ts");
	const { terminById } = await import("../src/data/termine.ts");
	// Die Vorlage: die Archivtermine, aus denen die Demo schöpft.
	for (const id of ["2021", "2020"])
		await pollTermin(oeffneDb(), terminById(id)!, { nurBehoerden: [DEMO] });
});

afterAll(async () => {
	const { schliesseDb } = await import("../src/lib/db.ts");
	schliesseDb();
	await mock.schliessen();
	aufraeumen(tmp);
});

describe("Vorlage", () => {
	it("nimmt je Amt die jüngste frühere Wahl derselben Wahlleitung", async () => {
		const { wahlen } = await spiele(0);
		const { erkenneWahltyp } = await import("../src/lib/wahltyp.ts");
		const typen = wahlen.map((w) => erkenneWahltyp(w.titel));
		// Rat, Ortsräte und die kreisweiten Wahlen kommen aus 2021 …
		expect(typen).toContain("rat");
		expect(typen).toContain("ortsrat");
		expect(typen).toContain("kreistag");
		// … die Bürgermeisterwahl aus 2020, denn 2021 gab es in Nordstemmen
		// keine. Genau dafür ist die Suche über mehrere Termine da.
		expect(typen).toContain("buergermeister");
		// Und jedes Amt genau einmal.
		expect(new Set(typen).size).toBe(typen.length);
	});

	it("kennt zu jeder Wahl ihre Auszähleinheiten", async () => {
		const { wahlen } = await spiele(0);
		for (const w of wahlen) expect(w.bausteine.length).toBeGreaterThan(1);
	});
});

describe("Ein Durchlauf", () => {
	it("beginnt mit einer leeren Aufstellung", async () => {
		const { kreis, termin, behoerde } = await spiele(0);
		const { ladeDashboard, kreisebeneFuer } = await import(
			"../src/lib/dashboard.ts"
		);
		const { wahleintraege } = await import("../src/lib/abfragen.ts");
		const kreisBehoerde = kreis.behoerden.find((b) => b.ags === kreis.ags)!;
		const m = ladeDashboard(
			kreis,
			termin,
			behoerde,
			wahleintraege(termin.id, behoerde.ags),
			kreisebeneFuer(termin, kreisBehoerde, behoerde),
		);
		// Die Folien stehen alle da – nur eben ohne Zahlen. Das ist der
		// Zustand, den man am Abend als Erstes sieht.
		expect(m.folien.length).toBeGreaterThan(5);
		const wahlFolien = m.folien.filter((f) => f.art === "wahl");
		expect(wahlFolien.every((f) => f.art === "wahl" && f.anz === 0)).toBe(true);
	});

	it("zählt unterwegs hoch und rechnet hoch", async () => {
		const { kreis, termin, behoerde } = await spiele(0.4);
		const { wahlKern } = await import("../src/lib/seite.ts");
		const { wahleintraege } = await import("../src/lib/abfragen.ts");
		const rat = wahleintraege(termin.id, behoerde.ags).find(
			(w) => w.typ === "rat",
		)!;
		const m = wahlKern(kreis, termin, behoerde, rat.slug)!;
		expect(m.aktuell?.standAnz).toBeGreaterThan(0);
		expect(m.aktuell!.standAnz!).toBeLessThan(m.aktuell!.standMax!);
		// Kein amtliches Ergebnis, solange gezählt wird – und ab der Schwelle
		// eine Hochrechnung mit Einstufung.
		expect(m.datenstand.art).not.toBe("endergebnis");
		expect(m.balken.length).toBeGreaterThan(0);
	});

	it("endet vollständig ausgezählt", async () => {
		const { kreis, termin, behoerde } = await spiele(1);
		const { wahlKern } = await import("../src/lib/seite.ts");
		const { wahleintraege } = await import("../src/lib/abfragen.ts");
		const rat = wahleintraege(termin.id, behoerde.ags).find(
			(w) => w.typ === "rat",
		)!;
		const m = wahlKern(kreis, termin, behoerde, rat.slug)!;
		expect(m.aktuell?.standAnz).toBe(m.aktuell?.standMax);
		expect(m.datenstand.art).toBe("endergebnis");
	});

	it("füllt den Ticker, während die Bezirke eingehen", async () => {
		const { oeffneDb } = await import("../src/lib/db.ts");
		const zaehle = () =>
			(
				oeffneDb()
					.prepare("SELECT COUNT(*) AS n FROM ereignisse WHERE termin = ?")
					.get("2026") as { n: number }
			).n;
		await spiele(0.2, 11);
		const vorher = zaehle();
		await spiele(0.6, 11);
		expect(zaehle()).toBeGreaterThan(vorher);
	});

	it("weicht von der Vorlage ab, damit sich etwas bewegt", async () => {
		// Ohne Rauschen stünde in jeder Veränderungsspalte „±0,0“ und jeder
		// Durchlauf sähe aus wie der vorige.
		const { kreis, termin, behoerde } = await spiele(1, 3);
		const { wahlKern } = await import("../src/lib/seite.ts");
		const { wahleintraege } = await import("../src/lib/abfragen.ts");
		const rat = wahleintraege(termin.id, behoerde.ags).find(
			(w) => w.typ === "rat",
		)!;
		const m = wahlKern(kreis, termin, behoerde, rat.slug)!;
		const diffs = m.balken.map((b) => b.diff).filter((d) => d !== undefined);
		expect(diffs.length).toBeGreaterThan(0);
		expect(diffs.some((d) => Math.abs(d) > 0.05)).toBe(true);
	});
});
