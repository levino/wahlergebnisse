/**
 * Probe auf die erzeugte Ansage – gegen einen nachgestellten Sprachdienst.
 *
 * Die Fragen, an denen der Wahlabend hängt: Läuft die Seite auch ohne
 * Schlüssel weiter? Kostet ein zweiter Durchlauf desselben Abends noch etwas?
 * Und entsteht wirklich nichts, wenn niemand zusieht?
 *
 * Kein Aufruf geht nach außen: `OPENAI_BASIS` zeigt auf einen eigenen
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
/** Womit der nachgestellte Dienst antwortet – für die Riegel-Proben. */
let antwortStatus = 200;
let antwortRumpf = "";

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
				if (antwortStatus !== 200) {
					res.writeHead(antwortStatus, { "content-type": "application/json" });
					res.end(antwortRumpf || "{}");
					return;
				}
				res.writeHead(200, { "content-type": "audio/mpeg" });
				res.end(KLANG);
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

describe("die Gegenstelle", () => {
	it("steht an genau einer Stelle im Quelltext", async () => {
		// Zwei Adressen hießen: In der Testumgebung wird die eine umgelenkt und
		// die andere vergessen – und das fällt erst auf, wenn eine Rechnung
		// kommt. Stimme und Moderation folgen deshalb beide aus `OPENAI_BASIS`.
		const { readdirSync, readFileSync, statSync } = await import("node:fs");
		const { join } = await import("node:path");
		const gefunden: string[] = [];
		const durchsuche = (dir: string): void => {
			for (const name of readdirSync(dir)) {
				const pfad = join(dir, name);
				if (statSync(pfad).isDirectory()) durchsuche(pfad);
				else if (
					/\.(ts|tsx|astro|mjs)$/.test(name) &&
					readFileSync(pfad, "utf8").includes("api.openai.com")
				)
					gefunden.push(pfad);
			}
		};
		for (const dir of ["src", "server", "e2e", "scripts"]) durchsuche(dir);
		expect(gefunden).toEqual(["src/lib/ansage-datei.ts"]);
	});
});

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
	it("erzeugt nichts für eine ausgeschlossene Wahlleitung", async () => {
		process.env.ANSAGE_BEHOERDEN = NORDSTEMMEN;
		const m = await bereit();
		m.vorproduziere("Ortsratswahl Irgendwo ist fertig ausgezählt.", ANDERE);
		await new Promise((f) => setTimeout(f, 50));
		expect(anfragen).toHaveLength(0);
	});

	it("erzeugt ohne Einschränkung für jede Wahlleitung", async () => {
		process.env.ANSAGE_BEHOERDEN = "";
		const m = await bereit();
		m.vorproduziere("Ortsratswahl Irgendwo ist fertig ausgezählt.", ANDERE);
		await new Promise((f) => setTimeout(f, 80));
		expect(anfragen).toHaveLength(1);
	});

	it("erzeugt für die Wahlleitung, für die der Dienst läuft", async () => {
		process.env.ANSAGE_BEHOERDEN = "";
		const m = await bereit();
		m.vorproduziere("Ortsratswahl Giesen ist fertig ausgezählt.", NORDSTEMMEN);
		await new Promise((f) => setTimeout(f, 80));
		expect(anfragen).toHaveLength(1);
	});
});

