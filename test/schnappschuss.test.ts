import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	MARKE_ERZEUGT,
	bestand,
	entpacke,
	erzeugeKopie,
	packe,
	uebernimmSchnappschuss,
} from "../src/lib/schnappschuss.ts";
import { FIXTURES, aufraeumen, tempVerzeichnis } from "./helfer.ts";
import {
	type MockVotemanager,
	starteMockVotemanager,
} from "./mock-votemanager.ts";

let mock: MockVotemanager;
let tmp: string;
/** Der gepackte Test-Schnappschuss – Grundlage aller Übernahme-Proben. */
let paket: string;
/** Zeilenzahl im Schnappschuss, gegen die die Übernahmen sich messen. */
let zeilenImPaket = 0;

beforeAll(async () => {
	tmp = tempVerzeichnis("wahlen-schnappschuss-");
	mock = await starteMockVotemanager(FIXTURES);
	process.env.VOTEMANAGER_BASIS = mock.url;

	const quelle = join(tmp, "quelle", "wahlen.db");
	process.env.DATABASE_PATH = quelle;
	const { oeffneDb, schliesseDb } = await import("../src/lib/db.ts");
	const { pollTermin } = await import("../src/lib/poll.ts");
	const { terminById } = await import("../src/data/termine.ts");
	const db = oeffneDb(quelle);
	const stat = await pollTermin(db, terminById("2021")!, {
		nurBehoerden: ["03254000", "03254026"],
	});
	expect(stat.fehler).toEqual([]);

	const roh = join(tmp, "wahlen.db.kopie");
	erzeugeKopie(quelle, roh, "test");
	zeilenImPaket = bestand(roh).zeilen;
	paket = join(tmp, "wahlen.db.zst");
	await packe(roh, paket, 3); // im Test niedrige Stufe: es geht um die Kette, nicht um die Quote
	rmSync(roh, { force: true });
	schliesseDb();
}, 120_000);

afterAll(async () => {
	const { schliesseDb } = await import("../src/lib/db.ts");
	schliesseDb();
	await mock.schliessen();
	aufraeumen(tmp);
});

/** Ein frisches, leeres Volume. */
const frischesVolume = (name: string): string => {
	const dir = join(tmp, name);
	rmSync(dir, { recursive: true, force: true });
	mkdirSync(dir, { recursive: true });
	return join(dir, "wahlen.db");
};

describe("Schnappschuss erzeugen", () => {
	it("liefert eine lesbare Datenbank mit Inhalt und Marke", () => {
		const b = bestand(paket.replace(/\.zst$/, "")); // gibt es nicht mehr → leer
		expect(b.zeilen).toBe(0);
		expect(zeilenImPaket).toBeGreaterThan(0);
		expect(statSync(paket).size).toBeGreaterThan(0);
	});

	it("packt und entpackt verlustfrei", async () => {
		const ziel = join(tmp, "probe.db");
		await entpacke(paket, ziel);
		const b = bestand(ziel);
		expect(b.zeilen).toBe(zeilenImPaket);
		expect(b.erzeugt).toBeTruthy();
		const { DATENSTAND } = await import("../src/lib/db.ts");
		expect(b.datenstand).toBe(DATENSTAND);
		rmSync(ziel, { force: true });
	});

	it("lässt die Quelle unangetastet und braucht keinen Schreibzugriff", () => {
		const quelle = join(tmp, "readonly.db");
		const anlegen = new DatabaseSync(quelle);
		anlegen.exec("PRAGMA journal_mode = WAL;");
		anlegen.exec(
			"CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
		);
		anlegen.exec("CREATE TABLE ergebnisse (termin TEXT)");
		anlegen.exec("INSERT INTO ergebnisse VALUES ('2021')");
		anlegen.close();
		const ziel = join(tmp, "readonly-kopie.db");
		const { erzeugt } = erzeugeKopie(quelle, ziel, "probe");
		expect(bestand(ziel).zeilen).toBe(1);
		expect(bestand(ziel).erzeugt).toBe(erzeugt);
		expect(bestand(quelle).erzeugt).toBeUndefined();
	});
});

