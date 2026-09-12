import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIXTURES, aufraeumen, tempVerzeichnis } from "./helfer.ts";
import {
	type MockVotemanager,
	starteMockVotemanager,
} from "./mock-votemanager.ts";

const GEMEINDE = "03254026";
const KREISBEHOERDE = "03254000";
const STICHWAHL_ID = 99;
const STICHWAHL_TITEL =
	"Stichwahl Bürgermeister/in - Gemeinde Nordstemmen - Gemeinde Nordstemmen";

let mock: MockVotemanager;
let tmp: string;

const legeStichwahlAn = (wurzel: string): void => {
	const api = join(wurzel, "20260913", GEMEINDE, "daten/api");
	const termin = JSON.parse(readFileSync(join(api, "termin.json"), "utf-8"));
	termin.datum_string = "13.09.2026 / 27.09.2026";
	termin.wahleintraege.push({
		wahl: { id: STICHWAHL_ID, titel: STICHWAHL_TITEL },
		stimmentyp: { id: 0, titel: "" },
		gebiet_link: {
			id: "ebene_-199_id_199",
			type: "ergebnis",
			title: "Gemeinde Nordstemmen",
		},
		leer: true,
	});
	writeFileSync(join(api, "termin.json"), JSON.stringify(termin));
	const wahl = join(api, `wahl_${STICHWAHL_ID}`);
	mkdirSync(wahl, { recursive: true });
	writeFileSync(
		join(wahl, "wahl.json"),
		JSON.stringify({
			titel: STICHWAHL_TITEL,
			datum: "27.09.2026",
			ergebnisstatus: [],
			stimmentypen: [{ id: 0, titel: "" }],
			menu_links: [],
		}),
	);
};

const dashboardAm = async (stichtag: string) => {
	const { kreisebeneFuer, ladeDashboard, TAKT_STANDARD } = await import(
		"../src/lib/dashboard.ts"
	);
	const { kreisBySlug } = await import("../src/data/kreise.ts");
	const { terminById } = await import("../src/data/termine.ts");
	const { wahleintraege } = await import("../src/lib/abfragen.ts");
	const kreis = kreisBySlug("hildesheim")!;
	const termin = terminById("2026")!;
	const behoerde = kreis.behoerden.find((b) => b.ags === GEMEINDE)!;
	const kreisBehoerde = kreis.behoerden.find((b) => b.ags === KREISBEHOERDE)!;
	return ladeDashboard(
		kreis,
		termin,
		behoerde,
		wahleintraege(termin.id, behoerde.ags),
		kreisebeneFuer(termin, kreisBehoerde, behoerde),
		TAKT_STANDARD,
		stichtag,
	);
};

beforeAll(async () => {
	tmp = tempVerzeichnis("spaeterer-wahltag-");
	const wurzel = join(tmp, "wurzel");
	cpSync(FIXTURES, wurzel, { recursive: true });
	legeStichwahlAn(wurzel);
	mock = await starteMockVotemanager(wurzel);
	process.env.VOTEMANAGER_BASIS = mock.url;
	process.env.DATABASE_PATH = join(tmp, "wahlen.db");
	const { oeffneDb } = await import("../src/lib/db.ts");
	const { pollTermin } = await import("../src/lib/poll.ts");
	const { terminById } = await import("../src/data/termine.ts");
	const s = await pollTermin(oeffneDb(), terminById("2026")!, {
		nurBehoerden: [GEMEINDE, KREISBEHOERDE],
	});
	expect(s.fehler).toEqual([]);
}, 120_000);

afterAll(async () => {
	const { schliesseDb } = await import("../src/lib/db.ts");
	schliesseDb();
	await mock.schliessen();
	aufraeumen(tmp);
});

describe("Eine Wahl, die erst später stattfindet", () => {
	it("übernimmt den Wahltag, den die Wahlleitung zu der Wahl führt", async () => {
		const { wahleintraege } = await import("../src/lib/abfragen.ts");
		const alle = wahleintraege("2026", GEMEINDE);
		const stichwahl = alle.find((w) => w.wahlId === STICHWAHL_ID);
		expect(stichwahl?.datum).toBe("2026-09-27");
		expect(alle.find((w) => w.typ === "rat")?.datum).toBe("2026-09-13");
	});

	it("steht am Wahlabend nicht im Karussell, sondern mit ihrem Datum im Hinweisband", async () => {
		const m = await dashboardAm("2026-09-13");
		const folien = m.folien.filter((f) => f.art === "wahl");
		expect(folien.map((f) => f.wahl)).not.toContain("Stichwahl Bürgermeister");
		expect(folien.some((f) => f.quelle.wahlId === STICHWAHL_ID)).toBe(false);
		expect(m.hinweise.join(" ")).toContain("Stichwahl Bürgermeister");
		expect(m.hinweise.join(" ")).toContain("27.09.2026");
		const ueberblick = m.folien.find((f) => f.art === "ueberblick");
		expect(
			ueberblick?.art === "ueberblick" &&
				ueberblick.zeilen.some((z) => z.wahl === "Stichwahl Bürgermeister"),
		).toBe(false);
	});

	it("ist an ihrem Wahltag eine Wahl wie jede andere", async () => {
		const m = await dashboardAm("2026-09-27");
		const folien = m.folien.filter((f) => f.art === "wahl");
		expect(folien.some((f) => f.quelle.wahlId === STICHWAHL_ID)).toBe(true);
		expect(m.hinweise.join(" ")).not.toContain("27.09.2026");
	});

	it("bleibt auf der Wahlseite auffindbar und nennt dort ihren Wahltag", async () => {
		const { wahlBySlug } = await import("../src/lib/abfragen.ts");
		const eintrag = wahlBySlug("2026", GEMEINDE, "buergermeister-stichwahl");
		expect(eintrag?.wahlId).toBe(STICHWAHL_ID);
		expect(eintrag?.datum).toBe("2026-09-27");
	});
});
