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
		expect(m.sitze?.unsicherheit).toBe("hoch");
		expect(m.datenstand.unsicherheit).toBe("hoch");
		expect(m.sitze?.hinweis).toContain("Unsicherheit hoch");
		expect(m.datenstand.text).toContain("mehrere Sitze");
	});

	it("stuft die Unsicherheit herunter, während der Abend läuft", async () => {
		const neun = await seite(URNE.slice(0, 9));
		expect(neun.aktuell?.standAnz).toBe(9);
		expect(neun.sitze?.unsicherheit).toBe("mittel");
		expect(neun.datenstand.unsicherheit).toBe("mittel");

		const sechzehn = await seite([...URNE, ...BRIEF].slice(0, 16));
		expect(sechzehn.aktuell?.standAnz).toBe(16);
		expect(sechzehn.sitze?.unsicherheit).toBe("niedrig");
		expect(sechzehn.datenstand.text).toContain("Höchstens noch ein Sitz");
	});

	it("kommt der amtlichen Sitzverteilung näher als der rohe Zwischenstand", async () => {
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
			const roh = hareNiemeyer(
				m.balken.map((b) => ({ key: b.key, stimmen: b.stimmen })),
				30,
			);
			const fRoh = falschVerteilt(roh);
			const fHoch = falschVerteilt(m.sitze?.verteilung ?? []);
			expect(fRoh).toBeGreaterThan(0);
			expect(fHoch).toBeLessThanOrEqual(fRoh);
			if (fHoch < fRoh) besser++;
		}
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
