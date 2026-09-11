import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { aufraeumen, tempVerzeichnis } from "./helfer.ts";

const KREIS_A = "wittmund";
const KREIS_B = "luechow-dannenberg";

let tmp: string;
let server: Server;
let basis: string;
let dienst: Awaited<ReturnType<typeof starte>>["dienst"];
const betrachtet: string[] = [];

type Modul = typeof import("../server/live.ts");

const starte = async () => {
	const { starteLive } = (await import("../server/live.ts")) as Modul;
	const d = starteLive({
		beiBetrachtung: (kreis) => betrachtet.push(kreis),
		pulsMs: 150,
		pruefMs: 50,
		hoechstens: 300,
	});
	const s = createServer((req, res) => {
		const url = new URL(req.url ?? "/", "http://localhost");
		if (d.handhabe(req, res, url)) return;
		res.writeHead(404).end();
	});
	await new Promise<void>((fertig) => s.listen(0, "127.0.0.1", fertig));
	const { port } = s.address() as { port: number };
	return { dienst: d, server: s, basis: `http://127.0.0.1:${port}` };
};

/** Eine offene SSE-Verbindung, deren Ereignisse mitgeschrieben werden. */
type Leitung = {
	ereignisse: Array<{ art: string; daten: Record<string, string> }>;
	schliesse: () => void;
	status: number;
};

const verbinde = async (pfad: string): Promise<Leitung> => {
	const abbruch = new AbortController();
	const antwort = await fetch(`${basis}${pfad}`, { signal: abbruch.signal });
	const ereignisse: Leitung["ereignisse"] = [];
	if (antwort.body) {
		const leser = antwort.body.getReader();
		const dekoder = new TextDecoder();
		let puffer = "";
		void (async () => {
			try {
				while (true) {
					const { done, value } = await leser.read();
					if (done) break;
					puffer += dekoder.decode(value, { stream: true });
					let ende = puffer.indexOf("\n\n");
					while (ende >= 0) {
						const block = puffer.slice(0, ende);
						puffer = puffer.slice(ende + 2);
						const art = block.match(/^event: (.*)$/m)?.[1];
						const daten = block.match(/^data: (.*)$/m)?.[1];
						if (art && daten)
							ereignisse.push({ art, daten: JSON.parse(daten) });
						ende = puffer.indexOf("\n\n");
					}
				}
			} catch {
				/* abgebrochen – gewollt */
			}
		})();
	}
	return {
		ereignisse,
		schliesse: () => abbruch.abort(),
		status: antwort.status,
	};
};

const warteAuf = async (
	pruefung: () => boolean,
	was: string,
	ms = 5000,
): Promise<void> => {
	const ende = Date.now() + ms;
	while (Date.now() < ende) {
		if (pruefung()) return;
		await new Promise((f) => setTimeout(f, 20));
	}
	throw new Error(`Zeitüberschreitung: ${was}`);
};

/** Neue Zahlen für eine Behörde vortäuschen – so, wie es der Poller täte. */
const meldeNeu = async (behoerde: string, wann: string) => {
	const { metaSet, oeffneDb } = await import("../src/lib/db.ts");
	const db = oeffneDb();
	db.prepare(
		`INSERT INTO ergebnisse (termin, behoerde, wahl_id, gebiet_id, ebene, titel, leer, stand_anz, stand_max, json, hash, aktualisiert, eingegangen_am)
		 VALUES ('2026', ?, 1, 'ebene_1_id_1', 1, 'Probe', 0, 1, 10, '{}', ?, ?, NULL)
		 ON CONFLICT(termin, behoerde, wahl_id, gebiet_id) DO UPDATE SET hash = excluded.hash, aktualisiert = excluded.aktualisiert`,
	).run(behoerde, wann, wann);
	metaSet(db, "termin:2026:version", wann);
};

beforeAll(async () => {
	tmp = tempVerzeichnis("wahlen-live-");
	process.env.DATABASE_PATH = join(tmp, "wahlen.db");
	({ dienst, server, basis } = await starte());
});

afterAll(async () => {
	dienst.schliesse();
	await new Promise<void>((f) => server.close(() => f()));
	const { schliesseDb } = await import("../src/lib/db.ts");
	schliesseDb();
	aufraeumen(tmp);
});

