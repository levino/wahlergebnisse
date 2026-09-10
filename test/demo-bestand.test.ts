/**
 * Der Demo-Bestand, von der Erzeugung bis zur Übernahme.
 *
 * Geprüft wird gegen eine echt gefüllte Datenbank: Der Poller lädt zwei
 * Wahlleitungen aus den Fixtures (2026, 2021, 2020), davon wird eine Kopie
 * gezogen, gefiltert und gepackt – genau so, wie der eingecheckte Bestand
 * entsteht. Attrappen würden hier die eine Frage umgehen, auf die es ankommt:
 * Kann die Generalprobe aus dem, was übrig bleibt, noch einen Abend spielen?
 *
 * Deshalb steht am Ende nicht „die Datei ist da", sondern `baueVorlage` – die
 * Funktion, an der die ganze Probe hängt. Ein Bestand, aus dem sie keine Ämter
 * mehr baut, ist wertlos, und zwar lautlos: Eine leere Generalprobe sieht aus
 * wie eine, die noch nicht angefangen hat.
 */
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	filtereFuerProbe,
	uebernimmDemoBestand,
	vorwertZeilen,
} from "../src/lib/demo-bestand.ts";
import { erzeugeKopie, packe } from "../src/lib/schnappschuss.ts";
import { FIXTURES, aufraeumen, tempVerzeichnis } from "./helfer.ts";
import {
	type MockVotemanager,
	starteMockVotemanager,
} from "./mock-votemanager.ts";

let mock: MockVotemanager;
let tmp: string;
/** Die gefilterte Kopie – sie bleibt liegen, damit die Proben hineinsehen können. */
let gefiltert: string;
/** Der gepackte Demo-Bestand, Grundlage aller Übernahme-Proben. */
let paket: string;

const DEMO = "03254026";
const KREIS = "03254000";

/** Die Zahlen, um die es beim Filtern geht. */
const zaehle = (pfad: string) => {
	const db = new DatabaseSync(pfad, { readOnly: true });
	const n = (sql: string): number =>
		Number((db.prepare(sql).get() as { n: number }).n);
	try {
		return {
			dateien: n("SELECT COUNT(*) AS n FROM dateien"),
			laeufe: n("SELECT COUNT(*) AS n FROM laeufe"),
			zielZahlen: n(
				"SELECT COUNT(*) AS n FROM ergebnisse WHERE termin = '2026' AND leer = 0",
			),
			zielAemter: n(
				"SELECT COUNT(*) AS n FROM wahleintraege WHERE termin = '2026'",
			),
			zielLeer: n(
				"SELECT COUNT(*) AS n FROM ergebnisse WHERE termin = '2026' AND leer = 1",
			),
			vorwertUebersichten: n(
				"SELECT COUNT(*) AS n FROM uebersichten WHERE termin = '2021'",
			),
			vorwertListen: n(
				"SELECT COUNT(*) AS n FROM wahlvorschlaege WHERE termin = '2021'",
			),
			vorwertRaeume: n(
				"SELECT COUNT(*) AS n FROM wahlraeume WHERE termin = '2021'",
			),
			vorwertEintraege: n(
				"SELECT COUNT(*) AS n FROM wahleintraege WHERE termin = '2021'",
			),
			vorwertZahlen: vorwertZeilen(pfad),
		};
	} finally {
		db.close();
	}
};

let vorher: ReturnType<typeof zaehle>;
let nachher: ReturnType<typeof zaehle>;

