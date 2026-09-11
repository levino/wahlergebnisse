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
	for (const id of ["2026", "2021", "2020", "2018-12-16", "2023-03-05"])
		await pollTermin(oeffneDb(), terminById(id)!);
});

afterAll(async () => {
	const { schliesseDb } = await import("../src/lib/db.ts");
	schliesseDb();
	await mock.schliessen();
	aufraeumen(tmp);
});

describe("Katalog", () => {
	it("führt die Vorwerte je Behörde, nicht je Kreis", async () => {
		const { kreisBySlug } = await import("../src/data/kreise.ts");
		const hi = kreisBySlug("hildesheim")!;
		const von = (ags: string) =>
			hi.behoerden.find((b) => b.ags === ags)?.archive ?? [];
		expect(von("03254005")).toContain("2018-12-16"); // Bad Salzdetfurth
		expect(von("03254003")).toContain("2023-03-05"); // Algermissen
		expect(von("03254026")).toContain("2020"); // Nordstemmen
		expect(von("03254021")).not.toContain("2018-12-16"); // Stadt Hildesheim
		expect(von("03254021")).not.toContain("2020");
		expect(hi.archive).toEqual(["2021"]);
		for (const b of hi.behoerden) expect(b.archive ?? []).not.toContain("2021");
	});

	it("erzeugt zu jedem Vorwert genau einen Termin, absteigend nach Wahltag", async () => {
		const { TERMINE } = await import("../src/data/termine.ts");
		const { KREISE } = await import("../src/data/kreise.ts");
		const ids = new Set(TERMINE.map((t) => t.id));
		expect(ids.size).toBe(TERMINE.length);
		expect(TERMINE.map((t) => t.datum)).toEqual(
			[...TERMINE.map((t) => t.datum)].sort().reverse(),
		);
		for (const k of KREISE) {
			for (const id of k.archive ?? []) expect(ids, k.slug).toContain(id);
			for (const b of k.behoerden)
				for (const id of b.archive ?? []) expect(ids, b.ags).toContain(id);
		}
	});

	it("nennt den Wahltag so, wie der Termin-Index ihn führt", async () => {
		const { terminById, indexDatum } = await import("../src/data/termine.ts");
		const t = terminById("2021-10-03")!;
		expect(t.ordner).toBe("0120210912");
		expect(indexDatum(t)).toBe("03.10.2021");
	});
});

describe("terminGiltFuerBehoerde", () => {
	it("trennt kreisweite Termine von denen einer einzigen Wahlleitung", async () => {
		const {
			terminById,
			terminGiltFuerBehoerde,
			terminGiltFuerKreis,
			terminGiltIrgendwoImKreis,
		} = await import("../src/data/termine.ts");
		const { kreisBySlug } = await import("../src/data/kreise.ts");
		const hi = kreisBySlug("hildesheim")!;
		const bs = hi.behoerden.find((b) => b.ags === "03254005")!;
		const stadt = hi.behoerden.find((b) => b.ags === "03254021")!;
		const t2018 = terminById("2018-12-16")!;
		const t2021 = terminById("2021")!;

		expect(terminGiltFuerBehoerde(t2018, hi, bs)).toBe(true);
		expect(terminGiltFuerBehoerde(t2018, hi, stadt)).toBe(false);
		expect(terminGiltIrgendwoImKreis(t2018, "hildesheim")).toBe(true);
		expect(terminGiltFuerKreis(t2018, "hildesheim")).toBe(false);
		expect(terminGiltIrgendwoImKreis(t2018, "peine")).toBe(false);
		expect(terminGiltFuerKreis(t2021, "hildesheim")).toBe(true);
		expect(terminGiltFuerBehoerde(t2021, hi, stadt)).toBe(true);
	});

	it("fragt für einen Vorwert nur die Behörden, die ihn führen", async () => {
		const { behoerdenFuer } = await import("../src/lib/poll.ts");
		const { oeffneDb } = await import("../src/lib/db.ts");
		const { terminById } = await import("../src/data/termine.ts");
		const db = oeffneDb();
		expect(
			behoerdenFuer(db, terminById("2018-12-16")!).map((z) => z.behoerde.ags),
		).toEqual(["03254005"]);
		expect(
			behoerdenFuer(db, terminById("2020")!).map((z) => z.behoerde.ags),
		).toEqual(["03254026"]);
		expect(
			behoerdenFuer(db, terminById("2021")!, { nurKreise: ["hildesheim"] }),
		).toHaveLength(19);
	});
});

describe("Vergleich je Amt", () => {
	const seite = async (
		terminId: string,
		behoerdeAgs: string,
		wahlSlug: string,
	) => {
		const { ladeWahlSeite } = await import("../src/lib/seite.ts");
		const { kreisBySlug } = await import("../src/data/kreise.ts");
		const { terminById } = await import("../src/data/termine.ts");
		const hi = kreisBySlug("hildesheim")!;
		return ladeWahlSeite(
			hi,
			terminById(terminId)!,
			hi.behoerden.find((b) => b.ags === behoerdeAgs)!,
			wahlSlug,
		);
	};

	it("stellt die Bürgermeisterwahl 2026 neben die von 2018, den Rat neben 2021", async () => {
		const bm = (await seite("2026", "03254005", "buergermeister"))!;
		expect(bm.vergleichTermin?.id).toBe("2018-12-16");
		expect(bm.vergleich?.ergebnis.parteien.length).toBeGreaterThan(1);

		const rat = (await seite("2026", "03254005", "rat"))!;
		expect(rat.eintrag.typ).toBe("rat");
		expect(rat.vergleichTermin?.id).not.toBe("2018-12-16");
	});

	it("nimmt für ein Amt den jüngsten Vorwert, auch wenn ein anderer näher liegt", async () => {
		const bm = (await seite("2026", "03254026", "buergermeister"))!;
		expect(bm.vergleichTermin?.id).toBe("2020");
		const rat = (await seite("2026", "03254026", "rat"))!;
		expect(rat.vergleichTermin?.id).toBe("2021");
		const landrat = (await seite("2026", "03254026", "landrat"))!;
		expect(landrat.vergleichTermin?.id).toBe("2021");
	});

	it("führt Haupt- und Stichwahl auf dasselbe Amt zurück", async () => {
		const { amtVon } = await import("../src/lib/wahltyp.ts");
		expect(amtVon("buergermeister-stichwahl")).toBe("buergermeister");
		expect(amtVon("landrat-stichwahl")).toBe("landrat");
		expect(amtVon("kreistag")).toBe("kreistag");
		expect(amtVon("ortsrat")).toBe("ortsrat");
	});
});
