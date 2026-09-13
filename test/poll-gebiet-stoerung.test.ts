import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIXTURES, aufraeumen, tempVerzeichnis } from "./helfer.ts";
import {
	type MockVotemanager,
	starteMockVotemanager,
} from "./mock-votemanager.ts";

let mock: MockVotemanager;
let tmp: string;

/** Genau ein Gebiet der Ratswahl bleibt unerreichbar. */
const GESTOERT = "ebene_6_id_3111";

beforeAll(async () => {
	tmp = tempVerzeichnis("wahlen-gebiet-stoerung-");
	mock = await starteMockVotemanager(FIXTURES, 0, {
		stoerung: (pfad) => pfad.includes(GESTOERT),
	});
	process.env.VOTEMANAGER_BASIS = mock.url;
	process.env.DATABASE_PATH = join(tmp, "wahlen.db");
});

afterAll(async () => {
	const { schliesseDb } = await import("../src/lib/db.ts");
	schliesseDb();
	await mock.schliessen();
	aufraeumen(tmp);
});

describe("Ein Gebiet, das nicht kommt", () => {
	it("reißt die übrigen Gebiete derselben Wahl nicht mit", async () => {
		const { oeffneDb } = await import("../src/lib/db.ts");
		const { pollTermin } = await import("../src/lib/poll.ts");
		const { terminById } = await import("../src/data/termine.ts");
		const { ergebnis, ergebnisseEbene, wahleintraege } = await import(
			"../src/lib/abfragen.ts"
		);

		const db = oeffneDb();
		const stat = await pollTermin(db, terminById("2021")!, {
			nurBehoerden: ["03254026"],
		});

		const rat = wahleintraege("2021", "03254026").find((w) => w.typ === "rat")!;

		// Das Gesamtergebnis steht, obwohl ein Wahlbezirk fehlt.
		expect(
			ergebnis("2021", "03254026", rat.wahlId, rat.gebietId),
		).toBeDefined();

		// Alle übrigen Wahlbezirke stehen auch – keiner wird mit aufgegeben.
		// Die Fixture führt 23 Wahlbezirke, einer davon ist gestört.
		const bezirke = ergebnisseEbene("2021", "03254026", rat.wahlId, 6);
		expect(bezirke.map((b) => b.gebietId)).not.toContain(GESTOERT);
		expect(bezirke).toHaveLength(22);

		// Und der Ausfall steht im Protokoll, statt still zu verschwinden.
		expect(stat.fehler.some((f) => f.includes(GESTOERT))).toBe(true);
	});
});