describe("Übernahme beim Start", () => {
	it("füllt ein leeres Volume und die Datenbank ist danach benutzbar", async () => {
		const ziel = frischesVolume("leer");
		const r = await uebernimmSchnappschuss({ quelle: paket, ziel });
		expect(r.art).toBe("uebernommen");
		expect(existsSync(ziel)).toBe(true);

		const vorher = mock.anfragen.length;
		const { oeffneDb, schliesseDb } = await import("../src/lib/db.ts");
		schliesseDb();
		process.env.DATABASE_PATH = ziel;
		const db = oeffneDb(ziel);
		const n = db.prepare("SELECT COUNT(*) AS n FROM ergebnisse").get() as {
			n: number;
		};
		expect(n.n).toBe(zeilenImPaket);
		const { terminVollstaendig } = await import("../src/lib/poll.ts");
		const { terminById } = await import("../src/data/termine.ts");
		expect(typeof terminVollstaendig(db, terminById("2021")!)).toBe("boolean");
		schliesseDb();
		expect(mock.anfragen.length).toBe(vorher);
	});

	it("rührt eine Datenbank mit eigenen Daten nicht an", async () => {
		const ziel = frischesVolume("eigene");
		const db = new DatabaseSync(ziel);
		db.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
		db.exec("CREATE TABLE ergebnisse (termin TEXT)");
		db.exec("INSERT INTO ergebnisse VALUES ('2021')");
		db.close();
		const r = await uebernimmSchnappschuss({ quelle: paket, ziel });
		expect(r.art).toBe("behalten");
		expect(bestand(ziel).zeilen).toBe(1);
	});

	it("rührt eine Datenbank mit Live-Zahlen nicht an, auch mit Marke", async () => {
		const ziel = frischesVolume("live");
		const db = new DatabaseSync(ziel);
		db.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
		db.exec("CREATE TABLE ergebnisse (termin TEXT)");
		db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)").run(
			MARKE_ERZEUGT,
			"2000-01-01T00:00:00.000Z",
		);
		db.exec("INSERT INTO ergebnisse VALUES ('2026')");
		db.close();
		const r = await uebernimmSchnappschuss({ quelle: paket, ziel });
		expect(r.art).toBe("behalten");
		expect(bestand(ziel).live).toBe(1);
	});

	it("ersetzt einen älteren Schnappschuss, an dem nichts Eigenes hängt", async () => {
		const ziel = frischesVolume("aelter");
		const db = new DatabaseSync(ziel);
		db.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
		db.exec("CREATE TABLE ergebnisse (termin TEXT)");
		const setz = db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)");
		setz.run(MARKE_ERZEUGT, "2000-01-01T00:00:00.000Z");
		setz.run("datenstand", "1");
		db.exec("INSERT INTO ergebnisse VALUES ('2021')");
		db.close();
		const r = await uebernimmSchnappschuss({ quelle: paket, ziel });
		expect(r.art).toBe("uebernommen");
		expect(bestand(ziel).zeilen).toBe(zeilenImPaket);
	});

	it("gewinnt nicht mit einem alten Datenstand", async () => {
		const ziel = frischesVolume("datenstand");
		const { DATENSTAND } = await import("../src/lib/db.ts");
		const db = new DatabaseSync(ziel);
		db.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
		db.exec("CREATE TABLE ergebnisse (termin TEXT)");
		const setz = db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)");
		setz.run(MARKE_ERZEUGT, "2000-01-01T00:00:00.000Z");
		setz.run("datenstand", String(DATENSTAND + 1));
		db.exec("INSERT INTO ergebnisse VALUES ('2021')");
		db.close();
		const r = await uebernimmSchnappschuss({ quelle: paket, ziel });
		expect(r.art).toBe("behalten");
		expect(bestand(ziel).zeilen).toBe(1);
	});

	it("tut ohne eingebackenen Schnappschuss nichts", async () => {
		const ziel = frischesVolume("ohne");
		const r = await uebernimmSchnappschuss({
			quelle: join(tmp, "gibt-es-nicht.zst"),
			ziel,
		});
		expect(r.art).toBe("kein-schnappschuss");
		expect(existsSync(ziel)).toBe(false);
	});
});
