import { cpSync, readFileSync, writeFileSync } from "node:fs";
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
	tmp = tempVerzeichnis("wahlen-archiv-");
	mock = await starteMockVotemanager(FIXTURES, 0, { listing: false });
	process.env.VOTEMANAGER_BASIS = mock.url;
	process.env.DATABASE_PATH = join(tmp, "wahlen.db");
});

afterAll(async () => {
	const { schliesseDb } = await import("../src/lib/db.ts");
	schliesseDb();
	await mock.schliessen();
	aufraeumen(tmp);
});

describe("Poller gegen Archivtermine", () => {
	it("lädt eine Wahl, die mit Erst- und Zweitstimmen zweimal im Termin steht", async () => {
		const { oeffneDb } = await import("../src/lib/db.ts");
		const { pollTermin } = await import("../src/lib/poll.ts");
		const { terminById } = await import("../src/data/termine.ts");
		const { ergebnis, ergebnisseEbene, wahleintraege } = await import(
			"../src/lib/abfragen.ts"
		);

		const db = oeffneDb();
		const stat = await pollTermin(db, terminById("2017-09-24")!, {
			nurBehoerden: ["03361006"],
		});
		expect(stat.fehler).toEqual([]);

		const eintraege = wahleintraege("2017-09-24", "03361006");
		const bundestag = eintraege.filter((w) => w.wahlId === 1);
		expect(bundestag).toHaveLength(1);
		expect(bundestag[0].gebietId).toBe("ebene_3_id_506");
		expect(eintraege.find((w) => w.typ === "buergermeister")).toBeDefined();

		const gesamt = ergebnis("2017-09-24", "03361006", 1, "ebene_3_id_506")!;
		expect(gesamt.ergebnis.parteien.map((p) => p.kurz)).toContain(
			"Mattfeldt, CDU",
		);
		expect(ergebnisseEbene("2017-09-24", "03361006", 1, 6).length).toBe(15);
	});

	it("lädt eine Wahl, deren wahl.json keinen Wahltag führt", async () => {
		const { oeffneDb } = await import("../src/lib/db.ts");
		const { pollTermin } = await import("../src/lib/poll.ts");
		const { terminById } = await import("../src/data/termine.ts");
		const { ergebnis, wahleintraege } = await import("../src/lib/abfragen.ts");

		const db = oeffneDb();
		const stat = await pollTermin(db, terminById("2019-09-15")!, {
			nurBehoerden: ["03159026"],
		});
		expect(stat.fehler).toEqual([]);

		const roh = db
			.prepare(
				"SELECT datum FROM wahlen WHERE termin = ? AND behoerde = ? AND wahl_id = ?",
			)
			.get("2019-09-15", "03159026", 133) as
			| { datum: string | null }
			| undefined;
		expect(roh?.datum).toBeNull();

		const eintraege = wahleintraege("2019-09-15", "03159026");
		expect(eintraege).toHaveLength(1);
		expect(eintraege[0].typ).toBe("buergermeister");
		expect(eintraege[0].datum).toBeUndefined();

		const gesamt = ergebnis(
			"2019-09-15",
			"03159026",
			eintraege[0].wahlId,
			eintraege[0].gebietId,
		)!;
		expect(gesamt.ergebnis.parteien.length).toBeGreaterThan(0);
	});

	it("verliert eine Wahl nicht, wenn die Wahlleitung Titel weglässt", async () => {
		const { oeffneDb } = await import("../src/lib/db.ts");
		const { pollTermin } = await import("../src/lib/poll.ts");
		const { terminById } = await import("../src/data/termine.ts");
		const { ergebnis, wahleintraege } = await import("../src/lib/abfragen.ts");

		const quelle = join(tmp, "ohne-titel");
		cpSync(join(FIXTURES, "20190915"), join(quelle, "20190915"), {
			recursive: true,
		});
		const api = join(quelle, "20190915/03159026/api/praesentation");
		const aendere = (
			datei: string,
			f: (j: Record<string, unknown>) => void,
		) => {
			const j = JSON.parse(readFileSync(datei, "utf-8"));
			f(j);
			writeFileSync(datei, JSON.stringify(j));
		};
		aendere(join(api, "termin.json"), (j) => {
			const eintrag = (
				j.wahleintraege as Array<{
					wahl: { titel?: string };
					gebiet_link: { title?: string };
				}>
			)[0];
			eintrag.wahl.titel = undefined;
			eintrag.gebiet_link.title = undefined;
		});
		aendere(join(api, "wahl_133/wahl.json"), (j) => {
			j.titel = undefined;
		});
		mock.setzeWurzel(quelle);

		const db = oeffneDb();
		const stat = await pollTermin(db, terminById("2019-09-15")!, {
			nurBehoerden: ["03159026"],
			force: true,
		});
		expect(stat.fehler).toEqual([]);

		const eintraege = wahleintraege("2019-09-15", "03159026");
		expect(eintraege).toHaveLength(1);
		expect(eintraege[0].titel).toBe("");
		expect(eintraege[0].wahlId).toBe(133);
		expect(
			ergebnis("2019-09-15", "03159026", 133, eintraege[0].gebietId)?.ergebnis
				.parteien.length,
		).toBeGreaterThan(0);
	});
});
