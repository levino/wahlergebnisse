import { type Wartend, einreihen, naechste } from "./beitrag-schlange.ts";
import { tonFrei } from "./klang.ts";

/** Ansage an oder aus – dieselbe Schublade wie beim Ton. */
export const STIMME_SCHLUESSEL = "wahlen:ansage";

/** Auflage des Anbieters: Es muss dastehen, dass die Stimme erzeugt ist. */
export const STIMME_HINWEIS = "Die Ansage spricht eine synthetische Stimme";

/** So lange darf das Holen einer hinterlegten Aufnahme dauern. */
export const AUFNAHME_FRIST_MS = 10_000;

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

export type AnsageHaken = {
	/** Adresse der Aufnahme – einen Satz bekommt der Browser nie zu sehen. */
	url: string;
	grund: "gespielt" | "keine-aufnahme" | "gesperrt" | "aus" | "verfallen";
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
	if (haken.grund !== "gespielt")
		console.warn(`Ansage stumm (${haken.grund}): ${haken.meldung ?? ""}`);
	try {
		spurEmpfaenger?.(haken);
	} catch {}
};

/**
 * Ein Moderationsbeitrag, wie ihn der Client abspielt.
 *
 * Er besteht aus zwei Teilen, die zusammengehören: dem Einblender auf der
 * Leinwand und der Aufnahme, die gesprochen wird. Erst wenn die Aufnahme
 * vollständig geladen und an der Reihe ist, erscheint beides gemeinsam – der
 * Abstand zwischen ihnen ist das, was im Saal stört.
 */
export type Beitrag = {
	/** Adresse der Aufnahme; ohne sie gibt es nichts zu laden. */
	url?: string;
	/** Fertig ausgezählt, Jubel, Abstieg – kommt vor dem Gewöhnlichen dran. */
	dringend?: boolean;
	/** Der Einblender. Läuft, wenn die Ansage an der Reihe ist. */
	zeige: () => void;
	/** Der Ton zur Ansage. Entfällt, wenn sie verfällt. */
	ton?: () => void;
};

type Eintrag = { beitrag: Beitrag; klang: HTMLAudioElement; url: string };

let schlange: Wartend<Eintrag>[] = [];
let laeuft: HTMLAudioElement | undefined;

const sofort = (a: Beitrag): void => {
	a.ton?.();
	a.zeige();
};

/**
 * Einen Moderationsbeitrag einreihen.
 *
 * Ohne Aufnahme, ohne freigegebenen Ton oder bei abgeschalteter Ansage gibt es
 * nichts zu laden – dann erscheint der Einblender sofort. Gewartet wird nur auf
 * eine Datei, die auch kommt.
 */
export const reiheBeitragEin = (auftrag: Beitrag): void => {
	if (!auftrag.url) {
		sofort(auftrag);
		merkeHaken({
			url: "",
			grund: "keine-aufnahme",
			meldung: "Zu diesem Beitrag gibt es keine Aufnahme",
		});
		return;
	}
	if (!ansageAn()) {
		sofort(auftrag);
		merkeHaken({
			url: auftrag.url,
			grund: "aus",
			meldung: "Ansage ist abgeschaltet",
		});
		return;
	}
	if (!tonFrei()) {
		sofort(auftrag);
		merkeHaken({
			url: auftrag.url,
			grund: "gesperrt",
			meldung: "Ton noch nicht freigegeben – einmal klicken",
		});
		return;
	}
	const seit = Date.now();
	const url = auftrag.url;
	void hole(url).then((klang) => {
		if (!klang) {
			// Ohne Aufnahme darf der Einblender nicht verlorengehen.
			sofort(auftrag);
			return;
		}
		schlange = einreihen(schlange, {
			last: { beitrag: auftrag, klang, url },
			seit,
			dringend: auftrag.dringend === true,
		});
		pruefeSchlange();
	});
};

