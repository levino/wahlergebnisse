import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { WahlKern } from "../src/lib/wahlkern.ts";
import { FIXTURES, aufraeumen, tempVerzeichnis } from "./helfer.ts";
import {
	type MockVotemanager,
	starteMockVotemanager,
} from "./mock-votemanager.ts";

process.env.WAHLEN_DEMO = "1";

let mock: MockVotemanager;
let tmp: string;

/** Der Stand der Gemeindewahl bei n von 23 Schnellmeldungen. */
const staende = new Map<number, WahlKern>();

beforeAll(async () => {
	tmp = tempVerzeichnis("generalprobe-");
	mock = await starteMockVotemanager(FIXTURES);
	process.env.VOTEMANAGER_BASIS = mock.url;
	process.env.DATABASE_PATH = join(tmp, "wahlen.db");
	const { oeffneDb } = await import("../src/lib/db.ts");
	const { pollTermin } = await import("../src/lib/poll.ts");
	const { terminById, PROBEN_TERMIN } = await import("../src/data/termine.ts");
	const { kreisBySlug } = await import("../src/data/kreise.ts");
	const { behoerdeBySlug } = await import("../src/data/behoerden.ts");
	const { bereiteProbeVor, baueVorlage, spieleStand } = await import(
		"../src/lib/demo-abend.ts"
	);
	const { zyklusVon } = await import("../src/lib/demo.ts");
	const { wahlKern } = await import("../src/lib/wahlkern.ts");

	const db = oeffneDb();
	const termin = terminById(PROBEN_TERMIN)!;
	await pollTermin(db, terminById("2016")!, { nurBehoerden: ["03254026"] });
	await pollTermin(db, termin, { nurBehoerden: ["03254026"] });

	const kreis = kreisBySlug("hildesheim")!;
	const behoerde = behoerdeBySlug("nordstemmen")!;
	bereiteProbeVor(db, termin);
	const wahlen = baueVorlage(db, kreis, termin, behoerde);
	const beginn = Date.now();
	for (let schritt = 0; schritt <= 100; schritt++) {
		const zyklus = {
			...zyklusVon(beginn, 600, beginn),
			fortschritt: schritt / 100,
			beginn,
		};
		spieleStand(db, termin, behoerde, wahlen, zyklus);
		const kern = wahlKern(kreis, termin, behoerde, "rat");
		const anz = kern?.aktuell?.standAnz ?? 0;
		if (kern && !staende.has(anz)) staende.set(anz, kern);
	}
});

afterAll(async () => {
	const { schliesseDb } = await import("../src/lib/db.ts");
	schliesseDb();
	await mock.schliessen();
	aufraeumen(tmp);
});

describe("Generalprobe: die Gemeindewahl Nordstemmen gegen 2016", () => {
	it("spielt den Abend von der ersten bis zur letzten Schnellmeldung", () => {
		expect(staende.get(23)?.aktuell?.standMax).toBe(23);
		expect([...staende.keys()].sort((a, b) => a - b)).toContain(20);
	});

	it("nimmt 2016 als Vergleichswahl", () => {
		expect(staende.get(20)?.vergleichTermin?.id).toBe("2016");
	});

	it("rechnet aus den Bezirken hoch statt fortzuschreiben", () => {
		const zwanzig = staende.get(20);
		expect(zwanzig?.sitze?.quelle).toBe("hochrechnung");
		expect(zwanzig?.sitze?.art).toBe("struktur");
		expect(zwanzig?.sitze?.hinweis).toContain("gewichtet mit deren damaliger");
	});

	it("meldet bei 20 von 23 Schnellmeldungen niedrige Unsicherheit", () => {
		expect(staende.get(20)?.sitze?.unsicherheit).toBe("niedrig");
		expect(staende.get(20)?.datenstand.unsicherheit).toBe("niedrig");
	});

	it("stuft die Unsicherheit ab, während der Abend läuft", () => {
		const stufen = [...staende]
			.filter(([anz]) => anz >= 5 && anz < 23)
			.sort((a, b) => a[0] - b[0])
			.map(([anz, kern]) => [anz, kern.sitze?.unsicherheit]);
		expect(stufen.every(([, s]) => s !== undefined)).toBe(true);
		const rang = { hoch: 0, mittel: 1, niedrig: 2 } as const;
		for (let i = 1; i < stufen.length; i++)
			expect(rang[stufen[i][1] as keyof typeof rang]).toBeGreaterThanOrEqual(
				rang[stufen[i - 1][1] as keyof typeof rang],
			);
	});
});
