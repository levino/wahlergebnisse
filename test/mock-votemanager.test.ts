import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIXTURES } from "./helfer.ts";
import {
	type MockVotemanager,
	starteMockVotemanager,
} from "./mock-votemanager.ts";

let mock: MockVotemanager;
beforeAll(async () => {
	mock = await starteMockVotemanager(FIXTURES);
});
afterAll(() => mock.schliessen());

describe("Mock-votemanager", () => {
	it("liefert Dateien, Listings, 404 und 304", async () => {
		const r = await fetch(
			`${mock.url}/20210912/03254026/api/praesentation/termin.json`,
		);
		expect(r.status).toBe(200);
		expect((await r.json()).wahleintraege.length).toBeGreaterThan(5);
		const etag = r.headers.get("etag")!;
		const r2 = await fetch(
			`${mock.url}/20210912/03254026/api/praesentation/termin.json`,
			{ headers: { "if-none-match": etag } },
		);
		expect(r2.status).toBe(304);
		const l = await (
			await fetch(`${mock.url}/20210912/03254026/api/praesentation/wahl_27/`)
		).text();
		expect(l).toContain('<a href="ergebnis_ebene_3_id_14_0.json">');
		expect(
			(
				await fetch(
					`${mock.url}/20210912/03254099/api/praesentation/termin.json`,
				)
			).status,
		).toBe(404);
	});
});
