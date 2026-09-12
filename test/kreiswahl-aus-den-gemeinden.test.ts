import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIXTURES_LUECHOW, aufraeumen, tempVerzeichnis } from "./helfer.ts";
import {
	type MockVotemanager,
	starteMockVotemanager,
} from "./mock-votemanager.ts";

const KREIS = "luechow-dannenberg";
const KREISBEHOERDE = "03354000";
const SAMTGEMEINDEN = ["033545403", "033545406", "033545407"];
const WAHLBEZIRKE = 86;

let mock: MockVotemanager;
let tmp: string;

const teile = async () => {
	const { oeffneDb } = await import("../src/lib/db.ts");
	const { kreisBySlug } = await import("../src/data/kreise.ts");
	const { terminById } = await import("../src/data/termine.ts");
	const kreis = kreisBySlug(KREIS)!;
	return {
		db: oeffneDb(),
		kreis,
		termin: terminById("2021")!,
		kreisbehoerde: kreis.behoerden.find((b) => b.ags === KREISBEHOERDE)!,
	};
};

const kreistagsWahl = async () => {
	const { wahlBySlug } = await import("../src/lib/abfragen.ts");
	return wahlBySlug("2021", KREISBEHOERDE, "kreistag")!;
};

beforeAll(async () => {
	tmp = tempVerzeichnis("kreiswahl-aus-den-gemeinden-");
	mock = await starteMockVotemanager(FIXTURES_LUECHOW, 0, { listing: false });
	process.env.VOTEMANAGER_BASIS = mock.url;
	process.env.DATABASE_PATH = join(tmp, "wahlen.db");
	process.env.POLL_ARCHIV_PRO_SEKUNDE = "500";
	process.env.POLL_ARCHIV_PARALLEL = "4";
	const { oeffneDb } = await import("../src/lib/db.ts");
	const { pollTermin } = await import("../src/lib/poll.ts");
	const { terminById } = await import("../src/data/termine.ts");
	const s = await pollTermin(oeffneDb(), terminById("2021")!, {
		nurKreise: [KREIS],
	});
	expect(s.fehler).toEqual([]);
});

afterAll(async () => {
	const { schliesseDb } = await import("../src/lib/db.ts");
	schliesseDb();
	await mock.schliessen();
	aufraeumen(tmp);
	delete process.env.POLL_ARCHIV_PRO_SEKUNDE;
	delete process.env.POLL_ARCHIV_PARALLEL;
});

