/**
 * SQLite-Schicht (node:sqlite, im Node-Kern enthalten – kein natives Modul).
 *
 * Die Datenbank ist Cache und Archiv zugleich: Der Poller legt jede gelesene
 * votemanager-Datei mit ETag/Änderungszeit ab (`dateien`), daneben die
 * normalisierten Ergebnisse (`ergebnisse`, `uebersichten`) und einen
 * Ereignis-Ticker (`ereignisse`). Die Seiten lesen ausschließlich hieraus.
 *
 * WAL-Modus, und der erlaubt genau das, worauf das unterbrechungsfreie
 * Ausrollen aufbaut: **ein** Schreiber, beliebig viele Leser. Verbindungen im
 * selben Prozess (Astro-Bundle + Poller) und in anderen Prozessen (die
 * Web-Pods) stören einander nicht, solange nur einer schreibt. Wer das ist,
 * entscheidet die Rolle (siehe `rolle.ts`): In der Rolle `web` wird die Datei
 * mit `readOnly: true` geöffnet, ein Schreibversuch endet dort mit einer
 * Ausnahme statt mit einer zweiten Schreibsperre.
 *
 * Neben dem Tabellenschema gibt es einen zweiten, inhaltlichen Stand: den
 * DATENSTAND (siehe unten). Er sorgt dafür, dass Archiv-Termine noch einmal
 * eingelesen werden, wenn der Code aus denselben Quelldateien neue Daten
 * ableitet.
 */
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
CREATE TABLE IF NOT EXISTS laeufe (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  termin TEXT NOT NULL, gestartet TEXT NOT NULL, beendet TEXT, anfragen INTEGER NOT NULL DEFAULT 0,
  geaendert INTEGER NOT NULL DEFAULT 0, fehler TEXT
);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

/**
 * Stand der ABGELEITETEN Daten (nicht des Tabellenschemas).
 *
 * Hintergrund: Archiv-Termine (`live: false`) werden genau einmal vollständig
 * geladen; danach setzt der Poller die Marke `termin:<id>:vollstaendig`, und
 * `server/main.ts` überspringt sie beim Start. Leitet der Code später aus
 * denselben votemanager-Dateien zusätzliche Daten ab, bleiben genau diese
 * Termine leer – die Quelle hat sich ja nicht geändert, nur unsere Auswertung.
 *
 * Deshalb: **DATENSTAND erhöhen, sobald aus unveränderten Quelldateien neue
 * abgeleitete Daten entstehen** (neue Tabelle, neue Spalte, veränderte
 * Ableitungslogik). Beim nächsten Öffnen der Datenbank fallen dann alle
 * `vollstaendig`-Marken weg und das Archiv wird einmal neu eingelesen.
 *
 * Kein Grund zum Erhöhen sind reine Darstellungs- oder Seitenänderungen, die
 * nichts in der Datenbank ablegen.
 *
 * **Und die Bedingung, die seit dem rollenden Ausrollen dazukommt:** Während
 * eines Deploys laufen alter und neuer Stand gleichzeitig auf derselben Datei.
 * Erhöhe den DATENSTAND nur, wenn **beide** mit dem Ergebnis leben können —
 * was hier geschieht (Marken löschen, ETags verwerfen), ist harmlos, weil es
 * nur Angaben *über* die Daten betrifft und keine Zeile umschreibt. Eine
 * Migration, die vorhandene Zeilen ändert oder löscht, wäre es nicht. Die
 * ganze Regel steht in `docs/rollierendes-ausrollen.md`.
 *
 * Der erneute Lauf ist billig: Der Poller schickt zu jeder Datei ihren
 * gespeicherten ETag mit (If-None-Match); unveränderte Dateien antworten mit
 * 304 und werden aus dem gespeicherten Body neu ausgewertet. Es fließen also
 * Anfragen, aber kaum Daten – und für den fremden Server bleibt es harmlos.
 *
 * Stand 2: Listenplätze der Bewerber (`wahlvorschlaege`).
 * Stand 3: eindeutige Wahl-Slugs und abgeleitete Gebietsnamen
 * (`wahleintraege.gebiet`, siehe `wahlSlugs()` in lib/wahltyp.ts).
 */
export const DATENSTAND = 7;
// 3: Sitze und Wahlvorschläge werden über die vollständigen Namen zugeordnet.
//    Aus denselben Quelldateien entstehen dadurch andere Zeilen — bei
//    Wahlvorschlägen, zu denen nur eine Liste antrat, standen bis dahin die
//    Bewerber an ihrer Stelle (14 Ortsratswahlen 2021 mit falschen Werten).
// 4: Wiederholung von 3. Der Lauf davor hat nichts bewirkt, weil nur die
//    Vollständig-Marken fielen: Die Quelle antwortete auf die gespeicherten
//    ETags mit 304, und die Dateien wurden nie ausgewertet.
// 5: Jede Wahl bekommt eine eindeutige Adresse; dafür wird das Gebiet je
//    Wahleintrag abgeleitet und gespeichert (Spalte `gebiet`).
// 6: Listenplätze werden je Ortsratswahl aus der passenden Datei gelesen;
//    zuvor bekam nur die erste Ortschaft einer Wahl-Id welche.
// 7: Regionsversammlung und Regionspräsident/in werden als Kreistag und
//    Landrat erkannt (vorher "sonstige"). Typ und Slug liegen abgeleitet in
//    wahleintraege; die Quelle antwortet mit 304, also muss das Archiv einmal
//    neu durch – sonst bleiben 63 Wahlen der Region Hannover unerreichbar.

