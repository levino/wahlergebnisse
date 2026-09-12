import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Kreis, kreisBySlug } from "../src/data/kreise.ts";
import { terminById } from "../src/data/termine.ts";
import { hatGemeldet, parseSeite, zuErgebnis } from "../src/lib/ivu.ts";
import { aufraeumen, tempVerzeichnis } from "./helfer.ts";
import { type Kassette, legeEin } from "./kassette.ts";

const UELZEN = kreisBySlug("uelzen") as Kreis;
const TERMIN = terminById("2026");
/** Die zweite Adresse des Katalogs ist die Landratswahl. */
const LANDRAT = (UELZEN.ivu?.[0]?.wahlen ?? [])[1];
/** Dieselbe Präsentation, gefüllt: derselbe Aufbau, echte Zahlen. */
const ARCHIV = "https://wahlen.landkreis-uelzen.de/kw2021/kt/";

const hole = async (url: string): Promise<string> => {
	const res = await fetch(url, { headers: { "User-Agent": "test" } });
	if (!res.ok) throw new Error(`${res.status} für ${url}`);
	return res.text();
};

describe("Uelzen 2021: dieselben Seiten mit echten Zahlen", () => {
	let kassette: Kassette;
	beforeAll(async () => {
		kassette = await legeEin("ivu-uelzen-2021", { openai: false });
	});
	afterAll(() => kassette.fertig());

	it("liest die Stimmen des Kreises in voller Genauigkeit", async () => {
		const seite = parseSeite(await hole(`${ARCHIV}ergebnisse.html`));
		expect(seite.wahl).toBe("Kreistagswahl 2021");
		expect(seite.gebiet).toBe("Landkreis Uelzen");
		expect(seite.status).toBe("Endergebnis");
		expect(hatGemeldet(seite)).toBe(true);
		const cdu = seite.parteien.find((p) => p.kurz === "CDU");
		expect(cdu?.stimmen).toBe(48114);
		expect(cdu?.prozent).toBeCloseTo(35.5757002159, 6);
		expect(cdu?.lang).toBe(
			"Christlich Demokratische Union Deutschlands in Niedersachsen",
		);
		expect(cdu?.farbe).toBe("#000000");
		expect(seite.kennzahlen).toEqual({
			wahlberechtigte: 78150,
			waehler: 46885,
			wahlbeteiligung: 59.9936020473,
			ungueltig: 661,
			stimmen: 135244,
			gueltig: 135244,
		});
	});

	it("zählt die Sitze aus der Liste der Gewählten", async () => {
		const seite = parseSeite(await hole(`${ARCHIV}ergebnisse.html`));
		const ergebnis = zuErgebnis(seite, {
			zeitstempel: "2026-09-12T12:00:00.000Z",
			untergebieteTitel: "Wahlbereiche",
		});
		expect(ergebnis.sitze?.gesamt).toBe(seite.gewaehlte.length);
		expect(ergebnis.sitze?.gewaehlte[0]).toEqual({
			partei: "CDU",
			name: "Hillmer, Jörg",
			mandat: "",
			stimmen: 3267,
		});
		const summe = ergebnis.sitze?.verteilung.reduce((s, v) => s + v.sitze, 0);
		expect(summe).toBe(ergebnis.sitze?.gesamt);
		expect(
			ergebnis.sitze?.verteilung.find((v) => v.key === "cdu")?.sitze,
		).toBeGreaterThan(0);
		expect(ergebnis.untergebiete[0]?.gebiete.map((g) => g.id)).toEqual([
			"ebene_5_id_1",
			"ebene_5_id_2",
			"ebene_5_id_3",
		]);
	});

	it("führt die Bewerber einer Gemeinde mit Listenplatz, aber ohne Stimmen", async () => {
		const seite = parseSeite(
			await hole(`${ARCHIV}ergebnisse_gemeinde_03360004.html`),
		);
		expect(seite.gebiet).toBe("03360004 - Gemeinde Bienenbüttel");
		expect(seite.kennzahlen.waehler).toBe(3980);
		const ergebnis = zuErgebnis(seite, {
			zeitstempel: "2026-09-12T12:00:00.000Z",
			untergebieteTitel: "Wahlbezirke",
		});
		expect(ergebnis.gebietKurz).toBe("Gemeinde Bienenbüttel");
		const cdu = ergebnis.parteien.find((p) => p.key === "cdu");
		expect(cdu?.stimmen).toBe(4211);
		expect(cdu?.kandidaten?.[0]).toEqual({
			name: "Dr. Graf, Günther",
			platz: 1,
		});
		expect(cdu?.kandidaten?.every((k) => k.stimmen === undefined)).toBe(true);
		expect(ergebnis.untergebiete[0]?.gebiete).toHaveLength(18);
	});
});

