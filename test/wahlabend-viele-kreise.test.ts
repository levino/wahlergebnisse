import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	aufraeumen,
	tempVerzeichnis,
	vieleKreiseFixtures,
	wahlabendFuerBehoerde,
} from "./helfer.ts";
import {
	type MockVotemanager,
	starteMockVotemanager,
} from "./mock-votemanager.ts";

const KREISE_MIT_DATEN = ["holzminden", "goslar", "northeim"];
const KREIS_OHNE_DATEN = "peine";

let mock: MockVotemanager;
let tmp: string;
let vorher: string;
let abend: string;
/** Kreis-Slug → AGS der Behörde, die am Wahlabend meldet. */
let melder: Map<string, string>;

beforeAll(async () => {
	tmp = tempVerzeichnis("wahlabend-viele-");
	const gespiegelt = vieleKreiseFixtures(join(tmp, "vorher"), KREISE_MIT_DATEN);
	vorher = gespiegelt.wurzel;
	melder = gespiegelt.melder;

	abend = vieleKreiseFixtures(join(tmp, "abend"), KREISE_MIT_DATEN).wurzel;
	for (const ags of melder.values()) wahlabendFuerBehoerde(abend, ags);

	mock = await starteMockVotemanager(vorher, 0, { listing: false });
	process.env.VOTEMANAGER_BASIS = mock.url;
	process.env.DATABASE_PATH = join(tmp, "wahlen.db");
});

afterAll(async () => {
	const { schliesseDb } = await import("../src/lib/db.ts");
	schliesseDb();
	await mock.schliessen();
	aufraeumen(tmp);
});

