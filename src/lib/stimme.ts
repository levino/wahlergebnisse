import { tonFrei } from "./klang.ts";
import {
	ANSAGE_FRIST_MS,
	ANSAGE_STIMME_STANDARD,
	type AnsageStand,
	ansageStandUrl,
	ansageUrl,
	istDienstStimme,
} from "./ansage.ts";

/** Ansage an oder aus – dieselbe Schublade wie beim Ton. */
export const STIMME_SCHLUESSEL = "wahlen:ansage";
/** Welche Stimme: `dienst:marin` oder `browser:Anna (Premium)`. */
export const STIMMEN_SCHLUESSEL = "wahlen:stimme";

export type StimmenAngabe = {
	name: string;
	lang: string;
	voiceURI?: string;
	/** Wird bewusst **nicht** ausgewertet – siehe `bewerte`. */
	localService?: boolean;
};

export type Guete = "premium" | "netz" | "einfach" | "roboter";

const SYSTEMSTIMMEN =
	/\b(Anna|Petra|Markus|Yannick|Helena|Martin|Viktor|Katja|Hedda|Stefan|Conrad|Amala|Killian|Seraphina|Florian|Gisela|Ingrid)\b/i;

const SPASSSTIMMEN =
	/\b(Zarvox|Trinoids|Bubbles|Bells|Boing|Jester|Superstar|Wobble|Organ|Cellos|Whisper|Bahh|Albert|Eddy|Flo|Grandma|Grandpa|Reed|Rocko|Sandy|Shelley|Junior|Ralph|Kathy|Bad News|Good News)\b/i;

const ROBOTERSTIMMEN = /espeak|e-speak|festival|flite|mbrola|pico|rhvoice/i;

const PREMIUM = /premium/i;
const ERWEITERT = /enhanced|erweitert/i;
const KOMPAKT = /kompakt|compact/i;
const NETZ = /\bgoogle\b|natural|neural|online/i;

const kennung = (s: StimmenAngabe): string => s.voiceURI || s.name;

export const istDeutsch = (s: StimmenAngabe): boolean =>
	Boolean(s.lang?.toLowerCase().startsWith("de"));

export const guete = (s: StimmenAngabe | undefined): Guete => {
	if (!s) return "roboter";
	const n = `${s.name} ${s.voiceURI ?? ""}`;
	if (ROBOTERSTIMMEN.test(n)) return "roboter";
	if (PREMIUM.test(n) || ERWEITERT.test(n)) return "premium";
	if (NETZ.test(n)) return "netz";
	return "einfach";
};

const bewerte = (s: StimmenAngabe): number => {
	const n = `${s.name} ${s.voiceURI ?? ""}`;
	let p = 0;
	if (PREMIUM.test(n)) p += 100;
	else if (ERWEITERT.test(n)) p += 80;
	else if (NETZ.test(n)) p += 60;
	if (SYSTEMSTIMMEN.test(n)) p += 30;
	if (KOMPAKT.test(n)) p -= 15;
	if (s.lang?.toLowerCase().startsWith("de-de")) p += 10;
	if (SPASSSTIMMEN.test(n)) p -= 60;
	if (ROBOTERSTIMMEN.test(n)) p -= 200;
	return p;
};

/** Alle deutschen Stimmen, beste zuerst. Name als Gleichstand-Entscheid. */
export const deutscheStimmen = <T extends StimmenAngabe>(
	stimmen: readonly T[],
): T[] =>
	stimmen
		.filter(istDeutsch)
		.slice()
		.sort((a, b) => bewerte(b) - bewerte(a) || a.name.localeCompare(b.name));

export const waehleStimme = <T extends StimmenAngabe>(
	stimmen: readonly T[],
	wunsch?: string | null,
): T | undefined => {
	const deutsche = deutscheStimmen(stimmen);
	if (wunsch) {
		const gewuenscht = deutsche.find(
			(s) => kennung(s) === wunsch || s.name === wunsch,
		);
		if (gewuenscht) return gewuenscht;
	}
	return deutsche[0];
};

export const klang = (
	s: StimmenAngabe | undefined,
): { rate: number; pitch: number } => {
	switch (guete(s)) {
		case "premium":
			return { rate: 1.08, pitch: 1 };
		case "netz":
			return { rate: 1, pitch: 1 };
		case "roboter":
			return { rate: 0.92, pitch: 0.9 };
		default:
			return { rate: 1.04, pitch: 1 };
	}
};

export const PROBESATZ = "Ortsratswahl Rössing ist fertig ausgezählt.";

export const ansageAn = (): boolean => {
	try {
		return localStorage.getItem(STIMME_SCHLUESSEL) !== "aus";
	} catch {
		return true;
	}
};

