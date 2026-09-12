/**
 * Die Naht zwischen Server und Browser, an einem Stück ausgeführt.
 *
 * Was ein geteilter Wert erzwingen kann, steht in `src/lib/live-kanal.ts`.
 * Hier steht der Rest: dass der Server tatsächlich sendet, was der Browser
 * erwartet, dass der Browser sich beim Aufbau einnordet und nicht erst beim
 * ersten Ping, und dass die eingestellte Partei bis zum Abruf durchkommt.
 * Gefahren wird mit den Adressen, die der Browser bildet, gegen die
 * Endpunkte, die der Server anbietet – ohne Browser, weil es ohne geht.
 */
import { existsSync } from "node:fs";
import { type Server, createServer } from "node:http";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { kreisBySlug } from "../src/data/kreise.ts";
import { terminById } from "../src/data/termine.ts";
import {
	BEITRAEGE_PFAD,
	beitragZeiger,
	beitraegeUrl,
} from "../src/lib/beitrag-abruf.ts";
import { type Db, oeffneDb, schliesseDb } from "../src/lib/db.ts";
import { legeBeitragAn } from "../src/lib/beitraege.ts";
import {
	LIVE_EREIGNIS,
	LIVE_PFAD,
	VERSION_PFAD,
	alsVersion,
	liveAdresse,
	mitPartei,
	versionAdresse,
} from "../src/lib/live-kanal.ts";
import {
	kreisAusTopic,
	topicFuer,
	wahlleitungAusTopic,
} from "../src/lib/stand.ts";
import { aufraeumen, tempVerzeichnis } from "./helfer.ts";

const TERMIN = "2026";
const KREIS = "hildesheim";
const AGS = "03254026";
const PARTEI = "cdu";

let tmp: string;
let db: Db;
let server: Server;
let basis: string;
let dienst: Awaited<ReturnType<typeof starte>>["dienst"];
/** Jedes Topic, nach dem die Zustellung gefragt hat. */
let gefragt: string[] = [];
/** Jedes Topic, das die Zustellung dem Poller gemeldet hat. */
let gemeldet: string[] = [];

const starte = async () => {
	const { starteLive } = await import("../server/live.ts");
	const { handhabeBeitrag } = await import("../server/beitrag.ts");
	const d = starteLive({
		pulsMs: 120,
		pruefMs: 30,
		beiTopic: (topic) => gemeldet.push(topic),
		beitragFuer: (terminId, topic) => {
			gefragt.push(topic);
			const { letzteKennung } = einmalig;
			const id = letzteKennung(db, terminId, topic);
			return id ? String(id) : "";
		},
	});
	const s = createServer((req, res) => {
		const url = new URL(req.url ?? "/", "http://localhost");
		if (d.handhabe(req, res, url)) return;
		if (handhabeBeitrag(db, req, res, url)) return;
		res.writeHead(404).end();
	});
	await new Promise<void>((f) => s.listen(0, "127.0.0.1", f));
	const { port } = s.address() as { port: number };
	return { dienst: d, server: s, basis: `http://127.0.0.1:${port}` };
};

let einmalig: typeof import("../src/lib/beitraege.ts");

type Ereignis = { art: string; daten: Record<string, string> };

/** Eine offene Leitung, deren Ereignisse mitgeschrieben werden. */
const verbinde = async (adresse: string) => {
	const abbruch = new AbortController();
	const antwort = await fetch(`${basis}${adresse}`, {
		signal: abbruch.signal,
	});
	const ereignisse: Ereignis[] = [];
	const leser = antwort.body?.getReader();
	if (leser) {
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
		status: antwort.status,
		schliesse: () => abbruch.abort(),
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
		await new Promise((f) => setTimeout(f, 15));
	}
	throw new Error(`Zeitüberschreitung: ${was}`);
};

/** Die Adressen, die der Browser bildet – hier gegen den echten Server. */
const holeUeberServer: typeof fetch = (eingabe, init) =>
	fetch(`${basis}${String(eingabe)}`, init);

