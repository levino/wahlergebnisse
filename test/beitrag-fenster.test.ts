import { readFileSync } from "node:fs";
import { join } from "node:path";
import { brotliDecompressSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MODERATION_ANWEISUNG } from "../src/lib/moderation.ts";
import { FIXTURES, aufraeumen, tempVerzeichnis } from "./helfer.ts";
import { KASSETTEN_PFAD } from "./kassette.ts";
import {
	type MockVotemanager,
	starteMockVotemanager,
} from "./mock-votemanager.ts";

process.env.WAHLEN_DEMO = "1";

const PROBE = "2021";
const GEMEINDE = "03254026";
const KREIS = "03254000";

const FENSTER = 60_000;

describe("das Ansagefenster am nachgespielten Abend", () => {
	let tmp: string;
	let mock: MockVotemanager;
	let db: import("../src/lib/db.ts").Db;
	let kreis: import("../src/data/kreise.ts").Kreis;
	let termin: import("../src/data/termine.ts").Termin;
	let gemeinde: import("../src/data/behoerden.ts").Behoerde;
	let gespielt: Array<{
		behoerde: import("../src/data/behoerden.ts").Behoerde;
		wahlen: import("../src/lib/demo-abend.ts").DemoWahl[];
	}>;
	let schub: typeof import("../src/lib/schub.ts");
	let meldungen: typeof import("../src/lib/meldungen.ts");
	let demoAbend: typeof import("../src/lib/demo-abend.ts");
	let zyklusVon: typeof import("../src/lib/demo.ts").zyklusVon;

	type Stand = Map<string, import("../src/lib/meldungen.ts").FolienStand>;

	const BEGINN = Date.UTC(2026, 8, 13, 16, 0, 0);
	const T0 = Date.UTC(2026, 8, 13, 18, 0, 0);

	const spiele = (fortschritt: number): void => {
		const zyklus = { ...zyklusVon(BEGINN, 3600, BEGINN), fortschritt };
		for (const g of gespielt)
			demoAbend.spieleStand(db, termin, g.behoerde, g.wahlen, zyklus);
	};

	const stand = (): Stand =>
		schub.staendeAus(schub.modellFuer(kreis, termin, gemeinde));

	const getaktet = (jetzt: number) =>
		schub.erkenneSchuebeGetaktet(db, kreis, termin, gemeinde, [""], {
			jetzt,
			ms: FENSTER,
		});

	/** Was die drei Schnellmeldungen einzeln gemeldet hätten. */
	const schritte: Array<{
		stand: Stand;
		einzeln: import("../src/lib/meldungen.ts").Meldung[];
		wartet: boolean;
		schuebe: number;
	}> = [];
	let erste: import("../src/lib/schub.ts").GetakteteSchuebe;
	let grundstand: Stand;
	let zusammen: import("../src/lib/schub.ts").GetakteteSchuebe;
	let letzterStand: Stand;

	beforeAll(async () => {
		tmp = tempVerzeichnis("beitrag-fenster-");
		mock = await starteMockVotemanager(FIXTURES);
		process.env.VOTEMANAGER_BASIS = mock.url;
		process.env.DATABASE_PATH = join(tmp, "wahlen.db");
		const { oeffneDb } = await import("../src/lib/db.ts");
		const { pollTermin } = await import("../src/lib/poll.ts");
		const { terminById } = await import("../src/data/termine.ts");
		const { kreisBySlug } = await import("../src/data/kreise.ts");
		db = oeffneDb();
		termin = terminById(PROBE)!;
		await pollTermin(db, termin, { nurBehoerden: [GEMEINDE, KREIS] });
		demoAbend = await import("../src/lib/demo-abend.ts");
		demoAbend.bereiteProbeVor(db, termin);
		({ zyklusVon } = await import("../src/lib/demo.ts"));
		schub = await import("../src/lib/schub.ts");
		meldungen = await import("../src/lib/meldungen.ts");
		kreis = kreisBySlug("hildesheim")!;
		gemeinde = kreis.behoerden.find((b) => b.ags === GEMEINDE)!;
		gespielt = [gemeinde, kreis.behoerden.find((b) => b.ags === KREIS)!].map(
			(behoerde) => ({
				behoerde,
				wahlen: demoAbend.baueVorlage(db, kreis, termin, behoerde),
			}),
		);

		spiele(0.3);
		schub.erkenneSchuebe(db, kreis, termin, gemeinde, [""]);

		spiele(0.4);
		erste = getaktet(T0);
		grundstand = stand();

		let vorher = grundstand;
		for (const [i, fortschritt] of [0.45, 0.5, 0.55].entries()) {
			spiele(fortschritt);
			const jetzt = stand();
			const g = getaktet(T0 + (i + 1) * 15_000);
			schritte.push({
				stand: jetzt,
				einzeln: meldungen.alleMeldungen(vorher, jetzt),
				wartet: g.wartet,
				schuebe: g.schuebe.length,
			});
			vorher = jetzt;
		}

		zusammen = getaktet(T0 + FENSTER);
		letzterStand = stand();
	}, 180_000);

	afterAll(async () => {
		const { schliesseDb } = await import("../src/lib/db.ts");
		schliesseDb();
		await mock.schliessen();
		aufraeumen(tmp);
	});

	it("schneidet den ersten Beitrag, sobald das Fenster offen ist", () => {
		expect(erste.wartet).toBe(false);
		expect(erste.schuebe.length).toBe(1);
	});

	it("spielt drei Schnellmeldungen ein, die einzeln je einen Beitrag ergäben", () => {
		expect(schritte.length).toBe(3);
		for (const s of schritte) expect(s.einzeln.length).toBeGreaterThan(0);
	});

	it("schweigt, solange das Fenster läuft", () => {
		for (const s of schritte) {
			expect(s.wartet).toBe(true);
			expect(s.schuebe).toBe(0);
		}
	});

	it("macht aus den drei Schnellmeldungen einen einzigen Beitrag", () => {
		expect(zusammen.wartet).toBe(false);
		expect(zusammen.schuebe.length).toBe(1);
	});

	it("trägt jede Wahl, die einzeln gemeldet worden wäre", () => {
		const erwartet = new Set(
			schritte.flatMap((s) => s.einzeln.map((m) => m.marke)),
		);
		expect(erwartet.size).toBeGreaterThan(1);
		const getragen = new Set(zusammen.schuebe[0].meldungen.map((m) => m.marke));
		for (const marke of erwartet) expect([...getragen]).toContain(marke);
	});

	it("verschluckt kein fertig ausgezähltes Gebiet und keine Hochrechnung", () => {
		const wichtig = (liste: readonly { marke: string; art: string }[]) =>
			liste
				.filter((m) => m.art !== "stand")
				.map((m) => `${m.marke}|${m.art}`)
				.sort();
		const erwartet = new Set(wichtig(schritte.flatMap((s) => s.einzeln)));
		const getragen = wichtig(zusammen.schuebe[0].meldungen);
		for (const eintrag of erwartet) expect(getragen).toContain(eintrag);
	});

	it("nennt die Zahlen des jüngsten Standes, nicht die der ersten Meldung", () => {
		const mitZahl = zusammen.schuebe[0].meldungen.filter(
			(m) => m.anz !== undefined,
		);
		expect(mitZahl.length).toBeGreaterThan(0);
		for (const m of mitZahl) {
			expect(m.anz).toBe(letzterStand.get(m.marke)?.anz);
			expect(m.max).toBe(letzterStand.get(m.marke)?.max);
		}
	});

	it("vergleicht gegen den Stand des letzten Beitrags, nicht gegen den vorigen Takt", () => {
		expect(zusammen.schuebe[0].vorher).toEqual(grundstand);
	});

	it("lässt nach Ablauf des Fensters wieder einen entstehen", () => {
		spiele(0.6);
		expect(getaktet(T0 + FENSTER + 15_000).wartet).toBe(true);
		const naechster = getaktet(T0 + 2 * FENSTER);
		expect(naechster.wartet).toBe(false);
		expect(naechster.schuebe.length).toBe(1);
	});
});

