import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
	ANSAGE_ANWEISUNG,
	ANSAGE_FASSUNG,
	ANSAGE_HOECHSTLAENGE,
	ANSAGE_MODELL,
	ANSAGE_STIMME_STANDARD,
	MODERATION_MODELL,
	istDienstStimme,
} from "./ansage.ts";
import { dbPfad } from "./db.ts";
import {
	MODERATION_ANWEISUNG,
	MODERATION_FASSUNG,
	type Schub,
	kontextText,
	pruefeAntwort,
} from "./moderation.ts";

export const OPENAI_BASIS_VORGABE = "https://api.openai.com/v1";

const basis = (): string =>
	(process.env.OPENAI_BASIS?.trim() || OPENAI_BASIS_VORGABE).replace(
		/\/+$/,
		"",
	);

const STIMME_URL = (): string => `${basis()}/audio/speech`;

const MODERATION_URL = (): string => `${basis()}/chat/completions`;

const schluessel = (): string => process.env.OPENAI_API_KEY?.trim() ?? "";

export type Gegenstelle = "stimme" | "moderation";

const riegel: Record<Gegenstelle, string> = { stimme: "", moderation: "" };

export const dienstBereit = (was: Gegenstelle = "stimme"): boolean =>
	schluessel().length > 0 && !riegel[was];

/** Nur für Tests. */
export const oeffneRiegel = (): void => {
	riegel.stimme = "";
	riegel.moderation = "";
};

const istEndgueltig = (status: number, rumpf: string): boolean =>
	status === 401 ||
	status === 403 ||
	(status === 429 && /insufficient_quota|billing/i.test(rumpf));

/** Ohne Angabe für alle; erzeugt wird ohnehin nur, wo jemand zusieht. */
const nurBehoerden = (): string[] =>
	(process.env.ANSAGE_BEHOERDEN ?? "")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);

export const istAnsageBehoerde = (ags: string): boolean => {
	const nur = nurBehoerden();
	return nur.length === 0 || nur.includes(ags);
};
export const modell = (): string =>
	process.env.ANSAGE_MODELL?.trim() || ANSAGE_MODELL;

export const standardStimme = (): string => {
	const wunsch = process.env.ANSAGE_STIMME?.trim();
	return wunsch && istDienstStimme(wunsch) ? wunsch : ANSAGE_STIMME_STANDARD;
};

export const ansagenVerzeichnis = (): string =>
	process.env.ANSAGEN_PFAD ?? join(dirname(dbPfad()), "ansagen");

export const ansageSchluessel = (text: string, stimme: string): string =>
	createHash("sha256")
		.update(
			[ANSAGE_FASSUNG, modell(), stimme, ANSAGE_ANWEISUNG, text].join(" "),
		)
		.digest("hex")
		.slice(0, 24);

export const ansagePfad = (text: string, stimme: string): string =>
	join(ansagenVerzeichnis(), `${ansageSchluessel(text, stimme)}.mp3`);

export const ansageDa = (text: string, stimme: string): boolean =>
	existsSync(ansagePfad(text, stimme));

const grenze = (name: string, vorgabe: number): number => {
	const n = Number(process.env[name]);
	return Number.isFinite(n) && n >= 0 ? n : vorgabe;
};

const fenster = new Map<string, { seit: number; zahl: number }>();

/** Sicherung gegen einen Fehler im Code, der in eine Rechnung mündet. */
const darfRufen = (
	was: string,
	proben: Array<[string, number, number]>,
): boolean => {
	const jetzt = Date.now();
	for (const [name, dauer, hoechstens] of proben) {
		const marke = `${was}:${name}`;
		const f = fenster.get(marke) ?? { seit: 0, zahl: 0 };
		fenster.set(marke, f);
		if (jetzt - f.seit > dauer) {
			f.seit = jetzt;
			f.zahl = 0;
		}
		if (f.zahl >= hoechstens) {
			log(`Bremse: mehr als ${hoechstens} ${was} je ${name}`);
			return false;
		}
	}
	for (const [name] of proben) {
		const f = fenster.get(`${was}:${name}`);
		if (f) f.zahl++;
	}
	return true;
};

const darfErzeugen = (): boolean =>
	darfRufen("Ansagen", [
		["Minute", 60_000, grenze("ANSAGEN_JE_MINUTE", 40)],
		["Stunde", 3_600_000, grenze("ANSAGEN_JE_STUNDE", 300)],
	]);