describe("Modell und Vorgabestimme", () => {
	it("nimmt ohne Umgebungsangabe die gewählte Stimme und das günstige Modell", async () => {
		// Der Betreiber hat fünf Stimmen im selben Satz gehört und `sage`
		// genommen; das Modell ist das, gegen das er sie gehört hat.
		const { standardStimme, modell, erzeugeAnsage } = await bereit();
		expect(standardStimme()).toBe("sage");
		expect(modell()).toBe("gpt-4o-mini-tts");
		await erzeugeAnsage("Ortsratswahl Emmerke ist fertig ausgezählt.");
		expect(anfragen[0].voice).toBe("sage");
		expect(anfragen[0].model).toBe("gpt-4o-mini-tts");
	});

	it("lässt sich am Server umstellen, ohne neues Abbild", async () => {
		// Über die Anlage im Saal trägt eine Stimme womöglich anders als über
		// Kopfhörer – dann will niemand auf einen Deploy warten.
		process.env.ANSAGE_STIMME = "verse";
		process.env.ANSAGE_MODELL = "gpt-4o-mini-tts-2025-12-15";
		const { standardStimme, modell, erzeugeAnsage } = await bereit();
		expect(standardStimme()).toBe("verse");
		await erzeugeAnsage("Ortsratswahl Sarstedt ist fertig ausgezählt.");
		expect(anfragen[0].voice).toBe("verse");
		expect(anfragen[0].model).toBe("gpt-4o-mini-tts-2025-12-15");
		process.env.ANSAGE_STIMME = "";
		process.env.ANSAGE_MODELL = "";
	});

	it("fällt bei einer unbekannten Stimme auf die gewählte zurück", async () => {
		process.env.ANSAGE_STIMME = "gibtsnicht";
		const { standardStimme } = await bereit();
		expect(standardStimme()).toBe("sage");
		process.env.ANSAGE_STIMME = "";
	});

	it("erzeugt nach einem Modellwechsel neue Aufnahmen statt einer Mischung", async () => {
		// Der Dateiname enthält das Modell. Ohne das klänge nach einem Wechsel
		// die eine Hälfte des Abends anders als die andere.
		const { ansagePfad } = await bereit();
		const satz = "Ortsratswahl Giesen ist fertig ausgezählt.";
		const vorher = ansagePfad(satz, "sage");
		process.env.ANSAGE_MODELL = "gpt-4o-mini-tts-2025-12-15";
		expect(ansagePfad(satz, "sage")).not.toBe(vorher);
		process.env.ANSAGE_MODELL = "";
	});
});

describe("ungültiger Schlüssel", () => {
	it("riegelt nach 401 ab und versucht es kein zweites Mal", async () => {
		// Ein ungültiger Schlüssel repariert sich nicht. Ohne Riegel liefe
		// jede Meldung des Abends in die volle Frist, bevor der Browser
		// einspringt – und protokollierte dabei je Versuch eine Zeile.
		const { erzeugeAnsage, dienstBereit } = await bereit();
		antwortStatus = 401;
		expect(
			await erzeugeAnsage(
				"Ortsratswahl Adensen ist fertig ausgezählt.",
				"sage",
			),
		).toBe(false);
		expect(anfragen).toHaveLength(1);
		expect(dienstBereit()).toBe(false);

		// Der zweite Satz geht gar nicht mehr hinaus – auch nicht, wenn der
		// Dienst inzwischen wieder antworten würde.
		antwortStatus = 200;
		expect(
			await erzeugeAnsage(
				"Ortsratswahl Barnten ist fertig ausgezählt.",
				"sage",
			),
		).toBe(false);
		expect(anfragen).toHaveLength(1);
	});

	it("riegelt auch ab, wenn das Kontingent leer ist", async () => {
		const { erzeugeAnsage, dienstBereit } = await bereit();
		antwortStatus = 429;
		antwortRumpf = JSON.stringify({ error: { code: "insufficient_quota" } });
		await erzeugeAnsage("Ortsratswahl Rössing ist fertig ausgezählt.", "sage");
		expect(dienstBereit()).toBe(false);
	});

	it("riegelt bei einer vorübergehenden Störung nicht ab", async () => {
		// 429 heißt normalerweise „zu schnell", 500 „gerade kaputt". Beides
		// geht vorbei; den Dienst dafür für den Abend abzuschalten wäre eine
		// selbstgemachte Störung.
		const { erzeugeAnsage, dienstBereit } = await bereit();
		antwortStatus = 500;
		await erzeugeAnsage("Ortsratswahl Heyersum ist fertig ausgezählt.", "sage");
		expect(dienstBereit()).toBe(true);
		antwortStatus = 429;
		await erzeugeAnsage(
			"Ortsratswahl Mahlerten ist fertig ausgezählt.",
			"sage",
		);
		expect(dienstBereit()).toBe(true);
	});

	it("liefert weiter aus, was schon auf der Platte liegt", async () => {
		// Der Riegel betrifft das Erzeugen, nicht das Abspielen: Was bezahlt
		// und erzeugt ist, wird auch nach dem Abriegeln noch gesagt.
		const { erzeugeAnsage } = await bereit();
		const satz = "Ortsratswahl Klein Escherde ist fertig ausgezählt.";
		expect(await erzeugeAnsage(satz, "sage")).toBe(true);
		antwortStatus = 401;
		await erzeugeAnsage("Ein anderer Satz, der fertig ausgezählt ist.", "sage");
		expect(await erzeugeAnsage(satz, "sage")).toBe(true);
	});
});

