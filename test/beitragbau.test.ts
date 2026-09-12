import { existsSync, rmSync } from "node:fs";
import { type Server, createServer } from "node:http";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Behoerde } from "../src/data/behoerden.ts";
import type { Kreis } from "../src/data/kreise.ts";
import type { Termin } from "../src/data/termine.ts";
import type { Db } from "../src/lib/db.ts";
import type { FolienStand } from "../src/lib/meldungen.ts";
import { FIXTURES, aufraeumen, tempVerzeichnis } from "./helfer.ts";
import {
	type MockVotemanager,
	starteMockVotemanager,
} from "./mock-votemanager.ts";

const NORDSTEMMEN = "03254026";
const KREIS = "03254000";
const SATZ = "In Rössing sind die Ergebnisse da, der Ortsrat steht fest.";

let tmp: string;
let mock: MockVotemanager;
let gegenstelle: Server;
let db: Db;
let kreis: Kreis;
let termin: Termin;
let behoerde: Behoerde;
let schub: typeof import("../src/lib/schub.ts");
let beitragbau: typeof import("../src/lib/beitragbau.ts");
let beitraege: typeof import("../src/lib/beitraege.ts");
let stand: typeof import("../src/lib/stand.ts");

/** Was die nachgestellte Gegenstelle gesehen hat. */
let moderationen = 0;
let stimmen = 0;
/** Wie lange der nachgestellte Sprachdienst braucht. */
let verzoegerungMs = 0;
/** Womit er antwortet – für den Ausfall. */
let stimmStatus = 200;
let metaGet: typeof import("../src/lib/db.ts").metaGet;

beforeAll(async () => {
	tmp = tempVerzeichnis("beitragbau-");
	process.env.DATABASE_PATH = join(tmp, "wahlen.db");
	process.env.ANSAGEN_PFAD = join(tmp, "ansagen");
	process.env.OPENAI_API_KEY = "sk-test-attrappe";
	mock = await starteMockVotemanager(FIXTURES);
	process.env.VOTEMANAGER_BASIS = mock.url;

	gegenstelle = createServer((req, res) => {
		req.on("data", () => {});
		req.on("end", () => {
			if (req.url?.endsWith("/audio/speech")) {
				stimmen++;
				setTimeout(() => {
					if (stimmStatus !== 200) {
						res.writeHead(stimmStatus, { "content-type": "application/json" });
						res.end("{}");
						return;
					}
					res.writeHead(200, { "content-type": "audio/mpeg" });
					res.end(Buffer.from("ID3AnsageAttrappe"));
				}, verzoegerungMs);
				return;
			}
			moderationen++;
			res.writeHead(200, { "content-type": "application/json" });
			res.end(JSON.stringify({ choices: [{ message: { content: SATZ } }] }));
		});
	});
	await new Promise<void>((f) => gegenstelle.listen(0, "127.0.0.1", f));
	const port = (gegenstelle.address() as { port: number }).port;
	process.env.OPENAI_BASIS = `http://127.0.0.1:${port}/v1`;

	const dbModul = await import("../src/lib/db.ts");
	const { oeffneDb } = dbModul;
	metaGet = dbModul.metaGet;
	const { pollTermin } = await import("../src/lib/poll.ts");
	const { terminById } = await import("../src/data/termine.ts");
	const { kreisBySlug } = await import("../src/data/kreise.ts");
	db = oeffneDb();
	for (const id of ["2021", "2020"])
		await pollTermin(db, terminById(id)!, {
			nurBehoerden: [NORDSTEMMEN, KREIS],
		});
	kreis = kreisBySlug("hildesheim")!;
	termin = terminById("2021")!;
	behoerde = kreis.behoerden.find((b) => b.ags === NORDSTEMMEN)!;
	schub = await import("../src/lib/schub.ts");
	beitragbau = await import("../src/lib/beitragbau.ts");
	beitraege = await import("../src/lib/beitraege.ts");
	stand = await import("../src/lib/stand.ts");
}, 120_000);

afterAll(async () => {
	await new Promise<void>((f) => gegenstelle.close(() => f()));
	await mock.schliessen();
	aufraeumen(tmp);
});

