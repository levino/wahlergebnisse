/**
 * Die Ansage: Was auf der Leinwand erscheint, wird auch gesagt.
 *
 * Zwei Wege, und die Reihenfolge ist die ganze Zusicherung dieses Moduls:
 * zuerst die erzeugte Ansage vom Server (`lib/ansage.ts`), sonst die Stimme
 * des Browsers. Ist der Dienst weg, langsam oder gar nicht eingerichtet, wird
 * der Satz trotzdem gesagt – ein Wahlabend darf an keiner fremden
 * Verfügbarkeit hängen.
 *
 * Die Browserstimmen sind der Rückfall und kein Ersatz: Auf dem Beamer-Mac
 * sind sie durchgehört worden, Kompakt wie Premium, und klingen alle nach den
 * Neunzigern. Die Auswahl hier sorgt dafür, dass wenigstens die beste davon
 * spricht – und niemals eine englische, die deutschen Text vorliest.
 */
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

/**
 * So viel von einer Stimme braucht die Rangfolge. Eigener Typ statt
 * `SpeechSynthesisVoice`, damit sie ohne Browser prüfbar ist.
 */
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

/**
 * Punkte einer Stimme, höher ist besser.
 *
 * `localService` kommt nicht vor: Das war der alte Fehler. Es sagt nichts über
 * den Klang, nur über den Ort – auf einem Mac mit geladener Premium-Stimme
 * richtig, auf Linux/Chrome ist die lokale Stimme eSpeak.
 */
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

/**
 * Die Stimme, mit der gesprochen wird. `wunsch` schlägt jede Rangfolge; gibt
 * es ihn auf diesem Gerät nicht, greift wieder die Rangfolge. Ohne deutsche
 * Stimme: `undefined` – dann wird geschwiegen.
 */
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

/**
 * Tempo und Tonhöhe je Stimme: „Google Deutsch" spricht von Haus aus zügig,
 * die Kompaktstimmen schleppen, und eSpeak wird erst langsamer verständlich.
 */
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
	} catch {
		// Nicht speicherbar – gilt dann nur für diese Sitzung.
	}
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
	} catch {
		// Nicht speicherbar – gilt dann nur für diese Sitzung.
	}
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

/**
 * Chrome liefert `getVoices()` beim ersten Mal leer und meldet die Liste über
 * `voiceschanged` nach; Safari füllt sie sofort und feuert nichts. Beides.
 */
export const beiStimmenwechsel = (wenn: () => void): void => {
	try {
		if (!("speechSynthesis" in window)) return;
		speechSynthesis.addEventListener?.("voiceschanged", wenn);
		wenn();
	} catch {
		// Kein Sprachausgabedienst – dann bleibt die Auswahl leer.
	}
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

/**
 * Wird gerufen, wenn der Ansagedienst wegfällt, während die Seite offen ist.
 *
 * Ein Schlüssel kann mitten am Abend ablaufen. Die Leinwand spricht dann
 * weiter – aber die Leiste sagt ohnehin, welche Stimme wirklich spricht, und
 * das darf nicht stehenbleiben, bis jemand neu lädt.
 */
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
	const id = wahl?.id ?? ANSAGE_STIMME_STANDARD;
	return istDienstStimme(id) ? id : ANSAGE_STIMME_STANDARD;
};

/**
 * Der Haken für die Browser-Tests: Playwright kann nicht hören, prüfbar ist
 * nur, welche Stimme **angefordert** wurde.
 */
export type AnsageHaken = {
	text: string;
	stimme: string;
	rate: number;
	pitch: number;
	grund: "dienst" | "browser" | "wartet" | "keine-stimme";
};

const merkeHaken = (haken: AnsageHaken): void => {
	try {
		(window as unknown as { __ansage?: AnsageHaken }).__ansage = haken;
	} catch {
		// Ohne Fenster gibt es nichts zu merken.
	}
};

let laeuft: HTMLAudioElement | undefined;

const halteAn = (): void => {
	try {
		laeuft?.pause();
		laeuft = undefined;
		speechSynthesis.cancel();
	} catch {
		// Nichts anzuhalten.
	}
};

/**
 * Erst holen, dann abspielen – nur so gibt es eine Frist. Ein `<audio>`, das
 * lädt, lädt; spräche es nach acht Sekunden los, redete es in die übernächste
 * Meldung hinein.
 */
const sprichPerDienst = async (
	satz: string,
	stimme: string,
): Promise<boolean> => {
	try {
		const antwort = await fetch(ansageUrl(satz, stimme, behoerde), {
			signal: AbortSignal.timeout(ANSAGE_FRIST_MS),
		});
		// 503 heißt: Der Server hat den Dienst abgeriegelt (ungültiger
		// Schlüssel, leeres Kontingent). Weiter zu fragen kostete je Meldung
		// die volle Frist, bevor der Browser einspringt.
		if (antwort.status === 503) dienstFaelltAus();
		if (!antwort.ok) return false;
		const klang = await antwort.blob();
		if (klang.size === 0) return false;
		const adresse = URL.createObjectURL(klang);
		const ton = new Audio(adresse);
		ton.addEventListener("ended", () => URL.revokeObjectURL(adresse));
		laeuft = ton;
		await ton.play();
		merkeHaken({ text: satz, stimme, rate: 1, pitch: 1, grund: "dienst" });
		return true;
	} catch {
		// Frist, Netzfehler oder ein Browser, der ohne Zutun keinen Ton zulässt.
		return false;
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
	if (dringend) halteAn();
	const dienst = dienstStimmeJetzt();
	if (dienst && (await sprichPerDienst(satz, dienst))) return;
	sprichBrowser(satz, dringend);
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
	} catch {
		// Kein Ereignis – dann greift der Zeitablauf.
	}
	setTimeout(() => {
		wartend = undefined;
	}, WARTEZEIT_MS);
};

const sprichBrowser = (satz: string, dringend: boolean): void => {
	try {
		if (!("speechSynthesis" in window)) return;
		const alle = speechSynthesis.getVoices();
		// Liste noch nicht da (Chrome füllt sie asynchron): zurückstellen statt
		// falsch sprechen.
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
		// Keine deutsche Stimme heißt: still bleiben. Ohne gesetzte `voice`
		// nimmt der Browser seine Vorgabestimme, und die ist meist englisch –
		// „Ortsratswahl Rössing", englisch ausgesprochen, ist im Saal schlimmer
		// als Stille. `utterance.lang` ändert daran nichts.
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
	} catch {
		// Kein Sprachausgabedienst – dann bleibt es bei Einblender und Ton.
	}
};