beforeAll(async () => {
	tmp = tempVerzeichnis("demo-bestand-");
	mock = await starteMockVotemanager(FIXTURES);
	process.env.VOTEMANAGER_BASIS = mock.url;

	// 1. Ein Bestand, wie ihn der Poller anlegt – mit dem Zieltermin, denn
	//    dessen Ämter geben vor, was die Probe nachspielt.
	const quelle = join(tmp, "quelle", "wahlen.db");
	process.env.DATABASE_PATH = quelle;
	const { oeffneDb, schliesseDb } = await import("../src/lib/db.ts");
	const { pollTermin } = await import("../src/lib/poll.ts");
	const { terminById } = await import("../src/data/termine.ts");
	const db = oeffneDb(quelle);
	for (const id of ["2026", "2021", "2020"]) {
		const stat = await pollTermin(db, terminById(id)!, {
			nurBehoerden: [DEMO, KREIS],
		});
		expect(stat.fehler).toEqual([]);
	}

	// 2. Kopie, filtern, packen – die Datenbank bleibt dabei offen, so wie sie
	//    es im Poller-Pod auch wäre.
	gefiltert = join(tmp, "wahlen.db.gefiltert");
	erzeugeKopie(quelle, gefiltert, "test");
	vorher = zaehle(gefiltert);
	filtereFuerProbe(gefiltert);
	nachher = zaehle(gefiltert);
	paket = join(tmp, "demo-bestand.db.zst");
	await packe(gefiltert, paket, 3); // niedrige Stufe: es geht um die Kette, nicht um die Quote
	schliesseDb();
}, 180_000);

afterAll(async () => {
	const { schliesseDb } = await import("../src/lib/db.ts");
	schliesseDb();
	await mock.schliessen();
	aufraeumen(tmp);
	delete process.env.WAHLEN_DEMO;
});

/** Ein frisches, leeres Volume. */
const frischesVolume = (name: string): string => {
	const dir = join(tmp, name);
	rmSync(dir, { recursive: true, force: true });
	mkdirSync(dir, { recursive: true });
	return join(dir, "wahlen.db");
};

/** Ein Aufruf in der Generalprobe – der Schalter gilt nur für ihn. */
const inDerProbe = async <T>(f: () => Promise<T>): Promise<T> => {
	const vorherWert = process.env.WAHLEN_DEMO;
	process.env.WAHLEN_DEMO = "1";
	try {
		return await f();
	} finally {
		if (vorherWert === undefined) delete process.env.WAHLEN_DEMO;
		else process.env.WAHLEN_DEMO = vorherWert;
	}
};

describe("Bestand erzeugen", () => {
	it("wirft weg, was die Probe nicht liest", () => {
		// Der HTTP-Zwischenspeicher des Pollers und seine Laufprotokolle: Die
		// Probe fragt keinen fremden Server ab, und ein „letzter Lauf", den es
		// in der Demo nie gab, wäre eine falsche Auskunft.
		expect(vorher.dateien).toBeGreaterThan(0);
		expect(nachher.dateien).toBe(0);
		expect(vorher.laeufe).toBeGreaterThan(0);
		expect(nachher.laeufe).toBe(0);
		// Übersichten und Listenplätze der Vorwerte liest die Anwendung nur zum
		// angezeigten Termin – landesweit sind das 130 MB, die kein Auge der
		// Generalprobe je sieht.
		expect(vorher.vorwertUebersichten).toBeGreaterThan(0);
		expect(nachher.vorwertUebersichten).toBe(0);
		expect(vorher.vorwertListen).toBeGreaterThan(0);
		expect(nachher.vorwertListen).toBe(0);
	});

	it("behält den Zieltermin als Struktur, aber ohne eine echte Zahl", () => {
		// Die Ämter bleiben – ohne sie wüsste die Probe nicht, was 2026 gewählt
		// wird. Was eine Wahlleitung dort schon veröffentlicht hat, bleibt
		// nicht: Echte Zahlen zum 13.09.2026 wären in einer Simulation von den
		// erfundenen nicht zu unterscheiden.
		expect(nachher.zielAemter).toBe(vorher.zielAemter);
		expect(nachher.zielAemter).toBeGreaterThan(0);
		expect(nachher.zielZahlen).toBe(0);
		// Die leeren Zeilen bleiben: „Es wird gewählt, und es liegt nichts vor"
		// ist die Wahrheit über ein Amt um 18 Uhr.
		expect(nachher.zielLeer).toBe(vorher.zielLeer);
	});

	it("behält alles, woraus die Probe ihre Vorlage baut", () => {
		// Ergebnisse und Wahleinträge der Vorwerte (`baueVorlage`) und die
		// Wahlräume – aus ihnen kommen die Kreiswahlbereiche, und zwar
		// ausdrücklich die von 2021 (`RUECKFALL_TERMIN`).
		expect(nachher.vorwertZahlen).toBe(vorher.vorwertZahlen);
		expect(nachher.vorwertZahlen).toBeGreaterThan(0);
		expect(nachher.vorwertEintraege).toBe(vorher.vorwertEintraege);
		expect(nachher.vorwertRaeume).toBe(vorher.vorwertRaeume);
	});
});