describe("Kreistagswahl Lüchow-Dannenberg 2021", () => {
	it("wird von der Kreisleitung ohne einen einzigen Wahlbezirk geführt", async () => {
		const { alleErgebnisse } = await import("../src/lib/abfragen.ts");
		const w = await kreistagsWahl();
		const zeilen = alleErgebnisse("2021", KREISBEHOERDE, w.wahlId);
		expect(zeilen.length).toBeGreaterThan(0);
		expect(zeilen.filter((z) => z.ebene === 6)).toEqual([]);
		expect(zeilen.filter((z) => z.ebene === 3)).toEqual([]);
		const gesamt = zeilen.find((z) => z.gebietId === w.gebietId)!;
		expect(gesamt.standMax).toBe(WAHLBEZIRKE);
	});

	it("zählen die Samtgemeinden dieselbe Wahl in ihren Wahlbezirken aus", async () => {
		const { alleErgebnisse, wahleintraege } = await import(
			"../src/lib/abfragen.ts"
		);
		let bezirke = 0;
		for (const ags of SAMTGEMEINDEN) {
			const w = wahleintraege("2021", ags).find((e) => e.typ === "kreistag")!;
			bezirke += alleErgebnisse("2021", ags, w.wahlId).filter(
				(z) => z.ebene === 6,
			).length;
		}
		expect(bezirke).toBe(WAHLBEZIRKE);
	});

	it("spielt die Probe aus den Wahlbezirken der Samtgemeinden", async () => {
		const { baueVorlage, bereiteProbeVor } = await import(
			"../src/lib/demo-abend.ts"
		);
		const { db, kreis, termin, kreisbehoerde } = await teile();
		bereiteProbeVor(db, termin);
		const wahlen = baueVorlage(db, kreis, termin, kreisbehoerde);
		const w = await kreistagsWahl();
		const kreistag = wahlen.find((x) => x.wahlId === w.wahlId)!;
		expect(kreistag).toBeDefined();
		expect(kreistag.lokale.length).toBe(WAHLBEZIRKE);
		expect(new Set(kreistag.lokale.map((l) => l.ags))).toEqual(
			new Set(SAMTGEMEINDEN),
		);
		expect(kreistag.zeilen).toHaveLength(1);
		expect(kreistag.zeilen[0].meldungen).toBe(WAHLBEZIRKE);
	});

	it("nennt einen Zwischenstand, solange Wahlbezirke fehlen", async () => {
		const { baueVorlage, spieleStand } = await import(
			"../src/lib/demo-abend.ts"
		);
		const { zyklusVon } = await import("../src/lib/demo.ts");
		const { wahlKern } = await import("../src/lib/wahlkern.ts");
		const { db, kreis, termin, kreisbehoerde } = await teile();
		const beginn = Date.UTC(2021, 8, 12, 16, 0, 0);
		const wahlen = baueVorlage(db, kreis, termin, kreisbehoerde);
		spieleStand(db, termin, kreisbehoerde, wahlen, {
			...zyklusVon(beginn, 600, beginn),
			nummer: 1,
			fortschritt: 0.5,
		});
		const kern = wahlKern(kreis, termin, kreisbehoerde, "kreistag")!;
		expect(kern.aktuell?.leer).toBe(false);
		expect(kern.aktuell?.standMax).toBe(WAHLBEZIRKE);
		expect(kern.aktuell?.standAnz).toBeGreaterThan(0);
		expect(kern.aktuell?.standAnz).toBeLessThan(WAHLBEZIRKE);
		expect(kern.datenstand.art).toBe("zwischenstand");
		expect(kern.balken.some((b) => b.stimmen > 0)).toBe(true);
	});

	it("summiert am Ende genau die Stimmen der gemeldeten Wahlbezirke", async () => {
		const { baueVorlage, spieleStand } = await import(
			"../src/lib/demo-abend.ts"
		);
		const { zyklusVon } = await import("../src/lib/demo.ts");
		const { wahlKern } = await import("../src/lib/wahlkern.ts");
		const { ergebnis, wahleintraege } = await import("../src/lib/abfragen.ts");
		const { db, kreis, termin, kreisbehoerde } = await teile();
		const beginn = Date.UTC(2021, 8, 12, 16, 0, 0);
		const zyklus = {
			...zyklusVon(beginn, 600, beginn),
			nummer: 1,
			fortschritt: 1,
		};
		spieleStand(
			db,
			termin,
			kreisbehoerde,
			baueVorlage(db, kreis, termin, kreisbehoerde),
			zyklus,
		);
		for (const ags of SAMTGEMEINDEN) {
			const behoerde = kreis.behoerden.find((b) => b.ags === ags)!;
			spieleStand(
				db,
				termin,
				behoerde,
				baueVorlage(db, kreis, termin, behoerde),
				zyklus,
			);
		}
		const kern = wahlKern(kreis, termin, kreisbehoerde, "kreistag")!;
		expect(kern.aktuell?.standAnz).toBe(WAHLBEZIRKE);
		expect(kern.datenstand.art).toBe("endergebnis");

		const summe = new Map<string, number>();
		for (const ags of SAMTGEMEINDEN) {
			const w = wahleintraege("2021", ags).find((e) => e.typ === "kreistag")!;
			const e = ergebnis("2021", ags, w.wahlId, w.gebietId)!;
			for (const p of e.ergebnis.parteien)
				summe.set(p.key, (summe.get(p.key) ?? 0) + p.stimmen);
		}
		expect(summe.size).toBeGreaterThan(0);
		for (const b of kern.balken) expect(b.stimmen).toBe(summe.get(b.key));
	});
});
