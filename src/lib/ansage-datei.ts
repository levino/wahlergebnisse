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
	istDienstStimme,
} from "./ansage.ts";
import { dbPfad } from "./db.ts";

const DIENST_URL = () =>
	process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1/audio/speech";

const schluessel = (): string => process.env.OPENAI_API_KEY?.trim() ?? "";

export const dienstBereit = (): boolean => schluessel().length > 0;

/**
 * Die Wahlleitung, für die die teure Stimme läuft. Alle anderen bekommen die
 * Browserstimme – landesweit für jede Gemeinde zu erzeugen wäre nicht zu
 * bezahlen.
 */
export const ANSAGE_BEHOERDE = (): string =>
	process.env.ANSAGE_BEHOERDE?.trim() || "03254026";

export const istAnsageBehoerde = (ags: string): boolean =>
	ags === ANSAGE_BEHOERDE();

export const ansagenVerzeichnis = (): string =>
	process.env.ANSAGEN_PFAD ?? join(dirname(dbPfad()), "ansagen");

export const ansageSchluessel = (text: string, stimme: string): string =>
	createHash("sha256")
		.update(
			[ANSAGE_FASSUNG, ANSAGE_MODELL, stimme, ANSAGE_ANWEISUNG, text].join(" "),
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

const fenster = { minute: { seit: 0, zahl: 0 }, stunde: { seit: 0, zahl: 0 } };

/** Sicherung gegen einen Fehler im Code, der in eine Rechnung mündet. */
const darfErzeugen = (): boolean => {
	const jetzt = Date.now();
	const proben: [keyof typeof fenster, number, number][] = [
		["minute", 60_000, grenze("ANSAGEN_JE_MINUTE", 40)],
		["stunde", 3_600_000, grenze("ANSAGEN_JE_STUNDE", 300)],
	];
	for (const [name, dauer, hoechstens] of proben) {
		const f = fenster[name];
		if (jetzt - f.seit > dauer) {
			f.seit = jetzt;
			f.zahl = 0;
		}
		if (f.zahl >= hoechstens) {
			log(`Bremse: mehr als ${hoechstens} Ansagen je ${name} – Browserstimme`);
			return false;
		}
	}
	fenster.minute.zahl++;
	fenster.stunde.zahl++;
	return true;
};

export const setzeBremseZurueck = (): void => {
	fenster.minute = { seit: 0, zahl: 0 };
	fenster.stunde = { seit: 0, zahl: 0 };
};

const laufend = new Map<string, Promise<boolean>>();

const log = (text: string): void =>
	console.log(`[${new Date().toISOString()}] ansage: ${text}`);

/**
 * Die Stelle, an der aus einem Ereignis ein gesprochener Satz wird.
 *
 * Der Betreiber möchte später eine Moderation davor („Ah, da kommen neue
 * Zahlen – ich schaue mal …"). Das braucht ein Textmodell; der Schlüssel darf
 * heute ausschließlich Sprachausgabe. Bis dahin bleibt es beim festen
 * Satzbau, und diese Funktion ist die Naht, an der es später ansetzt.
 */
export const formuliere = (satz: string): string => {
	if (process.env.ANSAGE_MODERATION !== "1") return satz;
	log("Moderation gewünscht, aber kein Textmodell erlaubt – fester Satzbau");
	return satz;
};

export const erzeugeAnsage = async (
	text: string,
	stimme: string = ANSAGE_STIMME_STANDARD,
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
				model: ANSAGE_MODELL,
				voice: stimme,
				input: satz,
				instructions: ANSAGE_ANWEISUNG,
				response_format: "mp3",
			}),
			signal: AbortSignal.timeout(fristMs),
		});
		if (!antwort.ok) {
			log(`Dienst antwortet ${antwort.status} – Browserstimme`);
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
	stimme: string = ANSAGE_STIMME_STANDARD,
): void => {
	if (!dienstBereit()) return;
	if (!istAnsageBehoerde(behoerde)) return;
	void erzeugeAnsage(formuliere(text), stimme).catch(() => false);
};
