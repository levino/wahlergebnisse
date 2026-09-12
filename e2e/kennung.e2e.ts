/**
 * Die Kennung einer Seite – eine Matrix über alle, die zusehen.
 *
 * Der Fehler, den das hier fängt: Der Server bildete die Kennung zweimal –
 * beim Ausliefern der Seite aus dem Folienmodell, beim Ablegen des Beitrags
 * aus dem Schub. Zwei Rechnungen aus zwei Datenständen ergaben zwei
 * Zeichenketten, und der Beitrag lag unter einer, die niemand abonniert hatte.
 * Nichts wurde rot, nichts fehlte sichtbar – es kam nur nichts an.
 *
 * Deshalb wird die Kennung hier **nie nachgerechnet**, sondern immer aus der
 * ausgelieferten Seite genommen. Geprüft wird über die Achsen, an denen sie
 * hing: Art der Seite, Wahlleitung, Parteieinstellung – und über zwei Runden,
 * denn erst die zweite zeigt, ob sie zwischen zwei Durchgängen wandert.
 *
 * Ohne Browser, weil es ohne geht: Gefahren wird mit den Adressen, die der
 * Server in die Seite geschrieben hat, gegen die Endpunkte, die er anbietet.
 * Das Ende der Kette – Einblender auf der Leinwand – steht in
 * `durchstich.e2e.ts`.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
	aufraeumen,
	tempVerzeichnis,
	wahlabendFuerBehoerde,
	wahlabendMitBezirken,
	vieleKreiseFixtures,
} from "../test/helfer.ts";
import { starteMockVotemanager } from "../test/mock-votemanager.ts";
import { oeffneDb } from "../src/lib/db.ts";
import { ORT_PARAM } from "../src/lib/live-kanal.ts";
import { liesStand } from "../src/lib/schub.ts";
import { behoerdePfad, dashboardPfad } from "../src/lib/pfade.ts";
import { starteGegenstelle } from "./gegenstelle.ts";
import { testUmgebung } from "./umgebung.ts";

const TERMIN = "2026";
const KREIS = "hildesheim";
const AGS = "03254026";
const KREIS_AGS = "03254000";

/** Die Wahlleitungen, deren Seiten geprüft werden – drei Zuschnitte. */
const WAHLLEITUNGEN = ["nordstemmen", "kreis", "leinebergland"];

/** Die Parteieinstellungen; „keine" ist der Normalfall im Saal. */
const PARTEIEN = ["", "cdu", "spd"];

const freierPort = (): Promise<number> =>
	new Promise((fertig, fehler) => {
		const s = createNetServer();
		s.on("error", fehler);
		s.listen(0, "127.0.0.1", () => {
			const port = (s.address() as { port: number }).port;
			s.close(() => fertig(port));
		});
	});

