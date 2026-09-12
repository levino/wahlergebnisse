import { TONPROBE_PFAD } from "./beitrag-abruf.ts";
import { type Wartend, einreihen, naechste } from "./beitrag-schlange.ts";
import { tonAn, tonFrei } from "./klang.ts";

/** Auflage des Anbieters: Es muss dastehen, dass die Stimme erzeugt ist. */
export const STIMME_HINWEIS = "Die Ansage spricht eine synthetische Stimme";

/** So lange darf das Holen einer hinterlegten Aufnahme dauern. */
export const AUFNAHME_FRIST_MS = 10_000;

export type AnsageHaken = {
	/** Adresse der Aufnahme – einen Satz bekommt der Browser nie zu sehen. */
	url: string;
	grund:
		| "gespielt"
		| "keine-aufnahme"
		| "gesperrt"
		| "aus"
		| "verfallen"
		| "verdraengt"
		| "nachzug";
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
	/**
	 * Wann der Beitrag entstanden ist, aus der Ablage. Daran misst sich, ob er
	 * beim Drankommen noch etwas zu sagen hat.
	 */
	seit?: number;
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

/**
 * Ein Beitrag ohne Stimme: Der Einblender erscheint, es gongt aber nicht.
 *
 * Der Gong kündigt an, dass gleich gesprochen wird. Kommt keine Stimme, ist er
 * nur ein Plopp ohne Anlass – im Saal die verwirrendste aller Meldungen.
 */
const stumm = (a: Beitrag): void => a.zeige();

const zeitpunkt = (a: Beitrag): number => {
	const jetzt = Date.now();
	return Number.isFinite(a.seit) ? Math.min(a.seit as number, jetzt) : jetzt;
};

/**
 * Einen Moderationsbeitrag einreihen.
 *
 * Ohne Aufnahme oder bei abgeschaltetem Ton gibt es nichts zu laden – dann
 * erscheint der Einblender sofort. Gewartet wird nur auf eine Datei, die auch
 * kommt.
 */
const reiheEin = (auftrag: Beitrag, pruefeTon: boolean): void => {
	if (!auftrag.url) {
		// Hier ist nie eine Stimme zu erwarten: Der Gong ist die ganze Meldung.
		auftrag.ton?.();
		auftrag.zeige();
		merkeHaken({
			url: "",
			grund: "keine-aufnahme",
			meldung: "Zu diesem Beitrag gibt es keine Aufnahme",
		});
		return;
	}
	if (pruefeTon && !tonAn()) {
		stumm(auftrag);
		merkeHaken({
			url: auftrag.url,
			grund: "aus",
			meldung: "Ton ist abgeschaltet",
		});
		return;
	}
	if (pruefeTon && !tonFrei()) {
		stumm(auftrag);
		merkeHaken({
			url: auftrag.url,
			grund: "gesperrt",
			meldung: "Ton noch nicht freigegeben – einmal klicken",
		});
		return;
	}
	const seit = zeitpunkt(auftrag);
	const url = auftrag.url;
	void hole(url).then((klang) => {
		if (!klang) {
			// Ohne Aufnahme darf der Einblender nicht verlorengehen.
			stumm(auftrag);
			return;
		}
		const { schlange: naechsteSchlange, verdraengt } = einreihen(schlange, {
			last: { beitrag: auftrag, klang, url },
			seit,
			dringend: auftrag.dringend === true,
		});
		schlange = naechsteSchlange;
		for (const weg of verdraengt)
			entlasse(weg, "verdraengt", "Der Deckel ließ nur Jüngeres durch");
		pruefeSchlange();
	});
};

export const reiheBeitragEin = (auftrag: Beitrag): void =>
	reiheEin(auftrag, true);

/** Vollständig laden, erst danach abspielen – ein halber Klang ist keiner. */
const hole = async (url: string): Promise<HTMLAudioElement | undefined> => {
	const ohne = (meldung: string): undefined => {
		merkeHaken({ url, grund: "keine-aufnahme", meldung });
		return undefined;
	};
	try {
		const antwort = await fetch(url, {
			signal: AbortSignal.timeout(AUFNAHME_FRIST_MS),
		});
		if (!antwort.ok)
			return ohne(`Aufnahme nicht abrufbar (HTTP ${antwort.status})`);
		const daten = await antwort.blob();
		if (daten.size === 0) return ohne("Aufnahme ist leer");
		const adresse = URL.createObjectURL(daten);
		const klang = new Audio(adresse);
		klang.addEventListener("ended", () => URL.revokeObjectURL(adresse));
		return klang;
	} catch (e) {
		const fehler = e as Error;
		return ohne(
			fehler.name === "TimeoutError"
				? `Aufnahme nicht binnen ${AUFNAHME_FRIST_MS} ms da`
				: `Ansage misslungen: ${fehler.message}`,
		);
	}
};

/**
 * Einen Wartenden gehen lassen: Der Einblender bleibt, die Stimme entfällt.
 *
 * Die Zahl ist überholt, die Tatsache bleibt – und die geladene Datei gibt den
 * Speicher wieder her.
 */
const entlasse = (
	wartend: Wartend<Eintrag>,
	grund: AnsageHaken["grund"],
	meldung: string,
): void => {
	try {
		URL.revokeObjectURL(wartend.last.klang.src);
	} catch {}
	stumm(wartend.last.beitrag);
	merkeHaken({ url: wartend.last.url, grund, meldung });
};

/**
 * Eine nach der anderen.
 *
 * Was beim Drankommen zu alt ist, entfällt – mitsamt seinem Ton, aber nicht
 * mitsamt seinem Einblender.
 */
const pruefeSchlange = (): void => {
	if (laeuft) return;
	const griff = naechste(schlange, Date.now());
	schlange = griff.rest;
	for (const alt of griff.verfallen)
		entlasse(alt, "verfallen", "Beitrag war beim Drankommen überholt");
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
			const gesperrt = e.name === "NotAllowedError";
			merkeHaken({
				url,
				grund: gesperrt ? "gesperrt" : "keine-aufnahme",
				meldung: gesperrt
					? `Browser spielt nicht ab (${e.message}) – einmal klicken`
					: `Ansage misslungen: ${e.message}`,
			});
			weiter();
		});
};

