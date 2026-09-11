import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { type Server, createServer } from "node:http";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	AUFNAHMEN_PFAD,
	type Aufnahme,
	MODERATION_PFAD,
	PLATZHALTER_SCHLUESSEL,
	STIMME_PFAD,
	aufnahmeSchluessel,
	kernAus,
} from "../e2e/aufnahmen.ts";
import { type MockOpenai, starteMockOpenai } from "../e2e/mock-openai.ts";
import { aufraeumen, tempVerzeichnis } from "./helfer.ts";

const GEHEIM = "sk-proj-GEHEIMER-TESTSCHLUESSEL-4711";

const SATZ = "Da kommen gerade neue Ergebnisse rein – Rössing hat ausgezählt.";

const MODERATION_RUMPF = {
	model: "gpt-4o-mini",
	messages: [
		{ role: "system", content: "Du hast am Wahlabend das Mikrofon." },
		{ role: "user", content: "Ortsratswahl Rössing: fertig ausgezählt." },
	],
};

const STIMM_RUMPF = {
	model: "gpt-4o-mini-tts",
	voice: "sage",
	input: SATZ,
	instructions: "Sprache: Deutsch.",
	response_format: "mp3",
};

const schicke = (
	mock: MockOpenai,
	pfad: string,
	rumpf: unknown,
	kopf?: string,
): Promise<Response> =>
	fetch(`${mock.url}/v1${pfad}`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			...(kopf === undefined ? {} : { authorization: kopf }),
		},
		body: JSON.stringify(rumpf),
	});

describe("Wiedergabe ohne Schlüssel", () => {
	let tmp: string;
	let mock: MockOpenai;

	beforeAll(async () => {
		tmp = tempVerzeichnis("wahlen-aufnahmen-");
		const moderation: Aufnahme = {
			...kernAus(MODERATION_PFAD, MODERATION_RUMPF)!,
			schluessel: "",
			herkunft: "Probe",
			antwort: { choices: [{ message: { content: SATZ } }] },
		};
		moderation.schluessel = aufnahmeSchluessel(moderation);
		const stimme: Aufnahme = {
			...kernAus(STIMME_PFAD, STIMM_RUMPF)!,
			schluessel: "",
			herkunft: "Probe",
			datei: "ton.mp3",
		};
		stimme.schluessel = aufnahmeSchluessel(stimme);
		writeFileSync(join(tmp, "ton.mp3"), Buffer.from("ID3Probe"));
		for (const a of [moderation, stimme])
			writeFileSync(join(tmp, `${a.schluessel}.json`), JSON.stringify(a));
		mock = await starteMockOpenai({ verzeichnis: tmp });
	});

	afterAll(async () => {
		await mock.schliessen();
		aufraeumen(tmp);
	});

	it.each([
		["Platzhalter des E2E-Laufs", `Bearer ${PLATZHALTER_SCHLUESSEL}`],
		["schlichtes sk-test", "Bearer sk-test"],
		["gar kein Kopf", undefined],
		["leerer Kopf", ""],
		["Unsinn", "Basic wer-auch-immer"],
	])("moderiert – %s", async (_was, kopf) => {
		const antwort = await schicke(
			mock,
			MODERATION_PFAD,
			MODERATION_RUMPF,
			kopf,
		);
		expect(antwort.status).toBe(200);
		const daten = (await antwort.json()) as {
			choices: Array<{ message: { content: string } }>;
		};
		expect(daten.choices[0].message.content).toBe(SATZ);
	});

	it("liefert die Stimme auch ohne jeden Schlüssel", async () => {
		const antwort = await schicke(mock, STIMME_PFAD, STIMM_RUMPF);
		expect(antwort.status).toBe(200);
		expect(antwort.headers.get("content-type")).toBe("audio/mpeg");
		expect(Buffer.from(await antwort.arrayBuffer()).toString()).toBe(
			"ID3Probe",
		);
	});

	it("scheitert am Inhalt und nicht am Schlüssel", async () => {
		const antwort = await schicke(
			mock,
			MODERATION_PFAD,
			{
				...MODERATION_RUMPF,
				messages: [
					MODERATION_RUMPF.messages[0],
					{ role: "user", content: "Eine Wahl, von der niemand weiß." },
				],
			},
			`Bearer ${PLATZHALTER_SCHLUESSEL}`,
		);
		expect(antwort.status).toBe(502);
		expect(mock.unbekannte.join("\n")).toContain("AUFNAHME FEHLT");
	});
});

