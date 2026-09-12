import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIXTURES, aufraeumen, tempVerzeichnis } from "./helfer.ts";
import { spiegleZuordnung } from "../src/data/wahlzuordnung.ts";
import {
	type MockVotemanager,
	starteMockVotemanager,
} from "./mock-votemanager.ts";

const KREIS = "harburg";
/** Die Kreisbehörde: zum 13.09.2026 nichts angelegt. */
const KREISBEHOERDE = "03353000";
/** Eine Gemeinde ohne eigenen Server – sie liegt auf der Quelle des Kreises. */
const GEMEINDE = "03353031";
/** Eine zweite Gemeinde, die nichts veröffentlicht. */
const STUMM = "03353032";

let mock: MockVotemanager;
let tmp: string;

const anfragenFuer = (ags: string): string[] =>
	mock.anfragen.filter((p) => p.includes(`/${ags}/`));

beforeAll(async () => {
	tmp = tempVerzeichnis("stumme-kreisbehoerde-");
	const wurzel = join(tmp, "wurzel");
	cpSync(FIXTURES, wurzel, { recursive: true });
	cpSync(
		join(FIXTURES, "20260913/03254026"),
		join(wurzel, "20260913", GEMEINDE),
		{ recursive: true },
	);
	spiegleZuordnung("03254026", GEMEINDE);
	const api = join(wurzel, GEMEINDE, "api");
	mkdirSync(api, { recursive: true });
	writeFileSync(
		join(api, "termine.json"),
		JSON.stringify({
			termine: [
				{
					date: "13.09.2026",
					name: "Kommunalwahlen 2026",
					url: `../20260913/${GEMEINDE}/praesentation/`,
				},
			],
		}),
	);

	mock = await starteMockVotemanager(wurzel, 0, { listing: false });
	process.env.VOTEMANAGER_BASIS = mock.url;
	process.env.DATABASE_PATH = join(tmp, "wahlen.db");
});

afterAll(async () => {
	const { schliesseDb } = await import("../src/lib/db.ts");
	schliesseDb();
	await mock.schliessen();
	aufraeumen(tmp);
});

describe("Ein Kreis, dessen Kreisbehörde schweigt", () => {
	it("holt die Wahlleitungen ab, die selbst veröffentlichen", async () => {
		const { oeffneDb } = await import("../src/lib/db.ts");
		const { pollTermin, behoerdeLiefert, kreisLiefert } = await import(
			"../src/lib/poll.ts"
		);
		const { terminById } = await import("../src/data/termine.ts");
		const { kreisBySlug } = await import("../src/data/kreise.ts");
		const { wahleintraege } = await import("../src/lib/abfragen.ts");
		const db = oeffneDb();
		const kreis = kreisBySlug(KREIS)!;
		const gemeinde = kreis.behoerden.find((b) => b.ags === GEMEINDE)!;
		expect(gemeinde.wurzel).toBeUndefined();
		expect(behoerdeLiefert(db, kreis, gemeinde)).toBe(false);

		const s = await pollTermin(db, terminById("2026")!, { nurKreise: [KREIS] });
		expect(s.fehler).toEqual([]);

		expect(behoerdeLiefert(db, kreis, gemeinde)).toBe(true);
		expect(wahleintraege("2026", GEMEINDE).map((e) => e.typ)).toContain("rat");
		expect(kreisLiefert(db, kreis)).toBe(false);
		expect(wahleintraege("2026", KREISBEHOERDE)).toEqual([]);
	}, 60_000);

	it("fragt die stummen Wahlleitungen nicht bei jedem Lauf erneut", async () => {
		const { oeffneDb } = await import("../src/lib/db.ts");
		const { pollTermin } = await import("../src/lib/poll.ts");
		const { terminById } = await import("../src/data/termine.ts");
		const db = oeffneDb();
		const kreisVorher = anfragenFuer(KREISBEHOERDE).length;
		const stummVorher = anfragenFuer(STUMM).length;
		expect(kreisVorher).toBeGreaterThan(0);
		expect(stummVorher).toBeGreaterThan(0);

		const s = await pollTermin(db, terminById("2026")!, { nurKreise: [KREIS] });
		expect(s.fehler).toEqual([]);
		expect(anfragenFuer(KREISBEHOERDE).length).toBe(kreisVorher);
		expect(anfragenFuer(STUMM).length).toBe(stummVorher);
		expect(anfragenFuer(GEMEINDE).length).toBeGreaterThan(stummVorher);
	}, 60_000);
});
