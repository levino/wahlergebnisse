/**
 * Kreiswahlbereiche: Die Wahlleitung benennt die Ebene in `wahl.json`; die
 * Anwendung bildet ab, was dort steht, und leitet nichts aus anderen Terminen
 * her.
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

const KREIS = "03254000";
const NORDSTEMMEN = "03254026";
/** Kreiswahlbereich B 2026, wie die Wahlleitung ihn führt. */
const WAHLBEREICH_B_2026 = "ebene_-53_id_162";
/** Derselbe Bereich 2021 – andere Nummer, anderer Zuschnitt. */
const WAHLBEREICH_B_2021 = "ebene_9_id_57";

const seite = async (terminId: string, behoerde: string, gebietId?: string) => {
	const { ladeWahlSeite } = await import("../src/lib/seite.ts");
	const { kreisBySlug } = await import("../src/data/kreise.ts");
	const { terminById } = await import("../src/data/termine.ts");
	const { behoerdeBySlug } = await import("../src/data/behoerden.ts");
	return ladeWahlSeite(
		kreisBySlug("hildesheim")!,
		terminById(terminId)!,
		behoerdeBySlug(behoerde)!,
		"kreistag",
		gebietId,
	);
};

beforeAll(async () => {
	tmp = tempVerzeichnis("kreiswahlbereiche-");
	mock = await starteMockVotemanager(FIXTURES);
	process.env.VOTEMANAGER_BASIS = mock.url;
	process.env.DATABASE_PATH = join(tmp, "wahlen.db");
	const { oeffneDb } = await import("../src/lib/db.ts");
	const { pollTermin } = await import("../src/lib/poll.ts");
	const { terminById } = await import("../src/data/termine.ts");
	const db = oeffneDb();
	await pollTermin(db, terminById("2026")!);
	await pollTermin(db, terminById("2021")!);
});

afterAll(async () => {
	const { schliesseDb } = await import("../src/lib/db.ts");
	schliesseDb();
	await mock.schliessen();
	aufraeumen(tmp);
});

describe("Kreiswahlbereiche zum Termin 2026", () => {
	it("führt alle elf Bereiche als eigene Ebene, nicht als namenloses Gebiet", async () => {
		const { apiGebiete } = await import("../src/lib/api.ts");
		const { behoerdeBySlug } = await import("../src/data/behoerden.ts");
		const { wahlbereichKuerzel } = await import("../src/lib/wahlbereiche.ts");
		const bereiche = apiGebiete("2026", behoerdeBySlug("kreis")!, "kreistag", {
			ebene: "wahlbereich",
		});
		expect(bereiche?.map((g) => wahlbereichKuerzel(g.gebiet.name))).toEqual([
			"A",
			"B",
			"C",
			"D",
			"E",
			"F",
			"G",
			"H",
			"I",
			"K",
			"L",
		]);
		expect(
			bereiche?.find((g) => g.gebiet.id === WAHLBEREICH_B_2026),
		).toBeDefined();
	});

	it("macht sie von der Kreistagsseite aus erreichbar", async () => {
		const { alsAuswahl } = await import("../src/lib/gebietsbaum.ts");
		const m = await seite("2026", "kreis");
		const auswahl = alsAuswahl(m!.gebiete);
		const b = auswahl.find(
			(e) => e.titel === "Wahlbereich B (Elze, Nordstemmen)",
		);
		expect(b?.href).toBe(
			`/hildesheim/2026/kreis/kreistag/${WAHLBEREICH_B_2026}/`,
		);
		expect(
			auswahl.filter((e) => e.titel.startsWith("Wahlbereich ")),
		).toHaveLength(11);
	});

	it("beschriftet die Gebietsseite des Bereichs als Wahlbereich", async () => {
		const m = await seite("2026", "kreis", WAHLBEREICH_B_2026);
		expect(m?.ebeneName).toBe("Wahlbereich");
		expect(m?.gebietName).toBe("Wahlbereich B (Elze, Nordstemmen)");
	});

	it("kennt die Kennung von 2021 zum Termin 2026 nicht", async () => {
		expect(await seite("2026", "kreis", WAHLBEREICH_B_2021)).toBeUndefined();
	});
});

