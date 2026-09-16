import { join } from "node:path";
import nock from "nock";
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	expect,
	it,
	vi,
} from "vitest";
import type { Schub } from "../src/lib/moderation.ts";
import { aufraeumen, tempVerzeichnis } from "./helfer.ts";

const GEGENSTELLE = "https://api.openai.com";
const FEST = "Gemeinderatswahl Nordstemmen ist fertig ausgezählt.";

let tmp: string;
let anfragen: string[] = [];

beforeAll(() => {
	tmp = tempVerzeichnis("wahlen-schalter-");
	process.env.ANSAGEN_PFAD = join(tmp, "ansagen");
	delete process.env.OPENAI_BASIS;
	nock.disableNetConnect();
});

afterAll(() => {
	nock.cleanAll();
	nock.enableNetConnect();
	aufraeumen(tmp);
	delete process.env.WAHLABEND;
});

beforeEach(() => {
	anfragen = [];
	nock.cleanAll();
	nock(GEGENSTELLE)
		.persist()
		.post(/.*/)
		.reply((pfad) => {
			anfragen.push(pfad);
			return [200, "{}"];
		});
});

afterEach(() => nock.cleanAll());

const schub = (): Schub => ({
	behoerde: "03254026",
	termin: "2026",
	fest: FEST,
	eingaenge: [],
	unveraendert: [],
	wahlen: [],
});

const modul = async (wahlabend: string) => {
	vi.resetModules();
	process.env.WAHLABEND = wahlabend;
	process.env.OPENAI_API_KEY = "sk-test-attrappe";
	return await import("../src/lib/ansage-datei.ts");
};

it("telefoniert nicht, wenn die Wahlabend-Schicht aus ist – auch mit Schlüssel", async () => {
	const { dienstBereit, erzeugeAnsage, formuliere } = await modul("0");
	expect(dienstBereit()).toBe(false);
	expect(dienstBereit("moderation")).toBe(false);
	expect(
		await erzeugeAnsage("Ortsratswahl Rössing ist fertig ausgezählt."),
	).toBe(false);
	expect((await formuliere(schub())).satz).toBe(FEST);
	expect(anfragen).toEqual([]);
});

it("telefoniert wieder, sobald die Schicht läuft", async () => {
	const { dienstBereit, erzeugeAnsage } = await modul("1");
	expect(dienstBereit()).toBe(true);
	await erzeugeAnsage("Ortsratswahl Rössing ist fertig ausgezählt.");
	expect(anfragen).toEqual(["/v1/audio/speech"]);
});
