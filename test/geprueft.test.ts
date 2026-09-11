import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { metaSet, oeffneDb, schliesseDb } from "../src/lib/db.ts";
import {
	liesGeprueft,
	merkeGeprueft,
	vergissGeprueft,
} from "../src/lib/geprueft.ts";

let ordner: string;
let pfad: string;

beforeEach(() => {
	ordner = mkdtempSync(join(tmpdir(), "wahlen-geprueft-"));
	pfad = join(ordner, "wahlen.db");
	vergissGeprueft();
});

afterEach(() => {
	schliesseDb();
	rmSync(ordner, { recursive: true, force: true });
});

describe("geprüft je Kreis", () => {
	it("was der Poller festhält, findet der Leser wieder", () => {
		const db = oeffneDb(pfad);
		merkeGeprueft(db, ["hildesheim", "goslar"], 1_700_000_000_000);

		vergissGeprueft();
		const werte = liesGeprueft(db);
		expect(werte.get("hildesheim")).toBe(1_700_000_000_000);
		expect(werte.get("goslar")).toBe(1_700_000_000_000);
		expect(werte.size).toBe(2);
	});

	it("übersteht einen Neustart – die Werte kommen aus der Datei", () => {
		const erst = oeffneDb(pfad);
		merkeGeprueft(erst, ["peine"], 1_700_000_000_000);
		schliesseDb();
		vergissGeprueft();

		const nachNeustart = oeffneDb(pfad);
		expect(liesGeprueft(nachNeustart).get("peine")).toBe(1_700_000_000_000);
	});

	it("fremde Meta-Schlüssel bleiben außen vor", () => {
		const db = oeffneDb(pfad);
		metaSet(db, "termin:2026:zuletzt", "2026-09-13T18:44:00.000Z");
		metaSet(db, "kreis:kaputt:geholt", "keine Zahl");
		merkeGeprueft(db, ["hildesheim"], 42);

		vergissGeprueft();
		expect([...liesGeprueft(db).keys()]).toEqual(["hildesheim"]);
	});

	it("eine leere Liste schreibt nichts", () => {
		const db = oeffneDb(pfad);
		merkeGeprueft(db, [], Date.now());
		vergissGeprueft();
		expect(liesGeprueft(db).size).toBe(0);
	});
});