describe("Zuschnitt wird nicht aus einem anderen Termin hergeleitet", () => {
	it("nennt 2026 die Gemeinden aus der Bekanntmachung der Wahlleitung", async () => {
		const { kreisWahlbereiche } = await import("../src/lib/wahlbereiche.ts");
		expect([...(kreisWahlbereiche("2026").get("B") ?? [])]).toEqual([
			"Elze",
			"Nordstemmen",
		]);
		const m = await seite("2026", "kreis", WAHLBEREICH_B_2026);
		expect(m?.gebietName).toBe("Wahlbereich B (Elze, Nordstemmen)");
	});

	it("übernimmt den Zuschnitt von 2021 nicht, wo er sich geändert hat", async () => {
		const { kreisWahlbereiche } = await import("../src/lib/wahlbereiche.ts");
		const z2021 = kreisWahlbereiche("2021");
		const z2026 = kreisWahlbereiche("2026");
		expect([...(z2021.get("D") ?? [])]).toEqual([
			"Bockenem",
			"Freden",
			"Lamspringe",
		]);
		expect([...(z2026.get("D") ?? [])]).toEqual(["Alfeld", "Freden"]);
		expect([...z2021.keys()]).toContain("M");
		expect([...z2026.keys()]).not.toContain("M");
	});

	it("führt jede Gemeinde des Kreises 2026 in genau einem Bereich", async () => {
		const { kreisWahlbereiche, bereichVonGemeinde } = await import(
			"../src/lib/wahlbereiche.ts"
		);
		const { GEMEINDEN } = await import("../src/data/behoerden.ts");
		const zuordnung = kreisWahlbereiche("2026");
		const ohne = GEMEINDEN.filter(
			(g) => g.kurz !== "Hildesheim" && !bereichVonGemeinde(g.kurz, zuordnung),
		);
		expect(ohne.map((g) => g.kurz)).toEqual([]);
	});

	it("nennt sie 2021, wo die Wahlräume den Kreiswahlbereich führen", async () => {
		const { kreisWahlbereiche } = await import("../src/lib/wahlbereiche.ts");
		expect([...(kreisWahlbereiche("2021").get("B") ?? [])]).toEqual([
			"Elze",
			"Nordstemmen",
		]);
		const m = await seite("2021", "kreis", WAHLBEREICH_B_2021);
		expect(m?.gebietName).toBe("Wahlbereich B (Elze, Nordstemmen)");
	});

	it("baut die Wahlbereichsfolie der Gemeinde aus der belegten Zuordnung", async () => {
		const { kreisebeneFuer, ladeDashboard } = await import(
			"../src/lib/dashboard.ts"
		);
		const { wahleintraege } = await import("../src/lib/abfragen.ts");
		const { kreisBySlug } = await import("../src/data/kreise.ts");
		const { terminById } = await import("../src/data/termine.ts");
		const { behoerdeBySlug } = await import("../src/data/behoerden.ts");
		const kreis = kreisBySlug("hildesheim")!;
		const termin = terminById("2026")!;
		const gemeinde = behoerdeBySlug("nordstemmen")!;
		const kreisebene = kreisebeneFuer(
			termin,
			behoerdeBySlug("kreis")!,
			gemeinde,
		);
		expect(kreisebene.bereiche).toBe(11);
		expect(kreisebene.wahlbereich?.name).toBe("Wahlbereich B");
		expect(kreisebene.wahlbereich?.gemeinden).toBe("Elze, Nordstemmen");
		expect(kreisebene.wahlbereich?.gebietId).toBe(WAHLBEREICH_B_2026);
		const m = ladeDashboard(
			kreis,
			termin,
			gemeinde,
			wahleintraege(termin.id, gemeinde.ags),
			kreisebene,
		);
		expect(
			m.folien.some((f) => f.art === "wahl" && f.zuschnitt === "wahlbereich"),
		).toBe(true);
	});
});

describe("Zahlen der Auszähleinheiten", () => {
	it("zählt Wahlbereich und Kreistag so, wie die Wahlleitung es meldet", async () => {
		const { apiGebiet, apiWahl } = await import("../src/lib/api.ts");
		const { behoerdeBySlug } = await import("../src/data/behoerden.ts");
		const kreis = behoerdeBySlug("kreis")!;
		const b = apiGebiet("2021", kreis, "kreistag", WAHLBEREICH_B_2021);
		expect(b?.stand.schnellmeldungen).toEqual({
			eingegangen: 37,
			erwartet: 37,
		});
		const ganz = apiWahl("2021", kreis, "kreistag");
		expect(ganz?.ergebnis?.stand.schnellmeldungen).toEqual({
			eingegangen: 426,
			erwartet: 426,
		});
	});
});

