import { cpSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	FIXTURES,
	aufraeumen,
	tempVerzeichnis,
	wahlabendMitBezirken,
} from "./helfer.ts";
import {
	type MockVotemanager,
	starteMockVotemanager,
} from "./mock-votemanager.ts";

let mock: MockVotemanager;
let tmp: string;

/** Die 2021er IDs der Urnenwahlbezirke Nordstemmens, in Bezirksreihenfolge. */
const URNE = [
	3111, 3112, 3113, 3114, 3115, 3116, 3117, 3118, 3119, 3120, 3121, 3122, 3123,
	3124, 3125,
];

const dashboard = async (terminId: string, behoerdeSlug: string) => {
	const { kreisebeneFuer, ladeDashboard } = await import(
		"../src/lib/dashboard.ts"
	);
	const { kreisBySlug } = await import("../src/data/kreise.ts");
	const { terminById } = await import("../src/data/termine.ts");
	const { wahleintraege } = await import("../src/lib/abfragen.ts");
	const kreis = kreisBySlug("hildesheim")!;
	const termin = terminById(terminId)!;
	const behoerde = kreis.behoerden.find((b) => b.slug === behoerdeSlug)!;
	const kreisBehoerde = kreis.behoerden.find((b) => b.ags === kreis.ags)!;
	return ladeDashboard(
		kreis,
		termin,
		behoerde,
		wahleintraege(termin.id, behoerde.ags),
		kreisebeneFuer(termin, kreisBehoerde, behoerde),
	);
};

