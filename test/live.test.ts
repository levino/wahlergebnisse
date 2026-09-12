import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { aufraeumen, tempVerzeichnis } from "./helfer.ts";

const KREIS_A = "wittmund";
const KREIS_B = "luechow-dannenberg";
const BEHOERDE_A = "03462019";

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
	it("stellt jeder Kennung zu, die die Zahlen auf ihren Folien hat", async () => {
		const { kreisBySlug } = await import("../src/data/kreise.ts");
		const kreisA = kreisBySlug(KREIS_A)!;
		const gemeindeA = kreisA.behoerden.find((b) => b.art !== "kreis")!;
		const kreisamtA = kreisA.behoerden.find((b) => b.ags === kreisA.ags)!;

		await meldeNeu(gemeindeA.ags, "2026-09-13T18:00:00.000Z");
		const kennung = (...behoerden: string[]) =>
			verbinde(
				`/api/live?termin=2026&topic=${[KREIS_A, ...behoerden].join("/")}`,
			);
		const a = await kennung();
		// Die Leinwand der Gemeinde: eigene Wahlen, dazu Kreistag und Landrat.
		const leinwand = await kennung(gemeindeA.ags, kreisamtA.ags);
		// Eine Seite, auf der nur die Gemeinde steht.
		const nurGemeinde = await kennung(gemeindeA.ags);
		const b = await verbinde(`/api/live?termin=2026&topic=${KREIS_B}`);
		const alle = { a, leinwand, nurGemeinde, b };

		await warteAuf(
			() => Object.values(alle).every((l) => l.ereignisse.length > 0),
			"erster Stand",
		);
		expect(a.ereignisse[0].daten.version).toBe("2026-09-13T18:00:00.000Z");
		expect(b.ereignisse[0].daten.version).toBe("");

		const staende = () =>
			Object.fromEntries(
				Object.entries(alle).map(([name, l]) => [
					name,
					l.ereignisse.filter((e) => e.art === "stand").length,
				]),
			) as Record<keyof typeof alle, number>;

		const vorGemeinde = staende();
		await meldeNeu(gemeindeA.ags, "2026-09-13T18:05:00.000Z");
		await warteAuf(
			() =>
				staende().a > vorGemeinde.a &&
				staende().leinwand > vorGemeinde.leinwand &&
				staende().nurGemeinde > vorGemeinde.nurGemeinde,
			"zugestellter Stand in Kreis A",
		);
		expect(
			a.ereignisse.filter((e) => e.art === "stand").at(-1)?.daten.version,
		).toBe("2026-09-13T18:05:00.000Z");
		expect(staende().b).toBe(vorGemeinde.b);

		// Der Kern des Abends: Die Gemeinde ist früh fertig, der Kreistag zählt
		// stundenlang weiter. Wer seine Folien zeigt, muss mitziehen – und wer
		// sie nicht zeigt, bleibt in Ruhe.
		const vorKreis = staende();
		await meldeNeu(kreisamtA.ags, "2026-09-13T18:10:00.000Z");
		await warteAuf(
			() => staende().a > vorKreis.a && staende().leinwand > vorKreis.leinwand,
			"zugestellter Stand des Kreisamts",
		);
		expect(
			leinwand.ereignisse.filter((e) => e.art === "stand").at(-1)?.daten
				.version,
		).toBe("2026-09-13T18:10:00.000Z");
		expect(staende().nurGemeinde).toBe(vorKreis.nurGemeinde);
		expect(staende().b).toBe(vorKreis.b);

		await warteAuf(() => b.ereignisse.some((e) => e.art === "puls"), "Puls");
		expect(betrachtet).toContain(KREIS_B);

		for (const l of Object.values(alle)) l.schliesse();
		await warteAuf(() => dienst.anzahl() === 0, "Abräumen nach dem Trennen");
	});

	it("hält 200 gleichzeitige Verbindungen aus und räumt sie wieder ab", async () => {
		const vorherSpeicher = process.memoryUsage().heapUsed;
		const leitungen = await Promise.all(
			Array.from({ length: 200 }, () =>
				verbinde(`/api/live?termin=2026&topic=${KREIS_A}`),
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

	it("schickt Kennungen und sonst nichts", async () => {
		const a = await verbinde(`/api/live?termin=2026&topic=${KREIS_A}`);
		await warteAuf(() => a.ereignisse.length > 0, "erster Stand");
		await meldeNeu(
			(await import("../src/data/kreise.ts")).kreisBySlug(KREIS_A)!.behoerden[1]
				.ags,
			"2026-09-13T20:00:00.000Z",
		);
		await warteAuf(
			() => a.ereignisse.filter((e) => e.art === "stand").length > 1,
			"zweiter Stand",
		);
		await warteAuf(() => a.ereignisse.some((e) => e.art === "puls"), "Puls");

		// Alle Ereignisarten kommen vor – geprüft wird jede einzelne Nachricht.
		expect(new Set(a.ereignisse.map((e) => e.art))).toEqual(
			new Set(["stand", "puls", "beitrag"]),
		);
		for (const e of a.ereignisse) {
			expect(Object.keys(e.daten).sort(), e.art).toEqual(
				e.art === "beitrag"
					? ["kennung"]
					: ["geprueft", "termin", "topic", "version"],
			);
			for (const [feld, wert] of Object.entries(e.daten)) {
				expect(typeof wert, `${e.art}.${feld}`).toBe("string");
				// Eine Kennung ist kurz. Ein Einblender oder ein Ansagesatz
				// wäre es nicht – daran fiele auf, wenn hier Inhalt landete.
				expect(wert.length, `${e.art}.${feld}`).toBeLessThanOrEqual(120);
			}
		}

		a.schliesse();
		await warteAuf(() => dienst.anzahl() === 0, "Abräumen");
	});

	it("schickt den Beitrag als eigene Nachricht, nicht im Stand", async () => {
		const gefragt: Array<[string, string]> = [];
		const { starteLive } = (await import("../server/live.ts")) as Modul;
		const mitBeitraegen = starteLive({
			pulsMs: 5000,
			pruefMs: 50,
			beitragFuer: (termin, topic) => {
				gefragt.push([termin, topic]);
				return "4711";
			},
		});
		const s = createServer((req, res) => {
			const url = new URL(req.url ?? "/", "http://localhost");
			if (!mitBeitraegen.handhabe(req, res, url)) res.writeHead(404).end();
		});
		await new Promise<void>((f) => s.listen(0, "127.0.0.1", f));
		const { port } = s.address() as { port: number };

		const abbruch = new AbortController();
		const antwort = await fetch(
			`http://127.0.0.1:${port}/api/live?termin=2026&topic=${KREIS_A}`,
			{ signal: abbruch.signal },
		);
		const block = await antwort.body!.getReader().read();
		const text = new TextDecoder().decode(block.value);
		const bloecke = text.split("\n\n").filter((b) => b.includes("data:"));
		const nach = (art: string) =>
			bloecke
				.filter((b) => b.includes(`event: ${art}`))
				.map((b) => JSON.parse(b.match(/^data: (.*)$/m)![1]));

		// Die Zahlen tragen keine Beitragskennung mehr …
		expect(nach("stand")[0].beitrag).toBeUndefined();
		// … die kommt als eigene Nachricht mit eigenen Feldern.
		expect(nach("beitrag")[0]).toEqual({ kennung: "4711" });
		expect(gefragt[0]).toEqual(["2026", KREIS_A]);

		abbruch.abort();
		mitBeitraegen.schliesse();
		await new Promise<void>((f) => s.close(() => f()));
	});

	it("stellt einen Beitrag zu, auch wenn sich an den Zahlen nichts tut", async () => {
		// Der Kern der Trennung: Ein Beitrag entsteht Sekunden nach den Zahlen.
		// Hinge er an ihnen, bliebe er bis zur nächsten Schnellmeldung liegen.
		const { starteLive } = (await import("../server/live.ts")) as Modul;
		const { metaSet, oeffneDb } = await import("../src/lib/db.ts");
		const { beitragsMarke } = await import("../src/lib/beitraege.ts");
		let kennung = "";
		const dienstB = starteLive({
			pulsMs: 5000,
			pruefMs: 30,
			beitragFuer: () => kennung,
		});
		const s = createServer((req, res) => {
			const url = new URL(req.url ?? "/", "http://localhost");
			if (!dienstB.handhabe(req, res, url)) res.writeHead(404).end();
		});
		await new Promise<void>((f) => s.listen(0, "127.0.0.1", f));
		const { port } = s.address() as { port: number };

		const abbruch = new AbortController();
		const antwort = await fetch(
			`http://127.0.0.1:${port}/api/live?termin=2026&topic=${KREIS_A}`,
			{ signal: abbruch.signal },
		);
		const leser = antwort.body!.getReader();
		const dekoder = new TextDecoder();
		await leser.read();

		// Keine neuen Zahlen – nur ein fertiger Beitrag.
		kennung = "99";
		metaSet(oeffneDb(), beitragsMarke("2026"), "99");

		let gesehen = "";
		const ende = Date.now() + 4000;
		while (Date.now() < ende && !gesehen.includes("event: beitrag")) {
			const { value, done } = await leser.read();
			if (done) break;
			gesehen += dekoder.decode(value, { stream: true });
		}
		expect(gesehen).toContain("event: beitrag");
		expect(gesehen).toContain('"kennung":"99"');
		expect(gesehen).not.toContain("event: stand");

		abbruch.abort();
		dienstB.schliesse();
		await new Promise<void>((f) => s.close(() => f()));
	});

	it("fragt für einen Zuschauer mit Partei ein eigenes Topic ab", async () => {
		// Jubel und Abstieg gehen nur den an, der die Partei eingestellt hat.
		// Deshalb hängt die Partei im Topic – zwei Einstellungen, zwei Pakete.
		const gefragt: string[] = [];
		const { starteLive } = (await import("../server/live.ts")) as Modul;
		const gemeldet: string[] = [];
		const mitPartei = starteLive({
			pulsMs: 5000,
			pruefMs: 50,
			beiTopic: (t) => gemeldet.push(t),
			beitragFuer: (_termin, topic) => {
				gefragt.push(topic);
				return "7";
			},
		});
		const s = createServer((req, res) => {
			const url = new URL(req.url ?? "/", "http://localhost");
			if (!mitPartei.handhabe(req, res, url)) res.writeHead(404).end();
		});
		await new Promise<void>((f) => s.listen(0, "127.0.0.1", f));
		const { port } = s.address() as { port: number };

		const abbruch = new AbortController();
		await fetch(
			`http://127.0.0.1:${port}/api/live?termin=2026&topic=${KREIS_A}/${BEHOERDE_A}&partei=cdu`,
			{ signal: abbruch.signal },
		);

		expect(gefragt[0]).toBe(`${KREIS_A}/${BEHOERDE_A}#cdu`);
		expect(gemeldet).toContain(`${KREIS_A}/${BEHOERDE_A}#cdu`);

		abbruch.abort();
		mitPartei.schliesse();
		await new Promise<void>((f) => s.close(() => f()));
	});

	it("nimmt keinen erfundenen Parteischlüssel in das Topic", async () => {
		const gefragt: string[] = [];
		const { starteLive } = (await import("../server/live.ts")) as Modul;
		const roh = starteLive({
			pulsMs: 5000,
			pruefMs: 50,
			beitragFuer: (_termin, topic) => {
				gefragt.push(topic);
				return "";
			},
		});
		const s = createServer((req, res) => {
			const url = new URL(req.url ?? "/", "http://localhost");
			if (!roh.handhabe(req, res, url)) res.writeHead(404).end();
		});
		await new Promise<void>((f) => s.listen(0, "127.0.0.1", f));
		const { port } = s.address() as { port: number };

		const abbruch = new AbortController();
		await fetch(
			`http://127.0.0.1:${port}/api/live?termin=2026&topic=${KREIS_A}/${BEHOERDE_A}&partei=${encodeURIComponent("../../etc")}`,
			{ signal: abbruch.signal },
		);

		expect(gefragt[0]).toBe(`${KREIS_A}/${BEHOERDE_A}`);

		abbruch.abort();
		roh.schliesse();
		await new Promise<void>((f) => s.close(() => f()));
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
