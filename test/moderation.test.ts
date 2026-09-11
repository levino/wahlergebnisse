/**
 * Probe auf die Moderation – gegen ein nachgestelltes Textmodell.
 *
 * Die Fragen, an denen der Wahlabend hängt: Bleibt es bei der festen
 * Formulierung, wenn das Modell nicht kann oder Unsinn erzählt? Kostet der
 * zweite Durchlauf der Generalprobe noch etwas? Und geht wirklich nichts
 * hinaus, wenn die Moderation abgestellt ist?
 *
 * Kein Aufruf geht nach außen: `OPENAI_BASIS` zeigt auf einen eigenen
 * HTTP-Server, der mitzählt.
 */
import { type Server, createServer } from "node:http";
import { join } from "node:path";
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import type { Schub } from "../src/lib/moderation.ts";
import { aufraeumen, tempVerzeichnis } from "./helfer.ts";

const FEST = "Gemeinderatswahl Nordstemmen ist fertig ausgezählt.";

let tmp: string;
let dienst: Server;
let anfragen: Array<{
	model: string;
	messages: Array<{ role: string; content: string }>;
}> = [];
let verzoegerungMs = 0;
let antwortStatus = 200;
let antwortRumpf = "";
let satzDesModells = "Da kommen neue Zahlen rein – Nordstemmen ist durch.";
/** Womit der nachgestellte Sprachdienst antwortet – für die Riegel-Probe. */
let stimmStatus = 200;

beforeAll(async () => {
	tmp = tempVerzeichnis("wahlen-moderation-");
	process.env.ANSAGEN_PFAD = join(tmp, "ansagen");
	dienst = createServer((req, res) => {
		let roh = "";
		req.on("data", (s) => {
			roh += s;
		});
		req.on("end", () => {
			if (req.url?.endsWith("/audio/speech")) {
				if (stimmStatus !== 200) {
					res.writeHead(stimmStatus, { "content-type": "application/json" });
					res.end("{}");
					return;
				}
				res.writeHead(200, { "content-type": "audio/mpeg" });
				res.end(Buffer.from("ID3AnsageAttrappe"));
				return;
			}
			anfragen.push(JSON.parse(roh));
			setTimeout(() => {
				if (antwortStatus !== 200) {
					res.writeHead(antwortStatus, { "content-type": "application/json" });
					res.end(antwortRumpf || "{}");
					return;
				}
				res.writeHead(200, { "content-type": "application/json" });
				res.end(
					JSON.stringify({
						choices: [{ message: { content: satzDesModells } }],
					}),
				);
			}, verzoegerungMs);
		});
	});
	await new Promise<void>((f) => dienst.listen(0, "127.0.0.1", f));
	const port = (dienst.address() as { port: number }).port;
	process.env.OPENAI_BASIS = `http://127.0.0.1:${port}/v1`;
});

afterAll(async () => {
	await new Promise<void>((f) => dienst.close(() => f()));
	aufraeumen(tmp);
});

beforeEach(() => {
	anfragen = [];
	verzoegerungMs = 0;
	antwortStatus = 200;
	antwortRumpf = "";
	satzDesModells = "Da kommen neue Zahlen rein – Nordstemmen ist durch.";
	stimmStatus = 200;
	process.env.ANSAGE_MODERATION = "";
});

/** Frisch laden, damit Bremse und Riegel je Fall neu gelten. */
const modul = async () => {
	vi.resetModules();
	process.env.OPENAI_API_KEY = "sk-test-attrappe";
	return await import("../src/lib/ansage-datei.ts");
};

