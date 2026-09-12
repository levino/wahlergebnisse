import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIXTURES, aufraeumen, tempVerzeichnis } from "./helfer.ts";
import {
	type MockVotemanager,
	starteMockVotemanager,
} from "./mock-votemanager.ts";

const LEINEBERGLAND = "032545406";

let mock: MockVotemanager;
let tmp: string;

const ratswahlen = async (termin: string) => {
	const { wahleintraege } = await import("../src/lib/abfragen.ts");
	return wahleintraege(termin, LEINEBERGLAND).filter((w) => w.typ === "rat");
};

beforeAll(async () => {
	tmp = tempVerzeichnis("mitgliedsgemeinde-");
	mock = await starteMockVotemanager(FIXTURES);
	process.env.VOTEMANAGER_BASIS = mock.url;
	process.env.DATABASE_PATH = join(tmp, "wahlen.db");
	const { oeffneDb } = await import("../src/lib/db.ts");
	const { pollTermin } = await import("../src/lib/poll.ts");
	const { terminById } = await import("../src/data/termine.ts");
	await pollTermin(oeffneDb(), terminById("2021")!);
});

afterAll(async () => {
	const { schliesseDb } = await import("../src/lib/db.ts");
	schliesseDb();
	await mock.schliessen();
	aufraeumen(tmp);
});

describe("Samtgemeinde Leinebergland", () => {
	it("führt jede Mitgliedsgemeinde unter ihrem eigenen Namen", async () => {
		const { untergebietVon } = await import("../src/lib/abfragen.ts");
		const namen = (await ratswahlen("2021"))
			.map((w) => untergebietVon(w))
			.filter((n): n is string => n !== undefined)
			.sort((a, b) => a.localeCompare(b, "de"));
		expect(namen).toEqual(["Duingen", "Eime", "Gronau (Leine)"]);
	});

	it("lässt allein die Samtgemeinderatswahl ohne eigenes Gebiet", async () => {
		const { untergebietVon } = await import("../src/lib/abfragen.ts");
		const ohne = (await ratswahlen("2021")).filter(
			(w) => untergebietVon(w) === undefined,
		);
		expect(ohne.map((w) => w.slug)).toEqual(["rat"]);
	});
});
