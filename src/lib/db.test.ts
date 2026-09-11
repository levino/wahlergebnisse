import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DATENSTAND, metaGet, metaSet, oeffneDb, schliesseDb } from "./db.ts";

let ordner: string;
let pfad: string;

beforeEach(() => {
	ordner = mkdtempSync(join(tmpdir(), "wahlen-db-"));
	pfad = join(ordner, "wahlen.db");
});

afterEach(() => {
	schliesseDb();
	rmSync(ordner, { recursive: true, force: true });
});

/** Legt eine Datei mit vorgegebenem Stand, Marken und einer Datenzeile an. */
const dateiMitStand = (stand: string | undefined) => {
	const db = oeffneDb(pfad);
	if (stand === undefined)
		db.prepare("DELETE FROM meta WHERE key = 'datenstand'").run();
	else metaSet(db, "datenstand", stand);
	metaSet(db, "termin:2021:vollstaendig", "2026-01-01T00:00:00.000Z");
	metaSet(db, "termin:2016:vollstaendig", "2026-01-01T00:00:00.000Z");
	metaSet(db, "termin:2021:zuletzt", "2026-01-01T00:00:00.000Z");
	db.prepare(
		"INSERT INTO ergebnisse (termin, behoerde, wahl_id, gebiet_id, ebene, titel, leer, json, hash, aktualisiert) VALUES ('2021','02','1','0',0,'Kreistag',0,'{}','h','2026-01-01T00:00:00.000Z')",
	).run();
	db.prepare(
		"INSERT INTO dateien (url, etag, listing_stand, hash, geholt_am, geaendert_am, body) VALUES ('https://example.org/a.json','\"abc\"','2026-01-01','h1','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z','{}')",
	).run();
	schliesseDb();
};

const marken = (db: ReturnType<typeof oeffneDb>): string[] =>
	(
		db
			.prepare(
				"SELECT key FROM meta WHERE key LIKE 'termin:%:vollstaendig' ORDER BY key",
			)
			.all() as { key: string }[]
	).map((r) => r.key);

describe("Datenstand", () => {
	it("schreibt auf einer frischen Datei nur den aktuellen Stand", () => {
		const db = oeffneDb(pfad);
		expect(metaGet(db, "datenstand")).toBe(String(DATENSTAND));
		expect(marken(db)).toEqual([]);
	});

	it("löscht bei altem Stand die vollstaendig-Marken, nicht die Daten", () => {
		dateiMitStand("1");

		const db = oeffneDb(pfad);
		expect(marken(db)).toEqual([]);
		expect(metaGet(db, "datenstand")).toBe(String(DATENSTAND));
		expect(metaGet(db, "termin:2021:zuletzt")).toBe("2026-01-01T00:00:00.000Z");
		expect(
			db.prepare("SELECT COUNT(*) AS n FROM ergebnisse").get() as { n: number },
		).toEqual({ n: 1 });
	});

	it("räumt auch eine Datei ganz ohne Meta-Eintrag auf", () => {
		dateiMitStand(undefined);

		const db = oeffneDb(pfad);
		expect(marken(db)).toEqual([]);
		expect(metaGet(db, "datenstand")).toBe(String(DATENSTAND));
	});

	it("lässt eine Datei mit aktuellem Stand unverändert", () => {
		dateiMitStand(String(DATENSTAND));

		const db = oeffneDb(pfad);
		expect(marken(db)).toEqual([
			"termin:2016:vollstaendig",
			"termin:2021:vollstaendig",
		]);
		expect(metaGet(db, "datenstand")).toBe(String(DATENSTAND));
	});

	it("verwirft die Änderungssignale, damit wirklich neu gelesen wird", () => {
		dateiMitStand("1");

		const db = oeffneDb(pfad);
		const d = db
			.prepare("SELECT etag, hash, listing_stand, body FROM dateien")
			.get() as {
			etag: string | null;
			hash: string | null;
			listing_stand: string | null;
			body: string | null;
		};
		expect(d.etag).toBeNull();
		expect(d.hash).toBeNull();
		expect(d.listing_stand).toBeNull();
		expect(d.body).toBe("{}");
	});

	it("lässt die Änderungssignale bei gleichem Stand in Ruhe", () => {
		dateiMitStand(String(DATENSTAND));

		const db = oeffneDb(pfad);
		const d = db.prepare("SELECT etag FROM dateien").get() as {
			etag: string | null;
		};
		expect(d.etag).toBe('"abc"');
	});
});
