import nock from "nock";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	STANDARD_VERBINDUNGEN,
	hostWarteschlange,
	sperrdauerMs,
	verbindungenAusUmgebung,
} from "../src/lib/warteschlange.ts";

const BASIS = "https://wahlleitung.example";
const HOST = "wahlleitung.example";

beforeEach(() => {
	nock.cleanAll();
	nock.disableNetConnect();
});

afterEach(() => {
	nock.cleanAll();
	nock.enableNetConnect();
});

const urls = (anzahl: number): string[] =>
	Array.from({ length: anzahl }, (_, i) => `${BASIS}/datei/${i}.json`);

describe("Warteschlange je Host", () => {
	it("lässt nie mehr Verbindungen offen als erlaubt", async () => {
		let offen = 0;
		let hoechste = 0;
		nock(BASIS)
			.get(/^\/datei\/\d+\.json$/)
			.times(24)
			.delay(25)
			.reply(() => {
				offen++;
				hoechste = Math.max(hoechste, offen);
				return [200, "{}"];
			});

		const w = hostWarteschlange({
			standard: { start: 4, mindestens: 4, hoechstens: 4 },
		});
		const begonnen = Date.now();
		await Promise.all(
			urls(24).map(async (url) => {
				const res = await w.hole(url);
				offen--;
				expect(res.status).toBe(200);
			}),
		);

		expect(hoechste).toBeLessThanOrEqual(4);
		expect(hoechste).toBeGreaterThan(1);
		expect(Date.now() - begonnen).toBeGreaterThanOrEqual(120);
		expect(w.offen(HOST)).toBe(0);
	});

	it("holt die Dateien mit mehr Verbindungen schneller", async () => {
		nock(BASIS)
			.get(/^\/datei\/\d+\.json$/)
			.times(48)
			.delay(25)
			.reply(200, "{}");

		const schnell = hostWarteschlange({
			standard: { start: 16, mindestens: 16, hoechstens: 16 },
		});
		const t0 = Date.now();
		await Promise.all(urls(24).map((url) => schnell.hole(url)));
		const mitSechzehn = Date.now() - t0;

		const langsam = hostWarteschlange({
			standard: { start: 2, mindestens: 2, hoechstens: 2 },
		});
		const t1 = Date.now();
		await Promise.all(urls(24).map((url) => langsam.hole(url)));
		const mitZwei = Date.now() - t1;

		expect(mitSechzehn * 2).toBeLessThan(mitZwei);
	});

	it("wartet bei 429 die im Retry-After genannte Zeit ab und holt danach", async () => {
		nock(BASIS)
			.get("/datei/0.json")
			.reply(429, "zu viel", { "Retry-After": "2" })
			.get("/datei/0.json")
			.reply(200, "{}");

		const gewartet: number[] = [];
		const w = hostWarteschlange({
			standard: { start: 4, mindestens: 1, hoechstens: 8 },
			warte: async (ms) => {
				gewartet.push(ms);
			},
		});

		const res = await w.hole(`${BASIS}/datei/0.json`);
		expect(res.status).toBe(200);
		expect(gewartet).toContain(2000);
		expect(w.erlaubt(HOST)).toBeLessThan(4);
	});

	it("hält nach einem 429 alle Anfragen an den Host zurück, nicht nur die eigene", async () => {
		nock(BASIS)
			.get("/datei/0.json")
			.reply(429, "zu viel", { "Retry-After": "1" })
			.get("/datei/0.json")
			.reply(200, "{}")
			.get("/datei/1.json")
			.delay(5)
			.reply(200, "{}");

		const reihenfolge: string[] = [];
		const w = hostWarteschlange({
			standard: { start: 4, mindestens: 1, hoechstens: 8 },
			warte: (ms) =>
				new Promise((r) => {
					reihenfolge.push(`sperre ${ms}`);
					setTimeout(r, 20);
				}),
		});

		const erste = w.hole(`${BASIS}/datei/0.json`);
		const zweite = w
			.hole(`${BASIS}/datei/1.json`)
			.then(() => reihenfolge.push("zweite fertig"));
		await Promise.all([erste, zweite]);

		expect(reihenfolge[0]).toBe("sperre 1000");
		expect(reihenfolge).toContain("zweite fertig");
	});

	it("fährt nach Fehlern zurück und danach wieder hoch", async () => {
		nock(BASIS)
			.get(/^\/datei\/\d+\.json$/)
			.times(3)
			.reply(500, "kaputt")
			.get(/^\/datei\/\d+\.json$/)
			.times(40)
			.reply(200, "{}");

		const w = hostWarteschlange({
			standard: { start: 8, mindestens: 1, hoechstens: 32 },
			latenzSchwelle: 50,
		});
		expect(w.erlaubt(HOST)).toBe(8);

		for (const url of urls(3)) {
			const res = await w.hole(url);
			expect(res.status).toBe(500);
		}
		const nachFehlern = w.erlaubt(HOST);
		expect(nachFehlern).toBeLessThan(8);
		expect(nachFehlern).toBeGreaterThanOrEqual(1);

		for (const url of urls(40)) await w.hole(url);
		expect(w.erlaubt(HOST)).toBeGreaterThan(nachFehlern);
		expect(w.erlaubt(HOST)).toBeLessThanOrEqual(32);
	});

	it("fährt zurück, wenn die Antwortzeiten deutlich steigen", async () => {
		nock(BASIS)
			.get(/^\/datei\/\d+\.json$/)
			.times(20)
			.reply(200, "{}")
			.get(/^\/datei\/\d+\.json$/)
			.times(12)
			.delay(120)
			.reply(200, "{}");

		const w = hostWarteschlange({
			standard: { start: 8, mindestens: 1, hoechstens: 32 },
			latenzSchwelle: 3,
		});
		for (const url of urls(20)) await w.hole(url);
		const flott = w.erlaubt(HOST);
		expect(flott).toBeGreaterThan(8);

		for (const url of urls(12)) await w.hole(url);
		expect(w.erlaubt(HOST)).toBeLessThan(flott);
	});

	it("führt für jeden Host ein eigenes Konto", async () => {
		nock(BASIS).get("/datei/0.json").reply(500, "kaputt");
		nock("https://andere.example").get("/datei/0.json").reply(200, "{}");

		const w = hostWarteschlange({
			standard: { start: 8, mindestens: 1, hoechstens: 32 },
			latenzSchwelle: 50,
		});
		await w.hole(`${BASIS}/datei/0.json`);
		await w.hole("https://andere.example/datei/0.json");

		expect(w.erlaubt(HOST)).toBe(4);
		expect(w.erlaubt("andere.example")).toBeGreaterThan(8);
	});
});