const entwertet = (roh: string): string =>
	roh.replace(/&#38;|&amp;/g, "&").replace(/&#34;|&quot;/g, '"');

type Seite = { art: string; pfad: string; kennung: string; liveUrl: string };

test.describe("Die Kennung einer Seite trägt bis zum Beitrag", () => {
	test.describe.configure({ mode: "serial", timeout: 300_000 });

	let tmp: string;
	let dbPfad: string;
	let vorher: string;
	let abend: string;
	let abendMehr: string;
	let mock: Awaited<ReturnType<typeof starteMockVotemanager>>;
	let gegenstelle: Awaited<ReturnType<typeof starteGegenstelle>>;
	let app: ChildProcess | undefined;
	let port: number;
	let basis: string;

	const warteAufBereit = async (frist = 120_000): Promise<void> => {
		const ende = Date.now() + frist;
		while (Date.now() < ende) {
			try {
				if ((await fetch(`${basis}/readyz`)).ok) return;
			} catch {}
			await new Promise((f) => setTimeout(f, 250));
		}
		throw new Error(`Server auf ${port} wurde nicht bereit`);
	};

	const warteAufDaten = async (frist = 180_000): Promise<void> => {
		const ende = Date.now() + frist;
		while (Date.now() < ende) {
			try {
				const r = await fetch(`${basis}/api/v1/${KREIS}/${TERMIN}`);
				if (r.ok && (await r.json()).termin?.stand) return;
			} catch {}
			await new Promise((f) => setTimeout(f, 500));
		}
		throw new Error(`Daten für ${TERMIN} wurden nicht geladen`);
	};

	const warteAufGemerktenStand = async (): Promise<void> => {
		const db = oeffneDb(dbPfad);
		await expect
			.poll(() => liesStand(db, TERMIN, AGS) !== undefined, { timeout: 60_000 })
			.toBe(true);
	};

	/** Die Seite abrufen und das mitnehmen, was der Server hineingeschrieben hat. */
	const hole = async (art: string, pfad: string): Promise<Seite> => {
		const antwort = await fetch(`${basis}${pfad}`);
		expect(antwort.status, `${pfad} antwortet nicht`).toBe(200);
		const html = await antwort.text();
		const liveUrl = entwertet(html.match(/data-live-url="([^"]*)"/)?.[1] ?? "");
		const kennung = new URLSearchParams(liveUrl.split("?")[1] ?? "").get(
			ORT_PARAM.topic,
		);
		if (!kennung) throw new Error(`${pfad} nennt keine Kennung`);
		// Die Leinwand trägt dieselbe Kennung noch einmal, weil ihr Skript damit
		// abruft. Zwei Stellen in derselben Seite, ein Wert – sonst redet die
		// Leitung von einem anderen Zuschnitt als der Abruf.
		const amDashboard = html.match(/data-topic="([^"]*)"/)?.[1];
		if (amDashboard !== undefined)
			expect(entwertet(amDashboard), `${pfad}: data-topic gegen data-live-url`)
				.toBe(kennung);
		return { art, pfad, kennung, liveUrl };
	};

	/** Alle Seitenarten einer Wahlleitung – die Unterseiten aus ihren Links. */
	const seitenVon = async (behoerde: string): Promise<Seite[]> => {
		const uebersicht = behoerdePfad(KREIS, TERMIN, behoerde);
		const html = await (await fetch(`${basis}${uebersicht}`)).text();
		const raus = [
			await hole("Leinwand", dashboardPfad(KREIS, TERMIN, behoerde)),
			await hole("Wahlleitung", uebersicht),
		];
		const stamm = `/${KREIS}/${TERMIN}/${behoerde}/`;
		const links = [
			...new Set(
				[...html.matchAll(/href="([^"]+)"/g)]
					.map((m) => entwertet(m[1]))
					.filter((h) => h.startsWith(stamm) && !h.endsWith("/dashboard")),
			),
		];
		const wahl = links.find((h) => !h.includes("/ort/"));
		const ort = links.find((h) => h.includes("/ort/"));
		if (wahl) raus.push(await hole("Wahlseite", wahl));
		if (ort) raus.push(await hole("Ortsseite", ort));
		return raus;
	};

	test.beforeAll(async () => {
		test.setTimeout(300_000);
		tmp = tempVerzeichnis("wahlen-kennung-");
		dbPfad = join(tmp, "wahlen.db");
		vorher = vieleKreiseFixtures(join(tmp, "vorher"), []).wurzel;
		abend = vieleKreiseFixtures(join(tmp, "abend"), []).wurzel;
		wahlabendFuerBehoerde(abend, AGS);
		abendMehr = vieleKreiseFixtures(join(tmp, "abend-mehr"), []).wurzel;
		wahlabendMitBezirken(
			abendMehr,
			AGS,
			[3111, 3112, 3113, 3114, 3115, 3116, 3117, 3118, 3119],
		);

		mock = await starteMockVotemanager(vorher);
		gegenstelle = await starteGegenstelle();
		port = await freierPort();
		basis = `http://127.0.0.1:${port}`;

		app = spawn(
			process.execPath,
			["--no-warnings", "--experimental-strip-types", "server/main.ts"],
			{
				stdio: "inherit",
				env: testUmgebung(
					{
						PORT: String(port),
						HOST: "127.0.0.1",
						DATABASE_PATH: dbPfad,
						ANSAGEN_PFAD: join(tmp, "ansagen"),
						PUBLIC_SITE_URL: "https://wahlergebnisse.example.org",
						VOTEMANAGER_BASIS: mock.url,
						POLL_INTERVAL_SEKUNDEN: "2",
						POLL_INTERVAL_RUHIG_SEKUNDEN: "2",
						POLL_INTERVAL_BETRACHTET_SEKUNDEN: "2",
						POLL_BEHOERDEN: [KREIS_AGS, AGS].join(","),
						POLL_KREISE_PRO_LAUF: "45",
						// Zwei Runden in einem Testlauf brauchen ein kurzes Fenster.
						ANSAGE_FENSTER_SEKUNDEN: "2",
						SHUTDOWN_FRIST_MS: "1000",
					},
					gegenstelle.url,
				),
			},
		);
		await warteAufBereit();
		await warteAufDaten();
	});

	test.afterAll(async () => {
		const p = app;
		app = undefined;
		if (p) {
			const aus = new Promise((f) => p.once("exit", f));
			p.kill("SIGTERM");
			await aus;
		}
		await gegenstelle.schliessen();
		await mock.schliessen();
		aufraeumen(tmp);
	});

	test("ist für jede Seite derselben Wahlleitung dieselbe", async () => {
		for (const behoerde of WAHLLEITUNGEN) {
			const seiten = await seitenVon(behoerde);
			expect(
				seiten.length,
				`${behoerde}: zu wenige Seitenarten geprüft`,
			).toBeGreaterThan(1);
			const erwartet = `${KREIS}/${TERMIN}/${behoerde}`;
			for (const s of seiten)
				expect(s.kennung, `${behoerde} · ${s.art} (${s.pfad})`).toBe(erwartet);
		}
	});

	test("bringt jedem Zuschauer seinen Beitrag – in beiden Runden", async () => {
		// Die Matrix: jede Seitenart mal jede Parteieinstellung. Alle sehen
		// derselben Wahlleitung zu, alle müssen etwas bekommen. Vorher teilten
		// sich zwei Kennungen einen gemerkten Stand – der hängt an
		// `<termin>:<behoerde>`, nicht an der Kennung: Wer zuerst drankam,
		// räumte den Vergleich leer, und alle anderen gingen still leer aus.
		const seiten = await seitenVon("nordstemmen");
		const zuschauer = seiten.flatMap((s) =>
			PARTEIEN.map((partei) => ({ seite: s, partei })),
		);
		expect(zuschauer.length).toBeGreaterThan(6);

		const offen: AbortController[] = [];
		const adresse = (z: (typeof zuschauer)[number], pfad: string) => {
			const p = new URLSearchParams({
				[ORT_PARAM.termin]: TERMIN,
				[ORT_PARAM.topic]: z.seite.kennung,
			});
			if (z.partei) p.set(ORT_PARAM.partei, z.partei);
			return `${basis}${pfad}?${p}`;
		};

		// Jeder hält seine Leitung offen – nur so erfährt der Poller, welche
		// Kennungen gerade jemand ansieht.
		for (const z of zuschauer) {
			const ab = new AbortController();
			offen.push(ab);
			const antwort = await fetch(adresse(z, "/api/live"), {
				signal: ab.signal,
			});
			expect(antwort.status).toBe(200);
			void antwort.body
				?.getReader()
				.read()
				.catch(() => {});
		}

		const stand = async (z: (typeof zuschauer)[number], seit: number) => {
			const antwort = await fetch(
				`${adresse(z, "/api/beitraege")}&seit=${seit}`,
			);
			return (await antwort.json()) as {
				topic: string;
				letzte: number;
				beitraege: Array<{
					id: number;
					aufnahme?: string;
					toasts: Array<{ text: string }>;
				}>;
			};
		};

		const gesehen = new Map<(typeof zuschauer)[number], number>(
			zuschauer.map((z) => [z, 0]),
		);

		const runde = async (name: string, wurzel: string) => {
			await warteAufGemerktenStand();
			mock.setzeWurzel(wurzel);
			for (const z of zuschauer) {
				const wer = `${name} · ${z.seite.art} · Partei „${z.partei || "keine"}"`;
				let neu: Awaited<ReturnType<typeof stand>> | undefined;
				await expect
					.poll(
						async () => {
							neu = await stand(z, gesehen.get(z) ?? 0);
							return neu.beitraege.length;
						},
						{ timeout: 150_000, message: wer },
					)
					.toBeGreaterThan(0);
				const paket = neu?.beitraege.at(-1);
				expect(paket?.toasts.length, `${wer}: leeres Paket`).toBeGreaterThan(0);
				expect(neu?.topic, `${wer}: fremde Kennung`).toBe(z.seite.kennung);
				gesehen.set(z, paket?.id ?? 0);
				if (paket?.aufnahme)
					expect((await fetch(`${basis}${paket.aufnahme}`)).status).toBe(200);
			}
			// Und die Kennung ist dieselbe geblieben – auch nach einem Durchgang,
			// in dem sich die Datenlage verschoben hat.
			for (const behoerde of WAHLLEITUNGEN)
				for (const s of await seitenVon(behoerde))
					expect(s.kennung, `${name} · ${behoerde} · ${s.art}`).toBe(
						`${KREIS}/${TERMIN}/${behoerde}`,
					);
		};

		await runde("Runde eins", abend);
		await runde("Runde zwei", abendMehr);

		for (const ab of offen) ab.abort();
	});
});