export const setzeAnsage = (an: boolean): void => {
	try {
		localStorage.setItem(STIMME_SCHLUESSEL, an ? "an" : "aus");
	} catch {}
};

export type StimmenWahl = { art: "dienst" | "browser"; id: string };

export const leseWahl = (): StimmenWahl | undefined => {
	let roh = "";
	try {
		roh = localStorage.getItem(STIMMEN_SCHLUESSEL) ?? "";
	} catch {
		return undefined;
	}
	if (!roh) return undefined;
	if (roh.startsWith("dienst:")) return { art: "dienst", id: roh.slice(7) };
	if (roh.startsWith("browser:")) return { art: "browser", id: roh.slice(8) };
	return { art: "browser", id: roh };
};

export const schreibeWahl = (wahl: StimmenWahl | undefined): void => {
	try {
		if (wahl)
			localStorage.setItem(STIMMEN_SCHLUESSEL, `${wahl.art}:${wahl.id}`);
		else localStorage.removeItem(STIMMEN_SCHLUESSEL);
	} catch {}
};

/** Leer, wenn eine Dienststimme gewählt ist: dann gilt für den Rückfall die Rangfolge. */
export const stimmenWunsch = (): string => {
	const wahl = leseWahl();
	return wahl?.art === "browser" ? wahl.id : "";
};

export const stimmenKennung = (s: StimmenAngabe): string => kennung(s);

/** Welche Wahlleitung die Seite zeigt – entscheidet, ob es den Dienst gibt. */
let behoerde = "";
export const setzeBehoerde = (ags: string): void => {
	behoerde = ags;
};

export const stimmenListe = (): SpeechSynthesisVoice[] => {
	try {
		if (!("speechSynthesis" in window)) return [];
		return deutscheStimmen(speechSynthesis.getVoices());
	} catch {
		return [];
	}
};

export const beiStimmenwechsel = (wenn: () => void): void => {
	try {
		if (!("speechSynthesis" in window)) return;
		speechSynthesis.addEventListener?.("voiceschanged", wenn);
		wenn();
	} catch {}
};

/** Die Browserstimme, die gerade tatsächlich spräche. */
export const aktuelleStimme = (): SpeechSynthesisVoice | undefined => {
	try {
		if (!("speechSynthesis" in window)) return undefined;
		return waehleStimme(speechSynthesis.getVoices(), stimmenWunsch());
	} catch {
		return undefined;
	}
};

let dienststand: AnsageStand | undefined;

export const holeDienstStand = async (): Promise<AnsageStand | undefined> => {
	if (dienststand) return dienststand;
	try {
		const antwort = await fetch(ansageStandUrl(behoerde), {
			signal: AbortSignal.timeout(4000),
		});
		if (!antwort.ok) return undefined;
		dienststand = (await antwort.json()) as AnsageStand;
		return dienststand;
	} catch {
		return undefined;
	}
};

export const dienstStand = (): AnsageStand | undefined => dienststand;

let beiWechsel: (() => void) | undefined;

export const wennDienstWechselt = (fn: () => void): void => {
	beiWechsel = fn;
};

/** Der Server sagt: kein Dienst mehr. Ab jetzt gar nicht erst fragen. */
const dienstFaelltAus = (): void => {
	if (!dienststand?.verfuegbar) return;
	dienststand = { ...dienststand, verfuegbar: false };
	beiWechsel?.();
};

/** Die Dienststimme, die jetzt spräche – oder "" für „Browserstimme". */
export const dienstStimmeJetzt = (): string => {
	const wahl = leseWahl();
	if (wahl?.art === "browser") return "";
	if (!dienststand?.verfuegbar) return "";
	const vorgabe = dienststand.standard || ANSAGE_STIMME_STANDARD;
	const id = wahl?.id ?? vorgabe;
	return istDienstStimme(id) ? id : vorgabe;
};

export type AnsageHaken = {
	text: string;
	stimme: string;
	rate: number;
	pitch: number;
	grund:
		| "dienst"
		| "browser"
		| "wartet"
		| "keine-stimme"
		| "kein-dienst"
		| "gesperrt";
	meldung?: string;
};

let spurEmpfaenger: ((haken: AnsageHaken) => void) | undefined;

export const wennAnsageSpur = (fn: (haken: AnsageHaken) => void): void => {
	spurEmpfaenger = fn;
};

const merkeHaken = (haken: AnsageHaken): void => {
	try {
		(window as unknown as { __ansage?: AnsageHaken }).__ansage = haken;
	} catch {}
	if (haken.grund !== "dienst" && haken.grund !== "browser")
		console.warn(`Ansage stumm (${haken.grund}): ${haken.meldung ?? ""}`);
	try {
		spurEmpfaenger?.(haken);
	} catch {}
};

let laeuft: HTMLAudioElement | undefined;

