/**
 * Die Ortsseite über den ganzen Datenweg: Poller → Datenbank → Modell.
 *
 * Geprüft wird die Umkehrung, um die es geht – nicht „wie ging diese Wahl
 * aus“, sondern „was ist in diesem Dorf passiert“: alle Wahlen eines Abends,
 * eingesammelt über die gemeinsame Gebiets-Id des Ortsteils.
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

const ortSeite = async (ort: string) => {
	const { ladeOrtSeite } = await import("../src/lib/ort.ts");
	const { kreisBySlug } = await import("../src/data/kreise.ts");
	const { terminById } = await import("../src/data/termine.ts");
	const kreis = kreisBySlug("hildesheim")!;
	const behoerde = kreis.behoerden.find((b) => b.slug === "nordstemmen")!;
	return ladeOrtSeite(kreis, terminById("2021")!, behoerde, ort);
};

beforeAll(async () => {
	tmp = tempVerzeichnis("ort-");
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

describe("Ortsseite", () => {
	it("sammelt alle Wahlen des Abends für einen Ort ein", async () => {
		const m = (await ortSeite("roessing"))!;
		expect(m.ort.name).toBe("Rössing");
		expect(m.wahlen.map((w) => w.titel)).toEqual([
			"Ortsratswahl",
			"Gemeinderatswahl",
			"Kreistagswahl",
			"Landratswahl",
		]);
		// Die eigene Ortsratswahl steht vorn: Sie ist die Wahl dieses Ortes,
		// alles andere sein Anteil an einer größeren.
		expect(m.wahlen[0].eigen).toBe(true);
		expect(m.wahlen.slice(1).every((w) => !w.eigen)).toBe(true);
	});

	it("zeigt je Wahl die Zahlen dieses Ortes, nicht die der Gemeinde", async () => {
		const m = (await ortSeite("roessing"))!;
		const rat = m.wahlen.find((w) => w.titel === "Gemeinderatswahl")!;
		// Rössing hat drei Wahlbezirke, die Gemeinde 23.
		expect(rat.max).toBe(3);
		expect(rat.balken[0].prozent).toBeGreaterThan(0);
		const ortsrat = m.wahlen[0];
		expect(ortsrat.balken.map((b) => b.kurz)).toContain("CDU");
	});

	it("vergibt Sitze nur für den eigenen Ortsrat", async () => {
		// Der Anteil eines Ortsteils an der Gemeindewahl verteilt keinen
		// Gemeinderat – dort gibt es nichts zu vergeben (siehe seite.ts).
		const m = (await ortSeite("roessing"))!;
		expect(m.wahlen[0].sitze?.gesamt).toBe(7);
		expect(m.wahlen.slice(1).every((w) => w.sitze === undefined)).toBe(true);
	});

	it("nennt die Gewählten des Ortsrats und die Wahlbezirke des Ortes", async () => {
		const m = (await ortSeite("roessing"))!;
		expect(m.bewerber.length).toBeGreaterThan(0);
		expect(m.ortsratErgebnis?.sitze?.gewaehlte.length).toBeGreaterThan(0);
		expect(m.bezirke.map((b) => b.titel).join(" ")).toContain("Rössing");
	});

	it("führt die Ortsratswahl eines Nachbarorts nicht mit", async () => {
		// In der Ortsratswahl Adensen hat Rössing nicht gewählt; eine Karte mit
		// lauter Nullen wäre keine Auskunft, sondern eine Falle.
		const m = (await ortSeite("roessing"))!;
		expect(m.wahlen.filter((w) => w.titel === "Ortsratswahl")).toHaveLength(1);
	});

	it("kennt alle Ortschaften der Gemeinde zum Weiterblättern", async () => {
		const m = (await ortSeite("adensen"))!;
		expect(m.orte.map((o) => o.name)).toEqual([
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
		expect(m.orte.filter((o) => o.aktiv).map((o) => o.name)).toEqual([
			"Adensen",
		]);
	});

	it("gibt es zu einem unbekannten Ort nicht", async () => {
		expect(await ortSeite("gibtesnicht")).toBeUndefined();
	});
});
