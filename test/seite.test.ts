/** Seitenmodell und Karten-Zuordnung auf Basis der 2021-Fixtures. */
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
	await pollTermin(oeffneDb(), terminById("2021")!);
});

afterAll(async () => {
	const { schliesseDb } = await import("../src/lib/db.ts");
	schliesseDb();
	await mock.schliessen();
	aufraeumen(tmp);
});

describe("ladeWahlSeite", () => {
	it("Kreistag: Karte der Gemeinden und Wahlbereiche, amtliche Sitze, Tabellen", async () => {
		const { ladeWahlSeite } = await import("../src/lib/seite.ts");
		const { kreisBySlug } = await import("../src/data/kreise.ts");
		const hi = kreisBySlug("hildesheim")!;
		const { terminById } = await import("../src/data/termine.ts");
		const { behoerdeBySlug } = await import("../src/data/behoerden.ts");
		const m = ladeWahlSeite(
			hi,
			terminById("2021")!,
			behoerdeBySlug("kreis")!,
			"kreistag",
		)!;
		expect(m.istGesamt).toBe(true);
		expect(m.sitze?.quelle).toBe("amtlich");
		expect(m.sitze?.gesamt).toBe(64);
		expect(m.tabellen.map((t) => t.titel)).toEqual([
			"Gemeinden",
			"Kreiswahlbereiche",
		]);
		const gemeinden = m.tabellen[0];
		expect(
			gemeinden.zeilen.find((z) => z.label === "Gemeinde Nordstemmen")?.href,
		).toBe("/hildesheim/2021/nordstemmen/kreistag/");
		expect(
			gemeinden.zeilen.find((z) => z.label === "Gemeinde Nordstemmen")
				?.siegerFarbe,
		).toBe("#d60029");
		const karte = m.karte!;
		const ge = karte.ebenen.find((e) => e.id === "gemeinden")!;
		expect(ge.flaechen).toHaveLength(20); // 17 Gemeinden + 3 Mitgliedsgemeinden der Samtgemeinde
		expect(ge.flaechen.every((f) => !f.ohneDaten)).toBe(true);
		expect(ge.flaechen.find((f) => f.name === "Nordstemmen")?.href).toBe(
			"/hildesheim/2021/nordstemmen/kreistag/",
		);
		expect(ge.flaechen.find((f) => f.name === "Eime")?.tooltip).toContain(
			"Samtgemeinde Leinebergland",
		);
		const wb = karte.ebenen.find((e) => e.id === "wahlbereiche")!;
		expect(wb.flaechen.length).toBeGreaterThan(20); // Hildesheim je Ortsteil
		expect(
			wb.flaechen.find((f) => f.name.startsWith("Nordstemmen"))?.name,
		).toContain("Wahlbereich B");
		expect(karte.legende.map((l) => l.kurz)).toContain("SPD");
		expect(karte.bbox).toBeDefined();
	});

	it("Gemeinde-Untergebiet der Kreiswahl: Zahlen der Gemeinde, Karte hebt sie hervor", async () => {
		const { ladeWahlSeite } = await import("../src/lib/seite.ts");
		const { kreisBySlug } = await import("../src/data/kreise.ts");
		const hi = kreisBySlug("hildesheim")!;
		const { terminById } = await import("../src/data/termine.ts");
		const { behoerdeBySlug } = await import("../src/data/behoerden.ts");
		const m = ladeWahlSeite(
			hi,
			terminById("2021")!,
			behoerdeBySlug("kreis")!,
			"kreistag",
			"ebene_3_id_14",
		)!;
		expect(m.istGesamt).toBe(false);
		expect(m.aktuell?.titel).toBe("Gemeinde Nordstemmen");
		expect(m.aktuell?.standAnz).toBe(23);
		expect(
			m.karte?.ebenen[0].flaechen.find((f) => f.name === "Nordstemmen")?.aktiv,
		).toBe(true);
		expect(m.karte?.fokus).toBeDefined();
		expect(m.pfad).toHaveLength(2);
	});

	it("Gemeindewahl Nordstemmen: Ortsteile als Flächen, Wahllokale als Punkte, Kandidaten", async () => {
		const { ladeWahlSeite } = await import("../src/lib/seite.ts");
		const { kreisBySlug } = await import("../src/data/kreise.ts");
		const hi = kreisBySlug("hildesheim")!;
		const { terminById } = await import("../src/data/termine.ts");
		const { behoerdeBySlug } = await import("../src/data/behoerden.ts");
		const m = ladeWahlSeite(
			hi,
			terminById("2021")!,
			behoerdeBySlug("nordstemmen")!,
			"rat",
		)!;
		expect(m.sitze?.gesamt).toBe(30);
		expect(m.tabellen.map((t) => t.titel)).toEqual([
			"Ortsteile",
			"Wahlbezirke",
		]);
		const ot = m.karte!.ebenen.find((e) => e.id === "ortsteile")!;
		expect(ot.flaechen.map((f) => f.name).sort()).toEqual([
			"Adensen",
			"Barnten",
			"Burgstemmen",
			"Groß Escherde",
			"Heyersum",
			"Klein Escherde",
			"Mahlerten",
			"Nordstemmen",
			"Rössing",
		]);
		expect(ot.flaechen.find((f) => f.name === "Rössing")?.href).toBe(
			"/hildesheim/2021/nordstemmen/rat/ebene_8_id_112/",
		);
		expect(m.karte?.punkte.length).toBeGreaterThanOrEqual(10);
		expect(m.karte?.umriss).toHaveLength(1);
		expect(m.balken.find((b) => b.kurz === "CDU")?.sitze).toBe(9);
	});

	it("Ortsratswahl: nur die Wahlbezirke des Ortsteils, Slug mit Ortsname", async () => {
		const { ladeWahlSeite } = await import("../src/lib/seite.ts");
		const { kreisBySlug } = await import("../src/data/kreise.ts");
		const hi = kreisBySlug("hildesheim")!;
		const { terminById } = await import("../src/data/termine.ts");
		const { behoerdeBySlug } = await import("../src/data/behoerden.ts");
		const m = ladeWahlSeite(
			hi,
			terminById("2021")!,
			behoerdeBySlug("nordstemmen")!,
			"ortsrat-roessing",
		)!;
		expect(m.eintrag.gebietTitel).toBe("Rössing");
		const wb = m.tabellen.find((t) => t.titel === "Wahlbezirke")!;
		expect(wb.zeilen.every((z) => /Rössing/.test(z.label))).toBe(true);
		expect(m.karte?.punkte.every((p) => /Rössing/.test(p.name))).toBe(true);
	});

	it("Gebietstabelle: Spalten aus der angezeigten Wahl, nicht aus der Wahl-Id", async () => {
		const { ladeWahlSeite } = await import("../src/lib/seite.ts");
		const { kreisBySlug } = await import("../src/data/kreise.ts");
		const hi = kreisBySlug("hildesheim")!;
		const { terminById } = await import("../src/data/termine.ts");
		const { behoerdeBySlug } = await import("../src/data/behoerden.ts");
		const ns = behoerdeBySlug("nordstemmen")!;
		const t2021 = terminById("2021")!;

		const burg = ladeWahlSeite(hi, t2021, ns, "ortsrat-burgstemmen")!;
		const wb = burg.tabellen.find((t) => t.titel === "Wahlbezirke")!;
		expect(wb.spalten.map((s) => s.kurz)).toEqual(["WZB", "SPD"]);
		const urne = wb.zeilen.find((z) => z.label === "15 - Burgstemmen")!;
		expect(urne.werte).toEqual([
			{ kurz: "WZB", absolut: 547, prozent: 46.87 },
			{ kurz: "SPD", absolut: 620, prozent: 53.13 },
		]);

		const adensen = ladeWahlSeite(hi, t2021, ns, "ortsrat-adensen")!;
		const awb = adensen.tabellen.find((t) => t.titel === "Wahlbezirke")!;
		expect(awb.spalten.map((s) => s.kurz)).toEqual(["Die Unabhängigen"]);
		expect(awb.zeilen.find((z) => z.label === "06 - Adensen")?.werte).toEqual([
			{ kurz: "Die Unabhängigen", absolut: 915, prozent: 100 },
		]);

		const landrat = ladeWahlSeite(
			hi,
			t2021,
			behoerdeBySlug("kreis")!,
			"landrat",
		)!;
		const gem = landrat.tabellen.find((t) => t.titel === "Gemeinden")!;
		expect(gem.spalten[0].kurz).toBe("gültig");
		expect(gem.spalten).toHaveLength(6);
		expect(gem.spalten.map((s) => s.kurz)).toContain("Henke, PIRATEN");
	});

	it("vergleicht jede Wahlart mit dem passenden früheren Termin", async () => {
		const { oeffneDb } = await import("../src/lib/db.ts");
		const { pollTermin } = await import("../src/lib/poll.ts");
		const { ladeWahlSeite } = await import("../src/lib/seite.ts");
		const { kreisBySlug } = await import("../src/data/kreise.ts");
		const hi = kreisBySlug("hildesheim")!;
		const { terminById } = await import("../src/data/termine.ts");
		const { behoerdeBySlug } = await import("../src/data/behoerden.ts");
		const ns = behoerdeBySlug("nordstemmen")!;
		await pollTermin(oeffneDb(), terminById("2020")!, {
			nurBehoerden: [ns.ags],
		});
		await pollTermin(oeffneDb(), terminById("2026")!, {
			nurBehoerden: [ns.ags],
		});

		const bm = ladeWahlSeite(hi, terminById("2026")!, ns, "buergermeister")!;
		expect(bm.vergleichTermin?.id).toBe("2020");
		const rat = ladeWahlSeite(hi, terminById("2026")!, ns, "rat")!;
		expect(rat.vergleichTermin?.id).toBe("2021");
	});

	it("nennt einen Kreiswahlbereich mit seinen Gemeinden", async () => {
		const { ladeWahlSeite } = await import("../src/lib/seite.ts");
		const { kreisBySlug } = await import("../src/data/kreise.ts");
		const hi = kreisBySlug("hildesheim")!;
		const { terminById } = await import("../src/data/termine.ts");
		const { behoerdeBySlug } = await import("../src/data/behoerden.ts");
		const m = ladeWahlSeite(
			hi,
			terminById("2021")!,
			behoerdeBySlug("kreis")!,
			"kreistag",
			"ebene_9_id_57",
		)!;
		expect(m.aktuell?.titel).toBe("B");
		expect(m.gebietName).toBe("Wahlbereich B (Elze, Nordstemmen)");
		expect(m.pfad[1].titel).toBe("Wahlbereich B (Elze, Nordstemmen)");
		const bereichA = m.gebiete.find((g) =>
			g.titel.startsWith("Wahlbereich A ("),
		);
		expect(bereichA?.kinder.map((k) => k.titel)).toContain(
			"Gemeinde Algermissen",
		);
		const bereichB = m.gebiete.find((g) =>
			g.titel.startsWith("Wahlbereich B ("),
		);
		const titel = bereichB?.kinder.map((k) => k.titel) ?? [];
		expect(titel).toContain("Gemeinde Nordstemmen");
		expect(titel).toContain("Rössing");
		expect(titel.some((t) => t.includes("09 - Rössing - DGH"))).toBe(true);
	});

	it("unbekannte Slugs und Gebiete liefern undefined", async () => {
		const { ladeWahlSeite } = await import("../src/lib/seite.ts");
		const { kreisBySlug } = await import("../src/data/kreise.ts");
		const hi = kreisBySlug("hildesheim")!;
		const { terminById } = await import("../src/data/termine.ts");
		const { behoerdeBySlug } = await import("../src/data/behoerden.ts");
		expect(
			ladeWahlSeite(
				hi,
				terminById("2021")!,
				behoerdeBySlug("nordstemmen")!,
				"gibt-es-nicht",
			),
		).toBeUndefined();
		expect(
			ladeWahlSeite(
				hi,
				terminById("2021")!,
				behoerdeBySlug("nordstemmen")!,
				"rat",
				"ebene_6_id_999999",
			),
		).toBeUndefined();
	});
});