describe("Übernahme beim Start", () => {
	it("füllt ein leeres Volume, und die Probe spielt daraus", async () => {
		const ziel = frischesVolume("leer");
		const r = await inDerProbe(() =>
			uebernimmDemoBestand({ quelle: paket, ziel }),
		);
		expect(r.art).toBe("uebernommen");
		expect(existsSync(ziel)).toBe(true);

		// Und jetzt der eigentliche Beweis. Nicht „die Datei ist da", sondern:
		// Die Generalprobe findet ihre Ämter und ihre Bausteine – ohne dass
		// eine einzige Anfrage gestellt wurde.
		const vorherAnfragen = mock.anfragen.length;
		const { oeffneDb, schliesseDb } = await import("../src/lib/db.ts");
		schliesseDb();
		process.env.DATABASE_PATH = ziel;
		const db = oeffneDb(ziel);
		const { baueVorlage } = await import("../src/lib/demo-abend.ts");
		const { kreisBySlug } = await import("../src/data/kreise.ts");
		const { terminById } = await import("../src/data/termine.ts");
		const kreis = kreisBySlug("hildesheim")!;
		const behoerde = kreis.behoerden.find((b) => b.ags === DEMO)!;
		const wahlen = baueVorlage(db, kreis, terminById("2026")!, behoerde);
		expect(wahlen.length).toBeGreaterThan(0);
		// Eine Vorlage ohne Bausteine wäre ein Abend ohne Wahlbezirke: Die
		// Zahlen stünden von der ersten Sekunde an vollständig da. Eine Einheit
		// genügt dafür – der Ortsrat Mahlerten hat genau einen Wahlbezirk.
		expect(wahlen.every((w) => w.bausteine.length > 0)).toBe(true);
		schliesseDb();
		expect(mock.anfragen.length).toBe(vorherAnfragen);
	});

	it("tut außerhalb der Generalprobe nichts", async () => {
		// Die wichtigste Sicherung: In der Produktion hat dieser Bestand nichts
		// verloren. Er ist die kleine, gefilterte Fassung – auf einem
		// Produktions-Volume wäre er ein Rückschritt, und einer, der lautlos
		// passierte.
		const ziel = frischesVolume("ohne-probe");
		const r = await uebernimmDemoBestand({ quelle: paket, ziel });
		expect(r.art).toBe("keine-probe");
		expect(existsSync(ziel)).toBe(false);
	});

	it("rührt eine Datenbank mit Vorwerten nicht an", async () => {
		const ziel = frischesVolume("vorhanden");
		const db = new DatabaseSync(ziel);
		db.exec("CREATE TABLE ergebnisse (termin TEXT, leer INTEGER)");
		db.exec("INSERT INTO ergebnisse VALUES ('2021', 0)");
		db.close();
		const r = await inDerProbe(() =>
			uebernimmDemoBestand({ quelle: paket, ziel }),
		);
		expect(r.art).toBe("behalten");
		expect(vorwertZeilen(ziel)).toBe(1);
	});

	it("tut ohne eingecheckten Bestand nichts", async () => {
		const ziel = frischesVolume("kein-bestand");
		const r = await inDerProbe(() =>
			uebernimmDemoBestand({ quelle: join(tmp, "gibt-es-nicht.zst"), ziel }),
		);
		expect(r.art).toBe("kein-bestand");
		expect(existsSync(ziel)).toBe(false);
	});
});
