import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TERMINE, terminById } from "../src/data/termine.ts";
import {
	type Lage,
	STANDARD_NACHLAUF,
	faelligeKreise,
	letzteAenderung,
	stufe,
} from "../src/lib/takt.ts";
import { FIXTURES, aufraeumen, tempVerzeichnis } from "./helfer.ts";
import {
	type MockVotemanager,
	starteMockVotemanager,
} from "./mock-votemanager.ts";

let mock: MockVotemanager;
let tmp: string;

const KURZ_VOR_MITTERNACHT = new Date("2026-09-13T21:59:00Z");
const KURZ_NACH_MITTERNACHT = new Date("2026-09-13T22:01:00Z");

/** Das Alter des Stempels, den ein echter Lauf hinterlassen hat. */
let alterMs: number;

beforeAll(async () => {
	tmp = tempVerzeichnis("wahlnacht-");
	mock = await starteMockVotemanager(FIXTURES);
	process.env.VOTEMANAGER_BASIS = mock.url;
	process.env.DATABASE_PATH = join(tmp, "wahlen.db");

	const { metaGet, oeffneDb } = await import("../src/lib/db.ts");
	const { pollTermin } = await import("../src/lib/poll.ts");
	const db = oeffneDb();
	const stat = await pollTermin(db, terminById("2026")!, {
		nurBehoerden: ["03254000", "03254026"],
	});
	if (stat.geaendert === 0) throw new Error("Der Lauf hat nichts geändert");
	const stempel = letzteAenderung([metaGet(db, "termin:2026:version")]);
	if (stempel === undefined) throw new Error("Kein Änderungsstempel");
	alterMs = Date.now() - stempel;
});

afterAll(async () => {
	const { schliesseDb } = await import("../src/lib/db.ts");
	schliesseDb();
	await mock.schliessen();
	aufraeumen(tmp);
});

describe("Der Kreistag wird über Mitternacht ausgezählt", () => {
	const frisch = (jetzt: Date): Lage => ({
		letzteAenderung: jetzt.getTime() - alterMs,
	});

	it("versteht den Stempel, den ein echter Lauf hinterlässt", () => {
		expect(alterMs).toBeGreaterThanOrEqual(0);
		expect(alterMs).toBeLessThan(STANDARD_NACHLAUF.ms);
	});

	it("hält vor und nach Mitternacht den schnellen Takt", () => {
		expect(
			stufe(KURZ_VOR_MITTERNACHT, TERMINE, frisch(KURZ_VOR_MITTERNACHT)),
		).toBe("wahlabend");
		expect(
			stufe(KURZ_NACH_MITTERNACHT, TERMINE, frisch(KURZ_NACH_MITTERNACHT)),
		).toBe("wahlabend");
	});

	it("holt den betrachteten Kreis nach Mitternacht binnen anderthalb Minuten wieder", () => {
		const auftrag = {
			termine: TERMINE,
			kreise: ["hildesheim", "holzminden"],
			gesehen: new Map([
				["hildesheim", KURZ_NACH_MITTERNACHT.getTime() - 30_000],
			]),
			geholt: new Map([
				["hildesheim", KURZ_NACH_MITTERNACHT.getTime() - 90_000],
				["holzminden", KURZ_NACH_MITTERNACHT.getTime() - 90_000],
			]),
			jetzt: KURZ_NACH_MITTERNACHT,
		};
		expect(
			faelligeKreise({ ...auftrag, lage: frisch(KURZ_NACH_MITTERNACHT) }),
		).toEqual(["hildesheim"]);
		expect(faelligeKreise(auftrag)).toEqual([]);
	});

	it("gibt den Takt frei, wenn der Nachlauf ohne neue Zahl verstreicht", () => {
		const ausgezaehlt: Lage = {
			letzteAenderung:
				KURZ_NACH_MITTERNACHT.getTime() - STANDARD_NACHLAUF.ms - 60_000,
		};
		expect(stufe(KURZ_NACH_MITTERNACHT, TERMINE, ausgezaehlt)).toBe("wahltag");
	});
});