describe("Uelzen 2026: die Landratswahl vor dem ersten Eingang", () => {
	let kassette: Kassette;
	let tmp: string;
	let db: ReturnType<typeof import("../src/lib/db.ts").oeffneDb>;
	let ersterLauf: { anfragen: number; geaendert: number; fehler: string[] };
	let zweiterLauf: { anfragen: number; geaendert: number; fehler: string[] };
	/** Derselbe Kreis, aber nur die eine Wahl – die Aufnahme bleibt lesbar. */
	const nurLandrat: Kreis = {
		...UELZEN,
		ivu: [{ termin: "2026", wahlen: [LANDRAT] }],
	};

	beforeAll(async () => {
		kassette = await legeEin("ivu-uelzen-landrat", { openai: false });
		tmp = tempVerzeichnis("ivu-");
		process.env.DATABASE_PATH = join(tmp, "wahlen.db");
		const { oeffneDb } = await import("../src/lib/db.ts");
		const { pollIvuKreis } = await import("../src/lib/poll.ts");
		db = oeffneDb();
		ersterLauf = { anfragen: 0, geaendert: 0, fehler: [] };
		await pollIvuKreis(db, TERMIN, nurLandrat, ersterLauf, {});
		// nock kann einer fetch-Anfrage kein 304 zurückgeben. Ohne gemerktes
		// ETag fragt der zweite Lauf unbedingt nach und bekommt dieselben
		// Bytes – geprüft wird ohnehin, dass er dabei bleibt.
		db.prepare("UPDATE dateien SET etag = NULL").run();
		zweiterLauf = { anfragen: 0, geaendert: 0, fehler: [] };
		await pollIvuKreis(db, TERMIN, nurLandrat, zweiterLauf, {});
	}, 120_000);

	afterAll(async () => {
		const { schliesseDb } = await import("../src/lib/db.ts");
		schliesseDb();
		kassette.fertig();
		aufraeumen(tmp);
	});

	const zeile = (gebietId: string) =>
		db
			.prepare(
				"SELECT leer, stand_anz, stand_max, titel, json FROM ergebnisse WHERE behoerde = '03360000' AND wahl_id = 1 AND gebiet_id = ?",
			)
			.get(gebietId) as
			| {
					leer: number;
					stand_anz: number;
					stand_max: number;
					titel: string;
					json: string;
			  }
			| undefined;

	it("holt jedes Gebiet des Index und legt es unter der Kreisbehörde ab", () => {
		expect(ersterLauf.fehler).toEqual([]);
		const n = db
			.prepare("SELECT count(*) n FROM ergebnisse WHERE behoerde = '03360000'")
			.get() as { n: number };
		expect(n.n).toBe(212);
		const eintrag = db
			.prepare(
				"SELECT wahl_id, slug, typ, gebiet_id, titel FROM wahleintraege WHERE behoerde = '03360000'",
			)
			.all();
		expect(eintrag).toEqual([
			{
				wahl_id: 1,
				slug: "landrat",
				typ: "landrat",
				gebiet_id: "ebene_1_id_0360",
				titel: "Landratswahl 2026",
			},
		]);
	});

	it("führt „Kein Eingang“ als leer, nicht als Null-Ergebnis", () => {
		const kreis = zeile("ebene_1_id_0360");
		expect(kreis?.leer).toBe(1);
		const ergebnis = JSON.parse(kreis?.json ?? "{}");
		expect(ergebnis.parteien).toEqual([]);
		expect(ergebnis.kennzahlen).toEqual({});
		expect(ergebnis.stand.status).toBe("Kein Eingang");
		expect(ergebnis.personenwahl).toBe(true);
	});

	it("leitet den Auszählstand aus den Wahlbezirken der Quelle ab", () => {
		const kreis = zeile("ebene_1_id_0360");
		expect(kreis?.stand_anz).toBe(0);
		const blaetter = db
			.prepare(
				"SELECT count(*) n FROM ergebnisse WHERE behoerde = '03360000' AND ebene = 6",
			)
			.get() as { n: number };
		expect(kreis?.stand_max).toBe(blaetter.n);
		const gemeinde = zeile("ebene_3_id_03360004");
		expect(gemeinde?.titel).toBe("Gemeinde Bienenbüttel");
		expect(gemeinde?.stand_max).toBe(18);
		const bezirk = zeile("ebene_6_id_03360004302");
		expect(bezirk?.stand_max).toBe(1);
		expect(bezirk?.stand_anz).toBe(0);
	});

	it("fragt im zweiten Lauf nur noch die Kreisseite nach", () => {
		expect(zweiterLauf.anfragen).toBe(1);
		expect(zweiterLauf.geaendert).toBe(0);
		expect(zweiterLauf.fehler).toEqual([]);
	});
});