/** Vollständig laden, erst danach abspielen – ein halber Klang ist keiner. */
const hole = async (url: string): Promise<HTMLAudioElement | undefined> => {
	const stumm = (meldung: string): undefined => {
		merkeHaken({ url, grund: "keine-aufnahme", meldung });
		return undefined;
	};
	try {
		const antwort = await fetch(url, {
			signal: AbortSignal.timeout(AUFNAHME_FRIST_MS),
		});
		if (!antwort.ok)
			return stumm(`Aufnahme nicht abrufbar (HTTP ${antwort.status})`);
		const daten = await antwort.blob();
		if (daten.size === 0) return stumm("Aufnahme ist leer");
		const adresse = URL.createObjectURL(daten);
		const klang = new Audio(adresse);
		klang.addEventListener("ended", () => URL.revokeObjectURL(adresse));
		return klang;
	} catch (e) {
		const fehler = e as Error;
		return stumm(
			fehler.name === "TimeoutError"
				? `Aufnahme nicht binnen ${AUFNAHME_FRIST_MS} ms da`
				: `Ansage misslungen: ${fehler.message}`,
		);
	}
};

/**
 * Eine nach der anderen.
 *
 * Was beim Drankommen zu alt ist, entfällt – mitsamt seinem Ton, aber nicht
 * mitsamt seinem Einblender: Die Zahl ist überholt, die Tatsache bleibt.
 */
const pruefeSchlange = (): void => {
	if (laeuft) return;
	const griff = naechste(schlange, Date.now());
	schlange = griff.rest;
	for (const alt of griff.verfallen) {
		alt.last.beitrag.zeige();
		merkeHaken({
			url: alt.last.url,
			grund: "verfallen",
			meldung: "Beitrag war beim Drankommen überholt",
		});
	}
	const dran = griff.naechste;
	if (!dran) return;
	const { beitrag, klang, url } = dran.last;
	laeuft = klang;
	const weiter = () => {
		if (laeuft !== klang) return;
		laeuft = undefined;
		pruefeSchlange();
	};
	klang.addEventListener("ended", weiter, { once: true });
	klang.addEventListener("error", weiter, { once: true });
	beitrag.ton?.();
	beitrag.zeige();
	klang
		.play()
		.then(() => merkeHaken({ url, grund: "gespielt" }))
		.catch((e: Error) => {
			merkeHaken({
				url,
				grund: "keine-aufnahme",
				meldung: `Ansage misslungen: ${e.message}`,
			});
			weiter();
		});
};

/**
 * Sofort still sein.
 *
 * Wer im Saal die Glocke drückt, will reden – dann hat die Stimme zu schweigen,
 * und zwar die laufende Ansage mitsamt allem, was noch wartet. Die Einblender
 * der Wartenden erscheinen trotzdem: Der Ton ist überholt, die Tatsache bleibt.
 */
export const verstumme = (): void => {
	try {
		laeuft?.pause();
	} catch {}
	laeuft = undefined;
	const wartende = schlange;
	schlange = [];
	for (const wartend of wartende) {
		try {
			URL.revokeObjectURL(wartend.last.klang.src);
		} catch {}
		wartend.last.beitrag.zeige();
	}
};

/** Nur für Tests: die Schlange leeren. */
export const leereSchlange = (): void => {
	schlange = [];
	laeuft = undefined;
};

/** Der Probeknopf spielt auch, wenn die Ansage aus steht – er ist das Zutun. */
export const sprichProbe = (): void => {
	const letzte = zuletzt;
	if (!letzte) {
		merkeHaken({
			url: "",
			grund: "keine-aufnahme",
			meldung: "Noch kein Beitrag eingegangen",
		});
		return;
	}
	void hole(letzte).then((klang) => {
		if (!klang) return;
		try {
			laeuft?.pause();
		} catch {}
		laeuft = undefined;
		klang.addEventListener("ended", pruefeSchlange, { once: true });
		void klang
			.play()
			.then(() => merkeHaken({ url: letzte, grund: "gespielt" }));
	});
};

/** Die zuletzt eingereihte Aufnahme – der Probeknopf wiederholt sie. */
let zuletzt = "";

export const merkeAufnahme = (url: string): void => {
	if (url) zuletzt = url;
};
