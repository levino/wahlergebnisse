import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
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
} from "vitest";
import type { Db } from "../src/lib/db.ts";
import { type PaketToast, legePaketAn } from "../src/lib/pakete.ts";
import { aufraeumen, tempVerzeichnis } from "./helfer.ts";

const KLANG = Buffer.from("ID3AufnahmeAttrappe");
const TERMIN = "2026";
const NORDSTEMMEN = "hildesheim/03254026";
const KREIS = "hildesheim/03254000";
const DATEI = "a1b2c3d4e5f6.mp3";

/** Der Satz, den die Stimme spricht – er darf in keiner Antwort auftauchen. */
const GESPROCHEN =
	"In Rössing sind die Ergebnisse da, der Ortsrat steht fest. Im Gemeinderat liegt jetzt die CDU vorn.";

let tmp: string;
let ansagen: string;
let db: Db;
let server: Server;
let port: number;
/** Zählt jeden Aufruf an die Gegenstelle – er muss bei null bleiben. */
let gegenstelle: Server;
let anfragen = 0;

const toast = (t: Partial<PaketToast> = {}): PaketToast => ({
	marke: "ortsrat-roessing",
	ort: "Rössing",
	wahl: "Ortsratswahl",
	art: "fertig",
	text: "Wahlbezirk 03 - Grundschule ausgezählt – 3 von 3",
	...t,
});

const lege = (
	topic: string,
	schluessel: string,
	extra: { aufnahme?: string; toasts?: PaketToast[] } = {},
) =>
	legePaketAn(db, {
		termin: TERMIN,
		topic,
		schluessel,
		toasts: extra.toasts ?? [toast()],
		...(extra.aufnahme === undefined ? {} : { aufnahme: extra.aufnahme }),
	});

const hole = async (
	pfad: string,
	methode = "GET",
): Promise<{
	status: number;
	kopf: Record<string, string>;
	text: string;
	bytes: number;
}> => {
	const antwort = await fetch(`http://127.0.0.1:${port}${pfad}`, {
		method: methode,
	});
	const roh = Buffer.from(await antwort.arrayBuffer());
	return {
		status: antwort.status,
		kopf: Object.fromEntries(antwort.headers.entries()),
		text: roh.toString("utf8"),
		bytes: roh.length,
	};
};

const json = async (pfad: string) => JSON.parse((await hole(pfad)).text);

const listeUrl = (topic: string, seit = 0) => {
	const [kreis, behoerde] = topic.split("/");
	return `/api/pakete?termin=${TERMIN}&kreis=${kreis}&behoerde=${behoerde}&seit=${seit}`;
};

beforeAll(async () => {
	tmp = tempVerzeichnis("paket-endpunkt-");
	ansagen = join(tmp, "ansagen");
	mkdirSync(ansagen, { recursive: true });
	writeFileSync(join(ansagen, DATEI), KLANG);
	process.env.ANSAGEN_PFAD = ansagen;
	process.env.DATABASE_PATH = join(tmp, "wahlen.db");
	delete process.env.WAHLEN_ROLLE;

	gegenstelle = createServer((_req, res) => {
		anfragen++;
		res.writeHead(200, { "content-type": "audio/mpeg" });
		res.end(KLANG);
	});
	await new Promise<void>((f) => gegenstelle.listen(0, "127.0.0.1", f));
	const gPort = (gegenstelle.address() as { port: number }).port;
	process.env.OPENAI_BASIS = `http://127.0.0.1:${gPort}/v1`;
	process.env.OPENAI_API_KEY = "sk-test-attrappe";

	const { oeffneDb } = await import("../src/lib/db.ts");
	db = oeffneDb();
	const { handhabePaket } = await import("../server/paket.ts");
	server = createServer((req, res) => {
		const url = new URL(req.url ?? "/", "http://localhost");
		if (!handhabePaket(db, req, res, url)) res.writeHead(404).end();
	});
	await new Promise<void>((f) => server.listen(0, "127.0.0.1", f));
	port = (server.address() as { port: number }).port;
});

afterAll(async () => {
	await new Promise<void>((f) => server.close(() => f()));
	await new Promise<void>((f) => gegenstelle.close(() => f()));
	const { schliesseDb } = await import("../src/lib/db.ts");
	schliesseDb();
	aufraeumen(tmp);
});

beforeEach(() => {
	anfragen = 0;
});

afterEach(() => {
	db.exec("DELETE FROM pakete");
});

