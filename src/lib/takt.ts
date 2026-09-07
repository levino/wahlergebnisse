/**
 * Wie oft bei welchem Kreis nachgesehen wird.
 *
 * Bis zum Ausbau war das eine Zahl: 19 Behörden, ein Takt für alle. Mit 412
 * Behörden in 45 Kreisen braucht es eine Staffelung nach zwei Fragen:
 *
 *   Ist gerade Wahltag, und ist es schon Abend?
 *   Sieht sich gerade jemand diesen Kreis an?
 *
 * „Sieht sich jemand an“ heißt: In den letzten fünfzehn Minuten wurde eine
 * Seite dieses Kreises aufgerufen. Der Server merkt sich dazu nur einen
 * Zeitstempel je Kreis (siehe server/main.ts) — kein Zählen, kein Verfolgen,
 * nichts, was einen Besucher wiedererkennt.
 *
 * ## Warum die Abstände am Wahlabend kurz sind
 *
 * Die erste Fassung dieser Staffelung hat den übrigen Kreisen auch am
 * Wahlabend 900 Sekunden gegeben, an gewöhnlichen Tagen einen ganzen Tag.
 * Das war zu vorsichtig, und zwar an der falschen Stelle: Ein Kreis, den
 * gerade niemand ansieht, kann jede Sekunde geöffnet werden. Wer um 20:05 Uhr
 * Holzminden aufruft und Zahlen von 19:50 Uhr sieht, hält die Seite für
 * kaputt — zu Recht.
 *
 * Die Rücksicht auf die fremden Server bleibt, sie steht nur woanders: im
 * Anfragenkonto je Host (src/lib/drossel.ts). Dort fällt die Last an, dort
 * wird sie gedeckelt. Ein Rückstand macht dann den Poller langsamer und nicht
 * die Wahlleitung — was der Takt hier verlangt, ist eine Absicht und keine
 * Garantie.
 *
 * ## Die Rechnung
 *
 * **Was ein Lauf kostet.** Gemessen gegen den Mock mit den echten Fixtures
 * des Landkreises (test/wahlabend-viele-kreise.test.ts hält die Zahl fest):
 * ein Durchgang durch die 19 Hildesheimer Behörden kostet im eingeschwungenen
 * Zustand 256 bedingte Anfragen bei leeren Ergebnisdateien und 342, wenn alle
 * Ebenen mit Zahlen besetzt sind (Termin 2021). Also **18 Anfragen je Behörde
 * und Lauf** als Ansatz für den Wahlabend — fast alle beantwortet mit 304
 * ohne Rumpf.
 *
 * **Was ein Durchgang kostet.** Abgefragt werden 371 Behörden in den 38
 * Kreisen mit benutzbarer Präsentation, verteilt auf vier Hosts:
 *
 *   votemanager.kdo.de       351 Behörden (37 Kreise)  →  6 300 Anfragen
 *   wahlen.kreis-hi.de        19 Behörden ( 1 Kreis)   →    342
 *   wahlen.hann.muenden.de     1 Behörde               →     18
 *   www.nordenham.de           1 Behörde               →     18
 *                                                        ------
 *                                                         6 678
 *
 * **Was daraus je Sekunde wird.** Bei einem Durchgang alle 180 Sekunden:
 *
 *   alle Hosts zusammen   6 678 / 180  =  37,1 Anfragen/s
 *   votemanager.kdo.de    6 300 / 180  =  35,0 /s   (Konto: 60 /s)
 *   wahlen.kreis-hi.de      342 / 180  =   1,9 /s   (Konto: 10 /s)
 *
 * Dazu der betrachtete Kreis, der alle 60 statt alle 180 Sekunden drankommt —
 * das Doppelte für diesen einen Kreis. Für Hildesheim sind das 342 × 2 / 180
 * = 3,8 /s obendrauf, zusammen 5,7 /s auf dem einzigen Apache ohne CDN. Für
 * einen durchschnittlichen Kreis beim KDO (9,8 Behörden, 176 Anfragen) sind
 * es 2,0 /s; erst bei etwa zwölf gleichzeitig betrachteten Kreisen wäre das
 * Konto dort ausgeschöpft, und dann bremst es.
 *
 * **Über den Abend.** 17 bis 24 Uhr sind 25 200 Sekunden, also 140 Durchgänge
 * à 6 678 ≈ 940 000 Anfragen; der Wahltag davor (0–17 Uhr, ein Durchgang alle
 * 1 800 s) noch einmal 228 000. Rund 1,2 Millionen bedingte Anfragen an einem
 * Wahltag, davon über neun Zehntel 304 ohne Rumpf — in Bytes wenige hundert
 * Megabyte über den Tag. Ein gewöhnlicher Tag kostet vier Durchgänge, also
 * 27 000 Anfragen oder 0,3 /s.
 *
 * **Angefasst werden 43 Kreise, abgefragt 38.** Die Uhr bekommt alle Kreise
 * vorgelegt, zu denen überhaupt eine Adresse bekannt ist (alle außer Celle und
 * Uelzen, die keinen votemanager benutzen). Fünf davon lieferten beim Abzug
 * nichts — für sie tut ein Lauf nur eines: einmal je Viertelstunde nachsehen,
 * ob die Präsentation inzwischen da ist (eine Anfrage, siehe `NACHSCHAU_S` in
 * src/lib/poll.ts). Das kostet neben den 6 678 Anfragen eines Durchgangs
 * nichts und erspart am Wahlabend ein Ausrollen, wenn die Region Hannover
 * freischaltet.
 *
 * `STANDARD_HOECHSTENS` deckelt weiterhin, wie viele Kreise ein einzelner Lauf
 * anfasst — es ist aber nicht mehr der Grund, dass Daten altern. Am Wahlabend
 * sind je Minute im Schnitt 42 / 3 + 1 = 15 Kreise fällig (der betrachtete
 * kommt jede Minute dran), der Deckel liegt bei 15. Er greift beim Kaltstart,
 * wenn alle 43 auf einmal dran wären, und teilt sie dabei in Gruppen, die
 * ihren Abstand behalten. Das ist seine eigentliche Aufgabe: die Last über die
 * Minuten verteilen, statt sie in jedem dritten Lauf zusammenfallen zu lassen.
 * Der größte Lauf kostet so 2 610 Anfragen an einen Host — bei 60 je Sekunde
 * 44 Sekunden und damit innerhalb des Grundtakts.
 * src/lib/wahlabend-takt.test.ts rechnet diesen Abend nach und lässt die
 * Prüfung scheitern, wenn eine der Zahlen oben nicht mehr stimmt.
 *
 * **Das Archiv läuft daneben her.** Die Kommunalwahl 2021 für 41 Kreise
 * einzulesen sind rund 90 000 Anfragen. Sie stehen in keiner Rechnung oben,
 * weil der Archivlauf ein eigenes, viel kleineres Konto je Host hat und
 * zurücktritt, solange ein Live-Lauf unterwegs ist (src/lib/poll.ts).
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
	// An gewöhnlichen Tagen ändert sich fast nichts. Sechs Stunden statt eines
	// ganzen Tages, damit eine neu angelegte Präsentation noch am selben Tag
	// auftaucht; vier Durchgänge kosten 0,3 Anfragen je Sekunde.
	ruhig: { betrachtet: 900, uebrig: 21_600 },
	// Am Wahltag vor 17 Uhr liegen noch keine Zahlen vor, aber die
	// Präsentation wird fertiggestellt – halbstündlich reicht dafür.
	wahltag: { betrachtet: 300, uebrig: 1_800 },
	// Ab 17 Uhr kommen die Schnellmeldungen im Minutentakt. Auch ein Kreis,
	// den gerade niemand ansieht, ist damit höchstens drei Minuten alt, wenn
	// ihn jemand öffnet – der Grund für diese Zahl. Was der Kürze eine Grenze
	// setzt, ist das Anfragenkonto je Host, nicht dieser Wert.
	wahlabend: { betrachtet: 60, uebrig: 180 },
};

/**
 * Wie viele Kreise ein einzelner Lauf höchstens anfasst.
 *
 * Der Deckel glättet Rückstände: nach einem Neustart, nach einer Störung oder
 * wenn viele Kreise zufällig gleichzeitig fällig werden. Er ist bewusst so
 * gewählt, dass er im gewöhnlichen Betrieb nicht greift – sonst wäre er der
 * Grund, dass Daten altern, und genau das soll er nicht sein.
 */
export const STANDARD_HOECHSTENS: Record<Stufe, number> = {
	ruhig: 8,
	wahltag: 12,
	// 38 Kreise bei 180 s Abstand und 60 s Grundtakt sind im Schnitt 12,7 je
	// Lauf. 15 lässt Luft und teilt den Kaltstart in drei Gruppen (15/15/8),
	// die danach ihren Abstand behalten – die Last verteilt sich damit von
	// selbst auf jede Minute, statt in jedem dritten Lauf zusammenzufallen.
	// Mit einem höheren Deckel (20) entstünde die Folge 20/19/1, und der
	// große Lauf käme mit 3 500 Anfragen an einen Host dem Grundtakt gefährlich
	// nahe; mit 15 sind es 2 600, gut 43 Sekunden bei 60 Anfragen je Sekunde.
	wahlabend: 15,
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
	/** Eine Zahl für alle Stufen oder je Stufe eine. */
	hoechstens?: number | Record<Stufe, number>;
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
		.slice(0, deckel)
		.map((k) => k.slug);
};
