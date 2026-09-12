import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { aufraeumen, demoKreisFixtures, tempVerzeichnis } from "./helfer.ts";
import {
	type MockVotemanager,
	starteMockVotemanager,
} from "./mock-votemanager.ts";

const KREIS = "region-hannover";
/** So viele Gemeinden der Region bekommen Zahlen – mehr kostet nur Laufzeit. */
const GEMEINDEN = 3;

let mock: MockVotemanager;
let tmp: string;

beforeAll(async () => {
	tmp = tempVerzeichnis("demo-kreise-");
	mock = await starteMockVotemanager(
		demoKreisFixtures(join(tmp, "votemanager"), [KREIS], GEMEINDEN),
	);
	process.env.VOTEMANAGER_BASIS = mock.url;
	process.env.DATABASE_PATH = join(tmp, "wahlen.db");
	const { oeffneDb } = await import("../src/lib/db.ts");
	const { pollTermin } = await import("../src/lib/poll.ts");
	const { terminById } = await import("../src/data/termine.ts");
	const { kreisBySlug } = await import("../src/data/kreise.ts");
	const kreis = kreisBySlug(KREIS)!;
	const gemeinden = kreis.behoerden
		.filter((b) => b.art !== "kreis")
		.slice(0, GEMEINDEN)
		.map((b) => b.ags);
	const ziele = [kreis.ags, ...gemeinden];
	await pollTermin(oeffneDb(), terminById("2021")!, { nurBehoerden: ziele });
	const { bereiteProbeVor } = await import("../src/lib/demo-abend.ts");
	bereiteProbeVor(oeffneDb(), terminById("2021")!);
});

afterAll(async () => {
	const { schliesseDb } = await import("../src/lib/db.ts");
	schliesseDb();
	await mock.schliessen();
	aufraeumen(tmp);
});

const teile = async () => {
	const { oeffneDb } = await import("../src/lib/db.ts");
	const { kreisBySlug } = await import("../src/data/kreise.ts");
	const { terminById } = await import("../src/data/termine.ts");
	const kreis = kreisBySlug(KREIS)!;
	return {
		db: oeffneDb(),
		kreis,
		termin: terminById("2021")!,
		gemeinde: kreis.behoerden.filter((b) => b.art !== "kreis")[0],
		kreisBehoerde: kreis.behoerden.find((b) => b.ags === kreis.ags)!,
	};
};

describe("Ein anderer Kreis", () => {
	it("baut eine Vorlage und spielt einen Abend", async () => {
		const { baueVorlage, spieleStand } = await import(
			"../src/lib/demo-abend.ts"
		);
		const { zyklusVon } = await import("../src/lib/demo.ts");
		const { db, kreis, termin, gemeinde } = await teile();
		const wahlen = baueVorlage(db, kreis, termin, gemeinde);
		expect(wahlen.length).toBeGreaterThan(0);
		const beginn = Date.UTC(2021, 8, 12, 16, 0, 0);
		const geaendert = spieleStand(db, termin, gemeinde, wahlen, {
			...zyklusVon(beginn, 600, beginn),
			nummer: 5,
			fortschritt: 0.6,
		});
		expect(geaendert).toBeGreaterThan(0);
		const { alleErgebnisse } = await import("../src/lib/abfragen.ts");
		const zeilen = alleErgebnisse(termin.id, gemeinde.ags, wahlen[0].wahlId);
		expect(zeilen.length).toBeGreaterThan(1);
		expect(zeilen.some((z) => !z.ergebnis.leer)).toBe(true);
	});

	it("spielt genau die Wahlen, die an diesem Termin angelegt sind", async () => {
		const { baueVorlage } = await import("../src/lib/demo-abend.ts");
		const { db, kreis, termin, gemeinde } = await teile();
		const angelegt = db
			.prepare(
				"SELECT wahl_id, gebiet_id FROM wahleintraege WHERE termin = ? AND behoerde = ? AND typ NOT LIKE '%-stichwahl'",
			)
			.all(termin.id, gemeinde.ags) as Array<{
			wahl_id: number;
			gebiet_id: string;
		}>;
		const erlaubt = new Set(angelegt.map((e) => `${e.wahl_id}|${e.gebiet_id}`));
		expect(erlaubt.size).toBeGreaterThan(0);
		const gespielt = baueVorlage(db, kreis, termin, gemeinde);
		expect(gespielt.length).toBeGreaterThan(0);
		for (const w of gespielt)
			expect(erlaubt.has(`${w.wahlId}|${w.gebietId}`)).toBe(true);
	});

	it("sucht die Kreiswahlbereiche unter den Gemeinden dieses Kreises", async () => {
		const { kreisWahlbereiche } = await import("../src/lib/wahlbereiche.ts");
		const { kreis } = await teile();
		const eigene = kreis.behoerden.filter((b) => b.art !== "kreis");
		const bereiche = kreisWahlbereiche("2021", eigene);
		const genannt = [...bereiche.values()].flat();
		expect(genannt.length).toBeGreaterThan(0);
		const eigeneNamen = new Set(eigene.map((b) => b.kurz));
		for (const name of genannt) expect(eigeneNamen.has(name)).toBe(true);
	});
});
