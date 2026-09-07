/**
 * Nur-Lesen ist erzwungen, nicht bloß beabsichtigt.
 *
 * Das unterbrechungsfreie Ausrollen baut darauf, dass SQLite im WAL-Modus
 * genau einen Schreiber und beliebig viele Leser verträgt (siehe
 * docs/rollierendes-ausrollen.md). Der einzige Schreiber ist der Poller. Wäre
 * das nur eine Absicht, würde sie irgendwann verletzt — deshalb öffnet die
 * Rolle `web` die Datei mit `readOnly` und ein Schreibversuch endet dort mit
 * einer Ausnahme.
 *
 * Geprüft wird hier gegen echte Dateien und echte Verbindungen, nicht gegen
 * Attrappen: Was `node:sqlite` unter WAL zulässt, ist genau die Frage.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { metaGet, metaSet, oeffneDb, schliesseDb } from "../src/lib/db.ts";
import { rolle, schreibtDieserProzess } from "../src/lib/rolle.ts";

let ordner: string;
let pfad: string;

beforeEach(() => {
	ordner = mkdtempSync(join(tmpdir(), "wahlen-nurlesen-"));
	pfad = join(ordner, "wahlen.db");
});

afterEach(() => {
	schliesseDb();
	process.env.WAHLEN_ROLLE = "";
	rmSync(ordner, { recursive: true, force: true });
});

/** Legt die Datei als Schreiber an – so, wie es der Poller täte. */
const alsPoller = (fn: (db: DatabaseSync) => void): void => {
	const db = oeffneDb(pfad);
	fn(db);
	schliesseDb();
};

describe("Rolle", () => {
	it("ohne Angabe macht der Prozess beides", () => {
		expect(rolle()).toBe("beides");
		expect(schreibtDieserProzess()).toBe(true);
	});

	it("nur `web` schreibt nicht", () => {
		process.env.WAHLEN_ROLLE = "web";
		expect(schreibtDieserProzess()).toBe(false);
		process.env.WAHLEN_ROLLE = "poller";
		expect(schreibtDieserProzess()).toBe(true);
	});

	it("ein Tippfehler fällt auf `beides` zurück, statt still zu schweigen", () => {
		// „beides“ ist die Einstellung, die für sich allein funktioniert – eine
		// unbekannte Rolle darf nicht versehentlich zu „web“ werden und die
		// Seite ohne Poller lassen.
		process.env.WAHLEN_ROLLE = "webb";
		expect(rolle()).toBe("beides");
	});
});

describe("Datenbank in der Rolle web", () => {
	it("liest, was der Poller geschrieben hat", () => {
		alsPoller((db) => metaSet(db, "termin:2026:version", "abc"));

		process.env.WAHLEN_ROLLE = "web";
		const web = oeffneDb(pfad);
		expect(metaGet(web, "termin:2026:version")).toBe("abc");
	});

	it("weist jeden Schreibversuch ab", () => {
		alsPoller((db) => metaSet(db, "a", "1"));

		process.env.WAHLEN_ROLLE = "web";
		const web = oeffneDb(pfad);
		// Kein Einfügen …
		expect(() => metaSet(web, "b", "2")).toThrow();
		// … und auch kein Schema-Eingriff, der eine Migration nachholen wollte.
		expect(() => web.exec("CREATE TABLE IF NOT EXISTS neu (a TEXT)")).toThrow();
		expect(metaGet(web, "a")).toBe("1");
	});

	it("sieht neue Zahlen des laufenden Pollers", () => {
		// Der Fall, auf den es am Wahlabend ankommt: Der Poller schreibt weiter,
		// während die Web-Pods lesen. Ein Leser, der auf seinem Stand
		// festklebte, würde die Seite einfrieren.
		alsPoller((db) => metaSet(db, "termin:2026:version", "alt"));

		process.env.WAHLEN_ROLLE = "web";
		const web = oeffneDb(pfad);
		expect(metaGet(web, "termin:2026:version")).toBe("alt");

		// Zweiter Prozess wäre der Poller; hier reicht eine zweite Verbindung
		// auf dieselbe Datei — für SQLite ist das derselbe Fall.
		const poller = new DatabaseSync(pfad);
		poller.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
		metaSet(poller, "termin:2026:version", "neu");
		poller.close();

		expect(metaGet(web, "termin:2026:version")).toBe("neu");
	});

	it("fehlt die Datei noch, ist das ein Fehler und keine leere Datenbank", () => {
		// Genau darauf verlässt sich `server/main.ts`: Auf einem frischen Volume
		// wartet der Web-Pod, statt eine leere Seite auszuliefern. Legte die
		// Nur-Lese-Verbindung die Datei still an, wäre der Poller später
		// derjenige, der sich wundert.
		process.env.WAHLEN_ROLLE = "web";
		expect(() => oeffneDb(join(ordner, "gibt-es-nicht.db"))).toThrow();
	});
});
