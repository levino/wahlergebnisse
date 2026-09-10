/**
 * Probe auf die erzeugte Ansage – gegen einen nachgestellten Sprachdienst.
 *
 * Die Fragen, an denen der Wahlabend hängt: Läuft die Seite auch ohne
 * Schlüssel weiter? Kostet ein zweiter Durchlauf desselben Abends noch etwas?
 * Und entsteht wirklich nichts, wenn niemand zusieht?
 *
 * Kein Aufruf geht nach außen: `OPENAI_BASE_URL` zeigt auf einen eigenen
 * HTTP-Server, der mitzählt.
 */
import { readFileSync, readdirSync } from "node:fs";
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
import { aufraeumen, tempVerzeichnis } from "./helfer.ts";

const KLANG = Buffer.from("ID3AnsageAttrappe");
/** Nordstemmen – die Wahlleitung, für die der Dienst läuft. */
const NORDSTEMMEN = "03254026";
const ANDERE = "03254021";

let tmp: string;
let dienst: Server;
let anfragen: { input: string; voice: string; model: string }[] = [];
let verzoegerungMs = 0;

beforeAll(async () => {
	tmp = tempVerzeichnis("wahlen-ansage-");
	process.env.ANSAGEN_PFAD = join(tmp, "ansagen");
	dienst = createServer((req, res) => {
		let roh = "";
		req.on("data", (s) => {
			roh += s;
		});
		req.on("end", () => {
			anfragen.push(JSON.parse(roh));
			setTimeout(() => {
				res.writeHead(200, { "content-type": "audio/mpeg" });
				res.end(KLANG);
			}, verzoegerungMs);
		});
	});
	await new Promise<void>((f) => dienst.listen(0, "127.0.0.1", f));
	const port = (dienst.address() as { port: number }).port;
	process.env.OPENAI_BASE_URL = `http://127.0.0.1:${port}/v1/audio/speech`;
});

afterAll(async () => {
	await new Promise<void>((f) => dienst.close(() => f()));
	aufraeumen(tmp);
});

beforeEach(() => {
	anfragen = [];
	verzoegerungMs = 0;
});

/** Frisch laden, damit Bremse und Zuschauerprüfung je Fall neu gelten. */
const modul = async () => {
	vi.resetModules();
	return await import("../src/lib/ansage-datei.ts");
};

const bereit = async () => {
	process.env.OPENAI_API_KEY = "sk-test-attrappe";
	return await modul();
};

describe("ohne Schlüssel", () => {
	it("erzeugt nichts und stört nichts", async () => {
		// Der Fall, wenn das Geheimnis nicht ausgerollt wurde: Es muss
		// weiterlaufen, nur eben mit Browserstimme.
		process.env.OPENAI_API_KEY = "";
		const { dienstBereit, erzeugeAnsage, vorproduziere } = await modul();
		expect(dienstBereit()).toBe(false);
		expect(
			await erzeugeAnsage("Ortsratswahl Rössing ist fertig ausgezählt."),
		).toBe(false);
		expect(() => vorproduziere("Irgendein Satz.", NORDSTEMMEN)).not.toThrow();
		expect(anfragen).toHaveLength(0);
	});
});

describe("für wen erzeugt wird", () => {
	it("erzeugt nichts für eine fremde Wahlleitung", async () => {
		const m = await bereit();
		m.vorproduziere("Ortsratswahl Irgendwo ist fertig ausgezählt.", ANDERE);
		await new Promise((f) => setTimeout(f, 50));
		expect(anfragen).toHaveLength(0);
	});

	it("erzeugt für die Wahlleitung, für die der Dienst läuft", async () => {
		const m = await bereit();
		m.vorproduziere("Ortsratswahl Giesen ist fertig ausgezählt.", NORDSTEMMEN);
		await new Promise((f) => setTimeout(f, 80));
		expect(anfragen).toHaveLength(1);
	});
});