const schub = (ort = "Nordstemmen", fest = FEST): Schub => ({
	behoerde: "03254026",
	termin: "2026-09-13",
	partei: "CDU",
	fest,
	wahlen: [
		{
			wahl: "Gemeinderatswahl",
			ort,
			zuschnitt: "eigen",
			anz: 23,
			max: 23,
			datenstand: "Endergebnis",
			parteien: [
				{ kurz: "CDU", prozent: 34.2, diff: 2.1, sitze: 11 },
				{ kurz: "SPD", prozent: 30.8, diff: -1.4, sitze: 10 },
			],
			wahlbeteiligung: 61.2,
			wahlbeteiligungVorher: 58.9,
			vorher: {
				ort,
				wahl: "Gemeinderatswahl",
				anz: 22,
				max: 23,
				art: "hochrechnung",
				spitze: "CDU",
				parteien: [{ key: "cdu", platz: 1, prozent: 34.0, sitze: 11 }],
			},
			beitraege: [],
			meldungen: [fest],
		},
	],
});

describe("mit Textmodell", () => {
	it("lässt den ganzen Schub formulieren und nimmt das günstigste Modell", async () => {
		const { formuliere } = await modul();
		expect((await formuliere(schub())).satz).toBe(satzDesModells);
		expect(anfragen).toHaveLength(1);
		expect(anfragen[0].model).toBe("gpt-4o-mini");
		// Die Anweisung trägt die Rolle; ohne sie liest das Modell eine
		// Anzeigetafel vor.
		expect(anfragen[0].messages[0].role).toBe("system");
		expect(anfragen[0].messages[1].content).toContain(
			"Vorher auf der Leinwand",
		);
		expect(anfragen[0].messages[1].content).toContain("34,2 Prozent");
	});

	it("sagt in jeder Antwort, woher der Satz kommt", async () => {
		// Die Spur im Protokoll hängt daran: Modell, Zwischenspeicher oder
		// fest – und im letzten Fall warum. Ohne das war der ganze Weg stumm.
		const { formuliere } = await modul();
		expect(await formuliere(schub("Betheln"))).toMatchObject({
			quelle: "modell",
		});
		expect(await formuliere(schub("Betheln"))).toMatchObject({
			quelle: "zwischenspeicher",
		});
	});

	it("spielt den zweiten Durchlauf desselben Abends ohne einen Aufruf", async () => {
		// Die Generalprobe wiederholt denselben Abend. Der Zwischenspeicher
		// liegt über dem Schub und nicht über der Uhrzeit – dieselbe Regel wie
		// beim Ton.
		const { formuliere } = await modul();
		const abend = ["Adensen", "Barnten", "Rössing"];
		for (const o of abend) await formuliere(schub(o));
		expect(anfragen).toHaveLength(3);
		anfragen = [];
		for (const o of abend)
			expect((await formuliere(schub(o))).satz).toBe(satzDesModells);
		expect(anfragen).toHaveLength(0);
	});

	it("hält zwei gleichzeitige Anfragen zu einem Aufruf zusammen", async () => {
		const { formuliere } = await modul();
		verzoegerungMs = 40;
		const beide = await Promise.all([
			formuliere(schub("Heyersum")),
			formuliere(schub("Heyersum")),
		]);
		expect(beide.map((b) => b.satz)).toEqual([satzDesModells, satzDesModells]);
		expect(anfragen).toHaveLength(1);
	});
});

describe("wenn die Antwort nicht taugt", () => {
	it("verwirft eine Zahl, die im Kontext nicht steht", async () => {
		// Der wichtigste Riegel des ganzen Moduls: Was über die Anlage im Saal
		// gesagt wird, muss in den Zahlen stehen.
		const { formuliere } = await modul();
		satzDesModells = "Die CDU kommt auf 47 Prozent und holt 19 Sitze.";
		const raus = await formuliere(schub("Mahlerten"));
		expect(raus.satz).toBe(FEST);
		// Und es steht dabei, warum – mitsamt der Regel, die gegriffen hat.
		expect(raus.quelle).toBe("fest");
		expect(raus.grund).toContain("Zahlen ohne Deckung: 47");
	});

	it("verwirft einen Absatz", async () => {
		const { formuliere } = await modul();
		satzDesModells =
			"Neue Zahlen sind da. Nordstemmen ist durch. Die CDU liegt vorn.";
		expect((await formuliere(schub("Burgstemmen"))).satz).toBe(FEST);
	});

	it("merkt sich nur, was den Test bestanden hat", async () => {
		// Eine verworfene Antwort darf nicht im Zwischenspeicher landen – sonst
		// bliebe der Abend an einem einzigen Ausrutscher hängen.
		const { formuliere } = await modul();
		satzDesModells = "Die CDU kommt auf 47 Prozent.";
		expect((await formuliere(schub("Emmerke"))).satz).toBe(FEST);
		satzDesModells = "Emmerke ist durch.";
		expect((await formuliere(schub("Emmerke"))).satz).toBe(
			"Emmerke ist durch.",
		);
	});
});

