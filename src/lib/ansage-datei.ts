/**
 * Die erzeugten Ansagen auf der Platte.
 *
 * Die Datei entsteht, während der Server die Leinwandseite rendert – also
 * bevor der Browser die neuen Zahlen überhaupt anzeigt und lange bevor er die
 * Ansage anfordert. Vorgezogen wird schon eine Schnellmeldung früher (siehe
 * `ansagenVorbereiten` in `dashboard.ts`), damit die Aufnahme dasteht, wenn
 * die letzte Meldung eintrifft.
 *
 * Vier Riegel stehen vor jeder Erzeugung, und der erste ist der wichtigste:
 *   1. Sieht gerade jemand zu? Erzeugt wird beim Rendern der Leinwandseite –
 *      ohne Zuschauer kein Rendern und damit kein Aufruf (`vorproduziere`).
 *   2. Ist es die Wahlleitung, für die der Dienst bezahlt wird?
 *   3. Gibt es die Aufnahme schon? Wiederholungen kosten nichts.
 *   4. Ist die Obergrenze je Minute/Stunde erreicht?
 */
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

const DIENST_URL = () =>
	process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1/audio/speech";

const schluessel = (): string => process.env.OPENAI_API_KEY?.trim() ?? "";

/**
 * Abgeriegelt, weil der Schlüssel nicht gilt oder das Kontingent leer ist.
 *
 * Ein ungültiger Schlüssel repariert sich nicht von selbst. Ohne diesen
 * Riegel liefe jede Meldung des Abends in die volle Frist, bevor der Browser
 * einspringt – zweieinhalb Sekunden Verzögerung je Ansage und eine
 * Protokollzeile je Versuch. Das ist die Sorte Fehler, die niemand sucht,
 * weil ja „alles funktioniert". Also einmal feststellen, abriegeln,
 * Browserstimme, eine einzige Zeile ins Protokoll.
 *
 * Gilt für die Laufzeit des Prozesses: Ein neu ausgerollter Schlüssel kommt
 * ohnehin mit neuen Pods.
 */
let abgeriegelt = "";

export const dienstBereit = (): boolean =>
	schluessel().length > 0 && !abgeriegelt;

/** Nur für Tests. */
export const oeffneRiegel = (): void => {
	abgeriegelt = "";
};

/**
 * Antworten, nach denen ein weiterer Versuch sinnlos ist.
 *
 * 401 und 403 heißen: falscher, abgelaufener oder zu knapp berechtigter
 * Schlüssel. 429 heißt normalerweise „zu schnell" – das geht vorbei und wird
 * nicht abgeriegelt; nennt der Dienst dabei aber ein erschöpftes Kontingent,
 * ist es derselbe Fall wie 401.
 */
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
/**
 * Modell und Vorgabestimme sind am Server verstellbar – ohne Deploy.
 *
 * Am Wahlabend will niemand auf ein neues Image warten, weil die Stimme über
 * die Anlage anders trägt als über Kopfhörer oder weil ein Alias verrutscht
 * ist. Beides zählt in den Dateinamen hinein: Eine Umstellung erzeugt neue
 * Aufnahmen, statt alte und neue zu mischen.
 */
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

const log = (text: string): void =>
	console.log(`[${new Date().toISOString()}] ansage: ${text}`);

const MODERATION_URL = (): string =>
	process.env.OPENAI_CHAT_URL ?? "https://api.openai.com/v1/chat/completions";

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

const moderationen = new Map<string, Promise<string>>();

/**
 * Die Stelle, an der aus einem Schub ein gesprochener Satz wird.
 *
 * Aus dem ganzen Schub **ein** Satz: Kommen fünf Meldungen zusammen, spricht
 * niemand fünf davon und hängt „und zwei weitere Meldungen" an, sondern sagt,
 * was zusammen passiert ist. Formuliert wird das vom Textmodell; die feste
 * Formulierung geht als Vorlage mit und bleibt der Rückfall.
 *
 * Zwischengespeichert wird über dem **Schub** und nicht über der Uhrzeit –
 * dieselbe Regel wie beim Ton: Die Generalprobe spielt jeden Durchlauf gleich,
 * also kostet der zweite nichts.
 */
