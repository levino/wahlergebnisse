/**
 * Das Wahlabend-Dashboard über den ganzen Datenweg: Poller → Datenbank →
 * Folienmodell. Geprüft wird, was auf der Leinwand steht – die Reihenfolge des
 * Abends, der Auszählstand, und dass eine Hochrechnung auch als solche
 * beschriftet ankommt.
 */
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
	const { ladeDashboard } = await import("../src/lib/dashboard.ts");
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
		wahleintraege(termin.id, kreisBehoerde.ags),
		kreisBehoerde,
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
	it("beginnt mit dem Überblick und läuft von der eigenen Wahl zur Kreisebene", async () => {
		const m = await dashboard("2021", "nordstemmen");
		const folien = m.folien;
		expect(folien[0].art).toBe("ueberblick");
		const wahlen = folien.filter((f) => f.art === "wahl");
		expect(wahlen.map((f) => `${f.wahl} ${f.ort}`)).toEqual([
			"Gemeindewahl Nordstemmen",
			"Ortsratswahl Adensen",
			"Ortsratswahl Barnten",
			"Ortsratswahl Burgstemmen",
			"Ortsratswahl Groß Escherde",
			"Ortsratswahl Heyersum",
			"Ortsratswahl Klein Escherde",
			"Ortsratswahl Mahlerten",
			"Ortsratswahl Nordstemmen",
			"Ortsratswahl Rössing",
			"Kreistagswahl Nordstemmen",
			"Kreistagswahl Hildesheim",
			"Landratswahl Nordstemmen",
			"Landratswahl Hildesheim",
		]);
	});

	it("führt die kreisweiten Wahlen zweimal: eigenes Gebiet und ganzer Kreis", async () => {
		const m = await dashboard("2021", "nordstemmen");
		const kreistag = m.folien.filter(
			(f) => f.art === "wahl" && f.wahl === "Kreistagswahl",
		);
		expect(kreistag.map((f) => f.art === "wahl" && f.fremd)).toEqual([
			false,
			true,
		]);
		// Nordstemmen zählt seine 23 Wahlbezirke, der Kreis alle 426.
		expect(kreistag.map((f) => f.art === "wahl" && f.max)).toEqual([23, 426]);
		// Sitze gibt es nur für das ganze Gremium – der Anteil einer Gemeinde am
		// Kreistag ist keine Sitzverteilung.
		expect(kreistag[0].art === "wahl" && kreistag[0].sitze).toBeUndefined();
		expect(kreistag[1].art === "wahl" && kreistag[1].sitze?.gesamt).toBe(64);
	});

	it("nennt Bewerber bei der Personenwahl und Listen bei der Verhältniswahl", async () => {
		const m = await dashboard("2021", "nordstemmen");
		const landrat = m.folien.find(
			(f) => f.art === "wahl" && f.wahl === "Landratswahl" && f.fremd,
		);
		expect(landrat?.art === "wahl" && landrat.personenwahl).toBe(true);
		expect(landrat?.art === "wahl" && landrat.balken[0].name).toBe(
			"Bernd Lynack",
		);
		const rat = m.folien.find(
			(f) => f.art === "wahl" && f.wahl === "Gemeindewahl",
		);
		expect(rat?.art === "wahl" && rat.personenwahl).toBe(false);
		expect(rat?.art === "wahl" && rat.balken[0].name).toBe("SPD");
	});

	it("sortiert die Balken nach Stärke und zählt, was darunter wegfällt", async () => {
		const m = await dashboard("2021", "nordstemmen");
		const kreisweit = m.folien.find(
			(f) => f.art === "wahl" && f.wahl === "Kreistagswahl" && f.fremd,
		);
		if (kreisweit?.art !== "wahl") throw new Error("Folie fehlt");
		const anteile = kreisweit.balken.map((b) => b.prozent);
		expect([...anteile].sort((a, b) => b - a)).toEqual(anteile);
		expect(kreisweit.balken).toHaveLength(6);
		// Zwölf Listen traten an; die sechs schwächeren werden gezählt, nicht
		// stillschweigend unterschlagen.
		expect(kreisweit.weitere).toBe(6);
	});

	it("fasst im Überblick jede Wahl in einer Zeile zusammen", async () => {
		const m = await dashboard("2021", "nordstemmen");
		const ueberblick = m.folien[0];
		if (ueberblick.art !== "ueberblick") throw new Error("Überblick fehlt");
		expect(ueberblick.zeilen).toHaveLength(m.folien.length - 1);
		const roessing = ueberblick.zeilen.find((z) => z.ort === "Rössing");
		expect(roessing).toMatchObject({ anz: 3, max: 3, fertig: true });
		expect(roessing?.spitze?.name).toBe("CDU");
		// Der Fortschritt zählt nur die eigenen Wahlen – die 426
		// Schnellmeldungen des Kreises gehören nicht zum Abend der Gemeinde.
		expect(ueberblick.max).toBeLessThan(426);
	});

	it("lässt eine Wahl weg, die es im Archiv nie gab", async () => {
		// Der Landkreis führt zu 2021 eine Stichwahl des Landrats, zu der nie
		// eine Zahl kam. Im Rückblick ist das kein Bild für die Leinwand.
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
		expect(wahlen.every((f) => f.art === "wahl" && !f.fremd)).toBe(true);
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
			(f) => f.art === "wahl" && f.wahl === "Gemeindewahl",
		);
		if (rat?.art !== "wahl") throw new Error("Gemeindewahl fehlt");
		expect(rat.anz).toBe(8);
		expect(rat.max).toBe(23);
		expect(rat.datenstand.art).toBe("hochrechnung");
		expect(rat.datenstand.unsicherheit).toBeDefined();
		expect(rat.sitze?.quelle).toBe("hochrechnung");
		expect(rat.sitze?.verteilung.reduce((a, v) => a + v.sitze, 0)).toBe(
			rat.sitze?.gesamt,
		);
		// Vor der Auszählung stehen die übrigen Wahlen trotzdem in der
		// Aufstellung: Um 18 Uhr ist eine leere Folie die Wahrheit.
		expect(m.folien.length).toBeGreaterThan(5);
		const ueberblick = m.folien[0];
		expect(ueberblick.art).toBe("ueberblick");
		expect(ueberblick.art === "ueberblick" && ueberblick.anz).toBe(8);
	});
});
