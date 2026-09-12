import { existsSync, readFileSync, readdirSync } from "node:fs";
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
import { ANSAGE_ANWEISUNG, MODERATION_MODELL } from "../src/lib/ansage.ts";
import type { Schub } from "../src/lib/moderation.ts";
import { aufraeumen, tempVerzeichnis } from "./helfer.ts";
import {
	type Kassette,
	SCHLUESSEL_MUSTER,
	kassetten,
	kassetteninhalt,
	legeEin,
	nimmtAuf,
} from "./kassette.ts";
import { uebernimmEnvDatei } from "../scripts/umgebung.ts";

const STIMME = "/v1/audio/speech";
const TEXTMODELL = "/v1/chat/completions";

const EINBLENDER = "Ortsratswahl Rössing: fertig ausgezählt!";

let tmp: string;
let kassette: Kassette | undefined;
let lauf = 0;

beforeAll(() => {
	tmp = tempVerzeichnis("wahlen-kette-");
	if (nimmtAuf()) uebernimmEnvDatei();
	else process.env.OPENAI_API_KEY = "sk-abspielen-ohne-schluessel";
	delete process.env.OPENAI_BASIS;
});

// Der Zwischenspeicher liegt auf der Platte. Ohne eigenes Verzeichnis je Fall
// fände der zweite Test den Satz des ersten und fragte nie.
beforeEach(() => {
	lauf += 1;
	process.env.ANSAGEN_PFAD = join(tmp, `ansagen-${lauf}`);
});

afterAll(() => aufraeumen(tmp));

afterEach(() => {
	kassette?.fertig();
	kassette = undefined;
});

const modul = async () => {
	vi.resetModules();
	return await import("../src/lib/ansage-datei.ts");
};

/**
 * Eine Schnellmeldung aus einem Wahlbezirk, die mehrere Wahlen zugleich
 * bewegt – der Fall, den ein Wahlabend wirklich erzeugt.
 */
const schub = (): Schub => ({
	behoerde: "03254026",
	termin: "2026-09-13",
	partei: "CDU",
	fest: EINBLENDER,
	eingaenge: [
		{
			gebiet: "03 - Grundschule Rössing",
			wirkungen: [
				{
					wahl: "Ortsratswahl",
					ort: "Rössing",
					anz: 3,
					max: 3,
					fertig: true,
					reihenfolge: [
						{ kurz: "CDU", prozent: 45.1, diff: 3.2, sitze: 4 },
						{ kurz: "SPD", prozent: 38.4, diff: -2.1, sitze: 3 },
					],
					meldungen: [EINBLENDER],
				},
				{
					wahl: "Gemeinderatswahl",
					ort: "Nordstemmen",
					anz: 15,
					max: 23,
					fertig: false,
					reihenfolge: [
						{ kurz: "SPD", prozent: 40.9 },
						{ kurz: "CDU", prozent: 31.8 },
						{ kurz: "GRÜNE", prozent: 12.0 },
					],
					meldungen: ["Gemeinderatswahl Nordstemmen: 15 von 23 ausgezählt"],
				},
			],
		},
	],
	unveraendert: [
		{ wahl: "Kreistagswahl", ort: "Landkreis Hildesheim", anz: 196, max: 426 },
	],
	wahlen: [
		{
			wahl: "Ortsratswahl",
			ort: "Rössing",
			zuschnitt: "eigen",
			anz: 3,
			max: 3,
			datenstand: "Endergebnis",
			parteien: [
				{ kurz: "CDU", prozent: 45.1, diff: 3.2, sitze: 4 },
				{ kurz: "SPD", prozent: 38.4, diff: -2.1, sitze: 3 },
			],
			wahlbeteiligung: 63.2,
			vorher: {
				ort: "Rössing",
				wahl: "Ortsratswahl",
				anz: 2,
				max: 3,
				art: "zwischenstand",
				spitze: "SPD",
				parteien: [{ key: "spd", platz: 1, prozent: 41.0, sitze: 3 }],
			},
			beitraege: [],
			meldungen: [EINBLENDER],
		},
	],
});