describe("mit Schlüssel", () => {
	it("schickt Text, Stimme und Vortragsanweisung mit", async () => {
		const { erzeugeAnsage, ansagePfad } = await bereit();
		const satz = "Ortsratswahl Rössing ist fertig ausgezählt.";
		expect(await erzeugeAnsage(satz, "sage")).toBe(true);
		expect(readFileSync(ansagePfad(satz, "sage"))).toEqual(KLANG);
		expect(anfragen[0].input).toBe(satz);
		expect(anfragen[0].voice).toBe("sage");
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
		for (const s of abend) await erzeugeAnsage(s, "sage");
		expect(anfragen).toHaveLength(3);
		anfragen = [];
		for (const s of abend) expect(await erzeugeAnsage(s, "sage")).toBe(true);
		expect(anfragen).toHaveLength(0);
	});

	it("hält zwei gleichzeitige Anfragen zu einem Aufruf zusammen", async () => {
		const { erzeugeAnsage } = await bereit();
		verzoegerungMs = 40;
		const satz = "Ortsratswahl Heyersum ist fertig ausgezählt.";
		expect(
			await Promise.all([
				erzeugeAnsage(satz, "sage"),
				erzeugeAnsage(satz, "sage"),
			]),
		).toEqual([true, true]);
		expect(anfragen).toHaveLength(1);
	});

	it("unterscheidet die Stimmen", async () => {
		const { erzeugeAnsage, ansagePfad } = await bereit();
		const satz = "Ortsratswahl Mahlerten ist fertig ausgezählt.";
		await erzeugeAnsage(satz, "sage");
		await erzeugeAnsage(satz, "cedar");
		expect(ansagePfad(satz, "sage")).not.toBe(ansagePfad(satz, "cedar"));
		expect(anfragen).toHaveLength(2);
	});

	it("nimmt keine unbekannte Stimme und keinen Roman", async () => {
		const { erzeugeAnsage } = await bereit();
		expect(await erzeugeAnsage("Ein Satz.", "gibtsnicht")).toBe(false);
		expect(await erzeugeAnsage("x".repeat(500), "sage")).toBe(false);
		expect(anfragen).toHaveLength(0);
	});

	it("gibt auf, wenn der Dienst zu lange braucht", async () => {
		// Wer zu spät kommt, kommt gar nicht – der Browser spricht.
		const { erzeugeAnsage } = await bereit();
		verzoegerungMs = 300;
		expect(
			await erzeugeAnsage(
				"Ortsratswahl Burgstemmen ist fertig ausgezählt.",
				"sage",
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
				"sage",
			);
		expect(anfragen).toHaveLength(3);
		process.env.ANSAGEN_JE_STUNDE = "";
	});

	it("lässt keine halben Dateien liegen", async () => {
		// Zwei Web-Pods teilen sich das Volume: erst daneben schreiben, dann
		// umbenennen.
		const { erzeugeAnsage, ansagenVerzeichnis } = await bereit();
		await erzeugeAnsage("Ortsratswahl Emmerke ist fertig ausgezählt.", "sage");
		expect(
			readdirSync(ansagenVerzeichnis()).filter((n) => n.endsWith(".tmp")),
		).toEqual([]);
	});
});