const darfFormulieren = (): boolean =>
	darfRufen("Moderationen", [
		["Minute", 60_000, grenze("MODERATIONEN_JE_MINUTE", 20)],
		["Stunde", 3_600_000, grenze("MODERATIONEN_JE_STUNDE", 200)],
	]);

export const setzeBremseZurueck = (): void => fenster.clear();

const laufend = new Map<string, Promise<boolean>>();

export const protokolliere = (text: string): void =>
	console.log(`[${new Date().toISOString()}] ansage: ${text}`);

const log = protokolliere;

export const moderationsModell = (): string =>
	process.env.MODERATION_MODELL?.trim() || MODERATION_MODELL;

/** Die Moderation läuft, solange sie nicht ausdrücklich abgestellt wird. */
export const moderationAn = (): boolean =>
	process.env.ANSAGE_MODERATION !== "0";

export const moderationSchluessel = (kontext: string): string =>
	createHash("sha256")
		.update(
			[
				MODERATION_FASSUNG,
				moderationsModell(),
				MODERATION_ANWEISUNG,
				kontext,
			].join(" "),
		)
		.digest("hex")
		.slice(0, 24);

export const moderationPfad = (kontext: string): string =>
	join(ansagenVerzeichnis(), `${moderationSchluessel(kontext)}.txt`);

export type Formulierung = {
	satz: string;
	/** Woher der Satz kommt – die Zeile im Protokoll nennt genau das. */
	quelle: "modell" | "zwischenspeicher" | "fest";
	grund?: string;
	/** Wie lange der Aufruf gedauert hat; ohne Aufruf nicht gesetzt. */
	dauerMs?: number;
};

const moderationen = new Map<string, Promise<Formulierung>>();

export const formuliere = async (
	schub: Schub,
	fristMs = 8_000,
): Promise<Formulierung> => {
	const fest = schub.fest.trim();
	if (!moderationAn())
		return { satz: fest, quelle: "fest", grund: "Moderation abgestellt" };
	if (!fest)
		return { satz: fest, quelle: "fest", grund: "keine feste Formulierung" };
	const kontext = kontextText(schub);
	const ziel = moderationPfad(kontext);
	if (existsSync(ziel)) {
		const da = readFileSync(ziel, "utf8").trim();
		if (da) return { satz: da, quelle: "zwischenspeicher" };
	}
	if (!dienstBereit("moderation"))
		return {
			satz: fest,
			quelle: "fest",
			grund: riegel.moderation
				? `Riegel ${riegel.moderation}`
				: "kein Schlüssel",
		};
	const schon = moderationen.get(ziel);
	if (schon) return schon;
	if (!darfFormulieren())
		return {
			satz: fest,
			quelle: "fest",
			grund: "Bremse – Obergrenze je Minute oder Stunde erreicht",
		};
	const lauf = frage(kontext, fest, ziel, fristMs).finally(() =>
		moderationen.delete(ziel),
	);
	moderationen.set(ziel, lauf);
	return lauf;
};

