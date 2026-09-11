import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/lib/db.ts";
import {
	BEITRAEGE_HOECHSTENS,
	type Toast,
	legeBeitragAn,
	letzteKennung,
	beitrag,
	beitraegeSeit,
	raeumeBeitraegeAuf,
} from "../src/lib/beitraege.ts";
import { aufraeumen, tempVerzeichnis } from "./helfer.ts";

const TERMIN = "2026";
const NORDSTEMMEN = "hildesheim/03254026";
const KREIS = "hildesheim/03254000";

/** Der Satz, den die Stimme spricht – er darf in keiner Ablage auftauchen. */
const GESPROCHEN =
	"In Rössing sind die Ergebnisse da, der Ortsrat steht fest. Im Gemeinderat liegt jetzt die CDU vorn.";

let tmp: string;
let db: Db;

const toast = (t: Partial<Toast> = {}): Toast => ({
	marke: "ortsrat-roessing",
	ort: "Rössing",
	wahl: "Ortsratswahl",
	art: "fertig",
	text: "Wahlbezirk 03 - Grundschule ausgezählt – 3 von 3",
	...t,
});

const lege = (topic: string, schluessel: string, t: Toast[] = [toast()]) =>
	legeBeitragAn(db, {
		termin: TERMIN,
		topic,
		schluessel,
		aufnahme: "a1b2c3.mp3",
		toasts: t,
	});

beforeAll(async () => {
	tmp = tempVerzeichnis("pakete-");
	process.env.DATABASE_PATH = join(tmp, "wahlen.db");
	delete process.env.WAHLEN_ROLLE;
	const { oeffneDb } = await import("../src/lib/db.ts");
	db = oeffneDb();
});

afterEach(() => {
	delete process.env.WAHLEN_ROLLE;
	db.exec("DELETE FROM beitraege");
});

afterAll(async () => {
	const { schliesseDb } = await import("../src/lib/db.ts");
	schliesseDb();
	aufraeumen(tmp);
});

describe("Beiträge ablegen", () => {
	it("gibt zurück, was hinterlegt wurde", () => {
		const p = lege(NORDSTEMMEN, "schub-1");
		expect(p.id).toBeGreaterThan(0);
		expect(p.topic).toBe(NORDSTEMMEN);
		expect(p.aufnahme).toBe("a1b2c3.mp3");
		expect(p.toasts).toHaveLength(1);
		expect(p.toasts[0].text).toContain("Grundschule");
		expect(beitrag(db, p.id)).toEqual(p);
	});

	it("vergibt steigende Kennungen", () => {
		const a = lege(NORDSTEMMEN, "schub-1");
		const b = lege(NORDSTEMMEN, "schub-2");
		const c = lege(KREIS, "schub-3");
		expect(b.id).toBeGreaterThan(a.id);
		expect(c.id).toBeGreaterThan(b.id);
	});

	it("baut denselben Schub kein zweites Mal", () => {
		// Der Poller sieht dasselbe Ergebnis erneut – etwa nach einem Neustart.
		// Ein zweites Paket hieße: derselbe Einblender zweimal, und eine zweite
		// bezahlte Aufnahme.
		const erst = lege(NORDSTEMMEN, "schub-1");
		const nochmal = lege(NORDSTEMMEN, "schub-1", [toast({ text: "anders" })]);
		expect(nochmal.id).toBe(erst.id);
		expect(nochmal.toasts[0].text).toBe(erst.toasts[0].text);
		expect(
			beitraegeSeit(db, { termin: TERMIN, topic: NORDSTEMMEN, seit: 0 }),
		).toHaveLength(1);
	});

	it("trennt Topics: derselbe Schlüssel, zwei Leinwände", () => {
		const a = lege(NORDSTEMMEN, "schub-1");
		const b = lege(KREIS, "schub-1");
		expect(b.id).not.toBe(a.id);
	});
});

