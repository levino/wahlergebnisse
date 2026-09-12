import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
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

const WAHLTAG_BEGINN = 17;

/** Wann der Wahlabend endet – nicht um Mitternacht, sondern wenn nichts mehr kommt. */
export type Nachlauf = {
	/** So lange nach der letzten neuen Zahl läuft der schnelle Takt weiter. */
	ms: number;
	/** Zu dieser Berliner Stunde ist die Wahlnacht auf jeden Fall vorbei. */
	endeStunde: number;
};

export const STANDARD_NACHLAUF: Nachlauf = {
	ms: 180 * 60_000,
	endeStunde: 5,
};

/** Was der Poller über den laufenden Abend weiß. */
export type Lage = {
	/** Wann zuletzt eine neue Zahl hereinkam (ms seit Epoche). */
	letzteAenderung?: number;
	nachlauf?: Nachlauf;
};

const vortag = (datum: string): string => {
	const d = new Date(`${datum}T12:00:00Z`);
	d.setUTCDate(d.getUTCDate() - 1);
	return d.toISOString().slice(0, 10);
};

const wirdGewaehltAm = (datum: string, termine: Termin[]): boolean =>
	termine.some((t) => t.live && (t.datum === datum || t.stichwahl === datum));

/** Die Nacht nach einem Wahltag, bis zur Ende-Stunde. */
export const istWahlnacht = (
	jetzt: Date,
	termine: Termin[],
	nachlauf: Nachlauf = STANDARD_NACHLAUF,
): boolean => {
	const { datum, stunde } = berlinerZeit(jetzt);
	return stunde < nachlauf.endeStunde && wirdGewaehltAm(vortag(datum), termine);
};

export const istWahlabend = (
	jetzt: Date,
	termine: Termin[],
	lage: Lage = {},
): boolean => {
	const { datum, stunde } = berlinerZeit(jetzt);
	if (stunde >= WAHLTAG_BEGINN && wirdGewaehltAm(datum, termine)) return true;
	const nachlauf = lage.nachlauf ?? STANDARD_NACHLAUF;
	if (!istWahlnacht(jetzt, termine, nachlauf)) return false;
	return (
		lage.letzteAenderung !== undefined &&
		jetzt.getTime() - lage.letzteAenderung <= nachlauf.ms
	);
};

/** Ist heute ein Wahltag (unabhängig von der Uhrzeit)? */
export const istWahltag = (jetzt: Date, termine: Termin[]): boolean =>
	wirdGewaehltAm(berlinerZeit(jetzt).datum, termine);

export type Stufe = "ruhig" | "wahltag" | "wahlabend";

export const stufe = (
	jetzt: Date,
	termine: Termin[],
	lage: Lage = {},
): Stufe => {
	if (istWahlabend(jetzt, termine, lage)) return "wahlabend";
	const nachlauf = lage.nachlauf ?? STANDARD_NACHLAUF;
	return istWahltag(jetzt, termine) || istWahlnacht(jetzt, termine, nachlauf)
		? "wahltag"
		: "ruhig";
};

/** Der jüngste Änderungsstempel, in ms; ohne brauchbaren Stempel nichts. */
export const letzteAenderung = (
	stempel: Array<string | undefined>,
): number | undefined => {
	let juengster: number | undefined;
	for (const roh of stempel) {
		const ms = roh ? Date.parse(roh) : Number.NaN;
		if (Number.isFinite(ms) && (juengster === undefined || ms > juengster))
			juengster = ms;
	}
	return juengster;
};

export const NACHLAUF_DATEI = "wahlabend.json";

/** Die Stellschraube liegt neben der Datenbank, auf demselben Datenträger. */
export const nachlaufPfad = (pfadDerDb: string): string =>
	join(dirname(pfadDerDb), NACHLAUF_DATEI);

const zahl = (roh: unknown, vorgabe: number, hoechstens: number): number => {
	const n = Number(roh);
	return Number.isFinite(n) && n >= 0 && n <= hoechstens ? n : vorgabe;
};

export const nachlaufAus = (
	roh: { nachlaufMinuten?: unknown; endeStunde?: unknown },
	vorgabe: Nachlauf = STANDARD_NACHLAUF,
): Nachlauf => ({
	ms: zahl(roh.nachlaufMinuten, vorgabe.ms / 60_000, 24 * 60) * 60_000,
	endeStunde: zahl(roh.endeStunde, vorgabe.endeStunde, WAHLTAG_BEGINN),
});

export const nachlaufAusUmgebung = (
	umgebung: NodeJS.ProcessEnv = process.env,
): Nachlauf =>
	nachlaufAus({
		nachlaufMinuten: umgebung.WAHLABEND_NACHLAUF_MINUTEN,
		endeStunde: umgebung.WAHLABEND_ENDE_STUNDE,
	});

/** Gelesen bei jedem Takt: verstellbar am Abend, ohne Neustart, ohne Deploy. */
export const liesNachlauf = (
	pfad: string,
	umgebung: NodeJS.ProcessEnv = process.env,
): Nachlauf => {
	const vorgabe = nachlaufAusUmgebung(umgebung);
	try {
		return nachlaufAus(
			JSON.parse(readFileSync(pfad, "utf8")) as Record<string, unknown>,
			vorgabe,
		);
	} catch {
		return vorgabe;
	}
};

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
	lage?: Lage;
}): string[] => {
	const jetzt = args.jetzt.getTime();
	const jetzigeStufe = stufe(args.jetzt, args.termine, args.lage);
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