const raeumeSchlange = (grund: AnsageHaken["grund"], meldung: string): void => {
	const wartende = schlange;
	schlange = [];
	for (const wartend of wartende) entlasse(wartend, grund, meldung);
};

/**
 * Sofort still sein.
 *
 * Wer im Saal die Glocke drückt, will reden – dann hat die Stimme zu schweigen,
 * und zwar die laufende Ansage mitsamt allem, was noch wartet.
 */
export const verstumme = (): void => {
	try {
		laeuft?.pause();
	} catch {}
	laeuft = undefined;
	raeumeSchlange("aus", "Ton wurde abgeschaltet");
};

/**
 * Beim Zurückkommen wird nichts nachgeplappert.
 *
 * Was gesprochen werden sollte, während der Reiter hinten lag, war für diesen
 * Augenblick gedacht. Kommt der Nutzer zurück, ist es entweder gesagt oder
 * vorbei; ein Schwall aufgestauter Ansagen ist das Gegenteil von Moderation.
 * Die laufende Ansage spricht zu Ende.
 */
export const nichtsNachholen = (): void => {
	raeumeSchlange("nachzug", "Aufgestautes wird nicht nachgeholt");
};

/** Nur für Tests: die Schlange leeren. */
export const leereSchlange = (): void => {
	schlange = [];
	laeuft = undefined;
};

/** Der Probeknopf geht durch dieselbe Schlange – er drängelt, unterbricht aber nicht. */
export const sprichProbe = (): void =>
	reiheEin(
		{
			url: TONPROBE_PFAD,
			dringend: true,
			zeige: () => {},
		},
		false,
	);