beforeAll(async () => {
	tmp = tempVerzeichnis("dashboard-");
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

describe("Dashboard einer Gemeinde", () => {
	it("läuft von der eigenen Wahl zur Kreisebene – und zwar in dieser Reihenfolge", async () => {
		const m = await dashboard("2021", "nordstemmen");
		const wahlen = m.folien.filter((f) => f.art === "wahl");
		expect(wahlen.map((f) => `${f.wahl} ${f.ort}`)).toEqual([
			"Gemeinderatswahl Nordstemmen",
			"Ortsratswahl Adensen",
			"Ortsratswahl Barnten",
			"Ortsratswahl Burgstemmen",
			"Ortsratswahl Groß Escherde",
			"Ortsratswahl Heyersum",
			"Ortsratswahl Klein Escherde",
			"Ortsratswahl Mahlerten",
			"Ortsratswahl Nordstemmen",
			"Ortsratswahl Rössing",
			"Kreistagswahl Hildesheim",
			"Kreistagswahl Wahlbereich B",
			"Landratswahl Hildesheim",
		]);
	});

	it("gibt jeder Folie eine Marke für die Adresse", async () => {
		const m = await dashboard("2021", "nordstemmen");
		const marken = m.folien.map((f) => f.marke);
		expect(new Set(marken).size).toBe(marken.length);
		expect(marken[0]).toBe("ueberblick");
		expect(marken).toContain("ortsrat-roessing");
		expect(marken).toContain("kreistag-kreis");
		expect(marken).toContain("kreistag-wahlbereich-b");
		expect(marken).toContain("landrat-kreis");
	});

	it("zeigt keine Wahl, über die anderswo entschieden wird, im Gemeindezuschnitt", async () => {
		const m = await dashboard("2021", "nordstemmen");
		const kreiswahlen = m.folien.filter(
			(f) =>
				f.art === "wahl" &&
				(f.wahl === "Kreistagswahl" || f.wahl === "Landratswahl"),
		);
		expect(kreiswahlen.map((f) => f.art === "wahl" && f.zuschnitt)).toEqual([
			"kreis",
			"wahlbereich",
			"kreis",
		]);
	});

	it("führt die Kreistagswahl in zwei Zuschnitten: ganzer Kreis, dann Wahlbereich", async () => {
		const m = await dashboard("2021", "nordstemmen");
		const kreistag = m.folien.filter(
			(f) => f.art === "wahl" && f.wahl === "Kreistagswahl",
		);
		if (kreistag[0].art !== "wahl" || kreistag[1].art !== "wahl")
			throw new Error("Kreistagsfolien fehlen");
		expect([kreistag[0].zuschnitt, kreistag[1].zuschnitt]).toEqual([
			"kreis",
			"wahlbereich",
		]);
		expect([kreistag[0].max, kreistag[1].max]).toEqual([426, 37]);
		expect(kreistag[0].sitze?.gesamt).toBe(64);
		expect(kreistag[1].sitze).toBeUndefined();
	});

	it("nennt im Wahlbereich die Gewählten, nicht die Mehrheiten im Kreistag", async () => {
		const m = await dashboard("2021", "nordstemmen");
		const wb = m.folien.find(
			(f) => f.art === "wahl" && f.zuschnitt === "wahlbereich",
		);
		if (wb?.art !== "wahl") throw new Error("Wahlbereichsfolie fehlt");
		expect(wb.ort).toBe("Wahlbereich B");
		expect(wb.beisatz).toBe("Elze, Nordstemmen");
		expect(wb.kandidatenTitel).toBe("Gewählt in den Kreistag");
		expect(wb.kandidaten?.length).toBeGreaterThan(0);
		expect(wb.kandidaten?.map((k) => k.name)).toContain("Arlt, Andreas");
		expect(wb.kandidaten?.[0].mandat).not.toContain("B,");
	});

	it("nennt Bewerber bei der Personenwahl und Listen bei der Verhältniswahl", async () => {
		const m = await dashboard("2021", "nordstemmen");
		const landrat = m.folien.find(
			(f) =>
				f.art === "wahl" &&
				f.wahl === "Landratswahl" &&
				f.zuschnitt === "kreis",
		);
		expect(landrat?.art === "wahl" && landrat.personenwahl).toBe(true);
		expect(landrat?.art === "wahl" && landrat.balken[0].name).toBe(
			"Bernd Lynack",
		);
		const rat = m.folien.find(
			(f) => f.art === "wahl" && f.wahl === "Gemeinderatswahl",
		);
		expect(rat?.art === "wahl" && rat.personenwahl).toBe(false);
		expect(rat?.art === "wahl" && rat.balken[0].name).toBe("SPD");
	});

	it("sortiert die Balken nach Stärke und zählt, was darunter wegfällt", async () => {
		const m = await dashboard("2021", "nordstemmen");
		const kreisweit = m.folien.find(
			(f) =>
				f.art === "wahl" &&
				f.wahl === "Kreistagswahl" &&
				f.zuschnitt === "kreis",
		);
		if (kreisweit?.art !== "wahl") throw new Error("Folie fehlt");
		const anteile = kreisweit.balken.map((b) => b.prozent);
		expect([...anteile].sort((a, b) => b - a)).toEqual(anteile);
		expect(kreisweit.balken).toHaveLength(6);
		expect(kreisweit.weitere).toBe(6);
	});

	it("beginnt mit dem Überblick und lässt die eigene Wahl darauf folgen", async () => {
		const m = await dashboard("2021", "nordstemmen");
		expect(m.folien[0].art).toBe("ueberblick");
		expect(m.folien[1].wahl).toBe("Gemeinderatswahl");
		const roessing = m.folien.find(
			(f) => f.art === "wahl" && f.ort === "Rössing",
		);
		expect(roessing).toMatchObject({ anz: 3, max: 3 });
		expect(roessing?.art === "wahl" && roessing.balken[0].name).toBe("CDU");
	});

	it("führt im Überblick jede folgende Folie mit Spitze und Auszählstand", async () => {
		const m = await dashboard("2021", "nordstemmen");
		const ueberblick = m.folien[0];
		if (ueberblick.art !== "ueberblick") throw new Error("Überblick fehlt");
		const wahlen = m.folien.filter((f) => f.art === "wahl");
		expect(ueberblick.zeilen).toHaveLength(wahlen.length);
		expect(ueberblick.zeilen.map((z) => z.marke)).toEqual(
			wahlen.map((f) => f.marke),
		);
		const roessing = ueberblick.zeilen.find((z) => z.ort === "Rössing");
		expect(roessing?.spitze?.name).toBe("CDU");
		expect(roessing?.fertig).toBe(true);
	});

	it("zählt im Überblick nur die eigenen Wahlen der Wahlleitung", async () => {
		const m = await dashboard("2021", "nordstemmen");
		const ueberblick = m.folien[0];
		if (ueberblick.art !== "ueberblick") throw new Error("Überblick fehlt");
		const eigene = m.folien.filter(
			(f) => f.art === "wahl" && f.zuschnitt === "eigen",
		);
		expect(ueberblick.max).toBe(
			eigene.reduce((s, f) => s + (f.art === "wahl" ? f.max : 0), 0),
		);
		expect(ueberblick.max).toBeLessThan(426);
	});

	it("lässt eine Wahl weg, die es im Archiv nie gab", async () => {
		const m = await dashboard("2021", "nordstemmen");
		expect(
			m.folien.some((f) => f.art === "wahl" && f.wahl.includes("Stichwahl")),
		).toBe(false);
	});
});

describe("Dashboard der Kreisbehörde", () => {
	it("zeigt die kreisweiten Wahlen genau einmal", async () => {
		const m = await dashboard("2021", "kreis");
		const wahlen = m.folien.filter((f) => f.art === "wahl");
		expect(
			wahlen.every((f) => f.art === "wahl" && f.zuschnitt === "eigen"),
		).toBe(true);
		expect(
			wahlen.filter((f) => f.art === "wahl" && f.wahl === "Kreistagswahl"),
		).toHaveLength(1);
	});
});

describe("Dashboard am Wahlabend", () => {
	it("beschriftet eine Hochrechnung als solche und zeigt den Auszählstand", async () => {
		const wurzel = join(tmp, "wahlabend");
		cpSync(FIXTURES, wurzel, { recursive: true });
		wahlabendMitBezirken(wurzel, "03254026", URNE.slice(0, 8));
		mock.setzeWurzel(wurzel);
		const { oeffneDb } = await import("../src/lib/db.ts");
		const { pollTermin } = await import("../src/lib/poll.ts");
		const { terminById } = await import("../src/data/termine.ts");
		await pollTermin(oeffneDb(), terminById("2026")!, {
			nurBehoerden: ["03254026"],
		});

		const m = await dashboard("2026", "nordstemmen");
		const rat = m.folien.find(
			(f) => f.art === "wahl" && f.wahl === "Gemeinderatswahl",
		);
		if (rat?.art !== "wahl") throw new Error("Gemeinderatswahl fehlt");
		expect(rat.anz).toBe(8);
		expect(rat.max).toBe(23);
		expect(rat.datenstand.art).toBe("hochrechnung");
		expect(rat.datenstand.unsicherheit).toBeDefined();
		expect(rat.sitze?.quelle).toBe("hochrechnung");
		expect(rat.sitze?.verteilung.reduce((a, v) => a + v.sitze, 0)).toBe(
			rat.sitze?.gesamt,
		);
		expect(m.folien.length).toBeGreaterThan(5);
		expect(m.folien.filter((f) => f.max === 0).length).toBeGreaterThan(0);
	});
});
