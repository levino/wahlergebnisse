import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { aufraeumen, tempVerzeichnis } from "./helfer.ts";

const NORDSTEMMEN = "03254026";
let tmp: string;

beforeAll(async () => {
	tmp = tempVerzeichnis("ticker-");
	process.env.DATABASE_PATH = join(tmp, "wahlen.db");
	const { oeffneDb } = await import("../src/lib/db.ts");
	const db = oeffneDb();
	db.prepare(
		"INSERT INTO wahleintraege (termin, behoerde, wahl_id, gebiet_id, titel, gebiet_titel, gebiet, typ, slug, reihenfolge) VALUES ('2026', ?, 52, 'ebene_-141_id_130', 'Gemeindewahl', 'Gemeinde Nordstemmen', '', 'rat', 'rat', 1)",
	).run(NORDSTEMMEN);
	db.prepare(
		"INSERT INTO wahlraeume (termin, behoerde, id, titel, bezirk, ortsteil, wahlbereich, kreiswahlbereich, barrierefrei) VALUES ('2026', ?, 6006, 'Gemeindejugendring Nordstemmen', '01 - Nordstemmen - Gemeindejugendring', 'Nordstemmen', NULL, NULL, 1)",
	).run(NORDSTEMMEN);
	const ereignis = db.prepare(
		"INSERT INTO ereignisse (termin, zeit, behoerde, wahl_id, gebiet_id, art, text, json) VALUES ('2026', '2026-09-13T18:12:00.000Z', ?, ?, ?, 'fortschritt', ?, '{}')",
	);
	ereignis.run(
		NORDSTEMMEN,
		52,
		"ebene_6_id_6006",
		"01 - Nordstemmen - Gemeindejugendring: Gemeindewahl ausgezählt",
	);
	ereignis.run(
		NORDSTEMMEN,
		52,
		"ebene_6_id_6021",
		"901 - Briefwahl Nordstemmen: Gemeindewahl ausgezählt",
	);
	ereignis.run(
		NORDSTEMMEN,
		52,
		"ebene_-141_id_130",
		"Gemeinde Nordstemmen: Gemeindewahl 2 von 23",
	);
	ereignis.run(
		NORDSTEMMEN,
		99,
		"ebene_6_id_6006",
		"01 - Nordstemmen - Gemeindejugendring: Ortsratswahl ausgezählt",
	);
});

afterAll(async () => {
	const { schliesseDb } = await import("../src/lib/db.ts");
	schliesseDb();
	aufraeumen(tmp);
});

const eintraege = async () => {
	const { ereignisse } = await import("../src/lib/abfragen.ts");
	const { tickerEintraege } = await import("../src/lib/ticker.ts");
	return tickerEintraege(
		"hildesheim",
		"2026",
		ereignisse("2026", 10, NORDSTEMMEN).reverse(),
	);
};

describe("Ticker-Einträge", () => {
	it("führt vom Wahlbezirk auf dessen Seite und nennt das Wahllokal", async () => {
		const [wahlbezirk] = await eintraege();
		expect(wahlbezirk.href).toBe(
			"/hildesheim/2026/nordstemmen/rat/ebene_6_id_6006/",
		);
		expect(wahlbezirk.name).toBe("Gemeindejugendring Nordstemmen");
		expect(wahlbezirk.text).toBe("Gemeindewahl ausgezählt");
	});

	it("nennt das Gebiet, wo es kein Wahllokal gibt", async () => {
		const briefwahl = (await eintraege())[1];
		expect(briefwahl.href).toBe(
			"/hildesheim/2026/nordstemmen/rat/ebene_6_id_6021/",
		);
		expect(briefwahl.name).toBe("901 - Briefwahl Nordstemmen");
	});

	it("führt beim Gesamtgebiet auf die Wahl selbst", async () => {
		const gesamt = (await eintraege())[2];
		expect(gesamt.href).toBe("/hildesheim/2026/nordstemmen/rat/");
		expect(gesamt.name).toBe("Gemeinde Nordstemmen");
	});

	it("bleibt bei der Wahlleitung, wenn die Wahl nicht im Bestand steht", async () => {
		const ohneWahl = (await eintraege())[3];
		expect(ohneWahl.href).toBe("/hildesheim/2026/nordstemmen/");
	});
});