let lauf = 0;
const hinterlege = (topic: string, text: string): number =>
	legeBeitragAn(db, {
		termin: TERMIN,
		topic,
		schluessel: `naht-${lauf++}`,
		toasts: [
			{
				marke: "rat",
				ort: "Nordstemmen",
				wahl: "Gemeinderatswahl",
				art: "stand",
				text,
			},
		],
	}).id;

beforeAll(async () => {
	tmp = tempVerzeichnis("wahlen-naht-");
	process.env.DATABASE_PATH = join(tmp, "wahlen.db");
	einmalig = await import("../src/lib/beitraege.ts");
	db = oeffneDb();
	({ dienst, server, basis } = await starte());
});

afterAll(async () => {
	dienst.schliesse();
	await new Promise<void>((f) => server.close(() => f()));
	schliesseDb();
	aufraeumen(tmp);
});

const kreis = kreisBySlug(KREIS);
const TOPIC = topicFuer({
	kreis,
	termin: terminById(TERMIN),
	behoerde: kreis?.behoerden.find((b) => b.ags === AGS),
});

const ORT = { termin: TERMIN, topic: TOPIC };

describe("die Ereignisarten der Leitung", () => {
	it("sind die, auf die der Browser hört – und keine anderen", async () => {
		const leitung = await verbinde(liveAdresse(ORT));
		await warteAuf(
			() => leitung.ereignisse.some((e) => e.art === LIVE_EREIGNIS.puls),
			"Puls",
		);
		const arten = new Set(leitung.ereignisse.map((e) => e.art));
		expect(arten.size).toBeGreaterThan(0);
		for (const art of arten)
			expect(Object.values(LIVE_EREIGNIS) as string[]).toContain(art);
		expect(arten).toContain(LIVE_EREIGNIS.stand);
		expect(arten).toContain(LIVE_EREIGNIS.beitrag);
		leitung.schliesse();
	});
});

describe("das Einnorden beim Seitenaufbau", () => {
	it("verschluckt den ersten Beitrag des Abends nicht", async () => {
		// Genau der Weg des Browsers: Der Kanal meldet beim Verbinden seinen
		// Stand, der Zeiger nordet sich daran ein – und der erste echte Beitrag
		// ist damit einer, der gezeigt wird, und kein Einnorden mehr.
		expect(einmalig.letzteKennung(db, TERMIN, TOPIC)).toBe(0);

		const leitung = await verbinde(liveAdresse(ORT));
		await warteAuf(
			() => leitung.ereignisse.some((e) => e.art === LIVE_EREIGNIS.beitrag),
			"Stand des Beitragskanals beim Aufbau",
		);
		const zuerst = leitung.ereignisse.find(
			(e) => e.art === LIVE_EREIGNIS.beitrag,
		);
		expect(zuerst?.daten.kennung).toBe("0");

		const zeiger = beitragZeiger(holeUeberServer);
		const gezeigt: string[] = [];
		const verarbeite = async (kennung: number) => {
			const schub = await zeiger.hole(ORT, kennung);
			for (const p of schub?.beitraege ?? []) gezeigt.push(p.toasts[0].text);
		};

		await verarbeite(Number(zuerst?.daten.kennung));
		expect(gezeigt).toEqual([]);

		const erster = hinterlege(TOPIC, "Der erste Beitrag des Abends");
		await verarbeite(erster);
		expect(gezeigt).toEqual(["Der erste Beitrag des Abends"]);
		leitung.schliesse();
	});
});

