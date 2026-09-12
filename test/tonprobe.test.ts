import { type Server, createServer } from "node:http";
import { join } from "node:path";
import nock from "nock";
import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { uebernimmEnvDatei } from "../scripts/umgebung.ts";
import { TONPROBE_SATZ } from "../src/lib/ansage.ts";
import {
	ansageDa,
	erzeugeAnsage,
	standardStimme,
} from "../src/lib/ansage-datei.ts";
import { TONPROBE_PFAD } from "../src/lib/beitrag-abruf.ts";
import type { Db } from "../src/lib/db.ts";
import { handhabeBeitrag } from "../server/beitrag.ts";
import { aufraeumen, tempVerzeichnis } from "./helfer.ts";
import { legeEin, nimmtAuf } from "./kassette.ts";

const STIMME_URL = "/v1/audio/speech";

let tmp: string;
let ansagen: string;
let db: Db;
let server: Server;
let port: number;
let frisch = 0;

const eigenesVerzeichnis = (): string => {
	const pfad = join(tmp, `leer-${++frisch}`);
	process.env.ANSAGEN_PFAD = pfad;
	return pfad;
};

beforeAll(async () => {
	tmp = tempVerzeichnis("wahlen-tonprobe-");
	ansagen = join(tmp, "ansagen");
	if (nimmtAuf()) uebernimmEnvDatei();
	else process.env.OPENAI_API_KEY = "sk-abspielen-ohne-schluessel";
	delete process.env.OPENAI_BASIS;
	process.env.ANSAGEN_PFAD = ansagen;
	process.env.DATABASE_PATH = join(tmp, "wahlen.db");
	delete process.env.WAHLEN_ROLLE;

	const kassette = await legeEin("tonprobe");
	expect(await erzeugeAnsage(TONPROBE_SATZ)).toBe(true);
	kassette.fertig();
	nock.enableNetConnect();

	const { oeffneDb } = await import("../src/lib/db.ts");
	db = oeffneDb();
	server = createServer((req, res) => {
		const url = new URL(req.url ?? "/", "http://localhost");
		if (!handhabeBeitrag(db, req, res, url)) res.writeHead(404).end();
	});
	await new Promise<void>((f) => server.listen(0, "127.0.0.1", f));
	port = (server.address() as { port: number }).port;
});

afterAll(async () => {
	await new Promise<void>((f) => server.close(() => f()));
	const { schliesseDb } = await import("../src/lib/db.ts");
	schliesseDb();
	aufraeumen(tmp);
});

afterEach(() => {
	process.env.ANSAGEN_PFAD = ansagen;
	nock.cleanAll();
	nock.enableNetConnect();
	vi.unstubAllGlobals();
});

class Lautsprecher {
	static letzte: Lautsprecher | undefined;
	static verweigert = false;
	src: string;
	horcher = new Map<string, (() => void)[]>();
	angehalten = false;
	constructor(src: string) {
		this.src = src;
		Lautsprecher.letzte = this;
	}
	addEventListener(art: string, fn: () => void) {
		this.horcher.set(art, [...(this.horcher.get(art) ?? []), fn]);
	}
	pause() {
		this.angehalten = true;
	}
	async play() {
		if (Lautsprecher.verweigert)
			throw Object.assign(new Error("play() failed because the user didn't"), {
				name: "NotAllowedError",
			});
	}
}

type Haken = { url: string; grund: string; meldung?: string };

const echterAbruf = globalThis.fetch;

/** Der Probeknopf, wie ihn der Browser drückt – gegen den echten Endpunkt. */
const druecke = async (): Promise<Haken> => {
	Lautsprecher.letzte = undefined;
	vi.stubGlobal("window", {});
	vi.stubGlobal("Audio", Lautsprecher);
	vi.stubGlobal("fetch", (ziel: string, opts?: RequestInit) =>
		echterAbruf(new URL(ziel, `http://127.0.0.1:${port}`), opts),
	);
	Object.assign(URL, {
		createObjectURL: (b: Blob) => `blob:${b.size}`,
		revokeObjectURL: () => {},
	});

	vi.resetModules();
	const m = await import("../src/lib/stimme.ts");
	let haken: Haken | undefined;
	m.wennAnsageSpur((h) => {
		haken = h;
	});
	m.sprichProbe();
	await vi.waitFor(() => expect(haken).toBeDefined());
	return haken as Haken;
};

