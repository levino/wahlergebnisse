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

const KREIS_A = "wittmund";
const KREIS_B = "luechow-dannenberg";

let mock: MockVotemanager;
let tmp: string;
let wurzel: string;
let melder: Map<string, string>;

beforeAll(async () => {
	tmp = tempVerzeichnis("wahlen-stand-");
	({ wurzel, melder } = vieleKreiseFixtures(join(tmp, "votemanager"), [
		KREIS_A,
		KREIS_B,
	]));
	mock = await starteMockVotemanager(wurzel);
	process.env.VOTEMANAGER_BASIS = mock.url;
	process.env.DATABASE_PATH = join(tmp, "wahlen.db");
});

afterAll(async () => {
	const { schliesseDb } = await import("../src/lib/db.ts");
	schliesseDb();
	await mock.schliessen();
	aufraeumen(tmp);
});

describe("Versionsstempel je Kennung", () => {
	it("bewegt sich nur dort, wo tatsächlich gemeldet wurde", async () => {
		const { oeffneDb } = await import("../src/lib/db.ts");
		const { pollTermin } = await import("../src/lib/poll.ts");
		const { terminById } = await import("../src/data/termine.ts");
		const { kreisBySlug } = await import("../src/data/kreise.ts");
		const { topicVersion } = await import("../src/lib/stand.ts");
		const { version } = await import("../src/lib/abfragen.ts");

		const db = oeffneDb();
		const termin = terminById("2026")!;
		const kreisA = kreisBySlug(KREIS_A)!;
		const kreisB = kreisBySlug(KREIS_B)!;
		const meldendeBehoerde = melder.get(KREIS_A)!;

		const slug = (kreis: typeof kreisA, ags: string) =>
			kreis.behoerden.find((b) => b.ags === ags)!.slug;
		const topics = {
			landesweit: "alle",
			kreisA: KREIS_A,
			kreisB: KREIS_B,
			gemeindeA: `${KREIS_A}/${termin.id}/${slug(kreisA, meldendeBehoerde)}`,
			kreisamtA: `${KREIS_A}/${termin.id}/${slug(kreisA, kreisA.ags)}`,
			gemeindeB: `${KREIS_B}/${termin.id}/${slug(kreisB, melder.get(KREIS_B)!)}`,
		};
		const staende = () =>
			Object.fromEntries(
				Object.entries(topics).map(([name, t]) => [
					name,
					topicVersion(termin.id, t),
				]),
			) as Record<keyof typeof topics, string>;

		await pollTermin(db, termin, { nurKreise: [KREIS_A, KREIS_B] });
		const vorher = staende();
		expect(vorher.kreisA).not.toBe("");
		expect(vorher.kreisB).not.toBe("");
		expect(vorher.gemeindeA).not.toBe("");

		wahlabendFuerBehoerde(wurzel, meldendeBehoerde);
		const lauf = await pollTermin(db, termin, {
			nurKreise: [KREIS_A, KREIS_B],
		});
		expect(lauf.geaendert).toBeGreaterThan(0);
		const nachher = staende();

		expect(nachher.landesweit).not.toBe(vorher.landesweit);
		expect(nachher.gemeindeA).not.toBe(vorher.gemeindeA);
		expect(nachher.kreisA).not.toBe(vorher.kreisA);
		expect(nachher.kreisB).toBe(vorher.kreisB);
		expect(nachher.gemeindeB).toBe(vorher.gemeindeB);
		expect(nachher.kreisamtA).toBe(vorher.kreisamtA);

		expect(version(termin.id)).toBe(nachher.landesweit);
	});

	it("zieht bei der Kennung mit, sobald eine ihrer Wahlleitungen meldet", async () => {
		// Der Fall des Abends: Die Gemeinde ist fertig, der Kreistag zählt
		// weiter. Die Leinwand der Gemeinde zeigt seine Folien und muss
		// mitziehen, obwohl die Gemeinde selbst nichts mehr schreibt.
		const { oeffneDb, metaSet } = await import("../src/lib/db.ts");
		const { terminById } = await import("../src/data/termine.ts");
		const { kreisBySlug } = await import("../src/data/kreise.ts");
		const { topicVersion, vergissTopicVersionen } = await import(
			"../src/lib/stand.ts"
		);

		const db = oeffneDb();
		const termin = terminById("2026")!;
		const kreisA = kreisBySlug(KREIS_A)!;
		const kreisB = kreisBySlug(KREIS_B)!;
		const gemeinde = kreisA.behoerden.find(
			(b) => b.ags === melder.get(KREIS_A),
		)!;
		const leinwand = `${KREIS_A}/${termin.id}/${gemeinde.slug}`;
		const fremd = `${KREIS_B}/${termin.id}/${
			kreisB.behoerden.find((b) => b.ags === melder.get(KREIS_B))!.slug
		}`;

		const vorher = {
			leinwand: topicVersion(termin.id, leinwand),
			fremd: topicVersion(termin.id, fremd),
		};

		const wann = "2026-09-13T21:30:00.000Z";
		db.prepare(
			`INSERT INTO ergebnisse (termin, behoerde, wahl_id, gebiet_id, ebene, titel, leer, stand_anz, stand_max, json, hash, aktualisiert, eingegangen_am)
			 VALUES (?, ?, 99, 'ebene_1_id_99', 1, 'Kreistag', 0, 1, 426, '{}', ?, ?, NULL)
			 ON CONFLICT(termin, behoerde, wahl_id, gebiet_id) DO UPDATE SET hash = excluded.hash, aktualisiert = excluded.aktualisiert`,
		).run(termin.id, kreisA.ags, wann, wann);
		metaSet(db, `termin:${termin.id}:version`, wann);
		vergissTopicVersionen();

		expect(topicVersion(termin.id, leinwand)).not.toBe(vorher.leinwand);
		expect(topicVersion(termin.id, fremd)).toBe(vorher.fremd);
	});

	it("stutzt eine Kennung aus der Anfrage auf das, was es gibt", async () => {
		const { topicAusParametern } = await import("../src/lib/stand.ts");
		const { kreisBySlug } = await import("../src/data/kreise.ts");
		const kreisA = kreisBySlug(KREIS_A)!;
		const kreisB = kreisBySlug(KREIS_B)!;
		const gemeinde = kreisA.behoerden.find(
			(b) => b.ags === melder.get(KREIS_A),
		)!;
		const fremde = kreisB.behoerden.find((b) => b.ags === melder.get(KREIS_B))!;
		const kennung = (wert: string) =>
			topicAusParametern(new URLSearchParams({ topic: wert }));

		expect(kennung(`${KREIS_A}/2026/${gemeinde.slug}`)).toBe(
			`${KREIS_A}/2026/${gemeinde.slug}`,
		);
		expect(kennung(`${KREIS_A}/2026`)).toBe(`${KREIS_A}/2026`);
		expect(kennung(KREIS_A)).toBe(KREIS_A);
		expect(kennung("")).toBe("alle");
		expect(kennung("gibt-es-nicht/2026/nordstemmen")).toBe("alle");
		expect(kennung(`${KREIS_A}/kein-termin/${gemeinde.slug}`)).toBe(KREIS_A);
		// Eine fremde Wahlleitung gehört nicht in diesen Kreis und fliegt raus.
		expect(kennung(`${KREIS_A}/2026/${fremde.slug}`)).toBe(`${KREIS_A}/2026`);
	});
});