describe("mit Schlüssel", () => {
	it("schickt Text, Stimme und Vortragsanweisung mit", async () => {
		const { erzeugeAnsage, ansagePfad } = await bereit();
		const satz = "Ortsratswahl Rössing ist fertig ausgezählt.";
		expect(await erzeugeAnsage(satz, "marin")).toBe(true);
		expect(readFileSync(ansagePfad(satz, "marin"))).toEqual(KLANG);
		expect(anfragen[0].input).toBe(satz);
		expect(anfragen[0].voice).toBe("marin");
		// Ohne Anweisung liest das Modell bloß vor – daran hängt der Unterschied.
		expect(anfragen[0]).toHaveProperty("instructions");
	});

	it("spielt den zweiten Durchlauf desselben Abends ohne einen Aufruf", async () => {
		// Die Generalprobe wiederholt alle zehn Minuten denselben Abend. Ohne
		// Zwischenspeicher wäre das ein Dauerauftrag; mit ist der zweite
		// Durchlauf umsonst.
		const { erzeugeAnsage } = await bereit();
		const abend = [
			"Ortsratswahl Adensen ist fertig ausgezählt.",
			"Ortsratswahl Barnten ist fertig ausgezählt.",
			"Gemeinderatswahl Nordstemmen ist fertig ausgezählt.",
		];
		for (const s of abend) await erzeugeAnsage(s, "marin");
		expect(anfragen).toHaveLength(3);
		anfragen = [];
		for (const s of abend) expect(await erzeugeAnsage(s, "marin")).toBe(true);
		expect(anfragen).toHaveLength(0);
	});

	it("hält zwei gleichzeitige Anfragen zu einem Aufruf zusammen", async () => {
		const { erzeugeAnsage } = await bereit();
		verzoegerungMs = 40;
		const satz = "Ortsratswahl Heyersum ist fertig ausgezählt.";
		expect(
			await Promise.all([
				erzeugeAnsage(satz, "marin"),
				erzeugeAnsage(satz, "marin"),
			]),
		).toEqual([true, true]);
		expect(anfragen).toHaveLength(1);
	});

	it("unterscheidet die Stimmen", async () => {
		const { erzeugeAnsage, ansagePfad } = await bereit();
		const satz = "Ortsratswahl Mahlerten ist fertig ausgezählt.";
		await erzeugeAnsage(satz, "marin");
		await erzeugeAnsage(satz, "cedar");
		expect(ansagePfad(satz, "marin")).not.toBe(ansagePfad(satz, "cedar"));
		expect(anfragen).toHaveLength(2);
	});

	it("nimmt keine unbekannte Stimme und keinen Roman", async () => {
		const { erzeugeAnsage } = await bereit();
		expect(await erzeugeAnsage("Ein Satz.", "gibtsnicht")).toBe(false);
		expect(await erzeugeAnsage("x".repeat(500), "marin")).toBe(false);
		expect(anfragen).toHaveLength(0);
	});

	it("gibt auf, wenn der Dienst zu lange braucht", async () => {
		// Wer zu spät kommt, kommt gar nicht – der Browser spricht.
		const { erzeugeAnsage } = await bereit();
		verzoegerungMs = 300;
		expect(
			await erzeugeAnsage(
				"Ortsratswahl Burgstemmen ist fertig ausgezählt.",
				"marin",
				50,
			),
		).toBe(false);
	});

	it("bremst, bevor eine Rechnung daraus wird", async () => {
		process.env.ANSAGEN_JE_STUNDE = "3";
		const { erzeugeAnsage } = await bereit();
		for (let i = 0; i < 6; i++)
			await erzeugeAnsage(
				`Ortsratswahl Nummer ${i} ist fertig ausgezählt.`,
				"marin",
			);
		expect(anfragen).toHaveLength(3);
		process.env.ANSAGEN_JE_STUNDE = "";
	});

	it("lässt keine halben Dateien liegen", async () => {
		// Zwei Web-Pods teilen sich das Volume: erst daneben schreiben, dann
		// umbenennen.
		const { erzeugeAnsage, ansagenVerzeichnis } = await bereit();
		await erzeugeAnsage("Ortsratswahl Emmerke ist fertig ausgezählt.", "marin");
		expect(
			readdirSync(ansagenVerzeichnis()).filter((n) => n.endsWith(".tmp")),
		).toEqual([]);
	});

	it("lässt den Satzbau fest, solange kein Textmodell erlaubt ist", async () => {
		// Die Moderation („Ah, da kommen neue Zahlen …") braucht einen
		// erweiterten Schlüssel. Bis dahin ist dies die Naht, nicht die Naht­stelle.
		const { formuliere } = await bereit();
		const satz = "Ortsratswahl Rössing ist fertig ausgezählt.";
		expect(formuliere(satz)).toBe(satz);
		process.env.ANSAGE_MODERATION = "1";
		expect(formuliere(satz)).toBe(satz);
		process.env.ANSAGE_MODERATION = "";
	});
});