beforeEach(() => {
	db.prepare("DELETE FROM meta WHERE key LIKE 'schub:%'").run();
	db.prepare("DELETE FROM beitraege").run();
	// Auch der Zwischenspeicher auf der Platte: Sonst zählte ein Test den
	// Aufruf nicht mehr, den ein früherer schon bezahlt hat.
	rmSync(join(tmp, "ansagen"), { recursive: true, force: true });
	db.prepare("DELETE FROM meta WHERE key LIKE 'termin:%:beitraege'").run();
	moderationen = 0;
	stimmen = 0;
	verzoegerungMs = 0;
	stimmStatus = 200;
});

const echterStand = (): Map<string, FolienStand> =>
	schub.staendeAus(schub.modellFuer(kreis, termin, behoerde));

/** Ein Wahllokal weniger auf den Gemeindewahlen – ein Schub wie im Saal. */
const zurueckgedreht = (): Map<string, FolienStand> => {
	const raus = new Map<string, FolienStand>();
	for (const [marke, s] of echterStand())
		raus.set(
			marke,
			s.max > 1 && s.max <= 40
				? { ...s, anz: Math.max(0, s.anz - 1), art: "zwischenstand" }
				: s,
		);
	return raus;
};

const topicFuer = (parteiKey?: string) =>
	stand.topicName(stand.topicAus(kreis, [behoerde.ags]), parteiKey);

const baue = async (parteiKeys: string[]) => {
	const { modell, schuebe } = schub.erkenneSchuebe(
		db,
		kreis,
		termin,
		behoerde,
		parteiKeys,
	);
	const raus = [];
	for (const s of schuebe)
		raus.push(
			await beitragbau.baueUndLegeAb(db, {
				kreis,
				termin,
				behoerde,
				modell,
				schub: s,
				topic: topicFuer(s.parteiKey || undefined),
			}),
		);
	return raus;
};

