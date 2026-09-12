import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	filtereFuerProbe,
	probenZeilen,
	uebernimmDemoBestand,
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
			spaeterZeilen: n(
				"SELECT COUNT(*) AS n FROM ergebnisse WHERE termin = '2026'",
			),
			spaeterAemter: n(
				"SELECT COUNT(*) AS n FROM wahleintraege WHERE termin = '2026'",
			),
			spaeterRaeume: n(
				"SELECT COUNT(*) AS n FROM wahlraeume WHERE termin = '2026'",
			),
			uebersichten: n("SELECT COUNT(*) AS n FROM uebersichten"),
			listen: n("SELECT COUNT(*) AS n FROM wahlvorschlaege"),
			probeRaeume: n(
				"SELECT COUNT(*) AS n FROM wahlraeume WHERE termin = '2021'",
			),
			probeEintraege: n(
				"SELECT COUNT(*) AS n FROM wahleintraege WHERE termin = '2021'",
			),
			probeZahlen: probenZeilen(pfad),
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
		expect(vorher.dateien).toBeGreaterThan(0);
		expect(nachher.dateien).toBe(0);
		expect(vorher.laeufe).toBeGreaterThan(0);
		expect(nachher.laeufe).toBe(0);
		expect(vorher.uebersichten).toBeGreaterThan(0);
		expect(nachher.uebersichten).toBe(0);
		expect(vorher.listen).toBeGreaterThan(0);
		expect(nachher.listen).toBe(0);
	});

	it("wirft weg, was nach dem Probentermin liegt", () => {
		expect(vorher.spaeterAemter).toBeGreaterThan(0);
		expect(nachher.spaeterAemter).toBe(0);
		expect(nachher.spaeterZeilen).toBe(0);
		expect(nachher.spaeterRaeume).toBe(0);
	});

	it("behält alles, woraus die Probe ihren Abend spielt", () => {
		expect(nachher.probeZahlen).toBe(vorher.probeZahlen);
		expect(nachher.probeZahlen).toBeGreaterThan(0);
		expect(nachher.probeEintraege).toBe(vorher.probeEintraege);
		expect(nachher.probeRaeume).toBe(vorher.probeRaeume);
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

		const vorherAnfragen = mock.anfragen.length;
		const { oeffneDb, schliesseDb } = await import("../src/lib/db.ts");
		schliesseDb();
		process.env.DATABASE_PATH = ziel;
		const db = oeffneDb(ziel);
		const { baueVorlage, bereiteProbeVor } = await import(
			"../src/lib/demo-abend.ts"
		);
		const { PROBEN_TERMIN, terminById } = await import(
			"../src/data/termine.ts"
		);
		const { kreisBySlug } = await import("../src/data/kreise.ts");
		const kreis = kreisBySlug("hildesheim")!;
		const behoerde = kreis.behoerden.find((b) => b.ags === DEMO)!;
		const termin = terminById(PROBEN_TERMIN)!;
		bereiteProbeVor(db, termin);
		const wahlen = baueVorlage(db, kreis, termin, behoerde);
		expect(wahlen.length).toBeGreaterThan(0);
		expect(wahlen.every((w) => w.lokale.length > 0)).toBe(true);
		schliesseDb();
		expect(mock.anfragen.length).toBe(vorherAnfragen);
	});

	it("tut außerhalb der Generalprobe nichts", async () => {
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
		expect(probenZeilen(ziel)).toBe(1);
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
