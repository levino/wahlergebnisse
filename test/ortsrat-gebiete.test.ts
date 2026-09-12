/**
 * Eine Ortsratswahl führt die Wahlbezirke ihrer Ortschaft – und keine anderen.
 *
 * Grundlage sind die amtlichen 2021er Daten der Gemeinde Nordstemmen: dort
 * teilen sich alle neun Ortsräte eine Wahl-Id, unter der die Wahlbezirke und
 * die Ortschaften der ganzen Gemeinde liegen. Zur Ortschaft Rössing gehören
 * die Wahlbezirke 09, 10 und 904.
 */
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIXTURES, aufraeumen, tempVerzeichnis } from "./helfer.ts";
import {
	type MockVotemanager,
	starteMockVotemanager,
} from "./mock-votemanager.ts";

let mock: MockVotemanager;
let tmp: string;

const NORDSTEMMEN = "03254026";
const ROESSING = [
	"09 - Rössing - DGH",
	"10 - Rössing - Gaststätte",
	"904 - Briefwahl Rössing",
];

beforeAll(async () => {
	tmp = tempVerzeichnis("ortsrat-gebiete-");
	mock = await starteMockVotemanager(FIXTURES);
	process.env.VOTEMANAGER_BASIS = mock.url;
	process.env.DATABASE_PATH = join(tmp, "wahlen.db");
	const { oeffneDb } = await import("../src/lib/db.ts");
	const { pollTermin } = await import("../src/lib/poll.ts");
	const { terminById } = await import("../src/data/termine.ts");
	await pollTermin(oeffneDb(), terminById("2021")!, {
		nurBehoerden: [NORDSTEMMEN],
	});
});

afterAll(async () => {
	const { schliesseDb } = await import("../src/lib/db.ts");
	schliesseDb();
	await mock.schliessen();
	aufraeumen(tmp);
});

const eintrag = async (slug: string) => {
	const { wahlBySlug } = await import("../src/lib/abfragen.ts");
	return wahlBySlug("2021", NORDSTEMMEN, slug)!;
};

describe("Gebiete einer Ortsratswahl", () => {
	it("führt genau die Wahlbezirke der Ortschaft", async () => {
		const { gebieteDerWahl } = await import("../src/lib/abfragen.ts");
		const w = await eintrag("ortsrat-roessing");
		const gebiete = gebieteDerWahl("2021", NORDSTEMMEN, w);
		expect(
			gebiete
				.filter((g) => g.ebene === 6)
				.map((g) => g.titel)
				.sort(),
		).toEqual(ROESSING);
		expect(gebiete.map((g) => g.gebietId)).toContain(w.gebietId);
		expect(gebiete).toHaveLength(ROESSING.length + 1);
	});

	it("führt keinen Wahlbezirk einer anderen Ortschaft", async () => {
		const { gebieteDerWahl, wahleintraege } = await import(
			"../src/lib/abfragen.ts"
		);
		const ortsraete = wahleintraege("2021", NORDSTEMMEN).filter(
			(w) => w.typ === "ortsrat",
		);
		expect(ortsraete.length).toBe(9);
		const gesehen = new Map<string, string>();
		for (const w of ortsraete)
			for (const g of gebieteDerWahl("2021", NORDSTEMMEN, w)) {
				if (g.ebene !== 6) continue;
				expect(gesehen.get(g.gebietId) ?? w.slug).toBe(w.slug);
				gesehen.set(g.gebietId, w.slug);
			}
		expect(gesehen.size).toBe(22);
	});

	it("lässt die Ratswahl unangetastet – sie führt die ganze Gemeinde", async () => {
		const { gebieteDerWahl, alleErgebnisse } = await import(
			"../src/lib/abfragen.ts"
		);
		const w = await eintrag("rat");
		expect(gebieteDerWahl("2021", NORDSTEMMEN, w)).toHaveLength(
			alleErgebnisse("2021", NORDSTEMMEN, w.wahlId).length,
		);
		expect(
			gebieteDerWahl("2021", NORDSTEMMEN, w).filter((g) => g.ebene === 6),
		).toHaveLength(23);
	});
});

describe("Auszählstand einer Ortsratswahl", () => {
	it("zählt die Wahlbezirke der Ortschaft, nicht die der Gemeinde", async () => {
		const { wahlKern } = await import("../src/lib/wahlkern.ts");
		const { kreisBySlug } = await import("../src/data/kreise.ts");
		const { terminById } = await import("../src/data/termine.ts");
		const { behoerdeBySlug } = await import("../src/data/behoerden.ts");
		const kern = wahlKern(
			kreisBySlug("hildesheim")!,
			terminById("2021")!,
			behoerdeBySlug("nordstemmen")!,
			"ortsrat-roessing",
		)!;
		expect([kern.aktuell?.standAnz, kern.aktuell?.standMax]).toEqual([3, 3]);
		expect(kern.eigeneGebiete?.size).toBe(3);
		expect(kern.datenstand.art).toBe("endergebnis");
	});

	it("meldet die Ortschaft als fertig ausgezählt", async () => {
		const { ladeDashboard, kreisebeneFuer } = await import(
			"../src/lib/dashboard.ts"
		);
		const { wahleintraege } = await import("../src/lib/abfragen.ts");
		const { kreisBySlug } = await import("../src/data/kreise.ts");
		const { terminById } = await import("../src/data/termine.ts");
		const { behoerdeBySlug } = await import("../src/data/behoerden.ts");
		const termin = terminById("2021")!;
		const behoerde = behoerdeBySlug("nordstemmen")!;
		const modell = ladeDashboard(
			kreisBySlug("hildesheim")!,
			termin,
			behoerde,
			wahleintraege(termin.id, behoerde.ags),
			kreisebeneFuer(termin, behoerdeBySlug("kreis")!, behoerde),
		);
		const folie = modell.folien.find(
			(f) => f.art === "wahl" && f.marke === "ortsrat-roessing",
		);
		expect(folie?.art).toBe("wahl");
		if (folie?.art !== "wahl") return;
		expect([folie.anz, folie.max]).toEqual([3, 3]);
		expect(folie.quelle.eigeneGebiete).toHaveLength(3);
	});
});

describe("Gebietsauswahl und Schnittstelle", () => {
	it("bietet im Umschalter nur die eigenen Wahlbezirke an", async () => {
		const { ladeWahlSeite } = await import("../src/lib/seite.ts");
		const { kreisBySlug } = await import("../src/data/kreise.ts");
		const { terminById } = await import("../src/data/termine.ts");
		const { behoerdeBySlug } = await import("../src/data/behoerden.ts");
		const modell = ladeWahlSeite(
			kreisBySlug("hildesheim")!,
			terminById("2021")!,
			behoerdeBySlug("nordstemmen")!,
			"ortsrat-roessing",
		)!;
		expect(modell.gebiete.map((k) => k.titel).sort()).toEqual(ROESSING);
	});

	it("liefert unter /gebiete nur die eigenen Gebiete", async () => {
		const { apiGebiete } = await import("../src/lib/api.ts");
		const { behoerdeBySlug } = await import("../src/data/behoerden.ts");
		const gebiete = apiGebiete(
			"2021",
			behoerdeBySlug("nordstemmen")!,
			"ortsrat-roessing",
		)!;
		expect(gebiete.map((g) => g.gebiet.name).sort()).toEqual([
			...ROESSING,
			"Rössing",
		]);
		expect(
			apiGebiete("2021", behoerdeBySlug("nordstemmen")!, "ortsrat-roessing", {
				ebene: "wahlbezirk",
			}),
		).toHaveLength(3);
	});
});