describe("Live-Zustellung", () => {
	it("stellt nur dem betroffenen Kreis zu", async () => {
		const { kreisBySlug } = await import("../src/data/kreise.ts");
		const kreisA = kreisBySlug(KREIS_A)!;
		const gemeindeA = kreisA.behoerden.find((b) => b.art !== "kreis")!;

		await meldeNeu(gemeindeA.ags, "2026-09-13T18:00:00.000Z");
		const a = await verbinde(`/api/live?termin=2026&kreis=${KREIS_A}`);
		const aGemeinde = await verbinde(
			`/api/live?termin=2026&kreis=${KREIS_A}&behoerde=${gemeindeA.slug}`,
		);
		const aKreisamt = await verbinde(
			`/api/live?termin=2026&kreis=${KREIS_A}&behoerde=kreis`,
		);
		const b = await verbinde(`/api/live?termin=2026&kreis=${KREIS_B}`);

		await warteAuf(
			() => [a, aGemeinde, aKreisamt, b].every((l) => l.ereignisse.length > 0),
			"erster Stand",
		);
		expect(a.ereignisse[0].daten.version).toBe("2026-09-13T18:00:00.000Z");
		expect(b.ereignisse[0].daten.version).toBe("");

		const vorher = Object.fromEntries(
			[
				["a", a],
				["aGemeinde", aGemeinde],
				["aKreisamt", aKreisamt],
				["b", b],
			].map(([name, l]) => [
				name as string,
				(l as Leitung).ereignisse.filter((e) => e.art === "stand").length,
			]),
		);

		await meldeNeu(gemeindeA.ags, "2026-09-13T18:05:00.000Z");
		await warteAuf(
			() =>
				a.ereignisse.filter((e) => e.art === "stand").length > vorher.a &&
				aGemeinde.ereignisse.filter((e) => e.art === "stand").length >
					vorher.aGemeinde,
			"zugestellter Stand in Kreis A",
		);
		expect(
			a.ereignisse.filter((e) => e.art === "stand").at(-1)?.daten.version,
		).toBe("2026-09-13T18:05:00.000Z");

		expect(b.ereignisse.filter((e) => e.art === "stand").length).toBe(vorher.b);
		expect(aKreisamt.ereignisse.filter((e) => e.art === "stand").length).toBe(
			vorher.aKreisamt,
		);

		await warteAuf(() => b.ereignisse.some((e) => e.art === "puls"), "Puls");
		expect(betrachtet).toContain(KREIS_B);

		for (const l of [a, aGemeinde, aKreisamt, b]) l.schliesse();
		await warteAuf(() => dienst.anzahl() === 0, "Abräumen nach dem Trennen");
	});

	it("hält 200 gleichzeitige Verbindungen aus und räumt sie wieder ab", async () => {
		const vorherSpeicher = process.memoryUsage().heapUsed;
		const leitungen = await Promise.all(
			Array.from({ length: 200 }, () =>
				verbinde(`/api/live?termin=2026&kreis=${KREIS_A}`),
			),
		);
		expect(dienst.anzahl()).toBe(200);
		await warteAuf(
			() => leitungen.every((l) => l.ereignisse.length > 0),
			"erster Stand an alle 200",
			10_000,
		);

		await meldeNeu(
			(await import("../src/data/kreise.ts")).kreisBySlug(KREIS_A)!.behoerden[1]
				.ags,
			"2026-09-13T19:00:00.000Z",
		);
		await warteAuf(
			() =>
				leitungen.every((l) =>
					l.ereignisse.some(
						(e) =>
							e.art === "stand" &&
							e.daten.version === "2026-09-13T19:00:00.000Z",
					),
				),
			"Zustellung an alle 200",
			10_000,
		);

		const zuwachs = process.memoryUsage().heapUsed - vorherSpeicher;
		expect(zuwachs).toBeLessThan(40 * 1024 * 1024);

		for (const l of leitungen) l.schliesse();
		await warteAuf(
			() => dienst.anzahl() === 0,
			"Abräumen aller 200 Verbindungen",
			10_000,
		);
	});

	it("lehnt unbekannte Termine ab und deckelt die Zahl der Leitungen", async () => {
		const unbekannt = await fetch(`${basis}/api/live?termin=1999`);
		expect(unbekannt.status).toBe(404);
		await unbekannt.text();
		expect(dienst.anzahl()).toBe(0);

		const { starteLive } = (await import("../server/live.ts")) as Modul;
		const eng = starteLive({ hoechstens: 2, pulsMs: 5000, pruefMs: 5000 });
		const s = createServer((req, res) => {
			const url = new URL(req.url ?? "/", "http://localhost");
			if (!eng.handhabe(req, res, url)) res.writeHead(404).end();
		});
		await new Promise<void>((f) => s.listen(0, "127.0.0.1", f));
		const { port } = s.address() as { port: number };
		const abbruch = new AbortController();
		const offen = await Promise.all([
			fetch(`http://127.0.0.1:${port}/api/live?termin=2026`, {
				signal: abbruch.signal,
			}),
			fetch(`http://127.0.0.1:${port}/api/live?termin=2026`, {
				signal: abbruch.signal,
			}),
		]);
		expect(offen.every((r) => r.status === 200)).toBe(true);
		const dritte = await fetch(`http://127.0.0.1:${port}/api/live?termin=2026`);
		expect(dritte.status).toBe(503);
		expect(dritte.headers.get("retry-after")).toBe("30");
		await dritte.text();
		abbruch.abort();
		eng.schliesse();
		await new Promise<void>((f) => s.close(() => f()));
	});
});
