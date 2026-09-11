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
	tmp = tempVerzeichnis("wahlen-ohne-listing-");
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

const verzeichnisAnfragen = (ab = 0) =>
	mock.anfragen.slice(ab).filter((p) => p.endsWith("/"));

describe("Poller ohne Verzeichnislisting", () => {
	it("findet Gesamtergebnis und Untergebiete über die Übersichten", async () => {
		const { oeffneDb } = await import("../src/lib/db.ts");
		const { pollTermin } = await import("../src/lib/poll.ts");
		const { terminById } = await import("../src/data/termine.ts");
		const { ergebnis, ergebnisseEbene, uebersichten, wahleintraege } =
			await import("../src/lib/abfragen.ts");

		const db = oeffneDb();
		const stat = await pollTermin(db, terminById("2021")!, {
			nurBehoerden: ["03254026"],
		});
		expect(stat.fehler).toEqual([]);

		const rat = wahleintraege("2021", "03254026").find((w) => w.typ === "rat")!;

		const gesamt = ergebnis("2021", "03254026", rat.wahlId, rat.gebietId)!;
		expect(gesamt.ergebnis.sitze?.gesamt).toBe(30);

		const bezirke = ergebnisseEbene("2021", "03254026", rat.wahlId, 6);
		expect(bezirke.length).toBeGreaterThan(10);
		const roessing = ergebnis(
			"2021",
			"03254026",
			rat.wahlId,
			"ebene_6_id_3119",
		)!;
		expect(roessing.titel).toBe("09 - Rössing - DGH");
		expect(roessing.standAnz).toBe(1);

		expect(
			uebersichten("2021", "03254026", rat.wahlId).map((u) => u.titel),
		).toContain("Ortsteile");

		expect(
			wahleintraege("2021", "03254026").filter((w) => w.typ === "ortsrat"),
		).toHaveLength(9);
	});

	it("versucht das Verzeichnislisting genau einmal je Host", async () => {
		const { oeffneDb, metaGet } = await import("../src/lib/db.ts");
		const { pollTermin } = await import("../src/lib/poll.ts");
		const { terminById } = await import("../src/data/termine.ts");
		const db = oeffneDb();

		expect(verzeichnisAnfragen().length).toBe(1);
		expect(metaGet(db, `listing:${new URL(mock.url).host}`)).toBe("nein");

		const vorher = mock.anfragen.length;
		const stat = await pollTermin(db, terminById("2021")!, {
			nurBehoerden: ["03254026"],
		});
		expect(stat.fehler).toEqual([]);
		expect(verzeichnisAnfragen(vorher)).toEqual([]);
	});

	it("fragt unveränderte Untergebiete beim zweiten Lauf gar nicht erst an", async () => {
		const { oeffneDb } = await import("../src/lib/db.ts");
		const { pollTermin } = await import("../src/lib/poll.ts");
		const { terminById } = await import("../src/data/termine.ts");
		const db = oeffneDb();

		const vorher = mock.anfragen.length;
		const stat = await pollTermin(db, terminById("2021")!, {
			nurBehoerden: ["03254026"],
		});
		expect(stat.geaendert).toBe(0);
		const neue = mock.anfragen.slice(vorher);

		expect(neue.length).toBeLessThan(60);
		expect(neue.filter((p) => p.includes("/termin.json"))).toHaveLength(0);
		expect(
			neue.filter((p) => p.includes("/wahl.json")).length,
		).toBeLessThanOrEqual(1);
		expect(neue.filter((p) => p.includes("open_data.json"))).toHaveLength(0);
		expect(
			neue.filter((p) => p.includes("/ergebnis_")).length,
		).toBeLessThanOrEqual(20);
	});
});
