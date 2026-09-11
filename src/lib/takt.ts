import type { Termin } from "../data/termine.ts";

/** Datum (JJJJ-MM-TT) und Stunde in Berliner Zeit. */
export const berlinerZeit = (
	jetzt: Date,
): { datum: string; stunde: number } => {
	const s = new Intl.DateTimeFormat("sv-SE", {
		timeZone: "Europe/Berlin",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		hour12: false,
	}).format(jetzt);
	const [datum, stunde] = s.split(" ");
	return { datum, stunde: Number(stunde) };
};

export const istWahlabend = (jetzt: Date, termine: Termin[]): boolean => {
	const { datum, stunde } = berlinerZeit(jetzt);
	return (
		stunde >= 17 &&
		termine.some((t) => t.live && (t.datum === datum || t.stichwahl === datum))
	);
};

/** Ist heute ein Wahltag (unabhängig von der Uhrzeit)? */
export const istWahltag = (jetzt: Date, termine: Termin[]): boolean => {
	const { datum } = berlinerZeit(jetzt);
	return termine.some(
		(t) => t.live && (t.datum === datum || t.stichwahl === datum),
	);
};

export type Stufe = "ruhig" | "wahltag" | "wahlabend";

export const stufe = (jetzt: Date, termine: Termin[]): Stufe =>
	istWahlabend(jetzt, termine)
		? "wahlabend"
		: istWahltag(jetzt, termine)
			? "wahltag"
			: "ruhig";

/** Abstand zweier Abfragen desselben Kreises, in Sekunden. */
export type Abstaende = Record<Stufe, { betrachtet: number; uebrig: number }>;

export const STANDARD_ABSTAENDE: Abstaende = {
	ruhig: { betrachtet: 900, uebrig: 21_600 },
	wahltag: { betrachtet: 300, uebrig: 1_800 },
	wahlabend: { betrachtet: 60, uebrig: 180 },
};

export const STANDARD_HOECHSTENS: Record<Stufe, number> = {
	ruhig: 8,
	wahltag: 12,
	wahlabend: 15,
};

/** Wie lange ein Seitenaufruf den Kreis als „betrachtet“ gelten lässt. */
export const BETRACHTET_S = 900;
/** Wie oft bei einem Kreis ohne jegliche Daten nachgesehen wird (Sekunden). */
export const NACHSCHAU_S = 15 * 60;

export const GRUNDTAKT_S = 60;

export const faelligeKreise = (args: {
	jetzt: Date;
	termine: Termin[];
	/** Kreise, die überhaupt abgefragt werden (Slugs). */
	kreise: string[];
	/** Slug → Zeitpunkt des letzten Seitenaufrufs (ms seit Epoche). */
	gesehen: Map<string, number>;
	/** Slug → Zeitpunkt des letzten Laufs (ms seit Epoche). */
	geholt: Map<string, number>;
	abstaende?: Abstaende;
	betrachtetS?: number;
	/** Eine Zahl für alle Stufen oder je Stufe eine. */
	hoechstens?: number | Record<Stufe, number>;
	ohneDaten?: Set<string>;
	nachschauS?: number;
}): string[] => {
	const jetzt = args.jetzt.getTime();
	const jetzigeStufe = stufe(args.jetzt, args.termine);
	const abstand = (args.abstaende ?? STANDARD_ABSTAENDE)[jetzigeStufe];
	const deckel =
		typeof args.hoechstens === "number"
			? args.hoechstens
			: (args.hoechstens ?? STANDARD_HOECHSTENS)[jetzigeStufe];
	const frist = (args.betrachtetS ?? BETRACHTET_S) * 1000;

	const bewertet = args.kreise.map((slug) => {
		const aufruf = args.gesehen.get(slug);
		const betrachtet = aufruf !== undefined && jetzt - aufruf < frist;
		const stufenSoll =
			(betrachtet ? abstand.betrachtet : abstand.uebrig) * 1000;
		const soll = args.ohneDaten?.has(slug)
			? Math.min(stufenSoll, (args.nachschauS ?? NACHSCHAU_S) * 1000)
			: stufenSoll;
		const letzter = args.geholt.get(slug);
		const seit =
			letzter === undefined ? Number.MAX_SAFE_INTEGER : jetzt - letzter;
		return {
			slug,
			betrachtet,
			faellig: seit >= soll,
			ueberfaellig: seit - soll,
		};
	});

	return bewertet
		.filter((k) => k.faellig)
		.sort(
			(a, b) =>
				Number(b.betrachtet) - Number(a.betrachtet) ||
				b.ueberfaellig - a.ueberfaellig,
		)
		.slice(0, deckel)
		.map((k) => k.slug);
};