export const formuliere = async (
	schub: Schub,
	fristMs = 8_000,
): Promise<string> => {
	const fest = schub.fest.trim();
	if (!moderationAn() || !fest) return fest;
	const kontext = kontextText(schub);
	const ziel = moderationPfad(kontext);
	if (existsSync(ziel)) {
		const da = readFileSync(ziel, "utf8").trim();
		if (da) return da;
	}
	if (!dienstBereit()) return fest;
	const schon = moderationen.get(ziel);
	if (schon) return schon;
	if (!darfFormulieren()) return fest;
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
): Promise<string> => {
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
				max_completion_tokens: 160,
			}),
			signal: AbortSignal.timeout(fristMs),
		});
		if (!antwort.ok) {
			const rumpf = await antwort.text().catch(() => "");
			if (istEndgueltig(antwort.status, rumpf)) {
				abgeriegelt = `HTTP ${antwort.status}`;
				log(
					`Dienst weist den Schlüssel ab (${abgeriegelt}) – ab jetzt feste Formulierung, keine weiteren Versuche`,
				);
			} else log(`Textmodell antwortet ${antwort.status} – feste Formulierung`);
			return fest;
		}
		const daten = (await antwort.json()) as {
			choices?: Array<{ message?: { content?: string } }>;
		};
		const roh = daten.choices?.[0]?.message?.content ?? "";
		const geprueft = pruefeAntwort(roh, kontext, ANSAGE_HOECHSTLAENGE);
		if ("fehler" in geprueft) {
			log(`Moderation verworfen (${geprueft.fehler}) – feste Formulierung`);
			return fest;
		}
		schreibeAtomar(ziel, Buffer.from(geprueft.satz, "utf8"));
		log(`moderiert in ${Date.now() - begonnen} ms: „${geprueft.satz}"`);
		return geprueft.satz;
	} catch (e) {
		log(
			`Moderation fehlgeschlagen (${(e as Error).message}) – feste Formulierung`,
		);
		return fest;
	}
};

export const erzeugeAnsage = async (
	text: string,
	stimme: string = standardStimme(),
	fristMs = 15_000,
): Promise<boolean> => {
	const satz = text.trim();
	if (!satz || satz.length > ANSAGE_HOECHSTLAENGE) return false;
	if (!istDienstStimme(stimme)) return false;
	const ziel = ansagePfad(satz, stimme);
	if (existsSync(ziel)) return true;
	if (!dienstBereit()) return false;
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
		const antwort = await fetch(DIENST_URL(), {
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
				abgeriegelt = `HTTP ${antwort.status}`;
				log(
					`Dienst weist den Schlüssel ab (${abgeriegelt}) – ab jetzt Browserstimme, keine weiteren Versuche`,
				);
			} else log(`Dienst antwortet ${antwort.status} – Browserstimme`);
			return false;
		}
		const daten = Buffer.from(await antwort.arrayBuffer());
		if (daten.length === 0) return false;
		schreibeAtomar(ziel, daten);
		log(`„${satz.slice(0, 60)}" (${stimme}): ${Date.now() - begonnen} ms`);
		return true;
	} catch (e) {
		log(`fehlgeschlagen (${(e as Error).message}) – Browserstimme`);
		return false;
	}
};

/**
 * Erst daneben schreiben, dann umbenennen: Am Wahlabend teilen sich zwei
 * Web-Pods das Volume (`/data` ist beschreibbar eingehängt, nur die Datenbank
 * öffnen sie lesend – siehe `rolle.ts`). `rename` ist atomar, ein Leser sieht
 * die Datei nie halb.
 */
const schreibeAtomar = (ziel: string, daten: Buffer): void => {
	mkdirSync(dirname(ziel), { recursive: true });
	const zwischen = `${ziel}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
	try {
		writeFileSync(zwischen, daten);
		renameSync(zwischen, ziel);
	} catch (e) {
		try {
			if (existsSync(zwischen)) unlinkSync(zwischen);
		} catch {
			// Die Zwischendatei stört niemanden.
		}
		throw e;
	}
};

/**
 * Erzeugen lassen und weitergehen – gerufen beim Rendern der Leinwandseite.
 *
 * Dort und nur dort stimmen beide Bedingungen von selbst: Der Satz ist
 * derselbe, den der Browser gleich anfordert (er entsteht aus derselben
 * Folie), und **es sieht jemand zu** – sonst würde die Seite nicht gerendert.
 * Sieht niemand hin, entsteht landesweit keine Datei und kein Aufruf.
 *
 * Gewartet wird nicht: Die Seite darf an keinem fremden Dienst hängen.
 */
export const vorproduziere = (
	text: string,
	behoerde: string,
	stimme: string = standardStimme(),
): void => {
	if (!dienstBereit()) return;
	if (!istAnsageBehoerde(behoerde)) return;
	void erzeugeAnsage(text, stimme).catch(() => false);
};
