import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIXTURES, aufraeumen, tempVerzeichnis } from "./helfer.ts";
import {
	type MockVotemanager,
	starteMockVotemanager,
} from "./mock-votemanager.ts";

const KREIS = "hildesheim";
const KREISBEHOERDE = "03254000";
const EINE_GEMEINDE = "03254026";

let mock: MockVotemanager;
let tmp: string;

beforeAll(async () => {
	tmp = tempVerzeichnis("kreisweiter-stand-");
	mock = await starteMockVotemanager(FIXTURES, 0, { listing: false });
	process.env.VOTEMANAGER_BASIS = mock.url;
	process.env.DATABASE_PATH = join(tmp, "wahlen.db");
	const { oeffneDb } = await import("../src/lib/db.ts");
	const { pollTermin } = await import("../src/lib/poll.ts");
	const { terminById } = await import("../src/data/termine.ts");
	await pollTermin(oeffneDb(), terminById("2021")!, {
		nurKreise: [KREIS],
		nurBehoerden: [KREISBEHOERDE, EINE_GEMEINDE],
	});
});

afterAll(async () => {
	const { schliesseDb } = await import("../src/lib/db.ts");
	schliesseDb();
	await mock.schliessen();
	aufraeumen(tmp);
});

describe("Kreisweiter Auszählstand, wenn Gemeinden fehlen", () => {
	it("zählt über das ganze Kreisgebiet, auch wenn nur eine Gemeinde Zahlen liefert", async () => {
		const { terminUebersicht } = await import("../src/lib/uebersicht.ts");
		const { kreisBySlug } = await import("../src/data/kreise.ts");
		const { terminById } = await import("../src/data/termine.ts");
		const m = terminUebersicht(terminById("2021")!, kreisBySlug(KREIS)!);
		const kreistag = m.karten.find((k) => k.eintrag.typ === "kreistag");
		const summeDerGemeinden = m.gemeinden.reduce((a, g) => a + g.max, 0);

		expect(m.gemeinden).toHaveLength(1);
		expect(summeDerGemeinden).toBeGreaterThan(0);
		expect(m.gesamt.max).toBe(kreistag?.ergebnis?.standMax);
		expect(m.gesamt.anz).toBe(kreistag?.ergebnis?.standAnz);
		expect(m.gesamt.max).toBeGreaterThan(summeDerGemeinden);
	});
});