describe("sperrdauerMs", () => {
	it("liest Sekunden", () => {
		expect(sperrdauerMs("30", 0)).toBe(30_000);
	});

	it("liest ein HTTP-Datum als Abstand zum Jetzt", () => {
		const jetzt = Date.parse("2026-09-13T20:00:00Z");
		expect(sperrdauerMs("Sun, 13 Sep 2026 20:00:05 GMT", jetzt)).toBe(5_000);
	});

	it("deckelt lange Angaben, damit der Poller nicht stehen bleibt", () => {
		expect(sperrdauerMs("86400", 0)).toBe(60_000);
	});

	it("übergeht Unsinn und leere Angaben", () => {
		expect(sperrdauerMs(null, 0)).toBeUndefined();
		expect(sperrdauerMs("bald", 0)).toBeUndefined();
	});
});

describe("verbindungenAusUmgebung", () => {
	it("nimmt ohne Angabe die Standardwerte", () => {
		expect(verbindungenAusUmgebung({})).toEqual({
			standard: STANDARD_VERBINDUNGEN,
			hosts: {},
		});
	});

	it("liest Ausgangswert und Obergrenze aus der Umgebung", () => {
		const { standard } = verbindungenAusUmgebung({
			POLL_VERBINDUNGEN_START: "12",
			POLL_VERBINDUNGEN_HOECHSTENS: "48",
			POLL_VERBINDUNGEN_MINDESTENS: "3",
		});
		expect(standard).toEqual({ start: 12, mindestens: 3, hoechstens: 48 });
	});

	it("liest host=start:hoechstens:mindestens", () => {
		const { hosts } = verbindungenAusUmgebung({
			POLL_HOST_VERBINDUNGEN:
				"wahlen.kreis-hi.de=16:64:4, www.nordenham.de=2:4",
		});
		expect(hosts["wahlen.kreis-hi.de"]).toEqual({
			start: 16,
			hoechstens: 64,
			mindestens: 4,
		});
		expect(hosts["www.nordenham.de"]).toEqual({
			start: 2,
			hoechstens: 4,
			mindestens: 1,
		});
	});

	it("übergeht Unsinn, statt den Poller lahmzulegen", () => {
		const { hosts } = verbindungenAusUmgebung({
			POLL_HOST_VERBINDUNGEN: "kaputt, =3, x.example=0, y.example=abc",
		});
		expect(hosts).toEqual({});
	});
});
