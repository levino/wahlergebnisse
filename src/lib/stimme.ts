import {
	ANSAGE_FRIST_MS,
	type AnsageStand,
	ansageStandUrl,
	ansageUrl,
} from "./ansage.ts";
import { tonFrei } from "./klang.ts";

/** Ansage an oder aus – dieselbe Schublade wie beim Ton. */
export const STIMME_SCHLUESSEL = "wahlen:ansage";

export const PROBESATZ = "Ortsratswahl Rössing ist fertig ausgezählt.";

/** Auflage des Anbieters: Es muss dastehen, dass die Stimme erzeugt ist. */
export const STIMME_HINWEIS = "Die Ansage spricht eine synthetische Stimme";

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

/** Welche Wahlleitung die Seite zeigt – entscheidet, ob es den Dienst gibt. */
let behoerde = "";
export const setzeBehoerde = (ags: string): void => {
	behoerde = ags;
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

export const ansageLaeuft = (): boolean => dienststand?.verfuegbar === true;

export type AnsageHaken = {
	text: string;
	grund: "dienst" | "kein-dienst" | "gesperrt";
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
	if (haken.grund !== "dienst")
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
	} catch {}
};

const sprichPerDienst = async (satz: string): Promise<string | undefined> => {
	try {
		const antwort = await fetch(ansageUrl(satz, behoerde), {
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
		merkeHaken({ text: satz, grund: "dienst" });
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
			grund: "gesperrt",
			meldung: "Ton noch nicht freigegeben – einmal klicken",
		});
		return;
	}
	if (dringend) halteAn();
	if (!ansageLaeuft()) {
		merkeHaken({
			text: satz,
			grund: "kein-dienst",
			meldung: dienststand
				? "Ansagedienst für diese Wahlleitung abgeschaltet"
				: "Stand des Ansagedienstes noch nicht geholt",
		});
		return;
	}
	const fehlte = await sprichPerDienst(satz);
	if (!fehlte) return;
	merkeHaken({ text: satz, grund: "kein-dienst", meldung: fehlte });
};
