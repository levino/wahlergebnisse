/** Welche Ebenen-Tabellen eine Wahlseite anbietet – Grundlage für die Voreinstellung. */
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
	tmp = tempVerzeichnis();
	mock = await starteMockVotemanager(FIXTURES);
	process.env.VOTEMANAGER_BASIS = mock.url;
	process.env.DATABASE_PATH = join(tmp, "wahlen.db");
	const { oeffneDb } = await import("../src/lib/db.ts");
	const { pollTermin } = await import("../src/lib/poll.ts");
	const { terminById } = await import("../src/data/termine.ts");
	await pollTermin(oeffneDb(), terminById("2021")!, {
		nurBehoerden: ["03254000", "03254026"],
	});
});

afterAll(async () => {
	const { schliesseDb } = await import("../src/lib/db.ts");
	schliesseDb();
	await mock.schliessen();
	aufraeumen(tmp);
});

describe("Ebenen einer Wahlseite", () => {
	it("bietet je Wahl die passenden Untergliederungen an", async () => {
		const { ladeWahlSeite } = await import("../src/lib/seite.ts");
		const { terminById } = await import("../src/data/termine.ts");
		const { behoerdeBySlug } = await import("../src/data/behoerden.ts");
		const t = terminById("2021")!;
		const zeig = (b: string, w: string) =>
			ladeWahlSeite(t, behoerdeBySlug(b)!, w)?.tabellen.map((x) => x.titel);

		expect(zeig("kreis", "kreistag")).toEqual([
			"Gemeinden",
			"Kreiswahlbereiche",
		]);
		expect(zeig("nordstemmen", "rat")).toEqual(["Ortsteile", "Wahlbezirke"]);
		// Bei einer Ortsratswahl ist der Wahlbezirk die einzige echte Untergliederung
		expect(zeig("nordstemmen", "ortsrat-roessing")).toEqual(["Wahlbezirke"]);
	});
});