describe("ein einzelnes Paket", () => {
	it("liefert die Toasts und die Adresse der Aufnahme", async () => {
		const p = lege(NORDSTEMMEN, "s1", { aufnahme: DATEI });
		const raus = await json(`/api/paket/${p.id}`);
		expect(raus).toMatchObject({
			id: p.id,
			aufnahme: `/api/paket/${p.id}.mp3`,
		});
		expect(raus.toasts).toHaveLength(1);
		expect(raus.toasts[0].text).toContain("Grundschule");
	});

	it("gibt den gesprochenen Satz nirgends heraus", async () => {
		const p = lege(NORDSTEMMEN, "s1", { aufnahme: DATEI });
		const roh = (await hole(`/api/paket/${p.id}`)).text;
		expect(roh).not.toContain(GESPROCHEN);
		expect(roh).not.toContain("satz");
		// Auch der Dateiname bleibt drin: Er ist der Hash des Satzes.
		expect(roh).not.toContain(DATEI);
	});

	it("lässt die Aufnahme weg, wenn zum Paket keine entstand", async () => {
		const p = lege(NORDSTEMMEN, "ohne");
		expect(await json(`/api/paket/${p.id}`)).not.toHaveProperty("aufnahme");
		expect((await hole(`/api/paket/${p.id}.mp3`)).status).toBe(404);
	});
});

describe("die Aufnahme", () => {
	it("kommt mit den Kopfzeilen einer unveränderlichen Datei", async () => {
		const p = lege(NORDSTEMMEN, "s1", { aufnahme: DATEI });
		const raus = await hole(`/api/paket/${p.id}.mp3`);
		expect(raus.status).toBe(200);
		expect(raus.bytes).toBe(KLANG.length);
		expect(raus.kopf["content-type"]).toBe("audio/mpeg");
		expect(raus.kopf["content-length"]).toBe(String(KLANG.length));
		expect(raus.kopf["cache-control"]).toContain("immutable");
	});

	it("liefert auf HEAD keinen Rumpf, aber die Länge", async () => {
		const p = lege(NORDSTEMMEN, "s1", { aufnahme: DATEI });
		const raus = await hole(`/api/paket/${p.id}.mp3`, "HEAD");
		expect(raus.status).toBe(200);
		expect(raus.bytes).toBe(0);
		expect(raus.kopf["content-length"]).toBe(String(KLANG.length));
	});

	it("führt nicht aus dem Verzeichnis heraus", async () => {
		// Eine Datei, die es wirklich gibt – sonst wäre der Fall auch ohne
		// Schutz ein 404 und der Test bewiese nichts.
		writeFileSync(join(tmp, "geheim.mp3"), KLANG);
		const p = lege(NORDSTEMMEN, "boshaft", { aufnahme: "../geheim.mp3" });
		expect((await hole(`/api/paket/${p.id}.mp3`)).status).toBe(404);
	});
});

describe("der Abruf erzeugt nichts", () => {
	it("beantwortet eine unbekannte Kennung mit 404", async () => {
		expect((await hole("/api/paket/999999")).status).toBe(404);
		expect((await hole("/api/paket/999999.mp3")).status).toBe(404);
	});

	it("ruft dabei keine Gegenstelle und legt keine Datei an", async () => {
		const vorher = readdirSync(ansagen);
		await hole("/api/paket/999999.mp3");
		await hole("/api/paket/1234.mp3");
		await hole(listeUrl(NORDSTEMMEN));
		expect(anfragen).toBe(0);
		expect(readdirSync(ansagen)).toEqual(vorher);
	});

	it("nimmt keine Kennung an, die keine ist", async () => {
		for (const unfug of ["abc", "0", "-1", "1e3", "../ansage"])
			expect((await hole(`/api/paket/${unfug}`)).status).toBe(404);
		expect(anfragen).toBe(0);
	});
});

describe("alles seit einer Kennung", () => {
	it("liefert genau das Neuere", async () => {
		const a = lege(NORDSTEMMEN, "s1");
		const b = lege(NORDSTEMMEN, "s2");
		const c = lege(NORDSTEMMEN, "s3");
		const raus = await json(listeUrl(NORDSTEMMEN, a.id));
		expect(raus.pakete.map((p: { id: number }) => p.id)).toEqual([b.id, c.id]);
		expect(raus.letzte).toBe(c.id);
	});

	it("reicht nach langer Abwesenheit nicht alles nach", async () => {
		for (let i = 0; i < 25; i++) lege(NORDSTEMMEN, `s${i}`);
		const raus = await json(listeUrl(NORDSTEMMEN));
		expect(raus.pakete).toHaveLength(20);
		// Die höchste Kennung steht trotzdem da – sonst holte der Client ewig nach.
		expect(raus.letzte).toBeGreaterThan(raus.pakete[19].id);
	});

	it("hält die Topics auseinander", async () => {
		lege(KREIS, "k1");
		const meins = lege(NORDSTEMMEN, "n1");
		const raus = await json(listeUrl(NORDSTEMMEN));
		expect(raus.topic).toBe(NORDSTEMMEN);
		expect(raus.pakete.map((p: { id: number }) => p.id)).toEqual([meins.id]);
		expect(raus.letzte).toBe(meins.id);
	});

	it("weist einen unbekannten Termin ab", async () => {
		expect(
			(await hole(`/api/pakete?termin=1999&kreis=hildesheim`)).status,
		).toBe(404);
	});
});