describe("Landesweit: jede angekündigte Ebene wird eingeordnet", () => {
	/** Die Ebenenbezeichnungen, die 2026 in Niedersachsen vorkommen. */
	const TITEL_2026 = [
		"Gemeinden",
		"Wahlbereiche",
		"Wahlbezirke",
		"Ortsratswahlgebiete",
		"Stadt-/Ortsteile",
		"Briefwahlgebiete",
		"Kreiswahlbereiche",
		"Gemeindewahlbereiche",
		"Stadtbezirke",
		"Analysebezirke",
		"(Mitglieds-)Gemeinden",
		"Wahlbereich",
		"Kommunen",
	];

	it("erkennt jede Wahlbereichs-Schreibweise als Wahlbereich", async () => {
		const { ebenenBezeichnung } = await import("../src/lib/ebenen.ts");
		for (const t of TITEL_2026.filter((t) => /wahlbereich/i.test(t)))
			expect(ebenenBezeichnung(t)).toBe("Wahlbereich");
	});

	it("ordnet die übrigen Ebenen ein, statt sie „Gebiet“ zu nennen", async () => {
		const { ebenenBezeichnung } = await import("../src/lib/ebenen.ts");
		const zugeordnet = Object.fromEntries(
			TITEL_2026.map((t) => [t, ebenenBezeichnung(t)]),
		);
		expect(zugeordnet).toEqual({
			Gemeinden: "Gemeinde",
			Wahlbereiche: "Wahlbereich",
			Wahlbezirke: "Wahlbezirk",
			Ortsratswahlgebiete: "Ortsteil",
			"Stadt-/Ortsteile": "Ortsteil",
			Briefwahlgebiete: "Briefwahl",
			Kreiswahlbereiche: "Wahlbereich",
			Gemeindewahlbereiche: "Wahlbereich",
			Stadtbezirke: "Stadtbezirk",
			Analysebezirke: "Analysebezirke",
			"(Mitglieds-)Gemeinden": "Gemeinde",
			Wahlbereich: "Wahlbereich",
			Kommunen: "Gemeinde",
		});
		expect(Object.values(zugeordnet)).not.toContain("Gebiet");
	});

	it("hängt nicht an der Ebenennummer – 2021 positiv, 2026 negativ", async () => {
		const { ebeneVon, ebenennamen } = await import("../src/lib/ebenen.ts");
		const namen = ebenennamen([
			{ ebene: "ebene_-6290", titel: "Kreiswahlbereiche" },
		]);
		expect(ebeneVon("ebene_-6290_id_1", namen)).toBe("Wahlbereich");
		expect(ebeneVon("ebene_9_id_57")).toBe("Wahlbereich");
		expect(ebeneVon("ebene_-6290_id_1")).toBe("Gebiet");
	});

	it("sagt es, wo die Wahlleitung eine Ebene ankündigt und nichts liefert", async () => {
		const { leereEbenen } = await import("../src/lib/ebenen.ts");
		expect(
			leereEbenen(
				[
					{ ebene: "ebene_3", titel: "Gemeinden" },
					{ ebene: "ebene_-6290", titel: "Kreiswahlbereiche" },
				],
				["ebene_-5921_id_10027", "ebene_3_id_2"],
			),
		).toEqual(["Kreiswahlbereiche"]);
	});
});

describe("Wahlräume", () => {
	it("liest den Kreiswahlbereich nur aus den Wahlräumen desselben Termins", async () => {
		const { wahlraeume } = await import("../src/lib/abfragen.ts");
		expect(
			wahlraeume("2021", NORDSTEMMEN).some((r) => r.kreiswahlbereich === "B"),
		).toBe(true);
		expect(
			wahlraeume("2026", NORDSTEMMEN).some((r) => r.kreiswahlbereich),
		).toBe(false);
		expect(wahlraeume("2026", KREIS)).toEqual([]);
	});
});

describe("Wo die Quelle nichts liefert, steht es auf der Seite", () => {
	it("meldet nichts Offenes, wo die Wahlleitung alles geliefert hat", async () => {
		const m = await seite("2026", "kreis");
		expect(m?.offeneEbenen).toEqual([]);
		expect(m?.gebiete.length).toBeGreaterThan(11);
	});

	/**
	 * Der Zustand der übrigen 39 Kreise am Samstag: `wahl.json` kündigt die
	 * Wahlbereiche an, veröffentlicht ist zu ihnen noch kein Gebiet.
	 */
	it("sagt es, solange die angekündigten Bereiche noch nicht da sind", async () => {
		const { oeffneDb } = await import("../src/lib/db.ts");
		const { wahlBySlug } = await import("../src/lib/abfragen.ts");
		const w = wahlBySlug("2026", KREIS, "kreistag")!;
		oeffneDb()
			.prepare(
				"DELETE FROM ergebnisse WHERE termin = ? AND behoerde = ? AND wahl_id = ? AND ebene = ?",
			)
			.run("2026", KREIS, w.wahlId, -53);
		const m = await seite("2026", "kreis");
		expect(m?.offeneEbenen).toEqual(["Wahlbereiche"]);
		expect(
			m?.gebiete.filter((g) => g.titel.startsWith("Wahlbereich ")),
		).toEqual([]);
	});
});