describe("Der Schlüssel des Mitschnitts bleibt nirgends hängen", () => {
	let tmp: string;
	let echte: Server;
	const gesehen: Array<{ pfad: string; kopf: string }> = [];
	let geschrieben = "";

	beforeAll(async () => {
		tmp = tempVerzeichnis("wahlen-mitschnitt-");
		echte = createServer((req, res) => {
			gesehen.push({
				pfad: req.url ?? "",
				kopf: req.headers.authorization ?? "",
			});
			req.resume();
			req.on("end", () => {
				if (req.url?.endsWith(STIMME_PFAD)) {
					res.writeHead(200, { "content-type": "audio/mpeg" });
					res.end(Buffer.from("ID3EchterTon"));
					return;
				}
				res.writeHead(200, { "content-type": "application/json" });
				res.end(
					JSON.stringify({
						id: "chatcmpl-probe",
						model: "gpt-4o-mini",
						choices: [{ message: { role: "assistant", content: SATZ } }],
					}),
				);
			});
		});
		await new Promise<void>((f) => echte.listen(0, "127.0.0.1", f));
		const port = (echte.address() as { port: number }).port;

		const schreibe = console.log;
		const meckere = console.error;
		const sammle =
			(weiter: typeof console.log) =>
			(...teile: unknown[]) => {
				geschrieben += `${teile.join(" ")}\n`;
				weiter(...teile);
			};
		console.log = sammle(schreibe);
		console.error = sammle(meckere);
		try {
			const mock = await starteMockOpenai({
				verzeichnis: tmp,
				aufzeichnen: {
					basis: `http://127.0.0.1:${port}/v1`,
					schluessel: GEHEIM,
				},
			});
			await schicke(mock, MODERATION_PFAD, MODERATION_RUMPF, "Bearer sk-test");
			await schicke(mock, STIMME_PFAD, STIMM_RUMPF, "Bearer sk-test");
			await mock.schliessen();
		} finally {
			console.log = schreibe;
			console.error = meckere;
		}
	});

	afterAll(async () => {
		await new Promise<void>((f) => echte.close(() => f()));
		aufraeumen(tmp);
	});

	it("reicht ihn an die echte Gegenstelle weiter – und nur dorthin", () => {
		expect(gesehen.map((g) => g.kopf)).toEqual([
			`Bearer ${GEHEIM}`,
			`Bearer ${GEHEIM}`,
		]);
	});

	it("fragt bei ihr die richtige Adresse, ohne doppeltes /v1", () => {
		expect(gesehen.map((g) => g.pfad)).toEqual([
			`/v1${MODERATION_PFAD}`,
			`/v1${STIMME_PFAD}`,
		]);
	});

	it("legt Aufnahmen an, in denen er nicht steht", () => {
		const dateien = readdirSync(tmp);
		expect(dateien.filter((n) => n.endsWith(".json"))).toHaveLength(2);
		expect(dateien.filter((n) => n.endsWith(".mp3"))).toHaveLength(1);
		for (const name of dateien) {
			const roh = readFileSync(join(tmp, name));
			expect(roh.includes(GEHEIM), `${name} nennt den Schlüssel`).toBe(false);
			expect(
				roh.toString("latin1").toLowerCase().includes("authorization"),
				`${name} nennt den authorization-Kopf`,
			).toBe(false);
		}
	});

	it("schreibt ihn in keine Protokollzeile", () => {
		expect(geschrieben).toContain("aufgezeichnet:");
		expect(geschrieben).not.toContain(GEHEIM);
	});
});

describe("Die eingecheckten Aufnahmen", () => {
	const SCHLUESSELMUSTER = /sk-[A-Za-z0-9_-]{12,}/;

	it("tragen keinen Zugangsschlüssel", () => {
		const dateien = readdirSync(AUFNAHMEN_PFAD);
		expect(dateien.length).toBeGreaterThan(0);
		for (const name of dateien) {
			const text = readFileSync(join(AUFNAHMEN_PFAD, name)).toString("latin1");
			expect(SCHLUESSELMUSTER.test(text), `${name} nennt einen Schlüssel`).toBe(
				false,
			);
			expect(text.toLowerCase()).not.toContain("authorization");
		}
	});

	it("sagen in „herkunft“, woher sie stammen", () => {
		for (const name of readdirSync(AUFNAHMEN_PFAD)) {
			if (!name.endsWith(".json")) continue;
			const a = JSON.parse(
				readFileSync(join(AUFNAHMEN_PFAD, name), "utf8"),
			) as Aufnahme;
			expect(a.herkunft.length, `${name} ohne Herkunft`).toBeGreaterThan(10);
		}
	});
});
