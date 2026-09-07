/**
 * Wie oft bei welchem Kreis nachgesehen wird.
 *
 * Bis zum Ausbau war das eine Zahl: 19 Behörden, ein Takt für alle. Mit 412
 * Behörden in 45 Kreisen geht das nicht mehr — derselbe Takt wäre das
 * Zweiundzwanzigfache, auf fremden Servern, von denen einige nackte
 * Apache-Instanzen ohne CDN sind. Deshalb gestaffelt nach zwei Fragen:
 *
 *   Ist gerade Wahltag, und ist es schon Abend?
 *   Sieht sich gerade jemand diesen Kreis an?
 *
 * „Sieht sich jemand an“ heißt: In den letzten fünfzehn Minuten wurde eine
 * Seite dieses Kreises aufgerufen. Der Server merkt sich dazu nur einen
 * Zeitstempel je Kreis (siehe server/main.ts) — kein Zählen, kein Verfolgen,
 * nichts, was einen Besucher wiedererkennt.
 *
 * ## Was dabei an Anfragen zusammenkommt
 *
 * Eine Behörde kostet je Lauf rund 20 bedingte Anfragen (an drei Kreisen
 * gemessen: zweiter Lauf 73 Anfragen für drei Behörden mit 18 Wahlen).
 * Ein Durchgang durch alle 412 Behörden sind also etwa 8 000 Anfragen,
 * ein Kreis im Schnitt 220.
 *
 *   gewöhnlicher Tag, niemand da   1 Durchgang       ≈   8 000 / Tag
 *   Wahltag bis 17 Uhr             17 Durchgänge     ≈ 139 000
 *   Wahlabend 17–24 Uhr            28 Durchgänge     ≈ 230 000
 *   dazu je betrachtetem Kreis     420 Läufe à 220   ≈  92 000
 *
 * Der Wahltag kostet damit gut eine halbe Million Anfragen, verteilt auf
 * sieben Hosts und überwiegend beantwortet mit 304 ohne Inhalt. In der Spitze
 * sind das rund 20 Anfragen je Sekunde. `hoechstens` deckelt zusätzlich, wie
 * viele Kreise ein einzelner Lauf anfasst, damit ein Rückstand sich verteilt,
 * statt sich in einer Spitze zu entladen.
 */
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

/**
 * Wahlabend heißt: Es gibt einen Live-Termin mit dem heutigen Datum und es
 * ist 17 Uhr oder später. Die Wahllokale schließen um 18 Uhr; die eine
 * Stunde Vorlauf kostet nichts und fängt frühe Briefwahlergebnisse mit.
 */
export const istWahlabend = (jetzt: Date, termine: Termin[]): boolean => {
	const { datum, stunde } = berlinerZeit(jetzt);
	return stunde >= 17 && termine.some((t) => t.live && t.datum === datum);
};

/** Ist heute ein Wahltag (unabhängig von der Uhrzeit)? */
export const istWahltag = (jetzt: Date, termine: Termin[]): boolean => {
	const { datum } = berlinerZeit(jetzt);
	return termine.some((t) => t.live && t.datum === datum);
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
	// An gewöhnlichen Tagen ändert sich nichts: einmal am Tag genügt, damit
	// neue Termine und Korrekturen ankommen.
	ruhig: { betrachtet: 900, uebrig: 86_400 },
	// Am Wahltag vor 17 Uhr liegen noch keine Zahlen vor, aber die
	// Präsentation wird fertiggestellt.
	wahltag: { betrachtet: 300, uebrig: 3_600 },
	// Ab 17 Uhr kommen die Schnellmeldungen im Minutentakt.
	wahlabend: { betrachtet: 60, uebrig: 900 },
};

/** Wie lange ein Seitenaufruf den Kreis als „betrachtet“ gelten lässt. */
export const BETRACHTET_S = 900;

/**
 * Der Grundtakt der Uhr: So oft wird geprüft, welche Kreise dran sind. Kürzer
 * als der kürzeste Abstand muss er nicht sein.
 */
export const GRUNDTAKT_S = 60;

/**
 * Welche Kreise sind jetzt fällig?
 *
 * Sortiert nach Dringlichkeit: erst die betrachteten, dann die am längsten
 * nicht geholten. `hoechstens` schneidet ab — was übrig bleibt, kommt beim
 * nächsten Lauf dran und rückt dabei nach vorn.
 */
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
	hoechstens?: number;
}): string[] => {
	const jetzt = args.jetzt.getTime();
	const abstand = (args.abstaende ?? STANDARD_ABSTAENDE)[
		stufe(args.jetzt, args.termine)
	];
	const frist = (args.betrachtetS ?? BETRACHTET_S) * 1000;

	const bewertet = args.kreise.map((slug) => {
		const aufruf = args.gesehen.get(slug);
		const betrachtet = aufruf !== undefined && jetzt - aufruf < frist;
		const soll = (betrachtet ? abstand.betrachtet : abstand.uebrig) * 1000;
		// Noch nie geholt: sofort dran – sonst bliebe ein Kreis nach dem ersten
		// Start bis zu einem Tag leer.
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
		.slice(0, args.hoechstens ?? Number.POSITIVE_INFINITY)
		.map((k) => k.slug);
};