const frage = async (
	kontext: string,
	fest: string,
	ziel: string,
	fristMs: number,
): Promise<Formulierung> => {
	const begonnen = Date.now();
	try {
		const antwort = await fetch(MODERATION_URL(), {
			method: "POST",
			headers: {
				authorization: `Bearer ${schluessel()}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({
				model: moderationsModell(),
				messages: [
					{ role: "system", content: MODERATION_ANWEISUNG },
					{ role: "user", content: kontext },
				],
				max_completion_tokens: 500,
			}),
			signal: AbortSignal.timeout(fristMs),
		});
		if (!antwort.ok) {
			const rumpf = await antwort.text().catch(() => "");
			if (istEndgueltig(antwort.status, rumpf)) {
				riegel.moderation = `HTTP ${antwort.status}`;
				log(
					`Textmodell weist den Schlüssel ab (${riegel.moderation}) – ab jetzt feste Formulierung, keine weiteren Versuche`,
				);
			}
			return {
				satz: fest,
				quelle: "fest",
				grund: `Textmodell antwortet HTTP ${antwort.status}`,
			};
		}
		const daten = (await antwort.json()) as {
			choices?: Array<{ message?: { content?: string } }>;
		};
		const roh = daten.choices?.[0]?.message?.content ?? "";
		const geprueft = pruefeAntwort(roh, kontext);
		if ("fehler" in geprueft)
			return {
				satz: fest,
				quelle: "fest",
				grund: `Antwort verworfen: ${geprueft.fehler}`,
				dauerMs: Date.now() - begonnen,
			};
		schreibeAtomar(ziel, Buffer.from(geprueft.satz, "utf8"));
		return {
			satz: geprueft.satz,
			quelle: "modell",
			dauerMs: Date.now() - begonnen,
		};
	} catch (e) {
		const fehler = e as Error;
		return {
			satz: fest,
			quelle: "fest",
			grund:
				fehler.name === "TimeoutError"
					? `Zeitüberschreitung nach ${fristMs} ms`
					: `Aufruf misslungen: ${fehler.message}`,
			dauerMs: Date.now() - begonnen,
		};
	}
};

export const erzeugeAnsage = async (
	text: string,
	stimme: string = standardStimme(),
	fristMs = 15_000,
): Promise<boolean> => {
	const satz = text.trim();
	if (!satz || satz.length > ANSAGE_HOECHSTLAENGE) {
		log(
			`keine Aufnahme: Satz ${satz ? `${satz.length} Zeichen, über ${ANSAGE_HOECHSTLAENGE}` : "leer"}`,
		);
		return false;
	}
	if (!istDienstStimme(stimme)) {
		log(`keine Aufnahme: Stimme „${stimme}" gibt es nicht`);
		return false;
	}
	const ziel = ansagePfad(satz, stimme);
	if (existsSync(ziel)) return true;
	if (!dienstBereit()) {
		log(
			`keine Aufnahme: ${riegel.stimme ? `Riegel ${riegel.stimme}` : "kein Schlüssel"}`,
		);
		return false;
	}
	const schon = laufend.get(ziel);
	if (schon) return schon;
	if (!darfErzeugen()) return false;
	const lauf = hole(satz, stimme, ziel, fristMs).finally(() =>
		laufend.delete(ziel),
	);
	laufend.set(ziel, lauf);
	return lauf;
};

const hole = async (
	satz: string,
	stimme: string,
	ziel: string,
	fristMs: number,
): Promise<boolean> => {
	const begonnen = Date.now();
	try {
		const antwort = await fetch(STIMME_URL(), {
			method: "POST",
			headers: {
				authorization: `Bearer ${schluessel()}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({
				model: modell(),
				voice: stimme,
				input: satz,
				instructions: ANSAGE_ANWEISUNG,
				response_format: "mp3",
			}),
			signal: AbortSignal.timeout(fristMs),
		});
		if (!antwort.ok) {
			const rumpf = await antwort.text().catch(() => "");
			if (istEndgueltig(antwort.status, rumpf)) {
				riegel.stimme = `HTTP ${antwort.status}`;
				log(
					`Sprachmodell weist den Schlüssel ab (${riegel.stimme}) – ab jetzt keine Ansage, keine weiteren Versuche`,
				);
			} else
				log(`keine Aufnahme: Sprachmodell antwortet HTTP ${antwort.status}`);
			return false;
		}
		const daten = Buffer.from(await antwort.arrayBuffer());
		if (daten.length === 0) {
			log("keine Aufnahme: Sprachmodell schickt keine Daten");
			return false;
		}
		schreibeAtomar(ziel, daten);
		log(`Aufnahme ${stimme}: ${Date.now() - begonnen} ms`);
		return true;
	} catch (e) {
		const fehler = e as Error;
		log(
			`keine Aufnahme: ${
				fehler.name === "TimeoutError"
					? `Zeitüberschreitung nach ${fristMs} ms`
					: `Aufruf misslungen (${fehler.message})`
			}`,
		);
		return false;
	}
};

const schreibeAtomar = (ziel: string, daten: Buffer): void => {
	mkdirSync(dirname(ziel), { recursive: true });
	const zwischen = `${ziel}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
	try {
		writeFileSync(zwischen, daten);
		renameSync(zwischen, ziel);
	} catch (e) {
		try {
			if (existsSync(zwischen)) unlinkSync(zwischen);
		} catch {}
		throw e;
	}
};

export const vorproduziere = (
	text: string,
	behoerde: string,
	stimme: string = standardStimme(),
): void => {
	if (!dienstBereit()) return;
	if (!istAnsageBehoerde(behoerde)) return;
	void erzeugeAnsage(text, stimme).catch(() => false);
};
