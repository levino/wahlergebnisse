/**
 * Der ganze Weg, an einem Stück: neues Ergebnis bis abgeholte Aufnahme.
 *
 * Poller sieht ein neues Ergebnis → erkennt den Schub → formuliert → erzeugt
 * die Aufnahme → legt den Moderationsbeitrag ab → kündigt ihn über die
 * Ereignisart der Zustellung an → der Browser holt ihn → der Einblender steht
 * auf der Leinwand → die Aufnahme wird angefordert.
 *
 * Nichts davon wird hier abgekürzt: Kein Beitrag wird von außen hinterlegt,
 * kein Ereignis von Hand ausgelöst. Die einzige Attrappe ist die Gegenstelle
 * des Sprachdienstes, und die antwortet immer dasselbe.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { join } from "node:path";
import { type Page, expect, test } from "@playwright/test";
import {
	aufraeumen,
	tempVerzeichnis,
	wahlabendFuerBehoerde,
	wahlabendMitBezirken,
	vieleKreiseFixtures,
} from "../test/helfer.ts";
import { starteMockVotemanager } from "../test/mock-votemanager.ts";
import { BEITRAEGE_PFAD, BEITRAG_PFAD } from "../src/lib/beitrag-abruf.ts";
import { oeffneDb } from "../src/lib/db.ts";
import { ORT_PARAM } from "../src/lib/live-kanal.ts";
import { liesStand } from "../src/lib/schub.ts";
import { haken } from "./leinwand.ts";
import { starteGegenstelle } from "./gegenstelle.ts";
import { testUmgebung } from "./umgebung.ts";

const TERMIN = "2026";
const KREIS = "hildesheim";
const AGS = "03254026";
const KREIS_AGS = "03254000";
const SEITE = `/${KREIS}/${TERMIN}/nordstemmen/dashboard?takt=300`;

const freierPort = (): Promise<number> =>
	new Promise((fertig, fehler) => {
		const s = createNetServer();
		s.on("error", fehler);
		s.listen(0, "127.0.0.1", () => {
			const port = (s.address() as { port: number }).port;
			s.close(() => fertig(port));
		});
	});

test.describe("Vom neuen Ergebnis bis zur abgeholten Aufnahme", () => {
	test.describe.configure({ mode: "serial", timeout: 300_000 });

	let tmp: string;
	let dbPfad: string;
	let ansagen: string;
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

	/** Wartet, bis die Fixtures des Termins in der Ablage stehen. */
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

	/**
	 * Wartet, bis der Poller die Wahlleitung einmal angesehen hat, während
	 * jemand zusieht.
	 *
	 * Beim ersten Blick entsteht kein Schub – alles wäre neu. Erst wenn dieser
	 * Stand gemerkt ist, führt die nächste Änderung zu einem Beitrag. Ohne
	 * dieses Warten liefe der Test gegen den ersten Blick statt gegen den
	 * zweiten.
	 */
	const warteAufGemerktenStand = async (): Promise<void> => {
		const db = oeffneDb(dbPfad);
		await expect
			.poll(() => liesStand(db, TERMIN, AGS) !== undefined, {
				timeout: 60_000,
			})
			.toBe(true);
	};

	const oeffne = async (page: Page): Promise<void> => {
		await page.goto(`${basis}${SEITE}`);
		await expect(page.locator(".db-buehne")).toBeVisible();
		// Vor der ersten Geste lässt kein Browser Ton zu; im Saal ist es der
		// Vollbildknopf, hier die Pause.
		await page.getByRole("button", { name: "Pause" }).click();
		await expect(page.locator("#stand-anzeige")).toHaveAttribute(
			"data-zustand",
			"verbunden",
			{ timeout: 60_000 },
		);
	};

	/** Die Adressen, die der Browser abgerufen hat. */
	const mitschnitt = (page: Page) => {
		const abrufe: string[] = [];
		const aufnahmen: Array<{ url: string; status: number }> = [];
		page.on("response", (r) => {
			const pfad = new URL(r.url()).pathname + new URL(r.url()).search;
			if (pfad.startsWith(BEITRAEGE_PFAD)) abrufe.push(pfad);
			if (pfad.startsWith(`${BEITRAG_PFAD}/`))
				aufnahmen.push({ url: pfad, status: r.status() });
		});
		return { abrufe, aufnahmen };
	};

	test.beforeAll(async () => {
		test.setTimeout(300_000);
		tmp = tempVerzeichnis("wahlen-durchstich-");
		dbPfad = join(tmp, "wahlen.db");
		ansagen = join(tmp, "ansagen");
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
						ANSAGEN_PFAD: ansagen,
						PUBLIC_SITE_URL: "https://wahlergebnisse.example.org",
						VOTEMANAGER_BASIS: mock.url,
						POLL_INTERVAL_SEKUNDEN: "2",
						POLL_INTERVAL_RUHIG_SEKUNDEN: "2",
						POLL_INTERVAL_BETRACHTET_SEKUNDEN: "2",
						POLL_BEHOERDEN: [KREIS_AGS, AGS].join(","),
						POLL_KREISE_PRO_LAUF: "45",
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

	test("ein neues Ergebnis wird zum Einblender und zur angeforderten Aufnahme", async ({
		context,
	}) => {
		const erste = await context.newPage();
		const zweite = await context.newPage();
		const spurErste = mitschnitt(erste);
		const spurZweite = mitschnitt(zweite);
		await oeffne(erste);
		await oeffne(zweite);
		await warteAufGemerktenStand();
		expect(gegenstelle.aufrufe()).toEqual({ moderation: 0, stimme: 0 });

		// Das neue Ergebnis. Ab hier rührt der Test nichts mehr an.
		mock.setzeWurzel(abend);

		// Der Einblender steht auf beiden Leinwänden. Dass er ankommt, ist der
		// Beleg für die Ereignisart: Gäbe der Server eine andere aus, als der
		// Browser abhört, bliebe die Leinwand leer.
		for (const seite of [erste, zweite])
			await expect(
				seite.locator("[data-meldungen] .db-meldung"),
			).not.toHaveCount(0, { timeout: 120_000 });

		// Es ist der **erste** Beitrag des Abends – der, den die Leinwand früher
		// zum Einnorden verbraucht hat.
		expect(spurErste.abrufe.length).toBeGreaterThan(0);
		expect(spurErste.abrufe[0]).toContain("seit=0");

		// Genau ein Aufruf an die Gegenstelle, obwohl zwei zusehen.
		expect(gegenstelle.aufrufe()).toEqual({ moderation: 1, stimme: 1 });

		// Und die Aufnahme, die der Beitrag nennt, wird angefordert und geliefert.
		for (const spur of [spurErste, spurZweite]) {
			await expect
				.poll(() => spur.aufnahmen.length, { timeout: 30_000 })
				.toBeGreaterThan(0);
			for (const a of spur.aufnahmen) {
				expect(a.url).toMatch(/\.mp3$/);
				expect(a.status).toBe(200);
			}
		}
		expect((await haken(erste))?.url).toMatch(/\.mp3$/);

		await erste.close();
		await zweite.close();
	});

	test("die eingestellte Partei kommt bis zum Abruf durch", async ({
		page,
	}) => {
		const spur = mitschnitt(page);
		await oeffne(page);
		await page.getByLabel("Meine Partei").selectOption({ label: "CDU" });
		await expect(page.locator("html")).toHaveAttribute("data-partei", "cdu");
		// Die Auswahl baut die Leitung neu auf – erst damit kennt der Poller
		// das Topic dieses Zuschauers.
		await expect(page.locator("#stand-anzeige")).toHaveAttribute(
			"data-zustand",
			"verbunden",
			{ timeout: 60_000 },
		);
		await warteAufGemerktenStand();

		mock.setzeWurzel(abendMehr);

		await expect(page.locator("[data-meldungen] .db-meldung")).not.toHaveCount(
			0,
			{ timeout: 120_000 },
		);
		// Abgefragt wurde ausschließlich das Topic mit Partei. Dass darin etwas
		// lag, heißt: Die Leitung hat die Partei gemeldet, der Poller hat dafür
		// gebaut, und der Abruf hat dasselbe Topic gemeint.
		expect(spur.abrufe.length).toBeGreaterThan(0);
		for (const adresse of spur.abrufe)
			expect(adresse).toContain(`${ORT_PARAM.partei}=cdu`);
	});
});
