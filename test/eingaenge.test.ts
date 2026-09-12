import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { aufraeumen, tempVerzeichnis } from "./helfer.ts";

const NORDSTEMMEN = "03254026";
const RAT = 52;
const ORTSRAT = 99;
const GESAMT = "ebene_-141_id_130";
const GESAMT_ORTSRAT = "ebene_-143_id_131";
const WAHLEN = [
	{ behoerde: NORDSTEMMEN, wahlId: RAT, gesamtGebietId: GESAMT },
	{
		behoerde: NORDSTEMMEN,
		wahlId: ORTSRAT,
		gesamtGebietId: GESAMT_ORTSRAT,
	},
];

let tmp: string;

const bezirk = (id: number) => `ebene_6_id_${id}`;

beforeAll(async () => {
	tmp = tempVerzeichnis("eingaenge-");
	process.env.DATABASE_PATH = join(tmp, "wahlen.db");
	const { oeffneDb } = await import("../src/lib/db.ts");
	const db = oeffneDb();
	const ergebnis = db.prepare(
		"INSERT INTO ergebnisse (termin, behoerde, wahl_id, gebiet_id, ebene, titel, leer, stand_anz, stand_max, json, hash, aktualisiert) VALUES ('2026', ?, ?, ?, 6, ?, 0, 1, 1, '{}', 'h', '2026-09-13T18:00:00.000Z')",
	);
	const ereignis = db.prepare(
		"INSERT INTO ereignisse (termin, zeit, behoerde, wahl_id, gebiet_id, art, text, json) VALUES ('2026', ?, ?, ?, ?, 'fortschritt', ?, '{}')",
	);
	const meldung = (
		wahlId: number,
		gebietId: string,
		titel: string,
		zeit: string,
	) => {
		ergebnis.run(NORDSTEMMEN, wahlId, gebietId, titel);
		ereignis.run(zeit, NORDSTEMMEN, wahlId, gebietId, `${titel}: ausgezählt`);
	};

	meldung(RAT, bezirk(6001), "01 - Adensen", "2026-09-13T18:01:00.000Z");
	meldung(RAT, bezirk(6002), "02 - Barnten", "2026-09-13T18:02:00.000Z");
	meldung(RAT, bezirk(6003), "03 - Burgstemmen", "2026-09-13T18:03:00.000Z");
	// Das Gesamtgebiet geht nicht ein, es wird summiert.
	ereignis.run(
		"2026-09-13T18:04:00.000Z",
		NORDSTEMMEN,
		RAT,
		GESAMT,
		"Gemeinde Nordstemmen: 3 von 23",
	);
	meldung(ORTSRAT, bezirk(6001), "01 - Adensen", "2026-09-13T18:05:00.000Z");
});

afterAll(async () => {
	const { schliesseDb } = await import("../src/lib/db.ts");
	schliesseDb();
	aufraeumen(tmp);
});

describe("letzteEingaenge", () => {
	it("bündelt je Wahl und stellt das Neueste nach vorn", async () => {
		const { letzteEingaenge, eingaengeFuer } = await import(
			"../src/lib/abfragen.ts"
		);
		const alle = letzteEingaenge("2026", WAHLEN);
		const rat = eingaengeFuer(alle, NORDSTEMMEN, RAT, GESAMT);
		expect(rat[0].gebietId).toBe(GESAMT);
		expect(rat.slice(1).map((e) => e.name)).toEqual([
			"03 - Burgstemmen",
			"02 - Barnten",
			"01 - Adensen",
		]);
		expect(
			eingaengeFuer(alle, NORDSTEMMEN, ORTSRAT, GESAMT_ORTSRAT).map(
				(e) => e.name,
			),
		).toEqual(["01 - Adensen"]);
	});

	it("lässt das Gesamtgebiet ohne Namen – dort geht nichts ein", async () => {
		const { letzteEingaenge, eingaengeFuer } = await import(
			"../src/lib/abfragen.ts"
		);
		const rat = eingaengeFuer(
			letzteEingaenge("2026", WAHLEN),
			NORDSTEMMEN,
			RAT,
			GESAMT,
		);
		expect(rat.find((e) => e.gebietId === GESAMT)?.name).toBe("");
	});

	it("löst den Namen über das Ergebnis auf, nicht über den Ereignistext", async () => {
		const { letzteEingaenge, eingaengeFuer } = await import(
			"../src/lib/abfragen.ts"
		);
		const alle = letzteEingaenge("2026", WAHLEN);
		const neueste = eingaengeFuer(alle, NORDSTEMMEN, RAT, GESAMT).find(
			(e) => e.gebietId === bezirk(6003),
		);
		expect(neueste?.name).toBe("03 - Burgstemmen");
	});

	it("deckelt je Wahl und fragt nur einmal", async () => {
		const { letzteEingaenge, eingaengeFuer } = await import(
			"../src/lib/abfragen.ts"
		);
		const alle = letzteEingaenge("2026", WAHLEN, 2);
		expect(eingaengeFuer(alle, NORDSTEMMEN, RAT, GESAMT)).toHaveLength(2);
	});

	it("kommt ohne Wahlen ohne Abfrage aus", async () => {
		const { letzteEingaenge } = await import("../src/lib/abfragen.ts");
		expect(letzteEingaenge("2026", []).size).toBe(0);
	});
});
