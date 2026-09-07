/**
 * Der Regelfall in Niedersachsen: eine Instanz **ohne** Verzeichnislisting.
 *
 * Von 38 geprüften Instanzen liefert keine eines, Hildesheim inzwischen auch
 * nicht mehr. Der Poller muss die Ergebnisdateien also allein über
 * termin.json, wahl.json und die Übersichten finden. Dieser Test läuft gegen
 * denselben Fixture-Bestand wie poll.test.ts, nur antwortet der Mock auf
 * Verzeichnisse mit 403.
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

beforeAll(async () => {
	tmp = tempVerzeichnis("wahlen-ohne-listing-");
	mock = await starteMockVotemanager(FIXTURES, 0, { listing: false });
	process.env.VOTEMANAGER_BASIS = mock.url;
	process.env.DATABASE_PATH = join(tmp, "wahlen.db");
});

afterAll(async () => {
	const { schliesseDb } = await import("../src/lib/db.ts");
	schliesseDb();
	await mock.schliessen();
	aufraeumen(tmp);
});

const verzeichnisAnfragen = (ab = 0) =>
	mock.anfragen.slice(ab).filter((p) => p.endsWith("/"));

describe("Poller ohne Verzeichnislisting", () => {
	it("findet Gesamtergebnis und Untergebiete über die Übersichten", async () => {
		const { oeffneDb } = await import("../src/lib/db.ts");
		const { pollTermin } = await import("../src/lib/poll.ts");
		const { terminById } = await import("../src/data/termine.ts");
		const { ergebnis, ergebnisseEbene, uebersichten, wahleintraege } =
			await import("../src/lib/abfragen.ts");

		const db = oeffneDb();
		const stat = await pollTermin(db, terminById("2021")!, {
			nurBehoerden: ["03254026"],
		});
		expect(stat.fehler).toEqual([]);

		const rat = wahleintraege("2021", "03254026").find((w) => w.typ === "rat")!;

		// Gesamtergebnis – steht in termin.json, nicht in einem Listing
		const gesamt = ergebnis("2021", "03254026", rat.wahlId, rat.gebietId)!;
		expect(gesamt.ergebnis.sitze?.gesamt).toBe(30);

		// Wahlbezirke – über uebersicht_ebene_6_0.json aus wahl.json gefunden
		const bezirke = ergebnisseEbene("2021", "03254026", rat.wahlId, 6);
		expect(bezirke.length).toBeGreaterThan(10);
		const roessing = ergebnis(
			"2021",
			"03254026",
			rat.wahlId,
			"ebene_6_id_3119",
		)!;
		expect(roessing.titel).toBe("09 - Rössing - DGH");
		expect(roessing.standAnz).toBe(1);

		// Ortsteile – die zweite Ebene aus dem Menü von wahl.json
		expect(
			uebersichten("2021", "03254026", rat.wahlId).map((u) => u.titel),
		).toContain("Ortsteile");

		// Die Ortsratswahlen hängen ebenfalls an termin.json
		expect(
			wahleintraege("2021", "03254026").filter((w) => w.typ === "ortsrat"),
		).toHaveLength(9);
	});

	it("versucht das Verzeichnislisting genau einmal je Host", async () => {
		const { oeffneDb, metaGet } = await import("../src/lib/db.ts");
		const { pollTermin } = await import("../src/lib/poll.ts");
		const { terminById } = await import("../src/data/termine.ts");
		const db = oeffneDb();

		// Im ersten Lauf hat der Poller es probiert und sich das 403 gemerkt.
		expect(verzeichnisAnfragen().length).toBe(1);
		expect(metaGet(db, `listing:${new URL(mock.url).host}`)).toBe("nein");

		const vorher = mock.anfragen.length;
		const stat = await pollTermin(db, terminById("2021")!, {
			nurBehoerden: ["03254026"],
		});
		expect(stat.fehler).toEqual([]);
		expect(verzeichnisAnfragen(vorher)).toEqual([]);
	});

	it("fragt unveränderte Untergebiete beim zweiten Lauf gar nicht erst an", async () => {
		const { oeffneDb } = await import("../src/lib/db.ts");
		const { pollTermin } = await import("../src/lib/poll.ts");
		const { terminById } = await import("../src/data/termine.ts");
		const db = oeffneDb();

		const vorher = mock.anfragen.length;
		const stat = await pollTermin(db, terminById("2021")!, {
			nurBehoerden: ["03254026"],
		});
		expect(stat.geaendert).toBe(0);
		const neue = mock.anfragen.slice(vorher);

		// Strukturdateien gelten sechs Stunden, Untergebiete erkennt der Poller
		// an ihrer Zeile in der Übersicht. Übrig bleiben je Wahl die Übersichten
		// und die Gesamtgebiete – rund 40 bedingte Anfragen für 13 Wahlen.
		expect(neue.length).toBeLessThan(60);
		expect(neue.filter((p) => p.includes("/termin.json"))).toHaveLength(0);
		// Ausnahme: Die Stichwahl von 2021 fehlt in den Fixtures. Ein 404 legt
		// nichts ab, das gelten könnte, also wird er jedes Mal neu versucht –
		// die Wahl könnte ja noch angelegt werden.
		expect(
			neue.filter((p) => p.includes("/wahl.json")).length,
		).toBeLessThanOrEqual(1);
		expect(neue.filter((p) => p.includes("open_data.json"))).toHaveLength(0);
		// Nur die Gebiete, die termin.json und das Menü von wahl.json direkt
		// nennen (13 Gesamtgebiete plus vier Ortsteil-Einstiege) – keines der
		// über hundert Untergebiete.
		expect(
			neue.filter((p) => p.includes("/ergebnis_")).length,
		).toBeLessThanOrEqual(20);
	});
});
