/**
 * Die Verbindung zur Zustellung – wann sie als tot gilt und wann wieder
 * angeklopft wird.
 *
 * Am Wahlabend steht die Seite auf einem Beamer, und der Betreiber patcht
 * die laufende Anwendung (docs/rollierendes-ausrollen.md). Jeder Deploy reißt
 * die offenen SSE-Leitungen ab. Der Browser verbindet zwar von selbst neu –
 * aber nur, solange er die Verbindung für „unterbrochen" hält und nicht für
 * „geschlossen": Kommt beim Wechsel ein 502 zurück, gibt `EventSource` auf
 * und rührt sich nie wieder. Dann steht die Leinwand still und behauptet
 * dabei „Live".
 *
 * Deshalb hängt das Wiederverbinden nicht am Browser, sondern hier: Es gibt
 * keine Zahl von Versuchen, nach der aufgegeben wird. Solange die Seite offen
 * ist, wird es weiter versucht.
 *
 * Hier steht nur das Rechnen – ohne DOM, ohne `EventSource`, ohne Uhr.
 */

/** Was die Standanzeige zeigt. */
export type Zustand = "verbindet" | "verbunden" | "unterbrochen";

/**
 * Wie lange eine Leitung ohne Kontakt als „verbindet gerade neu" durchgeht,
 * bevor die Anzeige Alarm schlägt.
 *
 * Ein Pod-Wechsel ist ein Aussetzer von wenigen Sekunden und keine Störung.
 * Ihn rot zu melden wäre auf dem Beamer ein Fehlalarm bei jedem Deploy; ihn zu
 * verschweigen wäre schlimmer.
 */
export const NACHSICHT_MS = 10_000;

/**
 * Ein hängender Socket meldet keinen Fehler. Bleibt der Puls (alle 20 s) aus,
 * obwohl die Leitung offen scheint, ist sie tot.
 */
export const PULS_AUSBLEIBEN_MS = 60_000;

/**
 * Abstände zwischen zwei Verbindungsversuchen.
 *
 * Kurz genug, dass ein Deploy im Saal niemandem auffällt, und mit einer
 * Obergrenze, die auch nach einer Viertelstunde Ausfall noch alle fünf
 * Sekunden anklopft: Wer am Wahlabend vor der Leinwand steht, wartet nicht
 * gern eine Minute, bloß weil der Server eine Minute weg war.
 */
export const ABSTAENDE_MS = [500, 1_000, 2_000, 3_000, 5_000];

/** Abstand zum nächsten Versuch nach `n` vergeblichen. */
export const abstandFuer = (versuche: number): number =>
	ABSTAENDE_MS[Math.min(Math.max(0, versuche), ABSTAENDE_MS.length - 1)];

/**
 * Solange keine Leitung steht, wird der Stand notfalls abgefragt.
 *
 * Das ist der zweite Boden unter der Zustellung: Selbst wenn SSE dauerhaft
 * scheitert – ein Proxy, der Streams schluckt, ein Browser mit abgeschaltetem
 * `EventSource` –, bleibt die Seite aktuell, nur eben im Abfragetakt. Eine
 * Leinwand, die falsche Zahlen zeigt, ist schlimmer als eine, die sie
 * langsamer bekommt.
 */
export const ABFRAGE_MS = 10_000;

export type Lage = {
	/** `EventSource.readyState`: 0 verbindet, 1 offen, 2 geschlossen. */
	readyState: number;
	/** Wann zuletzt etwas ankam (ms), 0 wenn noch nie. */
	letzterKontakt: number;
	/** Wann der laufende Versuch begonnen hat (ms). */
	verbindetSeit: number;
	jetzt: number;
};

/**
 * Der Zustand aus dem, was tatsächlich der Fall ist – statt ihn an einzelnen
 * Ereignissen festzumachen. So wird aus „verbindet" von allein
 * „unterbrochen" und umgekehrt.
 */
export const zustandVon = (l: Lage): Zustand => {
	if (l.readyState === 1) {
		const still = l.jetzt - l.letzterKontakt;
		return still > PULS_AUSBLEIBEN_MS ? "unterbrochen" : "verbunden";
	}
	const seit = l.jetzt - Math.max(l.letzterKontakt, l.verbindetSeit);
	return seit > NACHSICHT_MS ? "unterbrochen" : "verbindet";
};

/**
 * Muss eine neue Leitung aufgebaut werden?
 *
 * `readyState 2` heißt: Der Browser gibt nicht von selbst wieder an – das
 * passiert, wenn die Antwort mit einem Fehlerstatus kam, also genau beim
 * Deploy. `readyState 1` mit ausbleibendem Puls ist der hängende Socket, den
 * der Browser für gesund hält.
 */
export const brauchtNeueLeitung = (l: Lage): boolean =>
	l.readyState === 2 ||
	(l.readyState === 1 && l.jetzt - l.letzterKontakt > PULS_AUSBLEIBEN_MS) ||
	(l.readyState === 0 &&
		l.jetzt - Math.max(l.letzterKontakt, l.verbindetSeit) > NACHSICHT_MS);