describe("Wahlabend mit vielen Kreisen", () => {
	it("trägt einen Abend, in dem in mehreren Kreisen gleichzeitig Ergebnisse eingehen", async () => {
		const { oeffneDb } = await import("../src/lib/db.ts");
		const { pollTermin } = await import("../src/lib/poll.ts");
		const { terminById } = await import("../src/data/termine.ts");
		const { kreisBySlug } = await import("../src/data/kreise.ts");
		const { ergebnis, ereignisse, wahleintraege, wahlBySlug } = await import(
			"../src/lib/abfragen.ts"
		);
		const db = oeffneDb();
		const termin = terminById("2026")!;
		const alle = [...KREISE_MIT_DATEN, KREIS_OHNE_DATEN];

		const erster = await pollTermin(db, termin, { nurKreise: alle });
		expect(erster.fehler).toEqual([]);
		for (const slug of KREISE_MIT_DATEN) {
			const ags = melder.get(slug)!;
			expect(wahleintraege("2026", ags).length, slug).toBeGreaterThan(0);
		}
		for (const b of kreisBySlug(KREIS_OHNE_DATEN)!.behoerden)
			expect(wahleintraege("2026", b.ags), KREIS_OHNE_DATEN).toEqual([]);
		expect(ereignisse("2026", 100)).toEqual([]);

		const zweiter = await pollTermin(db, termin, { nurKreise: alle });
		expect(zweiter.fehler).toEqual([]);
		expect(zweiter.geaendert).toBe(0);
		const jeBehoerde = zweiter.anfragen / (KREISE_MIT_DATEN.length * 2);
		console.log(
			`eingeschwungener Lauf: ${zweiter.anfragen} bedingte Anfragen für ${KREISE_MIT_DATEN.length * 2} besetzte Behörden = ${jeBehoerde.toFixed(1)} je Behörde`,
		);
		expect(jeBehoerde).toBeGreaterThan(5);
		expect(jeBehoerde).toBeLessThan(25);

		mock.setzeWurzel(abend);
		mock.anfragen.length = 0;
		const dritter = await pollTermin(db, termin, { nurKreise: alle });
		expect(dritter.fehler).toEqual([]);
		expect(dritter.geaendert).toBeGreaterThan(0);

		for (const slug of KREISE_MIT_DATEN) {
			const ags = melder.get(slug)!;
			const wahl = wahleintraege("2026", ags).find((w) => w.typ === "rat");
			expect(wahl, `${slug}: Gemeindewahl fehlt`).toBeTruthy();
			const e = ergebnis("2026", ags, wahl!.wahlId, wahl!.gebietId);
			expect(e, `${slug}: kein Gesamtergebnis`).toBeTruthy();
			expect(e!.standAnz, `${slug}: Schnellmeldungen`).toBe(2);
			expect(e!.standMax, slug).toBe(23);
			expect(e!.ergebnis.parteien.length, slug).toBeGreaterThan(1);
		}

		const ticker = ereignisse("2026", 200);
		expect(ticker.length).toBeGreaterThan(KREISE_MIT_DATEN.length);
		const meldendeBehoerden = new Set(ticker.map((e) => e.behoerde));
		for (const slug of KREISE_MIT_DATEN)
			expect(meldendeBehoerden.has(melder.get(slug)!), slug).toBe(true);
		expect(
			ticker.some((e) => e.text.includes("Gemeindewahl")),
			"Ticker nennt die Wahl",
		).toBe(true);

		for (const b of kreisBySlug(KREIS_OHNE_DATEN)!.behoerden)
			expect(ticker.some((e) => e.behoerde === b.ags)).toBe(false);

		const vierter = await pollTermin(db, termin, { nurKreise: alle });
		expect(vierter.fehler).toEqual([]);
		expect(vierter.geaendert).toBe(0);
		expect(ereignisse("2026", 200)).toHaveLength(ticker.length);
	}, 120_000);

	it("hält fest, was ein Durchgang durch einen ganzen Kreis kostet", async () => {
		const { oeffneDb } = await import("../src/lib/db.ts");
		const { pollTermin } = await import("../src/lib/poll.ts");
		const { terminById } = await import("../src/data/termine.ts");
		const db = oeffneDb();

		const zaehle = async (terminId: string) => {
			const termin = terminById(terminId)!;
			await pollTermin(db, termin, { nurKreise: ["hildesheim"] });
			const s = await pollTermin(db, termin, { nurKreise: ["hildesheim"] });
			expect(s.fehler).toEqual([]);
			expect(s.geaendert).toBe(0);
			return s.anfragen;
		};

		const vorDerWahl = await zaehle("2026");
		const vollBesetzt = await zaehle("2021");
		console.log(
			`Hildesheim (19 Behörden): ${vorDerWahl} Anfragen vor der Wahl, ${vollBesetzt} voll besetzt = ${(vollBesetzt / 19).toFixed(1)} je Behörde`,
		);
		expect(vorDerWahl).toBe(255);
		expect(vollBesetzt).toBe(342);
		expect(Math.round(vollBesetzt / 19)).toBe(18);
	}, 120_000);

	it("fragt nur die Kreise ab, die dran sind", async () => {
		const { oeffneDb } = await import("../src/lib/db.ts");
		const { pollTermin } = await import("../src/lib/poll.ts");
		const { terminById } = await import("../src/data/termine.ts");
		const db = oeffneDb();
		const termin = terminById("2026")!;

		mock.anfragen.length = 0;
		await pollTermin(db, termin, { nurKreise: ["holzminden"] });
		const agsHolzminden = melder.get("holzminden")!;
		const fremde = mock.anfragen.filter(
			(p) => !p.includes(agsHolzminden) && !p.includes("03254000"),
		);
		const { kreisBySlug } = await import("../src/data/kreise.ts");
		const erlaubt = new Set(
			kreisBySlug("holzminden")!.behoerden.map((b) => b.ags),
		);
		for (const pfad of fremde) {
			const ags = pfad.match(/\/(\d{8,9})\/daten\//)?.[1];
			if (ags) expect(erlaubt.has(ags), pfad).toBe(true);
		}
	}, 60_000);
});
