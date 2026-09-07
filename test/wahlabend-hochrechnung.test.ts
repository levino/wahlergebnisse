/**
 * Der Weg durch die ganze Anwendung: Poller → Datenbank → Seitenmodell, mit
 * wachsendem Auszählstand. Geprüft wird, was am Wahlabend auf der Seite steht –
 * erst gar keine Sitzverteilung, dann eine Hochrechnung, zum Schluss das
 * amtliche Ergebnis.
 *
 * Die 2026-Fixtures tragen dabei die echten Nordstemmener Zahlen von 2021
 * (siehe `wahlabendMitBezirken`), das Gesamtergebnis ist die Summe der
 * gemeldeten Wahlbezirke. Vergleichswahl ist die Gemeindewahl 2021 – die
 * Hochrechnung müsste also fast punktgenau treffen, und was sie daran hindert,
 * sind genau die realen Stolpersteine: Die 2026-Wahlbezirke sind nicht
 * dieselben wie 2021.
 */
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	FIXTURES,
	aufraeumen,
	tempVerzeichnis,
	wahlabendMitBezirken,
} from "./helfer.ts";
import {
	type MockVotemanager,
	starteMockVotemanager,
} from "./mock-votemanager.ts";
import { cpSync } from "node:fs";
import { hareNiemeyer } from "../src/lib/sitze.ts";

let mock: MockVotemanager;
let tmp: string;

/** Die 2021er IDs der 15 Urnen- und 8 Briefwahlbezirke, in Bezirksreihenfolge. */
const URNE = [
	3111, 3112, 3113, 3114, 3115, 3116, 3117, 3118, 3119, 3120, 3121, 3122, 3123,
	3124, 3125,
];
const BRIEF = [4084, 4085, 4086, 4087, 4088, 4089, 4090, 4091];

const seite = async (bezirke: number[]) => {
	const wurzel = join(tmp, `stand-${bezirke.length}`);
	cpSync(FIXTURES, wurzel, { recursive: true });
	wahlabendMitBezirken(wurzel, "03254026", bezirke);
	mock.setzeWurzel(wurzel);
	const { oeffneDb } = await import("../src/lib/db.ts");
	const { pollTermin } = await import("../src/lib/poll.ts");
	const { terminById } = await import("../src/data/termine.ts");
	await pollTermin(oeffneDb(), terminById("2026")!, {
		nurBehoerden: ["03254026"],
	});
	const { ladeWahlSeite } = await import("../src/lib/seite.ts");
	const { kreisBySlug } = await import("../src/data/kreise.ts");
	const { behoerdeBySlug } = await import("../src/data/behoerden.ts");
	return ladeWahlSeite(
		kreisBySlug("hildesheim")!,
		terminById("2026")!,
		behoerdeBySlug("nordstemmen")!,
		"rat",
	)!;
};

beforeAll(async () => {
	tmp = tempVerzeichnis("wahlabend-hr-");
	mock = await starteMockVotemanager(FIXTURES);
	process.env.VOTEMANAGER_BASIS = mock.url;
	process.env.DATABASE_PATH = join(tmp, "wahlen.db");
	const { oeffneDb } = await import("../src/lib/db.ts");
	const { pollTermin } = await import("../src/lib/poll.ts");
	const { terminById } = await import("../src/data/termine.ts");
	// Vergleichsdaten: die Gemeindewahl 2021 mit allen 23 Wahlbezirken
	await pollTermin(oeffneDb(), terminById("2021")!, {
		nurBehoerden: ["03254026"],
	});
});

afterAll(async () => {
	const { schliesseDb } = await import("../src/lib/db.ts");
	schliesseDb();
	await mock.schliessen();
	aufraeumen(tmp);
});

