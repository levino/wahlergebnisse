/**
 * Die Probe auf den Wahlabend: mehrere Kreise gleichzeitig.
 *
 * Der vorhandene Browser-Test spielt einen Wahlabend für **einen** Kreis
 * durch. Am 13. September 2026 laufen die Schnellmeldungen aber in 38 Kreisen
 * parallel ein, und der Poller arbeitet sie gestaffelt ab. Dieser Test stellt
 * genau das nach – gegen den Mock-votemanager, offline, mit den echten
 * Fixtures des Landkreises, die auf mehrere Kreise gespiegelt werden:
 *
 *   – In drei Kreisen liegen zunächst leere Ergebnisdateien.
 *   – Dann meldet der Mock in allen dreien gleichzeitig erste Ergebnisse.
 *   – Ein Lauf muss sie alle mitnehmen, Ticker-Ereignisse anlegen und dabei
 *     ohne Fehler bleiben.
 *   – Ein vierter Kreis hat gar keine Präsentation. Er darf nichts kaputt
 *     machen und keinen Fehler erzeugen.
 *
 * Nebenbei hält der Test die Zahl fest, auf der die ganze Taktrechnung
 * beruht: was ein Durchgang durch einen Kreis an bedingten Anfragen kostet
 * (siehe Kopfkommentar von src/lib/takt.ts).
 */
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

/**
 * Drei Kreise, in die die Hildesheimer Fixtures gespiegelt werden, und ein
 * vierter ohne jede Präsentation.
 */
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

	// Derselbe Baum noch einmal, diesmal mit ersten Schnellmeldungen in jedem
	// der drei Kreise – so wie es um kurz nach 18 Uhr überall gleichzeitig
	// passiert.
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

		// --- Vor 18 Uhr: die Präsentationen stehen, Ergebnisse sind leer ---
		const erster = await pollTermin(db, termin, { nurKreise: alle });
		expect(erster.fehler).toEqual([]);
		for (const slug of KREISE_MIT_DATEN) {
			const ags = melder.get(slug)!;
			expect(wahleintraege("2026", ags).length, slug).toBeGreaterThan(0);
		}
		// Der Kreis ohne Präsentation liefert nichts – und keinen Fehler.
		for (const b of kreisBySlug(KREIS_OHNE_DATEN)!.behoerden)
			expect(wahleintraege("2026", b.ags), KREIS_OHNE_DATEN).toEqual([]);
		expect(ereignisse("2026", 100)).toEqual([]);

		// --- Der zweite Lauf ist der eingeschwungene Zustand: alles bedingt ---
		const zweiter = await pollTermin(db, termin, { nurKreise: alle });
		expect(zweiter.fehler).toEqual([]);
		expect(zweiter.geaendert).toBe(0);
		// Die Zahl, auf der die Taktrechnung in src/lib/takt.ts beruht. Sie darf
		// sich ändern – dann gehört die Rechnung dort mit geändert.
		const jeBehoerde = zweiter.anfragen / (KREISE_MIT_DATEN.length * 2);
		console.log(
			`eingeschwungener Lauf: ${zweiter.anfragen} bedingte Anfragen für ${KREISE_MIT_DATEN.length * 2} besetzte Behörden = ${jeBehoerde.toFixed(1)} je Behörde`,
		);
		expect(jeBehoerde).toBeGreaterThan(5);
		expect(jeBehoerde).toBeLessThan(25);

		// --- 18 Uhr: in allen drei Kreisen kommen die ersten Meldungen ---
		mock.setzeWurzel(abend);
		mock.anfragen.length = 0;
		const dritter = await pollTermin(db, termin, { nurKreise: alle });
		expect(dritter.fehler).toEqual([]);
		expect(dritter.geaendert).toBeGreaterThan(0);

		for (const slug of KREISE_MIT_DATEN) {
			const ags = melder.get(slug)!;
			const wahl = wahlBySlug("2026", ags, "rat");
			expect(wahl, `${slug}: Gemeindewahl fehlt`).toBeTruthy();
			const e = ergebnis("2026", ags, wahl!.wahlId, wahl!.gebietId);
			expect(e, `${slug}: kein Gesamtergebnis`).toBeTruthy();
			expect(e!.standAnz, `${slug}: Schnellmeldungen`).toBe(2);
			expect(e!.standMax, slug).toBe(23);
			expect(e!.ergebnis.parteien.length, slug).toBeGreaterThan(1);
		}

		// --- Der Ticker meldet die Eingänge, und zwar aus mehreren Kreisen ---
		const ticker = ereignisse("2026", 200);
		expect(ticker.length).toBeGreaterThan(KREISE_MIT_DATEN.length);
		const meldendeBehoerden = new Set(ticker.map((e) => e.behoerde));
		for (const slug of KREISE_MIT_DATEN)
			expect(meldendeBehoerden.has(melder.get(slug)!), slug).toBe(true);
		expect(
			ticker.some((e) => e.text.includes("Gemeindewahl")),
			"Ticker nennt die Wahl",
		).toBe(true);

		// --- Der Kreis ohne Präsentation bleibt auch jetzt still ---
		for (const b of kreisBySlug(KREIS_OHNE_DATEN)!.behoerden)
			expect(ticker.some((e) => e.behoerde === b.ags)).toBe(false);

		// --- Und noch ein Lauf: keine Dubletten im Ticker, keine Fehler ---
		const vierter = await pollTermin(db, termin, { nurKreise: alle });
		expect(vierter.fehler).toEqual([]);
		expect(vierter.geaendert).toBe(0);
		expect(ereignisse("2026", 200)).toHaveLength(ticker.length);
	}, 120_000);

	/**
	 * Die Zahl, auf der die Taktrechnung in src/lib/takt.ts steht. Ändert sie
	 * sich, ändert sich alles daran Hängende – deshalb steht sie hier fest und
	 * nicht als Schätzung im Kommentar.
	 */
	it("hält fest, was ein Durchgang durch einen ganzen Kreis kostet", async () => {
		const { oeffneDb } = await import("../src/lib/db.ts");
		const { pollTermin } = await import("../src/lib/poll.ts");
		const { terminById } = await import("../src/data/termine.ts");
		const db = oeffneDb();

		// Zweimal laufen lassen: Der erste Lauf holt alles, der zweite ist der
		// Zustand, in dem der Poller den Abend über bleibt (alles bedingt).
		const zaehle = async (terminId: string) => {
			const termin = terminById(terminId)!;
			await pollTermin(db, termin, { nurKreise: ["hildesheim"] });
			const s = await pollTermin(db, termin, { nurKreise: ["hildesheim"] });
			expect(s.fehler).toEqual([]);
			expect(s.geaendert).toBe(0);
			return s.anfragen;
		};

		// 19 Behörden, Präsentation angelegt, Ergebnisse noch leer.
		const vorDerWahl = await zaehle("2026");
		// 19 Behörden, alle Ebenen mit Zahlen besetzt – der Wahlabend-Fall.
		const vollBesetzt = await zaehle("2021");
		console.log(
			`Hildesheim (19 Behörden): ${vorDerWahl} Anfragen vor der Wahl, ${vollBesetzt} voll besetzt = ${(vollBesetzt / 19).toFixed(1)} je Behörde`,
		);
		expect(vorDerWahl).toBe(256);
		expect(vollBesetzt).toBe(342);
		// 342 / 19 = 18,0 – der Ansatz im Kopfkommentar von src/lib/takt.ts.
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
		// Der Kreis-AGS von Holzminden kommt aus dem Katalog, die Gemeinde ist
		// oben gemerkt; alles andere darf nicht angefasst worden sein.
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