describe("Pakete abholen", () => {
	it("liefert nur, was der Client noch nicht hat", () => {
		const a = lege(NORDSTEMMEN, "schub-1");
		const b = lege(NORDSTEMMEN, "schub-2");
		const c = lege(NORDSTEMMEN, "schub-3");
		expect(
			beitraegeSeit(db, { termin: TERMIN, topic: NORDSTEMMEN, seit: a.id }).map(
				(p) => p.id,
			),
		).toEqual([b.id, c.id]);
		expect(
			beitraegeSeit(db, { termin: TERMIN, topic: NORDSTEMMEN, seit: c.id }),
		).toEqual([]);
	});

	it("hält fremde Topics heraus", () => {
		lege(KREIS, "schub-1");
		const eigen = lege(NORDSTEMMEN, "schub-2");
		expect(
			beitraegeSeit(db, { termin: TERMIN, topic: NORDSTEMMEN, seit: 0 }).map(
				(p) => p.id,
			),
		).toEqual([eigen.id]);
	});

	it("deckelt, was ein Abruf zurückgibt", () => {
		// Wer eine Stunde weg war, soll nicht hundert Einblender auf einmal
		// nachgereicht bekommen.
		for (let i = 0; i < BEITRAEGE_HOECHSTENS + 5; i++)
			lege(NORDSTEMMEN, `schub-${i}`);
		const raus = beitraegeSeit(db, {
			termin: TERMIN,
			topic: NORDSTEMMEN,
			seit: 0,
		});
		expect(raus).toHaveLength(BEITRAEGE_HOECHSTENS);
		expect(raus[0].id).toBeLessThan(raus[raus.length - 1].id);
	});

	it("nennt die letzte Kennung, damit ein Client aufsetzen kann", () => {
		expect(letzteKennung(db, TERMIN, NORDSTEMMEN)).toBe(0);
		const a = lege(NORDSTEMMEN, "schub-1");
		expect(letzteKennung(db, TERMIN, NORDSTEMMEN)).toBe(a.id);
		expect(letzteKennung(db, TERMIN, KREIS)).toBe(0);
	});
});

describe("der gesprochene Satz", () => {
	it("steht in keiner Spalte und in keinem Toast", () => {
		// Die Zusicherung des ganzen Entwurfs: Der Client bekommt Einblender und
		// Aufnahme, nie den Text, den die Stimme spricht.
		lege(NORDSTEMMEN, "schub-1");
		const zeilen = db.prepare("SELECT * FROM beitraege").all();
		expect(JSON.stringify(zeilen)).not.toContain("Rössing sind die Ergebnisse");
		expect(JSON.stringify(zeilen)).not.toContain(GESPROCHEN);
		expect(
			db.prepare("PRAGMA table_info(pakete)").all() as Array<{ name: string }>,
		).not.toContainEqual(expect.objectContaining({ name: "satz" }));
	});

	it("lässt aus einem Toast nur die Felder der Leinwand durch", () => {
		// `anlass` ist die Deutung für das Sprachmodell und gehört nicht auf die
		// Leinwand – ein Aufrufer, der sie mitgibt, darf sie nicht durchreichen.
		const mitDeutung = {
			...toast(),
			anlass: "CDU zieht an SPD vorbei",
		} as Toast;
		const p = lege(NORDSTEMMEN, "schub-1", [mitDeutung]);
		expect(p.toasts[0]).not.toHaveProperty("anlass");
		expect(
			JSON.stringify(db.prepare("SELECT * FROM beitraege").all()),
		).not.toContain("zieht an");
	});
});

describe("die Rollen", () => {
	it("lässt die Web-Rolle lesen", () => {
		const a = lege(NORDSTEMMEN, "schub-1");
		process.env.WAHLEN_ROLLE = "web";
		expect(beitrag(db, a.id)?.id).toBe(a.id);
		expect(
			beitraegeSeit(db, { termin: TERMIN, topic: NORDSTEMMEN, seit: 0 }),
		).toHaveLength(1);
	});

	it("lässt die Web-Rolle nicht schreiben", () => {
		// Zwei Web-Pods, die beide Pakete anlegen, erzeugen denselben Einblender
		// zweimal. Schreiben darf nur der Poller.
		process.env.WAHLEN_ROLLE = "web";
		expect(() => lege(NORDSTEMMEN, "schub-1")).toThrow(/nur der Poller/);
		expect(() => raeumeBeitraegeAuf(db, { aelterAlsMs: 1000 })).toThrow(
			/nur der Poller/,
		);
	});
});

describe("Aufräumen", () => {
	it("wirft weg, was seine Zeit hinter sich hat", () => {
		const alt = lege(NORDSTEMMEN, "schub-alt");
		const neu = lege(NORDSTEMMEN, "schub-neu");
		const setze = db.prepare("UPDATE beitraege SET zeit = ? WHERE id = ?");
		setze.run("2026-09-13T18:00:00.000Z", alt.id);
		setze.run("2026-09-14T02:00:00.000Z", neu.id);
		const weg = raeumeBeitraegeAuf(db, {
			aelterAlsMs: 6 * 3600_000,
			bezogenAuf: Date.parse("2026-09-14T06:00:00.000Z"),
		});
		expect(weg).toBe(1);
		expect(beitrag(db, alt.id)).toBeUndefined();
		expect(beitrag(db, neu.id)?.id).toBe(neu.id);
	});
});