describe("der Server legt Moderationsbeiträge an", () => {
	it("baut beim ersten Blick keines – da ist noch nichts geschehen", async () => {
		// Sonst hagelt es beim Start Meldungen über Zahlen, die längst dastehen.
		expect(await baue([""])).toEqual([]);
		expect(moderationen).toBe(0);
		expect(stimmen).toBe(0);
	});

	it("macht aus einem Schub einen Beitrag, einen Satz und eine Aufnahme", async () => {
		schub.merkeStand(db, termin.id, behoerde.ags, zurueckgedreht());
		const [bericht] = await baue([""]);
		expect(bericht.beitrag).toBeDefined();
		expect(bericht.grund).toBeUndefined();
		expect(moderationen).toBe(1);
		expect(stimmen).toBe(1);
		expect(bericht.beitrag?.aufnahme).toMatch(/\.mp3$/);
		expect(bericht.beitrag?.toasts.length).toBeGreaterThan(0);
	});

	it("hält den gesprochenen Satz vom Beitrag fern", async () => {
		schub.merkeStand(db, termin.id, behoerde.ags, zurueckgedreht());
		const [bericht] = await baue([""]);
		expect(JSON.stringify(bericht.beitrag)).not.toContain(SATZ);
		const toasts = bericht.beitrag?.toasts ?? [];
		expect(toasts.length).toBeGreaterThan(0);
		for (const t of toasts) expect(Object.keys(t)).not.toContain("anlass");
	});

	it("legt denselben Schub kein zweites Mal an", async () => {
		// Ein Neustart des Pollers darf den Abend nicht erneut melden.
		schub.merkeStand(db, termin.id, behoerde.ags, zurueckgedreht());
		const [erst] = await baue([""]);
		schub.merkeStand(db, termin.id, behoerde.ags, zurueckgedreht());
		const [nochmal] = await baue([""]);
		expect(nochmal.beitrag?.id).toBe(erst.beitrag?.id);
		expect(
			beitraege.beitraegeSeit(db, {
				termin: termin.id,
				topic: topicFuer(),
				seit: 0,
			}),
		).toHaveLength(1);
	});

	it("kostet drei Zuschauer mit derselben Partei nur einen Aufruf", async () => {
		schub.merkeStand(db, termin.id, behoerde.ags, zurueckgedreht());
		await baue(["cdu", "cdu", "cdu"]);
		expect(moderationen).toBe(1);
		expect(stimmen).toBe(1);
		expect(
			beitraege.beitraegeSeit(db, {
				termin: termin.id,
				topic: topicFuer("cdu"),
				seit: 0,
			}),
		).toHaveLength(1);
	});

	it("gibt zwei Partei-Einstellungen zwei Beiträge", async () => {
		schub.merkeStand(db, termin.id, behoerde.ags, zurueckgedreht());
		const berichte = await baue(["", "cdu"]);
		expect(berichte).toHaveLength(2);
		const ohne = beitraege.beitraegeSeit(db, {
			termin: termin.id,
			topic: topicFuer(),
			seit: 0,
		});
		const mit = beitraege.beitraegeSeit(db, {
			termin: termin.id,
			topic: topicFuer("cdu"),
			seit: 0,
		});
		expect(ohne).toHaveLength(1);
		expect(mit).toHaveLength(1);
		expect(mit[0].id).not.toBe(ohne[0].id);
	});

	it("nennt der Partei ihre eigene Nachricht", async () => {
		// Die Fanfare gehört dem, der die Partei eingestellt hat – und nur ihm.
		const vorher = new Map(echterStand());
		for (const [marke, s] of vorher)
			vorher.set(marke, {
				...s,
				art: "zwischenstand",
				parteien: (s.parteien ?? []).map((p) =>
					p.key === "cdu" ? { ...p, platz: p.platz + 1 } : p,
				),
			});
		schub.merkeStand(db, termin.id, behoerde.ags, vorher);
		const { schuebe } = schub.erkenneSchuebe(db, kreis, termin, behoerde, [
			"",
			"cdu",
		]);
		const mit = schuebe.find((s) => s.parteiKey === "cdu");
		const ohne = schuebe.find((s) => s.parteiKey === "");
		expect(mit?.meldungen.some((m) => m.art === "jubel")).toBe(true);
		expect(ohne?.meldungen.some((m) => m.art === "jubel")).toBe(false);
	});

	it("hält die Zahlen nicht auf, wenn die Erzeugung scheitert", async () => {
		// Zahlen und Beiträge sind zwei Kanäle. Ein abgeriegelter Sprachdienst
		// nimmt dem Saal die Stimme, nicht die Ergebnisse.
		const vorher = metaGet(db, "termin:2021:version");
		stimmStatus = 500;
		schub.merkeStand(db, termin.id, behoerde.ags, zurueckgedreht());
		const [bericht] = await baue([""]);
		stimmStatus = 200;
		expect(bericht.grund).toBe("keine Aufnahme");
		expect(bericht.beitrag?.aufnahme).toBeUndefined();
		// Der Kanal der Zahlen ist unberührt geblieben.
		expect(metaGet(db, "termin:2021:version")).toBe(vorher);
	});

	it("bewegt die Marke erst, wenn die Aufnahme auf der Platte liegt", async () => {
		// Die Zustellung hängt an dieser Marke. Bewegte sie sich vor der
		// Aufnahme, kündigte der Ping etwas an, das es noch nicht gibt – und im
		// Saal käme der Gong Sekunden vor der Stimme.
		verzoegerungMs = 300;
		schub.merkeStand(db, termin.id, behoerde.ags, zurueckgedreht());
		const marke = beitraege.beitragsMarke(termin.id);
		const lauf = baue([""]);
		await new Promise((f) => setTimeout(f, 120));
		expect(metaGet(db, marke)).toBeUndefined();
		expect(
			beitraege.beitraegeSeit(db, {
				termin: termin.id,
				topic: topicFuer(),
				seit: 0,
			}),
		).toHaveLength(0);

		const [bericht] = await lauf;
		verzoegerungMs = 0;
		expect(metaGet(db, marke)).toBe(String(bericht.beitrag?.id));
		expect(
			existsSync(join(tmp, "ansagen", bericht.beitrag?.aufnahme ?? "fehlt")),
		).toBe(true);
	});

	it("meldet auf kreisweiten Wahlen nur die Zehnerschwellen", async () => {
		// Der Kreistag hat 426 Auszähleinheiten; jede einzelne wäre Lärm.
		const vorher = new Map(echterStand());
		for (const [marke, s] of vorher)
			if (s.max > 40)
				vorher.set(marke, {
					...s,
					anz: Math.max(0, s.anz - 1),
					art: "zwischenstand",
				});
		schub.merkeStand(db, termin.id, behoerde.ags, vorher);
		const { schuebe } = schub.erkenneSchuebe(db, kreis, termin, behoerde, [""]);
		for (const m of schuebe[0]?.meldungen ?? [])
			if (m.art === "stand") expect(m.prozent).toBeDefined();
	});
});