describe("Wahlabend: was auf der Seite steht", () => {
	it("zeigt bei 3 von 23 Schnellmeldungen keine Sitzverteilung", async () => {
		const m = await seite(URNE.slice(0, 3));
		expect(m.aktuell?.standAnz).toBe(3);
		expect(m.sitze).toBeUndefined();
		expect(m.sitzeAusstehend).toMatchObject({
			anz: 3,
			max: 23,
			noetig: 5,
			kleinesGebiet: false,
		});
		expect(m.sitzeAusstehend?.text).toContain("Erst ab 5 von 23");
		expect(m.datenstand.art).toBe("zwischenstand");
		expect(m.datenstand.titel).toBe("Zwischenstand");
		// Die Stimmen stehen trotzdem da – nur eben als Zwischenstand.
		expect(m.balken.length).toBeGreaterThan(0);
	});

	it("rechnet ab 5 von 23 strukturbasiert hoch und beschriftet das", async () => {
		const m = await seite(URNE.slice(0, 5));
		expect(m.sitzeAusstehend).toBeUndefined();
		expect(m.sitze?.quelle).toBe("hochrechnung");
		expect(m.sitze?.art).toBe("struktur");
		expect(m.sitze?.gesamt).toBe(30);
		expect(m.sitze?.verteilung.reduce((a, v) => a + v.sitze, 0)).toBe(30);
		expect(m.sitze?.hinweis).toContain("Keine Prognose der Wahlleitung");
		expect(m.sitze?.hinweis).toContain("gewichtet mit deren damaliger");
		expect(m.datenstand.art).toBe("hochrechnung");
		expect(m.datenstand.titel).toBe("Hochrechnung");
	});

	it("kommt der amtlichen Sitzverteilung näher als der rohe Zwischenstand", async () => {
		// Vergleichswahl und „aktuelle“ Wahl tragen hier dieselben Zahlen, die
		// Auszählung zeigt aber nur einen verzerrten Ausschnitt: fünf bzw. sechs
		// Bezirke aus dem Kernort, kein Dorf, keine Briefwahl. Die Hochrechnung
		// muss daraus das Gesamtbild rekonstruieren.
		//
		// Punktgenau kann sie es nicht: Die 2026-Fixtures haben mit
		// „909 - Briefwahl Mahlerten“ einen Wahlbezirk, den es 2021 nicht gab
		// (und „10 - Rössing“ heißt heute anders) – also genau die
		// Gebietsänderungen, die es real auch gibt.
		const amtlich: Record<string, number> = {
			spd: 12,
			cdu: 9,
			grüne: 4,
			dieunabhängigen: 3,
			fdp: 1,
			dielinke: 1,
		};
		const falschVerteilt = (sitze: Array<{ key: string; sitze: number }>) =>
			sitze.reduce((a, v) => a + Math.abs(v.sitze - (amtlich[v.key] ?? 0)), 0) /
			2;

		let besser = 0;
		for (const n of [5, 6, 7, 8]) {
			const m = await seite(URNE.slice(0, n));
			// Zum Vergleich: die Sitze, die der rohe Zwischenstand ergäbe
			const roh = hareNiemeyer(
				m.balken.map((b) => ({ key: b.key, stimmen: b.stimmen })),
				30,
			);
			const fRoh = falschVerteilt(roh);
			const fHoch = falschVerteilt(m.sitze?.verteilung ?? []);
			// Der rohe Zwischenstand liegt bei diesem Ausschnitt immer daneben …
			expect(fRoh).toBeGreaterThan(0);
			// … die Hochrechnung nie schlechter …
			expect(fHoch).toBeLessThanOrEqual(fRoh);
			if (fHoch < fRoh) besser++;
		}
		// … und mehrfach besser.
		expect(besser).toBeGreaterThanOrEqual(2);
	});

	it("meldet nach der letzten Schnellmeldung ein vollständiges Ergebnis", async () => {
		const m = await seite([...URNE, ...BRIEF]);
		expect(m.aktuell?.standAnz).toBe(23);
		expect(m.datenstand.art).toBe("endergebnis");
		expect(m.sitzeAusstehend).toBeUndefined();
		expect(m.sitze?.verteilung.reduce((a, v) => a + v.sitze, 0)).toBe(30);
	});
});