describe("der Probeknopf", () => {
	it("spricht, bevor ein einziger Beitrag eingegangen ist", async () => {
		Lautsprecher.verweigert = false;
		const haken = await druecke();
		expect(haken.grund).toBe("gespielt");
		expect(haken.url).toBe(TONPROBE_PFAD);
		expect(Number(Lautsprecher.letzte?.src.split(":")[1])).toBeGreaterThan(
			1000,
		);
	});

	it("meldet ein abgelehntes Abspielen als Fehlschlag", async () => {
		Lautsprecher.verweigert = true;
		const haken = await druecke();
		expect(haken.grund).not.toBe("gespielt");
		expect(haken.grund).toBe("gesperrt");
		expect(haken.meldung).toContain("klicken");
		Lautsprecher.verweigert = false;
	});

	it("meldet einen Fehlschlag, wenn keine Tonprobe hinterlegt ist", async () => {
		eigenesVerzeichnis();
		Lautsprecher.verweigert = false;
		const haken = await druecke();
		expect(haken.grund).toBe("keine-aufnahme");
		expect(haken.meldung).toContain("503");
	});
});

describe("die Aufnahme der Tonprobe", () => {
	it("kostet genau eine bezahlte Anfrage, egal wie oft gedrückt wird", async () => {
		eigenesVerzeichnis();
		const kassette = await legeEin("tonprobe");
		try {
			expect(await erzeugeAnsage(TONPROBE_SATZ)).toBe(true);
			const gleichzeitig = await Promise.all([
				erzeugeAnsage(TONPROBE_SATZ),
				erzeugeAnsage(TONPROBE_SATZ),
				erzeugeAnsage(TONPROBE_SATZ),
			]);
			expect(gleichzeitig).toEqual([true, true, true]);
			expect(kassette.gesendet.get(STIMME_URL)).toHaveLength(1);
			expect(kassette.rumpf(STIMME_URL).input).toBe(TONPROBE_SATZ);
			expect(ansageDa(TONPROBE_SATZ, standardStimme())).toBe(true);
		} finally {
			kassette.fertig();
		}
	});

	it("liegt beim Abruf schon da – der Endpunkt erzeugt nichts", async () => {
		eigenesVerzeichnis();
		nock.disableNetConnect();
		nock.enableNetConnect("127.0.0.1");
		const antwort = await echterAbruf(
			`http://127.0.0.1:${port}${TONPROBE_PFAD}`,
		);
		expect(antwort.status).toBe(503);
	});

	it("kommt als Audiodatei, die der Browser nicht zwischenspeichert", async () => {
		const antwort = await echterAbruf(
			`http://127.0.0.1:${port}${TONPROBE_PFAD}`,
		);
		expect(antwort.status).toBe(200);
		expect(antwort.headers.get("content-type")).toBe("audio/mpeg");
		expect(antwort.headers.get("cache-control")).toBe("no-store");
		expect((await antwort.arrayBuffer()).byteLength).toBeGreaterThan(1000);
	});
});

describe("der Satz der Tonprobe", () => {
	it("sagt, dass die Sprachausgabe läuft, und nennt kein Ergebnis", () => {
		expect(TONPROBE_SATZ).toMatch(/Sprachausgabe/i);
		expect(TONPROBE_SATZ).toMatch(/funktioniert/i);
		expect(TONPROBE_SATZ).not.toMatch(/\d/);
		expect(TONPROBE_SATZ.length).toBeLessThan(120);
	});
});
