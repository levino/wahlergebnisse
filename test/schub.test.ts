import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Behoerde } from "../src/data/behoerden.ts";
import type { Kreis } from "../src/data/kreise.ts";
import type { Termin } from "../src/data/termine.ts";
import type { Db } from "../src/lib/db.ts";
import type { FolienStand } from "../src/lib/meldungen.ts";
import { FIXTURES, aufraeumen, tempVerzeichnis } from "./helfer.ts";
import {
	type MockVotemanager,
	starteMockVotemanager,
} from "./mock-votemanager.ts";

const NORDSTEMMEN = "03254026";
const KREIS = "03254000";

let tmp: string;
let mock: MockVotemanager;
let db: Db;
let kreis: Kreis;
let termin: Termin;
let behoerde: Behoerde;
let schub: typeof import("../src/lib/schub.ts");

beforeAll(async () => {
	tmp = tempVerzeichnis("schub-");
	process.env.DATABASE_PATH = join(tmp, "wahlen.db");
	mock = await starteMockVotemanager(FIXTURES);
	process.env.VOTEMANAGER_BASIS = mock.url;
	const { oeffneDb } = await import("../src/lib/db.ts");
	const { pollTermin } = await import("../src/lib/poll.ts");
	const { terminById } = await import("../src/data/termine.ts");
	const { kreisBySlug } = await import("../src/data/kreise.ts");
	db = oeffneDb();
	for (const id of ["2021", "2020"])
		await pollTermin(db, terminById(id)!, {
			nurBehoerden: [NORDSTEMMEN, KREIS],
		});
	kreis = kreisBySlug("hildesheim")!;
	termin = terminById("2021")!;
	behoerde = kreis.behoerden.find((b) => b.ags === NORDSTEMMEN)!;
	schub = await import("../src/lib/schub.ts");
}, 120_000);

afterAll(async () => {
	await mock.schliessen();
	aufraeumen(tmp);
});

beforeEach(() => {
	db.prepare("DELETE FROM meta WHERE key LIKE 'schub:%'").run();
});

/** Der Stand, wie er wirklich in der Datenbank steht. */
const echterStand = (): Map<string, FolienStand> =>
	schub.staendeAus(schub.modellFuer(kreis, termin, behoerde));

/** Denselben Stand, aber auf einzelnen Folien zurückgedreht. */
const zurueckgedreht = (
	marken: string[],
	umWieviel: number,
): Map<string, FolienStand> => {
	const raus = new Map<string, FolienStand>();
	for (const [marke, s] of echterStand())
		raus.set(
			marke,
			marken.includes(marke)
				? { ...s, anz: Math.max(0, s.anz - umWieviel), art: "zwischenstand" }
				: s,
		);
	return raus;
};

const marken = (): string[] => [...echterStand().keys()];

const kleineWahlen = (): string[] =>
	[...echterStand()]
		.filter(([, s]) => s.max > 1 && s.max <= 40)
		.map(([marke]) => marke);

const grosseWahlen = (): string[] =>
	[...echterStand()].filter(([, s]) => s.max > 40).map(([marke]) => marke);

describe("die Stände einer Wahlleitung", () => {
	it("bildet je Wahlfolie einen Stand", () => {
		const staende = echterStand();
		expect(staende.size).toBeGreaterThan(1);
		for (const s of staende.values()) {
			expect(s.wahl).not.toBe("");
			expect(s.max).toBeGreaterThan(0);
		}
	});

	it("führt sowohl kleine Wahlen als auch kreisweite", () => {
		// Beide braucht die Drosselung, sonst prüft sie nichts.
		expect(kleineWahlen().length).toBeGreaterThan(0);
		expect(grosseWahlen().length).toBeGreaterThan(0);
	});

	it("übersteht das Ablegen und Wiederlesen unverändert", () => {
		const vorher = echterStand();
		schub.merkeStand(db, termin.id, behoerde.ags, vorher);
		expect(schub.liesStand(db, termin.id, behoerde.ags)).toEqual(vorher);
	});

	it("kennt vor dem ersten Merken keinen Stand", () => {
		expect(schub.liesStand(db, termin.id, behoerde.ags)).toBeUndefined();
	});
});

