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

describe("Versionsstempel je Bereich", () => {
	it("bewegt sich nur dort, wo tatsächlich gemeldet wurde", async () => {
		const { oeffneDb } = await import("../src/lib/db.ts");
		const { pollTermin } = await import("../src/lib/poll.ts");
		const { terminById } = await import("../src/data/termine.ts");
		const { kreisBySlug } = await import("../src/data/kreise.ts");
		const { bereichsVersion } = await import("../src/lib/stand.ts");
		const { version } = await import("../src/lib/abfragen.ts");

		const db = oeffneDb();
		const termin = terminById("2026")!;
		const kreisA = kreisBySlug(KREIS_A)!;
		const kreisB = kreisBySlug(KREIS_B)!;
		const meldendeBehoerde = melder.get(KREIS_A)!;

		const bereiche = {
			landesweit: {},
			kreisA: { kreis: kreisA },
			kreisB: { kreis: kreisB },
			gemeindeA: { kreis: kreisA, behoerde: meldendeBehoerde },
			kreisamtA: { kreis: kreisA, behoerde: kreisA.ags },
			gemeindeB: { kreis: kreisB, behoerde: melder.get(KREIS_B)! },
		};
		const staende = () =>
			Object.fromEntries(
				Object.entries(bereiche).map(([name, b]) => [
					name,
					bereichsVersion(termin.id, b),
				]),
			) as Record<keyof typeof bereiche, string>;

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
	});

	it("liest den Bereich aus dem Seitenpfad und rät nichts dazu", async () => {
		const { bereichAusPfad, bereichsName } = await import(
			"../src/lib/stand.ts"
		);
		const kreis = KREIS_A;
		const gemeinde = melder.get(KREIS_A)!;
		const { kreisBySlug } = await import("../src/data/kreise.ts");
		const slug = kreisBySlug(kreis)!.behoerden.find(
			(b) => b.ags === gemeinde,
		)!.slug;

		expect(bereichsName(bereichAusPfad("/"))).toBe("alle");
		expect(bereichsName(bereichAusPfad("/ueber"))).toBe("alle");
		expect(bereichsName(bereichAusPfad(`/${kreis}/`))).toBe(kreis);
		expect(bereichsName(bereichAusPfad(`/${kreis}/2026/`))).toBe(kreis);
		expect(bereichsName(bereichAusPfad(`/${kreis}/2026/${slug}/rat/`))).toBe(
			`${kreis}/${gemeinde}`,
		);
		expect(bereichsName(bereichAusPfad(`/${kreis}/2026/gibt-es-nicht/`))).toBe(
			kreis,
		);
		expect(bereichsName(bereichAusPfad(`/${KREIS_B}/2026/${slug}/`))).toBe(
			KREIS_B,
		);
	});
});
