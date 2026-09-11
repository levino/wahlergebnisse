import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { schreibtDieserProzess } from "./rolle.ts";

export type Db = DatabaseSync;

/** Pfad der Datenbankdatei (DATABASE_PATH), zur Laufzeit ausgewertet. */
export const dbPfad = (): string =>
	process.env.DATABASE_PATH ?? "./data/wahlen.db";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS dateien (
  url TEXT PRIMARY KEY,
  etag TEXT,
  listing_stand TEXT,
  hash TEXT,
  geholt_am TEXT NOT NULL,
  geaendert_am TEXT NOT NULL,
  body TEXT
);
-- gebiet_titel ist der Gebietsname, wie die Wahlleitung ihn schreibt – roh
-- und stellenweise unbrauchbar ("Ergebnis", "der Gemeinde Dahlum"). gebiet
-- ist der daraus abgeleitete Name des Gebiets, für das gewählt wird; leer,
-- wenn es das der Behörde selbst ist. Er trägt den Slug und die Beschriftung.
CREATE TABLE IF NOT EXISTS wahleintraege (
  termin TEXT NOT NULL, behoerde TEXT NOT NULL, wahl_id INTEGER NOT NULL, gebiet_id TEXT NOT NULL,
  titel TEXT NOT NULL, gebiet_titel TEXT NOT NULL, gebiet TEXT NOT NULL DEFAULT '',
  typ TEXT NOT NULL, slug TEXT NOT NULL, reihenfolge INTEGER NOT NULL,
  PRIMARY KEY (termin, behoerde, wahl_id, gebiet_id)
);
CREATE TABLE IF NOT EXISTS wahlen (
  termin TEXT NOT NULL, behoerde TEXT NOT NULL, wahl_id INTEGER NOT NULL,
  titel TEXT NOT NULL, typ TEXT NOT NULL, datum TEXT, status TEXT, json TEXT NOT NULL, aktualisiert TEXT NOT NULL,
  PRIMARY KEY (termin, behoerde, wahl_id)
);
CREATE TABLE IF NOT EXISTS ergebnisse (
  termin TEXT NOT NULL, behoerde TEXT NOT NULL, wahl_id INTEGER NOT NULL, gebiet_id TEXT NOT NULL,
  ebene INTEGER NOT NULL, titel TEXT NOT NULL, leer INTEGER NOT NULL,
  stand_anz INTEGER, stand_max INTEGER, json TEXT NOT NULL, hash TEXT NOT NULL,
  aktualisiert TEXT NOT NULL, eingegangen_am TEXT,
  PRIMARY KEY (termin, behoerde, wahl_id, gebiet_id)
);
CREATE INDEX IF NOT EXISTS ergebnisse_ebene ON ergebnisse (termin, behoerde, wahl_id, ebene);
CREATE TABLE IF NOT EXISTS uebersichten (
  termin TEXT NOT NULL, behoerde TEXT NOT NULL, wahl_id INTEGER NOT NULL, ebene TEXT NOT NULL,
  titel TEXT NOT NULL, json TEXT NOT NULL, hash TEXT NOT NULL, aktualisiert TEXT NOT NULL,
  PRIMARY KEY (termin, behoerde, wahl_id, ebene)
);
CREATE TABLE IF NOT EXISTS wahlraeume (
  termin TEXT NOT NULL, behoerde TEXT NOT NULL, id INTEGER NOT NULL,
  titel TEXT NOT NULL, bezirk TEXT NOT NULL, ortsteil TEXT, wahlbereich TEXT, kreiswahlbereich TEXT, barrierefrei INTEGER NOT NULL,
  PRIMARY KEY (termin, behoerde, id)
);
-- Listenplätze je Gebiet: Bei der Kreistagswahl stellt jede Partei pro
-- Kreiswahlbereich eine eigene Liste, bei Ortsratswahlen je Ortschaft.
-- Deshalb gehört die Gebiets-Id zum Schlüssel.
CREATE TABLE IF NOT EXISTS wahlvorschlaege (
  termin TEXT NOT NULL, behoerde TEXT NOT NULL, wahl_id INTEGER NOT NULL, gebiet_id TEXT NOT NULL,
  partei_key TEXT NOT NULL, platz INTEGER NOT NULL, name TEXT NOT NULL, stimmen INTEGER NOT NULL,
  PRIMARY KEY (termin, behoerde, wahl_id, gebiet_id, partei_key, platz)
);
CREATE TABLE IF NOT EXISTS ereignisse (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  termin TEXT NOT NULL, zeit TEXT NOT NULL, behoerde TEXT NOT NULL, wahl_id INTEGER NOT NULL, gebiet_id TEXT NOT NULL,
  art TEXT NOT NULL, text TEXT NOT NULL, json TEXT
);
CREATE INDEX IF NOT EXISTS ereignisse_termin_zeit ON ereignisse (termin, zeit);
CREATE INDEX IF NOT EXISTS ereignisse_wahl ON ereignisse (termin, behoerde, wahl_id, id);
CREATE TABLE IF NOT EXISTS laeufe (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  termin TEXT NOT NULL, gestartet TEXT NOT NULL, beendet TEXT, anfragen INTEGER NOT NULL DEFAULT 0,
  geaendert INTEGER NOT NULL DEFAULT 0, fehler TEXT
);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

