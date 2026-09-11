import {
	ANSAGE_FRIST_MS,
	type AnsageStand,
	ansageStandUrl,
	ansageUrl,
} from "./ansage.ts";
import { type Wartend, einreihen, naechste } from "./ansage-schlange.ts";
import { tonAn, tonFrei } from "./klang.ts";

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

let laeuft: { klang: HTMLAudioElement; adresse: string } | undefined;

type Wartender = { satz: string; klang: HTMLAudioElement; adresse: string };

let schlange: Wartend<Wartender>[] = [];

const gibFrei = (adresse: string): void => {
	try {
		URL.revokeObjectURL(adresse);
	} catch {}
};

/**
 * Sofort still sein.
 *
 * Wer im Saal die Glocke drückt, will reden – dann hat die Stimme zu
 * schweigen, und zwar die laufende Ansage mitsamt allem, was noch wartet.
 * Nachgeholt wird nichts: Die Einblender standen sichtbar da, und eine Zahl
 * nachzureichen, die inzwischen überholt ist, wäre der falsche Dienst.
 */
export const verstumme = (): void => {
	try {
		laeuft?.klang.pause();
	} catch {}
	if (laeuft) gibFrei(laeuft.adresse);
	laeuft = undefined;
	for (const wartend of schlange) gibFrei(wartend.last.adresse);
	schlange = [];
	try {
		if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
	} catch {}
};

/** Nur für Tests: die Schlange leeren. */
export const leereSchlange = (): void => {
	schlange = [];
	laeuft = undefined;
};

/**
 * Eine nach der anderen.
 *
 * Was beim Drankommen zu alt ist, entfällt: Eine Zahl von vorhin vorzulesen
 * ist schlechter als Schweigen. Ein Fehlschlag beim Abspielen hält die
 * Schlange nicht an, sonst stünde sie für immer.
 */
const pruefeSchlange = (): void => {
	if (laeuft) return;
	if (!tonAn()) return;
	const griff = naechste(schlange, Date.now());
	schlange = griff.rest;
	for (const alt of griff.verfallen)
		merkeHaken({
			text: alt.last.satz,
			grund: "kein-dienst",
			meldung: "Ansage war beim Drankommen überholt",
		});
	const dran = griff.naechste;
	if (!dran) return;
	const { satz, klang, adresse } = dran.last;
	laeuft = { klang, adresse };
	const weiter = () => {
		if (laeuft?.klang !== klang) return;
		gibFrei(adresse);
		laeuft = undefined;
		pruefeSchlange();
	};
	klang.addEventListener("ended", weiter, { once: true });
	klang.addEventListener("error", weiter, { once: true });
	klang
		.play()
		.then(() => merkeHaken({ text: satz, grund: "dienst" }))
		.catch((e: Error) => {
			merkeHaken({
				text: satz,
				grund: "kein-dienst",
				meldung: `Ansage misslungen: ${e.message}`,
			});
			weiter();
		});
};

const sprichPerDienst = async (
	satz: string,
	dringend: boolean,
): Promise<string | undefined> => {
	const seit = Date.now();
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
		// Einreihen statt sofort abspielen: Zwei Stimmen übereinander versteht
		// im Saal niemand, und eine laufende abzuschneiden ist schlimmer als
		// zu warten.
		schlange = einreihen(schlange, {
			last: { satz, klang: ton, adresse },
			seit,
			dringend,
		});
		pruefeSchlange();
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
	const fehlte = await sprichPerDienst(satz, dringend);
	if (!fehlte) return;
	merkeHaken({ text: satz, grund: "kein-dienst", meldung: fehlte });
};
