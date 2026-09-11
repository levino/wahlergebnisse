import { type Server, createServer } from "node:http";
import { join } from "node:path";
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
const NORDSTEMMEN = "03254026";

let tmp: string;
let gegenstelle: Server;
let anfragen = 0;
let verzoegerungMs = 0;

beforeAll(async () => {
	tmp = tempVerzeichnis("wahlen-ansage-endpunkt-");
	process.env.ANSAGEN_PFAD = join(tmp, "ansagen");
	gegenstelle = createServer((req, res) => {
		req.on("data", () => {});
		req.on("end", () => {
			anfragen++;
			setTimeout(() => {
				res.writeHead(200, { "content-type": "audio/mpeg" });
				res.end(KLANG);
			}, verzoegerungMs);
		});
	});
	await new Promise<void>((f) => gegenstelle.listen(0, "127.0.0.1", f));
	const port = (gegenstelle.address() as { port: number }).port;
	process.env.OPENAI_BASIS = `http://127.0.0.1:${port}/v1`;
});

afterAll(async () => {
	await new Promise<void>((f) => gegenstelle.close(() => f()));
	aufraeumen(tmp);
});

beforeEach(() => {
	anfragen = 0;
	verzoegerungMs = 0;
	process.env.OPENAI_API_KEY = "sk-test-attrappe";
	delete process.env.ANSAGE_WARTE_MS;
	delete process.env.ANSAGE_BEHOERDEN;
});

/** Der Endpunkt hinter einem echten Server – frisch je Fall. */
const starte = async (): Promise<{
	hole: (
		text: string,
		behoerde?: string,
	) => Promise<{
		status: number;
		rumpf: Record<string, unknown>;
		bytes: number;
	}>;
	schliessen: () => Promise<void>;
}> => {
	vi.resetModules();
	const { handhabeAnsage } = await import("../server/ansage.ts");
	const server = createServer((req, res) => {
		const url = new URL(req.url ?? "/", "http://localhost");
		if (!handhabeAnsage(req, res, url)) res.writeHead(404).end();
	});
	await new Promise<void>((f) => server.listen(0, "127.0.0.1", f));
	const port = (server.address() as { port: number }).port;
	return {
		hole: async (text, behoerde = NORDSTEMMEN) => {
			const antwort = await fetch(
				`http://127.0.0.1:${port}/api/ansage?stimme=sage&behoerde=${behoerde}&text=${encodeURIComponent(text)}`,
			);
			const roh = Buffer.from(await antwort.arrayBuffer());
			const istJson = (antwort.headers.get("content-type") ?? "").includes(
				"json",
			);
			return {
				status: antwort.status,
				rumpf: istJson ? JSON.parse(roh.toString("utf8")) : {},
				bytes: roh.length,
			};
		},
		schliessen: () => new Promise<void>((f) => server.close(() => f())),
	};
};

let offen: { schliessen: () => Promise<void> } | undefined;
afterEach(async () => {
	await offen?.schliessen();
	offen = undefined;
});

describe("der Ansage-Endpunkt", () => {
	it("liefert eine Aufnahme aus, die rechtzeitig fertig wird", async () => {
		const dienst = await starte();
		offen = dienst;
		const raus = await dienst.hole("Rat Nordstemmen ist fertig ausgezählt.");
		expect(raus.status).toBe(200);
		expect(raus.bytes).toBe(KLANG.length);
		expect(anfragen).toBe(1);
	});

	it("bricht die Aufnahme nicht ab, wenn der Browser aufgibt", async () => {
		const dienst = await starte();
		offen = dienst;
		process.env.ANSAGE_WARTE_MS = "60";
		verzoegerungMs = 400;
		const satz = "Ein Satz, für den der Sprachdienst länger braucht.";

		const erste = await dienst.hole(satz);
		expect(erste.status).toBe(503);
		expect(erste.rumpf).toMatchObject({ dienst: true });
		expect(String(erste.rumpf.fehler)).toContain("nicht binnen");

		await expect
			.poll(async () => (await dienst.hole(satz)).status, { timeout: 5000 })
			.toBe(200);
		expect((await dienst.hole(satz)).bytes).toBe(KLANG.length);
		expect(anfragen).toBe(1);
	});

	it("nennt eine abgelaufene Frist nicht einen fehlenden Dienst", async () => {
		const dienst = await starte();
		offen = dienst;
		process.env.ANSAGE_WARTE_MS = "60";
		verzoegerungMs = 400;
		const raus = await dienst.hole("Noch ein langsamer Satz.");
		expect(raus.rumpf.dienst).toBe(true);
	});

	it("meldet eine Wahlleitung ohne Ansagedienst als fehlenden Dienst", async () => {
		process.env.ANSAGE_BEHOERDEN = NORDSTEMMEN;
		const dienst = await starte();
		offen = dienst;
		const raus = await dienst.hole("Kreistag Hildesheim.", "03254021");
		expect(raus.status).toBe(503);
		expect(raus.rumpf.dienst).toBe(false);
		expect(anfragen).toBe(0);
	});

	it("nimmt einen ganzen moderierten Absatz an", async () => {
		const dienst = await starte();
		offen = dienst;
		const absatz =
			"Und bei der Bürgermeisterwahl bleibt es spannend. Gerald Ludewig setzt sich an die Spitze des Feldes. Aber noch ist alles offen, es sind erst dreißig Prozent der Wahlbezirke ausgezählt. Bleiben Sie dran, der Abend fängt gerade erst an.";
		expect(absatz.length).toBeGreaterThan(200);
		const raus = await dienst.hole(absatz);
		expect(raus.status).toBe(200);
		expect(anfragen).toBe(1);
	});

	it("spricht auch einen ungewöhnlich langen Absatz", async () => {
		// Der Deckel ist gegen Missbrauch da, nicht gegen einen redseligen
		// Moderator. Was das Modell schickt, wird gesprochen.
		const dienst = await starte();
		offen = dienst;
		const raus = await dienst.hole("Rössing ist durch. ".repeat(40).trim());
		expect(raus.status).toBe(200);
		expect(anfragen).toBe(1);
	});

	it("weist einen Text ab, der über den Missbrauchsdeckel geht", async () => {
		const dienst = await starte();
		offen = dienst;
		const raus = await dienst.hole("x".repeat(ANSAGE_HOECHSTLAENGE + 1));
		expect(raus.status).toBe(400);
		expect(anfragen).toBe(0);
	});
});