describe("die Schuberkennung", () => {
	it("meldet beim ersten Blick nichts und merkt sich den Stand", () => {
		// Sonst hagelte es beim Start Meldungen über Zahlen, die längst dastehen.
		expect(schub.erkenneSchub(db, kreis, termin, behoerde)).toBeUndefined();
		expect(schub.liesStand(db, termin.id, behoerde.ags)).toEqual(echterStand());
	});

	it("meldet nichts, wenn sich nichts geändert hat", () => {
		schub.erkenneSchub(db, kreis, termin, behoerde);
		expect(schub.erkenneSchub(db, kreis, termin, behoerde)).toBeUndefined();
	});

	it("macht aus einem Wahllokal in mehreren Wahlen einen einzigen Schub", () => {
		// Der reale Fall: Ein Wahlbezirk meldet, und derselbe Stapel zählt in
		// Ortsrat, Gemeinderat und die kreisweiten Wahlen zugleich.
		const betroffen = kleineWahlen().slice(0, 3);
		expect(betroffen.length).toBe(3);
		schub.merkeStand(db, termin.id, behoerde.ags, zurueckgedreht(betroffen, 1));

		const s = schub.erkenneSchub(db, kreis, termin, behoerde);
		expect(s).toBeDefined();
		const beruehrt = new Set(s!.meldungen.map((m) => m.marke));
		for (const marke of betroffen) expect(beruehrt).toContain(marke);
	});

	it("trägt den Stand von vorher mit, gegen den verglichen wurde", () => {
		const betroffen = kleineWahlen().slice(0, 1);
		const vorher = zurueckgedreht(betroffen, 1);
		schub.merkeStand(db, termin.id, behoerde.ags, vorher);
		const s = schub.erkenneSchub(db, kreis, termin, behoerde);
		expect(s!.vorher.get(betroffen[0])).toEqual(vorher.get(betroffen[0]));
	});

	it("meldet bei kreisweiten Wahlen keinen nackten Zähler", () => {
		// Kreistag und Landrat führen über vierhundert Auszähleinheiten; jede
		// einzelne zu melden hieße, alle acht Sekunden zu sprechen. Ein Zähler
		// ohne Zehnerschwelle darf dort deshalb nie entstehen.
		const gross = grosseWahlen()[0];
		const stand = echterStand().get(gross)!;
		const einSchritt = new Map(echterStand());
		einSchritt.set(gross, { ...stand, anz: stand.anz - 1 });
		schub.merkeStand(db, termin.id, behoerde.ags, einSchritt);

		const s = schub.erkenneSchub(db, kreis, termin, behoerde);
		const zaehler = (s?.meldungen ?? []).filter(
			(m) => m.marke === gross && m.art === "stand",
		);
		for (const m of zaehler) expect(m.prozent).toBeDefined();
		// Die wichtige Nachricht kommt trotzdem durch.
		expect(
			(s?.meldungen ?? []).some((m) => m.marke === gross && m.art === "fertig"),
		).toBe(true);
	});

	it("meldet bei der Gemeinde jeden einzelnen Wahlbezirk", () => {
		const klein = kleineWahlen()[0];
		const stand = echterStand().get(klein)!;
		const einSchritt = new Map(echterStand());
		einSchritt.set(klein, {
			...stand,
			anz: stand.anz - 1,
			art: "zwischenstand",
		});
		schub.merkeStand(db, termin.id, behoerde.ags, einSchritt);

		const s = schub.erkenneSchub(db, kreis, termin, behoerde);
		expect(s!.meldungen.some((m) => m.marke === klein)).toBe(true);
	});

	it("wiederholt nach einem Neustart nichts", () => {
		const betroffen = kleineWahlen().slice(0, 2);
		schub.merkeStand(db, termin.id, behoerde.ags, zurueckgedreht(betroffen, 1));
		expect(schub.erkenneSchub(db, kreis, termin, behoerde)).toBeDefined();

		// Der gemerkte Stand liegt auf der Platte, nicht im Prozessgedächtnis:
		// ein frischer Zugriff auf dieselbe Datei sieht ihn.
		const frisch = new DatabaseSync(join(tmp, "wahlen.db"), { readOnly: true });
		try {
			expect(schub.liesStand(frisch, termin.id, behoerde.ags)).toEqual(
				echterStand(),
			);
		} finally {
			frisch.close();
		}
		expect(schub.erkenneSchub(db, kreis, termin, behoerde)).toBeUndefined();
	});

	it("gibt demselben Schub denselben Schlüssel", () => {
		const betroffen = kleineWahlen().slice(0, 2);
		const vorher = zurueckgedreht(betroffen, 1);

		schub.merkeStand(db, termin.id, behoerde.ags, vorher);
		const eins = schub.erkenneSchub(db, kreis, termin, behoerde);
		schub.merkeStand(db, termin.id, behoerde.ags, vorher);
		const zwei = schub.erkenneSchub(db, kreis, termin, behoerde);

		expect(eins!.schluessel).toBe(zwei!.schluessel);
		expect(eins!.schluessel).toContain(behoerde.ags);
	});

	it("gibt verschiedenen Schüben verschiedene Schlüssel", () => {
		const alle = kleineWahlen();
		schub.merkeStand(db, termin.id, behoerde.ags, zurueckgedreht([alle[0]], 1));
		const eins = schub.erkenneSchub(db, kreis, termin, behoerde);
		schub.merkeStand(db, termin.id, behoerde.ags, zurueckgedreht([alle[1]], 1));
		const zwei = schub.erkenneSchub(db, kreis, termin, behoerde);

		expect(eins!.schluessel).not.toBe(zwei!.schluessel);
	});

	it("lässt sich ohne Merken befragen", () => {
		// Stufe 4 muss erst wissen, ob jemand zusieht, bevor sie fortschreibt.
		schub.merkeStand(db, termin.id, behoerde.ags, zurueckgedreht(marken(), 1));
		const erste = schub.erkenneSchub(db, kreis, termin, behoerde, {
			merken: false,
		});
		const zweite = schub.erkenneSchub(db, kreis, termin, behoerde, {
			merken: false,
		});
		expect(zweite?.schluessel).toBe(erste?.schluessel);
	});
});
