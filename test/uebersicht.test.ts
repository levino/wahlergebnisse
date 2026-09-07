/**
 * Die Startseite eines Kreises – für einen Landkreis und für eine kreisfreie
 * Stadt.
 *
 * Die kreisfreie Stadt steht deshalb in den Fixtures: Sechs von ihnen zeigten
 * „Die Daten dieses Termins sind noch nicht geladen“ und verlinkten keine
 * einzige ihrer Wahlen, obwohl alle Zahlen vorlagen – gemerkt hat das
 * niemand, weil sich sämtliche Tests auf den Landkreis Hildesheim stützten.
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
	tmp = tempVerzeichnis("wahlen-uebersicht-");
	mock = await starteMockVotemanager(FIXTURES, 0, { listing: false });
	process.env.VOTEMANAGER_BASIS = mock.url;
	process.env.DATABASE_PATH = join(tmp, "wahlen.db");
	const { oeffneDb } = await import("../src/lib/db.ts");
	const { pollTermin } = await import("../src/lib/poll.ts");
	const { terminById } = await import("../src/data/termine.ts");
	// Nur die beiden Kreise, für die es Fixtures gibt – sonst liefe der Poller
	// gegen 45 Kreise, von denen 43 nichts liefern.
	await pollTermin(oeffneDb(), terminById("2026")!, {
		nurKreise: ["hildesheim", "emden"],
	});
});

afterAll(async () => {
	const { schliesseDb } = await import("../src/lib/db.ts");
	schliesseDb();
	await mock.schliessen();
	aufraeumen(tmp);
});

describe("terminUebersicht", () => {
	it("kreisfreie Stadt: Oberbürgermeister und Rat als Karten, Ortsräte als Liste", async () => {
		const { terminUebersicht } = await import("../src/lib/uebersicht.ts");
		const { kreisBySlug } = await import("../src/data/kreise.ts");
		const { terminById } = await import("../src/data/termine.ts");
		const m = terminUebersicht(terminById("2026")!, kreisBySlug("emden")!);

		expect(m.kreisfrei).toBe(true);
		expect(m.daten).toBe(true);
		expect(m.gemeinden).toEqual([]);
		// Kein Landrat, kein Kreistag – trotzdem Karten mit Zahlen.
		expect(m.karten.map((k) => k.eintrag.kurz)).toEqual([
			"Oberbürgermeisterwahl",
			"Stadtratswahl",
		]);
		expect(m.karten.every((k) => k.ergebnis !== undefined)).toBe(true);
		// Die Ortsräte stehen als Liste, nicht als Karten.
		expect(m.ortsraete.map((w) => w.gebietTitel)).toEqual([
			"Ortschaft Borssum",
			"Ortschaft Wolthusen",
		]);
		// Der Fortschritt kommt von der Stadt selbst, nicht von Gemeinden.
		expect(m.gesamt).toEqual({ anz: 42, max: 42 });
	});

	it("kreisfreie Stadt: die Karten zeigen die stärksten Parteien", async () => {
		const { terminUebersicht } = await import("../src/lib/uebersicht.ts");
		const { staerkste } = await import("../src/lib/anzeige.ts");
		const { kreisBySlug } = await import("../src/data/kreise.ts");
		const { terminById } = await import("../src/data/termine.ts");
		const m = terminUebersicht(terminById("2026")!, kreisBySlug("emden")!);
		const rat = m.karten.find((k) => k.eintrag.typ === "rat")!;
		const parteien = rat.ergebnis!.ergebnis.parteien;

		// So kommt es aus der Wahlpräsentation: Stimmzettel-Reihenfolge.
		expect(parteien.slice(0, 6).map((p) => p.kurz)).toContain("Die PARTEI");
		// So gehört es auf die Karte: die sechs stärksten.
		expect(staerkste(parteien, 6).map((p) => p.kurz)).toEqual([
			"SPD",
			"CDU",
			"GRÜNE",
			"AfD",
			"FWG",
			"FDP",
		]);
	});

	it("Landkreis: Kreiswahlen als Karten, Gemeinden darunter", async () => {
		const { terminUebersicht } = await import("../src/lib/uebersicht.ts");
		const { kreisBySlug } = await import("../src/data/kreise.ts");
		const { terminById } = await import("../src/data/termine.ts");
		const m = terminUebersicht(terminById("2026")!, kreisBySlug("hildesheim")!);

		expect(m.kreisfrei).toBe(false);
		expect(m.karten.map((k) => k.eintrag.kurz)).toEqual([
			"Landratswahl",
			"Kreistagswahl",
		]);
		// Die Kreisbehörde selbst führt keine Ortsräte.
		expect(m.ortsraete).toEqual([]);
		expect(m.gemeinden.some((g) => g.behoerde.slug === "nordstemmen")).toBe(
			true,
		);
		// Die Gemeinden stehen als Gemeinden da, nicht als Karten.
		expect(m.karten.some((k) => k.eintrag.behoerde !== "03254000")).toBe(false);
	});

	it("Landkreis: der Untertitel einer Gemeinde nennt ihre eigenen Wahlen", async () => {
		const { terminUebersicht, gemeindeUntertitel } = await import(
			"../src/lib/uebersicht.ts"
		);
		const { kreisBySlug } = await import("../src/data/kreise.ts");
		const { terminById } = await import("../src/data/termine.ts");
		const m = terminUebersicht(terminById("2026")!, kreisBySlug("hildesheim")!);
		const ns = m.gemeinden.find((g) => g.behoerde.slug === "nordstemmen")!;
		const untertitel = gemeindeUntertitel(ns.wahlen);

		expect(untertitel).toContain("Bürgermeisterwahl");
		expect(untertitel).toContain("9 Ortsräte");
		// Landrat und Kreistag stehen in jeder Gemeinde und sagen über sie nichts.
		expect(untertitel).not.toContain("Landratswahl");
		expect(untertitel).not.toContain("Kreistagswahl");
	});
});