const halteAn = (): void => {
	try {
		laeuft?.pause();
		laeuft = undefined;
		speechSynthesis.cancel();
	} catch {}
};

const sprichPerDienst = async (
	satz: string,
	stimme: string,
): Promise<string | undefined> => {
	try {
		const antwort = await fetch(ansageUrl(satz, stimme, behoerde), {
			signal: AbortSignal.timeout(ANSAGE_FRIST_MS),
		});
		if (antwort.status === 503) {
			const daten = (await antwort.json().catch(() => ({}))) as {
				fehler?: string;
				dienst?: boolean;
			};
			if (daten.dienst === false) dienstFaelltAus();
			return `Ansagedienst: ${daten.fehler ?? "keine Aufnahme"}`;
		}
		if (!antwort.ok) return `Ansagedienst antwortet HTTP ${antwort.status}`;
		const klang = await antwort.blob();
		if (klang.size === 0) return "Ansagedienst schickt keine Daten";
		const adresse = URL.createObjectURL(klang);
		const ton = new Audio(adresse);
		ton.addEventListener("ended", () => URL.revokeObjectURL(adresse));
		laeuft = ton;
		await ton.play();
		merkeHaken({ text: satz, stimme, rate: 1, pitch: 1, grund: "dienst" });
		return undefined;
	} catch (e) {
		const fehler = e as Error;
		return fehler.name === "TimeoutError"
			? `Aufnahme nicht binnen ${ANSAGE_FRIST_MS} ms da`
			: `Ansage misslungen: ${fehler.message}`;
	}
};

export const sprich = (satz: string, dringend = false): void => {
	if (!satz || !ansageAn()) return;
	void sage(satz, dringend);
};

/** Der Probeknopf spricht auch, wenn die Ansage aus steht – er ist das Zutun. */
export const sprichProbe = (satz = PROBESATZ): void => {
	void sage(satz, true);
};

const sage = async (satz: string, dringend: boolean): Promise<void> => {
	if (!tonFrei()) {
		merkeHaken({
			text: satz,
			stimme: "",
			rate: 0,
			pitch: 0,
			grund: "gesperrt",
			meldung: "Ton noch nicht freigegeben – einmal klicken",
		});
		return;
	}
	if (dringend) halteAn();
	if (leseWahl()?.art === "browser") {
		sprichBrowser(satz, dringend);
		return;
	}
	const dienst = dienstStimmeJetzt();
	if (!dienst) {
		merkeHaken({
			text: satz,
			stimme: "",
			rate: 0,
			pitch: 0,
			grund: "kein-dienst",
			meldung: dienststand
				? "Ansagedienst für diese Wahlleitung abgeschaltet"
				: "Stand des Ansagedienstes noch nicht geholt",
		});
		return;
	}
	const fehlte = await sprichPerDienst(satz, dienst);
	if (!fehlte) return;
	merkeHaken({
		text: satz,
		stimme: "",
		rate: 0,
		pitch: 0,
		grund: "kein-dienst",
		meldung: fehlte,
	});
};

let wartend: { satz: string; dringend: boolean } | undefined;
let horcht = false;
const WARTEZEIT_MS = 3000;

const horcheAufListe = (): void => {
	if (horcht) return;
	horcht = true;
	const nachholen = () => {
		const offen = wartend;
		wartend = undefined;
		if (offen) sprichBrowser(offen.satz, offen.dringend);
	};
	try {
		speechSynthesis.addEventListener?.("voiceschanged", nachholen);
	} catch {}
	setTimeout(() => {
		wartend = undefined;
	}, WARTEZEIT_MS);
};

const sprichBrowser = (satz: string, dringend: boolean): void => {
	try {
		if (!("speechSynthesis" in window)) return;
		const alle = speechSynthesis.getVoices();
		if (alle.length === 0) {
			wartend = { satz, dringend };
			horcheAufListe();
			merkeHaken({
				text: satz,
				stimme: "",
				rate: 0,
				pitch: 0,
				grund: "wartet",
			});
			return;
		}
		const stimme = waehleStimme(alle, stimmenWunsch());
		if (!stimme) {
			merkeHaken({
				text: satz,
				stimme: "",
				rate: 0,
				pitch: 0,
				grund: "keine-stimme",
			});
			return;
		}
		if (dringend || speechSynthesis.pending) speechSynthesis.cancel();
		const rede = new SpeechSynthesisUtterance(satz);
		rede.voice = stimme;
		rede.lang = stimme.lang || "de-DE";
		const { rate, pitch } = klang(stimme);
		rede.rate = rate;
		rede.pitch = pitch;
		merkeHaken({
			text: satz,
			stimme: stimme.name,
			rate,
			pitch,
			grund: "browser",
		});
		speechSynthesis.speak(rede);
	} catch {}
};
