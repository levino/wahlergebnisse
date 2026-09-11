import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import nock from "nock";
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { ANSAGE_HOECHSTLAENGE } from "../src/lib/ansage.ts";
import { aufraeumen, tempVerzeichnis } from "./helfer.ts";

const KLANG = Buffer.from("ID3AnsageAttrappe");
/** Nordstemmen – die Wahlleitung, für die der Dienst läuft. */
const NORDSTEMMEN = "03254026";
const ANDERE = "03254021";
const GEGENSTELLE = "https://api.openai.com";

let tmp: string;
let anfragen: { input: string; voice: string; model: string }[] = [];
let verzoegerungMs = 0;
/** Womit die nachgestellte Gegenstelle antwortet – für die Riegel-Proben. */
let antwortStatus = 200;
let antwortRumpf = "";

beforeAll(() => {
	tmp = tempVerzeichnis("wahlen-ansage-");
	process.env.ANSAGEN_PFAD = join(tmp, "ansagen");
	delete process.env.OPENAI_BASIS;
	nock.disableNetConnect();
});

afterAll(() => {
	nock.cleanAll();
	nock.enableNetConnect();
	aufraeumen(tmp);
});

beforeEach(() => {
	anfragen = [];
	verzoegerungMs = 0;
	antwortStatus = 200;
	antwortRumpf = "";
	nock.cleanAll();
	nock(GEGENSTELLE)
		.persist()
		.post("/v1/audio/speech")
		.reply(async (_pfad, rumpf) => {
			anfragen.push(rumpf as (typeof anfragen)[number]);
			if (verzoegerungMs)
				await new Promise((f) => setTimeout(f, verzoegerungMs));
			if (antwortStatus !== 200) return [antwortStatus, antwortRumpf || "{}"];
			return [200, KLANG, { "content-type": "audio/mpeg" }];
		});
});

afterEach(() => nock.cleanAll());

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
		const { standardStimme, modell, erzeugeAnsage } = await bereit();
		expect(standardStimme()).toBe("sage");
		expect(modell()).toBe("gpt-4o-mini-tts");
		await erzeugeAnsage("Ortsratswahl Emmerke ist fertig ausgezählt.");
		expect(anfragen[0].voice).toBe("sage");
		expect(anfragen[0].model).toBe("gpt-4o-mini-tts");
	});

	it("lässt sich am Server umstellen, ohne neues Abbild", async () => {
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
		expect(anfragen[0]).toHaveProperty("instructions");
	});

	it("spielt den zweiten Durchlauf desselben Abends ohne einen Aufruf", async () => {
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

	it("bezahlt für drei Zuschauer derselben Leinwand eine Aufnahme", async () => {
		const { erzeugeAnsage } = await bereit();
		verzoegerungMs = 40;
		const satz = "Ortsratswahl Heyersum ist fertig ausgezählt.";
		expect(
			await Promise.all([
				erzeugeAnsage(satz),
				erzeugeAnsage(satz),
				erzeugeAnsage(satz),
			]),
		).toEqual([true, true, true]);
		expect(anfragen).toHaveLength(1);
	});

	it("fragt für alle mit derselben Stimme, ohne dass jemand wählt", async () => {
		const { erzeugeAnsage } = await bereit();
		const satz = "Ortsratswahl Adensen liegt jetzt vollstaendig vor.";
		await erzeugeAnsage(satz);
		expect(anfragen.map((a) => a.voice)).toEqual(["sage"]);
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
		expect(
			await erzeugeAnsage("x".repeat(ANSAGE_HOECHSTLAENGE + 1), "sage"),
		).toBe(false);
		expect(anfragen).toHaveLength(0);
	});

	it("nimmt einen ganzen moderierten Absatz auf", async () => {
		const { erzeugeAnsage } = await bereit();
		const absatz =
			"Und bei der Bürgermeisterwahl bleibt es spannend. Gerald Ludewig setzt sich an die Spitze des Feldes. Aber noch ist alles offen, es sind erst dreißig Prozent der Wahlbezirke ausgezählt. Bleiben Sie dran.";
		expect(absatz.length).toBeGreaterThan(200);
		expect(await erzeugeAnsage(absatz, "sage")).toBe(true);
		expect(anfragen).toHaveLength(1);
	});

	it("gibt auf, wenn der Dienst zu lange braucht", async () => {
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
		const { erzeugeAnsage, ansagenVerzeichnis } = await bereit();
		await erzeugeAnsage("Ortsratswahl Emmerke ist fertig ausgezählt.", "sage");
		expect(
			readdirSync(ansagenVerzeichnis()).filter((n) => n.endsWith(".tmp")),
		).toEqual([]);
	});
});
