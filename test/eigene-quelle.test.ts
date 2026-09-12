import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIXTURES, aufraeumen, tempVerzeichnis } from "./helfer.ts";
import {
	type MockVotemanager,
	starteMockVotemanager,
} from "./mock-votemanager.ts";

const KREIS = "region-hannover";
/** Die Kreisbehörde: kündigt den Termin an, liefert ihn nicht. */
const REGION = "03241000";
/** Die Landeshauptstadt: eigener Server, eigener Ordner, liefert. */
const STADT = "03241001";
/** Eine Wahlleitung ohne eigene Quelle – sie hängt an der Kreisbehörde. */
const GEMEINDE = "03241002";
/** Der Ordner, unter dem die Landeshauptstadt ihre Termine führt. */
const ORDNER = "Wahl-2026-09-13";

let mock: MockVotemanager;
let tmp: string;

const terminIndex = (
	wurzel: string,
	ags: string,
	termine: Array<{ date: string; name: string; ordner: string }>,
): void => {
	const ziel = join(wurzel, ags, "api");
	mkdirSync(ziel, { recursive: true });
	writeFileSync(
		join(ziel, "termine.json"),
		JSON.stringify({
			termine: termine.map((t) => ({
				date: t.date,
				name: t.name,
				url: `../${t.ordner}/${ags}/praesentation/`,
			})),
		}),
	);
};

/** Anfragen des Mocks, die einen bestimmten Gebietsschlüssel betreffen. */
const anfragenFuer = (ags: string): string[] =>
	mock.anfragen.filter((p) => p.includes(`/${ags}/`));

beforeAll(async () => {
	tmp = tempVerzeichnis("eigene-quelle-");
	const wurzel = join(tmp, "wurzel");
	cpSync(FIXTURES, wurzel, { recursive: true });

	cpSync(join(FIXTURES, "20260913/03254026"), join(wurzel, ORDNER, STADT), {
		recursive: true,
	});
	terminIndex(wurzel, STADT, [
		{ date: "13.09.2026", name: "Kommunalwahlen", ordner: ORDNER },
	]);

	terminIndex(wurzel, REGION, [
		{
			date: "13.09.2026",
			name: "Allgemeine Kommunalwahlen 2026",
			ordner: "20260913",
		},
	]);

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

describe("Eine Wahlleitung mit eigener Quelle in einem stummen Kreis", () => {
	it("wird abgeholt, obwohl ihre Kreisbehörde schweigt", async () => {
		const { oeffneDb } = await import("../src/lib/db.ts");
		const { pollTermin, behoerdeLiefert, kreisLiefert } = await import(
			"../src/lib/poll.ts"
		);
		const { terminById } = await import("../src/data/termine.ts");
		const { kreisBySlug } = await import("../src/data/kreise.ts");
		const { wahleintraege } = await import("../src/lib/abfragen.ts");
		const db = oeffneDb();
		const kreis = kreisBySlug(KREIS)!;
		const stadt = kreis.behoerden.find((b) => b.ags === STADT)!;
		const gemeinde = kreis.behoerden.find((b) => b.ags === GEMEINDE)!;

		expect(stadt.wurzel).toBeTruthy();
		expect(gemeinde.wurzel).toBeUndefined();
		expect(behoerdeLiefert(db, kreis, stadt)).toBe(false);

		const s = await pollTermin(db, terminById("2026")!, { nurKreise: [KREIS] });
		expect(s.fehler).toEqual([]);

		expect(behoerdeLiefert(db, kreis, stadt)).toBe(true);
		expect(wahleintraege("2026", STADT).length).toBeGreaterThan(0);

		expect(kreisLiefert(db, kreis)).toBe(false);
		expect(behoerdeLiefert(db, kreis, gemeinde)).toBe(false);
		expect(wahleintraege("2026", REGION)).toEqual([]);
	}, 60_000);

	it("kostet je stummer Wahlleitung nur die Nachschau", () => {
		expect(anfragenFuer(REGION).length).toBeGreaterThan(0);
		for (const ags of [GEMEINDE, "03241003", "03241009", "03241013"]) {
			expect(anfragenFuer(ags).length).toBeGreaterThan(0);
			expect(anfragenFuer(ags).length).toBeLessThanOrEqual(2);
		}
	});

	it("fragt die stummen Wahlleitungen nicht bei jedem Lauf erneut", async () => {
		const { oeffneDb } = await import("../src/lib/db.ts");
		const { pollTermin } = await import("../src/lib/poll.ts");
		const { terminById } = await import("../src/data/termine.ts");
		const db = oeffneDb();
		const vorher = anfragenFuer(REGION).length;
		const gemeindeVorher = anfragenFuer(GEMEINDE).length;

		const s = await pollTermin(db, terminById("2026")!, { nurKreise: [KREIS] });
		expect(s.fehler).toEqual([]);
		expect(anfragenFuer(REGION).length).toBe(vorher);
		expect(anfragenFuer(GEMEINDE).length).toBe(gemeindeVorher);
		expect(anfragenFuer(STADT).length).toBeGreaterThan(vorher);
	}, 60_000);

	it("führt die Wahlen der Landeshauptstadt mit ihren eigenen Namen", async () => {
		const { wahleintraege } = await import("../src/lib/abfragen.ts");
		const eintraege = wahleintraege("2026", STADT);
		expect(eintraege.map((e) => e.typ)).toContain("rat");
		expect(eintraege.every((e) => e.slug.length > 0)).toBe(true);
	});
});