describe("die eingestellte Parteibrille", () => {
	it("schneidet kein eigenes Paket, sondern siebt beim Abruf", async () => {
		// Der Beitrag gehört der Seite, nicht dem Zuschauer: Gemeldet und
		// abgefragt wird eine Kennung – die der Seite. Wer eine Partei
		// eingestellt hat, bekommt zusätzlich deren Einblender; wer keine hat,
		// bekommt trotzdem alles Übrige. Genau das ging vorher leer aus.
		gefragt = [];
		gemeldet = [];
		const mitCdu = { ...ORT, partei: PARTEI };

		const leitung = await verbinde(liveAdresse(mitCdu));
		await warteAuf(() => gemeldet.length > 0, "gemeldetes Topic");
		expect(gefragt[0]).toBe(TOPIC);
		expect(gemeldet).toContain(TOPIC);

		const jubel = legeBeitragAn(db, {
			termin: TERMIN,
			topic: TOPIC,
			schluessel: `naht-partei-${lauf++}`,
			toasts: [
				{
					marke: "rat",
					ort: "Nordstemmen",
					wahl: "Gemeinderatswahl",
					art: "jubel",
					text: "CDU liegt vorn!",
					partei: PARTEI,
				},
				{
					marke: "rat",
					ort: "Nordstemmen",
					wahl: "Gemeinderatswahl",
					art: "stand",
					text: "3 von 23 Wahlbezirken",
				},
			],
		}).id;

		const mit = beitragZeiger(holeUeberServer);
		const ohne = beitragZeiger(holeUeberServer);
		mit.setze(jubel - 1);
		ohne.setze(jubel - 1);

		const fuerMich = await mit.hole(mitCdu, jubel);
		expect(fuerMich?.beitraege[0].toasts.map((t) => t.text)).toEqual([
			"CDU liegt vorn!",
			"3 von 23 Wahlbezirken",
		]);
		const fuerAlle = await ohne.hole(ORT, jubel);
		expect(fuerAlle?.beitraege[0].toasts.map((t) => t.text)).toEqual([
			"3 von 23 Wahlbezirken",
		]);
		leitung.schliesse();
	});

	it("steht in derselben Adresse, die der Browser an die Leitung hängt", () => {
		// Der Browser kennt die Auswahl erst nach dem Aufbau und hängt sie an;
		// beides muss dieselbe Adresse ergeben.
		expect(mitPartei(liveAdresse(ORT), PARTEI)).toBe(
			liveAdresse({ ...ORT, partei: PARTEI }),
		);
		expect(beitraegeUrl({ ...ORT, partei: PARTEI }, 0)).toContain(
			`partei=${PARTEI}`,
		);
	});
});

describe("die Adressen, die der Browser bildet", () => {
	it("treffen die Endpunkte, die der Server anbietet", async () => {
		const leitung = await verbinde(liveAdresse(ORT));
		expect(leitung.status).toBe(200);
		leitung.schliesse();

		const abruf = await fetch(`${basis}${beitraegeUrl(ORT, 0)}`);
		expect(abruf.status).toBe(200);
		expect((await abruf.json()).topic).toBe(TOPIC);

		// Der Live-Pfad und der Abrufpfad gehören dem Node-Server, die Auskunft
		// ohne Leitung liegt als Astro-Seite: Deren Adresse ist ihr Dateiname.
		// Ein umbenannter Pfad fällt hier auf, statt erst im Browser.
		expect(liveAdresse(ORT).startsWith(`${LIVE_PFAD}?`)).toBe(true);
		expect(beitraegeUrl(ORT, 0).startsWith(`${BEITRAEGE_PFAD}?`)).toBe(true);
		const seite = new URL(`../src/pages${VERSION_PFAD}.ts`, import.meta.url)
			.pathname;
		expect(existsSync(seite), `${seite} fehlt`).toBe(true);
		expect(alsVersion(liveAdresse(ORT))).toBe(versionAdresse(ORT));
	});
});

describe("das Topic", () => {
	it("wird so zerlegt, wie es gebildet wurde", () => {
		expect(TOPIC).toBe(`${KREIS}/${TERMIN}/nordstemmen`);
		expect(kreisAusTopic(TOPIC)?.slug).toBe(KREIS);
		expect(wahlleitungAusTopic(TOPIC)?.behoerde.ags).toBe(AGS);
	});
});