export const DATENSTAND = 7;

const NACHGEREICHTE_SPALTEN: Array<[string, string, string]> = [
	["wahleintraege", "gebiet", "TEXT NOT NULL DEFAULT ''"],
];

const ergaenzeSpalten = (db: DatabaseSync): void => {
	for (const [tabelle, spalte, typ] of NACHGEREICHTE_SPALTEN) {
		const vorhanden = (
			db.prepare(`PRAGMA table_info(${tabelle})`).all() as Array<{
				name: string;
			}>
		).some((s) => s.name === spalte);
		if (!vorhanden)
			db.exec(`ALTER TABLE ${tabelle} ADD COLUMN ${spalte} ${typ}`);
	}
};

/** Meta-Schlüssel, unter dem der zuletzt erreichte DATENSTAND liegt. */
const DATENSTAND_KEY = "datenstand";

/** Ergebnis der Datenstands-Prüfung; `undefined`, wenn nichts zu tun war. */
export type DatenstandMigration = {
	/** Stand, der in der Datei stand (0 = frische Datei ohne Eintrag). */
	alt: number;
	/** Anzahl gelöschter `termin:*:vollstaendig`-Marken. */
	geloescht: number;
};

export const migriereDatenstand = (
	db: DatabaseSync,
): DatenstandMigration | undefined => {
	const alt = Number(metaGet(db, DATENSTAND_KEY) ?? 0);
	if (Number.isFinite(alt) && alt >= DATENSTAND) return undefined;
	return transaktion(db, () => {
		const { changes } = db
			.prepare("DELETE FROM meta WHERE key LIKE 'termin:%:vollstaendig'")
			.run();
		db.prepare(
			"UPDATE dateien SET etag = NULL, hash = NULL, listing_stand = NULL",
		).run();
		metaSet(db, DATENSTAND_KEY, String(DATENSTAND));
		return { alt: Number.isFinite(alt) ? alt : 0, geloescht: Number(changes) };
	});
};

let shared: DatabaseSync | undefined;

/** Nur für Tests: gemeinsame Verbindung schließen, damit eine andere Datei geöffnet werden kann. */
export const schliesseDb = (): void => {
	shared?.close();
	shared = undefined;
};

export const oeffneDb = (path: string = dbPfad()): DatabaseSync => {
	if (shared) return shared;
	if (!schreibtDieserProzess()) {
		const db = new DatabaseSync(path, { readOnly: true });
		db.exec("PRAGMA busy_timeout = 5000;");
		shared = db;
		return db;
	}
	mkdirSync(dirname(path), { recursive: true });
	const db = new DatabaseSync(path);
	db.exec(
		"PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;",
	);
	db.exec(SCHEMA);
	ergaenzeSpalten(db);
	const migration = migriereDatenstand(db);
	if (migration?.geloescht)
		console.log(
			`Datenstand ${migration.alt} → ${DATENSTAND}: ${migration.geloescht} Archiv-Termin(e) werden erneut eingelesen`,
		);
	shared = db;
	return db;
};

export const jetzt = (): string => new Date().toISOString();

export const metaGet = (db: DatabaseSync, key: string): string | undefined =>
	(
		db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as
			| { value: string }
			| undefined
	)?.value;

export const metaSet = (db: DatabaseSync, key: string, value: string): void => {
	db.prepare(
		"INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
	).run(key, value);
};

/** Führt fn in einer Transaktion aus (BEGIN/COMMIT, ROLLBACK bei Fehler). */
export const transaktion = <T>(db: DatabaseSync, fn: () => T): T => {
	db.exec("BEGIN");
	try {
		const r = fn();
		db.exec("COMMIT");
		return r;
	} catch (e) {
		db.exec("ROLLBACK");
		throw e;
	}
};