/**
 * Spalten, die einer bestehenden Datenbank fehlen, nachträglich anlegen.
 *
 * `CREATE TABLE IF NOT EXISTS` lässt eine schon vorhandene Tabelle
 * unangetastet – eine neue Spalte im SCHEMA erreicht sie also nie. Der
 * Vergleich mit `PRAGMA table_info` schließt die Lücke; gefüllt wird die
 * Spalte anschließend vom Poller, den der DATENSTAND dazu anstößt.
 *
 * Diese Liste kann ausschließlich **hinzufügen** – kein Umbenennen, kein
 * Entfernen. Das ist kein Mangel, sondern genau die Beschränkung, die ein
 * rollendes Ausrollen braucht: Der alte Stand, der während des Wechsels
 * weiterläuft, liest die Spalte noch (docs/rollierendes-ausrollen.md).
 * Deshalb auch: nie `NOT NULL` ohne Vorgabewert – das `INSERT` des alten
 * Stands füllt die Spalte nicht.
 */
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

/**
 * Hebt die Datei auf den aktuellen DATENSTAND.
 *
 * Gelöscht werden ausschließlich die `termin:*:vollstaendig`-Marken – die
 * eigentlichen Daten bleiben stehen. Der nächste Start liest die Archiv-Termine
 * dadurch noch einmal ein und schreibt die fehlenden abgeleiteten Zeilen nach;
 * bis dahin zeigt die Seite weiter, was schon da ist.
 *
 * Idempotent: Ein zweiter Aufruf (etwa aus der zweiten Verbindung im selben
 * Prozess) findet den aktuellen Stand vor und tut nichts.
 */
export const migriereDatenstand = (
	db: DatabaseSync,
): DatenstandMigration | undefined => {
	const alt = Number(metaGet(db, DATENSTAND_KEY) ?? 0);
	// Größere Werte (z. B. nach einem Rollback auf eine ältere Version) nicht
	// herabsetzen – die Daten sind dann eher zu vollständig als zu leer.
	if (Number.isFinite(alt) && alt >= DATENSTAND) return undefined;
	return transaktion(db, () => {
		const { changes } = db
			.prepare("DELETE FROM meta WHERE key LIKE 'termin:%:vollstaendig'")
			.run();
		// Die Vollständig-Marken allein genügen nicht: Der Poller fragt jede
		// Datei mit ihrem gespeicherten ETag an, bekommt "304 nicht geändert"
		// und wertet sie gar nicht erst aus. Genau das soll hier aber passieren
		// — die Quelldateien sind unverändert, nur unsere Ableitung daraus ist
		// neu. Also die Änderungssignale verwerfen, damit alles einmal wieder
		// wirklich gelesen wird.
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

/**
 * Öffnet (und migriert) die Datenbank. Wiederholte Aufrufe liefern dieselbe
 * Verbindung.
 *
 * In der Rolle `web` wird nur lesend geöffnet: kein Anlegen des Schemas, kein
 * Nachreichen von Spalten, keine Datenstands-Migration – all das schreibt und
 * gehört dem Poller. Fehlt die Datei noch (frisches Volume, der Poller war
 * noch nicht da), wirft `node:sqlite`; `server/main.ts` wartet in dem Fall,
 * statt eine halb benutzbare Seite auszuliefern.
 */
export const oeffneDb = (path: string = dbPfad()): DatabaseSync => {
	if (shared) return shared;
	if (!schreibtDieserProzess()) {
		// Kein mkdirSync: Ein Verzeichnis anzulegen, in dem nie eine Datenbank
		// entstehen wird, verschleiert nur, dass der Poller fehlt.
		const db = new DatabaseSync(path, { readOnly: true });
		// journal_mode und synchronous gehören dem Schreiber – eine nur lesende
		// Verbindung kann sie nicht setzen und muss es auch nicht. Die Wartezeit
		// bei belegter Datei dagegen ist eine Eigenschaft dieser Verbindung:
		// Ohne sie bricht ein Lesevorgang sofort mit SQLITE_BUSY ab, wenn der
		// Poller gerade seine Transaktion abschließt.
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
	// Nach dem Schema der inhaltliche Stand: fallen Marken weg, holt der
	// Archiv-Lauf in `server/main.ts` die fehlenden Ableitungen nach.
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