describe("die Länge des Fensters", () => {
	const dauerSekunden = (mp3: Buffer): number => {
		const LSF = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
		const MPEG1 = [
			0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320,
		];
		const RATEN: Record<number, number[]> = {
			3: [44100, 48000, 32000],
			2: [22050, 24000, 16000],
			0: [11025, 12000, 8000],
		};
		let i = 0;
		let sekunden = 0;
		while (i + 4 <= mp3.length) {
			if (mp3[i] !== 0xff || (mp3[i + 1] & 0xe0) !== 0xe0) {
				i++;
				continue;
			}
			const fassung = (mp3[i + 1] >> 3) & 3;
			const lage = (mp3[i + 1] >> 1) & 3;
			const rate = (mp3[i + 2] >> 4) & 15;
			const abtastung = (mp3[i + 2] >> 2) & 3;
			const fuellung = (mp3[i + 2] >> 1) & 1;
			const raten = RATEN[fassung];
			if (
				lage !== 1 ||
				rate === 0 ||
				rate === 15 ||
				abtastung === 3 ||
				!raten
			) {
				i++;
				continue;
			}
			const hertz = raten[abtastung];
			const halb = fassung !== 3;
			const bits = (halb ? LSF[rate] : MPEG1[rate]) * 1000;
			const proBild = halb ? 576 : 1152;
			const laenge = Math.floor(((proBild / 8) * bits) / hertz) + fuellung;
			if (laenge < 4) {
				i++;
				continue;
			}
			sekunden += proBild / hertz;
			i += laenge;
		}
		return sekunden;
	};

	const aufnahme = () => {
		const kassette = JSON.parse(
			readFileSync(join(KASSETTEN_PFAD, "schub-roessing.json"), "utf8"),
		) as Array<{ path: string; response: string | string[] }>;
		const text = kassette.find((e) => e.path.endsWith("/chat/completions"))!;
		const ton = kassette.find((e) => e.path.endsWith("/audio/speech"))!;
		const antwort = JSON.parse(
			brotliDecompressSync(
				Buffer.from((text.response as string[])[0], "hex"),
			).toString("utf8"),
		) as { choices: Array<{ message: { content: string } }> };
		return {
			satz: antwort.choices[0].message.content,
			sekunden: dauerSekunden(Buffer.from(ton.response as string, "hex")),
		};
	};

	it("deckt die längste Ansage ab, die die Anweisung zulässt", async () => {
		const { ANSAGE_FENSTER_S } = await import("../src/lib/schub.ts");
		const { satz, sekunden } = aufnahme();
		const woerter = satz.trim().split(/\s+/).length;
		expect(sekunden).toBeGreaterThan(10);
		const deckel = Number(
			/Höchstens (\d+) Wörter/.exec(MODERATION_ANWEISUNG)?.[1],
		);
		expect(deckel).toBeGreaterThan(0);
		const laengste = (sekunden / woerter) * deckel;
		expect(ANSAGE_FENSTER_S).toBeGreaterThanOrEqual(laengste);
		expect(ANSAGE_FENSTER_S).toBeLessThan(laengste * 1.5);
	});

	it("bleibt bei sechzig Sekunden, wenn nichts eingestellt ist", async () => {
		const { ANSAGE_FENSTER_S, ansageFensterMs } = await import(
			"../src/lib/schub.ts"
		);
		delete process.env.ANSAGE_FENSTER_SEKUNDEN;
		expect(ansageFensterMs()).toBe(ANSAGE_FENSTER_S * 1000);
	});

	it("lässt sich am Abend über die Umgebung verstellen", async () => {
		const { ANSAGE_FENSTER_S, ansageFensterMs } = await import(
			"../src/lib/schub.ts"
		);
		process.env.ANSAGE_FENSTER_SEKUNDEN = "45";
		expect(ansageFensterMs()).toBe(45_000);
		process.env.ANSAGE_FENSTER_SEKUNDEN = "kaputt";
		expect(ansageFensterMs()).toBe(ANSAGE_FENSTER_S * 1000);
		delete process.env.ANSAGE_FENSTER_SEKUNDEN;
	});
});