describe("wenn das Textmodell ausfällt", () => {
	it("spricht die feste Formulierung, wenn der Dienst stört", async () => {
		const { formuliere } = await modul();
		antwortStatus = 500;
		expect((await formuliere(schub("Giesen"))).satz).toBe(FEST);
	});

	it("spricht die feste Formulierung, wenn es zu lange dauert", async () => {
		const { formuliere } = await modul();
		verzoegerungMs = 300;
		const raus = await formuliere(schub("Klein Escherde"), 50);
		expect(raus.satz).toBe(FEST);
		expect(raus.grund).toBe("Zeitüberschreitung nach 50 ms");
	});

	it("riegelt nach 401 ab und versucht es kein zweites Mal", async () => {
		const { formuliere, dienstBereit } = await modul();
		antwortStatus = 401;
		expect((await formuliere(schub("Hasede"))).satz).toBe(FEST);
		expect(dienstBereit("moderation")).toBe(false);
		antwortStatus = 200;
		expect((await formuliere(schub("Himmelsthür"))).satz).toBe(FEST);
		expect(anfragen).toHaveLength(1);
	});

	it("lässt die Moderation laufen, wenn nur das Sprachmodell abgewiesen wird", async () => {
		// Der Befund von der Generalprobe: Ein Projektschlüssel darf
		// Textmodelle und keine Sprachmodelle. Der abgewiesene Sprachaufruf
		// fällt beim Rendern der Leinwand zuerst an – und legte, solange beide
		// hinter demselben Riegel lagen, die Moderation gleich mit still.
		const { formuliere, erzeugeAnsage, dienstBereit } = await modul();
		stimmStatus = 403;
		expect(
			await erzeugeAnsage("Ortsratswahl Rössing ist fertig ausgezählt."),
		).toBe(false);
		expect(dienstBereit("stimme")).toBe(false);
		expect(dienstBereit("moderation")).toBe(true);
		expect((await formuliere(schub("Hüddessum"))).satz).toBe(satzDesModells);
		expect(anfragen).toHaveLength(1);
	});

	it("erzeugt ohne Schlüssel gar nichts", async () => {
		vi.resetModules();
		process.env.OPENAI_API_KEY = "";
		const { formuliere } = await import("../src/lib/ansage-datei.ts");
		expect((await formuliere(schub("Sarstedt"))).satz).toBe(FEST);
		expect(anfragen).toHaveLength(0);
	});

	it("bremst, bevor eine Rechnung daraus wird – und sagt es", async () => {
		process.env.MODERATIONEN_JE_STUNDE = "2";
		const { formuliere } = await modul();
		const raus = [];
		for (const o of ["A", "B", "C", "D"]) raus.push(await formuliere(schub(o)));
		expect(anfragen).toHaveLength(2);
		expect(raus[3].grund).toContain("Bremse");
		process.env.MODERATIONEN_JE_STUNDE = "";
	});
});

describe("abgestellt", () => {
	it("ruft gar nicht erst an, wenn die Moderation aus ist", async () => {
		// Der Schalter am Server, ohne neues Abbild: Am Wahlabend will niemand
		// auf einen Deploy warten.
		process.env.ANSAGE_MODERATION = "0";
		const { formuliere } = await modul();
		expect((await formuliere(schub("Schliekum"))).satz).toBe(FEST);
		expect(anfragen).toHaveLength(0);
	});
});