describe("die ganze Kette gegen aufgezeichnete Antworten", () => {
	it("macht aus einem Schub einen gesprochenen Satz und nimmt ihn auf", async () => {
		kassette = await legeEin("schub-roessing");
		const { formuliere, erzeugeAnsage, ansageDa } = await modul();

		const raus = await formuliere(schub());

		expect(raus.quelle).toBe("modell");
		expect(raus.grund).toBeUndefined();
		expect(raus.satz.length).toBeGreaterThan(40);

		// Die Stimme liest den Einblender nicht vor.
		expect(raus.satz).not.toBe(EINBLENDER);
		expect(raus.satz).not.toContain(EINBLENDER);

		expect(await erzeugeAnsage(raus.satz)).toBe(true);
		expect(ansageDa(raus.satz, "sage")).toBe(true);
	});

	it("fragt das Textmodell mit Anweisung und Kontext", async () => {
		kassette = await legeEin("schub-roessing");
		const { formuliere } = await modul();
		await formuliere(schub());
		if (nimmtAuf()) return;

		const anfrage = kassette.rumpf(TEXTMODELL);
		expect(anfrage.model).toBe(MODERATION_MODELL);
		const nachrichten = anfrage.messages as Array<{
			role: string;
			content: string;
		}>;
		expect(nachrichten[0].role).toBe("system");
		expect(nachrichten[1].content).toContain("Rössing");
		expect(nachrichten[1].content).toContain("du liest es nicht vor");
	});

	it("fragt die Aufnahme mit der Vortragsanweisung und einer Stimme für alle", async () => {
		kassette = await legeEin("schub-roessing");
		const { formuliere, erzeugeAnsage } = await modul();
		const raus = await formuliere(schub());
		await erzeugeAnsage(raus.satz);
		if (nimmtAuf()) return;

		const anfrage = kassette.rumpf(STIMME);
		expect(anfrage.voice).toBe("sage");
		expect(anfrage.instructions).toBe(ANSAGE_ANWEISUNG);
		expect(anfrage.input).toBe(raus.satz);
		expect(anfrage.response_format).toBe("mp3");
	});

	it("kostet denselben Schub beim zweiten Mal keinen Aufruf", async () => {
		// In `lockdown` ist das die schärfste Probe, die es gibt: Ein zweiter
		// Aufruf fände keine Aufnahme und schlüge fehl.
		kassette = await legeEin("schub-roessing");
		const { formuliere } = await modul();
		const erste = await formuliere(schub());
		const zweite = await formuliere(schub());
		expect(zweite.satz).toBe(erste.satz);
		expect(zweite.quelle).toBe("zwischenspeicher");
	});

	it("bleibt gültig, wenn sich der Kontext ändert", async () => {
		// Der Grund, warum über Verfahren und Pfad verglichen wird und nicht
		// über den Anfragetext: Eine Kassette darf nicht verfallen, nur weil
		// jemand ein Wort an der Anweisung ändert.
		kassette = await legeEin("schub-roessing");
		const { formuliere } = await modul();

		const anders = schub();
		anders.wahlen[0].parteien.push({ kurz: "GRÜNE", prozent: 9.9 });
		anders.unveraendert.push({
			wahl: "Landratswahl",
			ort: "Landkreis Hildesheim",
			anz: 193,
			max: 426,
		});

		const raus = await formuliere(anders);
		expect(raus.quelle).toBe("modell");
		if (nimmtAuf()) return;
		expect(kassette.rumpf(TEXTMODELL).messages).toBeDefined();
	});

	it("hält drei gleichzeitige Zuschauer zu einem Aufruf zusammen", async () => {
		kassette = await legeEin("schub-roessing");
		const { formuliere } = await modul();
		const drei = await Promise.all([
			formuliere(schub()),
			formuliere(schub()),
			formuliere(schub()),
		]);
		expect(new Set(drei.map((d) => d.satz)).size).toBe(1);
	});
});

describe("die Kassetten", () => {
	it("liegen auf der Platte", () => {
		expect(kassetten().length).toBeGreaterThan(0);
	});

	it("führen keinen Zugangsschlüssel mit", () => {
		for (const name of kassetten())
			expect(kassetteninhalt(name)).not.toMatch(SCHLUESSEL_MUSTER);
	});

	it("sind der einzige Ort, an dem Antworten der Gegenstelle liegen", () => {
		expect(existsSync("e2e/aufnahmen")).toBe(false);
	});

	it("nennen die Gegenstelle nur an einer Stelle im Quelltext", () => {
		const gefunden: string[] = [];
		const durchsuche = (dir: string): void => {
			for (const name of readdirSync(dir, { withFileTypes: true })) {
				const pfad = join(dir, name.name);
				if (name.isDirectory()) durchsuche(pfad);
				else if (
					/\.(ts|tsx|astro|mjs)$/.test(name.name) &&
					readFileSync(pfad, "utf8").includes("api.openai.com")
				)
					gefunden.push(pfad);
			}
		};
		for (const dir of ["src", "server", "e2e", "scripts"]) durchsuche(dir);
		expect(gefunden).toEqual(["src/lib/ansage-datei.ts"]);
	});
});
