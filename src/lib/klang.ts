/**
 * Töne für den Wahlabend.
 *
 * Wer im Saal steht, sieht nicht dauernd auf die Leinwand – er redet, holt
 * Kaffee, zählt selbst. Ein Ton ist deshalb kein Zierrat, sondern die einzige
 * Meldung, die auch ankommt, wenn niemand hinsieht: Es hat sich etwas getan,
 * dreh dich um.
 *
 * **Erzeugt statt geladen.** Drei kurze Sinustöne kosten keine Datei, keinen
 * Ladevorgang und keinen Cache – und sie klingen auf einem Beamer-Lautsprecher
 * so gut wie ein Sample. Die Tonhöhen sind bewusst weit auseinander: Aus fünf
 * Metern unterscheidet man Klangfarben nicht, Intervalle schon.
 *
 * **Erst nach einem Klick.** Browser lassen Töne ohne Zutun des Nutzers nicht
 * zu. Der Kontext entsteht deshalb beim ersten Griff (Tonschalter, Pause,
 * Blättern) und nicht beim Laden; vorher bleibt es still, und das ist kein
 * Fehler, sondern die Regel des Browsers.
 */

export type Klangart =
	| "neu"
	| "fertig"
	| "abriss"
	| "zurueck"
	| "jubel"
	| "abstieg";

/** Tonfolgen je Art: [Hertz, Sekunden] – kurz, sonst nervt es am Abend. */
const FOLGEN: Record<Klangart, Array<[number, number]>> = {
	/** Neue Zahlen: ein einzelner heller Ton, unaufdringlich. */
	neu: [[880, 0.09]],
	/** Fertig ausgezählt: ein Dreiklang aufwärts – die gute Nachricht. */
	fertig: [
		[660, 0.11],
		[880, 0.11],
		[1320, 0.2],
	],
	/** Verbindung weg: zwei tiefe Töne abwärts. Unüberhörbar, nicht schrill. */
	abriss: [
		[420, 0.16],
		[300, 0.28],
	],
	/** Verbindung wieder da: dieselben Töne aufwärts. */
	zurueck: [
		[300, 0.12],
		[520, 0.18],
	],
	/**
	 * Die eigene Partei steigt auf: eine Fanfare.
	 *
	 * Sie darf länger sein als alles andere und ist die einzige Folge mit
	 * einem Anlauf: C–E–G, dann der Ton eine Oktave höher stehen gelassen.
	 * Das ist der Jubel, den es an dem Abend geben soll – im Saal dreht sich
	 * dabei jeder um, und genau das ist der Zweck. Fanfaren gibt es nur für
	 * die eigene Partei, sonst wäre sie keine.
	 */
	jubel: [
		[523, 0.1],
		[659, 0.1],
		[784, 0.12],
		[1047, 0.34],
	],
	/**
	 * Und wenn es rückwärts geht: dieselbe Folge abwärts, tiefer und kürzer.
	 *
	 * Kein Alarm – ein Platz weniger ist eine schlechte Nachricht und kein
	 * Notfall; der Abriss-Ton bleibt der lauteste Ton des Abends.
	 */
	abstieg: [
		[523, 0.12],
		[392, 0.14],
		[262, 0.32],
	],
};

/** Wo der Wunsch des Nutzers steht. */
export const TON_SCHLUESSEL = "wahlen:ton";

type Fenster = Window & {
	AudioContext?: typeof AudioContext;
	webkitAudioContext?: typeof AudioContext;
};

let kontext: AudioContext | undefined;

/** Ist der Ton eingeschaltet? Ohne Angabe: ja – am Wahlabend soll er an sein. */
export const tonAn = (): boolean => {
	try {
		return localStorage.getItem(TON_SCHLUESSEL) !== "aus";
	} catch {
		// Kein Zugriff auf den Speicher (privates Fenster): dann eben an.
		return true;
	}
};

export const setzeTon = (an: boolean): void => {
	try {
		localStorage.setItem(TON_SCHLUESSEL, an ? "an" : "aus");
	} catch {
		// Nicht speicherbar – gilt dann nur für diese Sitzung.
	}
};

/**
 * Spielt eine Tonfolge, wenn der Ton an ist.
 *
 * Scheitert irgendetwas daran – kein Audio im Browser, kein Zutun des Nutzers,
 * ein Gerät ohne Ausgabe –, bleibt es still. Ein Wahlabend darf an einem Ton
 * nicht hängen.
 */
export const spiele = (art: Klangart): void => {
	if (!tonAn()) return;
	try {
		const f = window as Fenster;
		const Ctor = f.AudioContext ?? f.webkitAudioContext;
		if (!Ctor) return;
		if (!kontext) kontext = new Ctor();
		if (kontext.state === "suspended") void kontext.resume();
		let start = kontext.currentTime;
		for (const [hz, dauer] of FOLGEN[art]) {
			const ton = kontext.createOscillator();
			const regler = kontext.createGain();
			ton.type = "sine";
			ton.frequency.value = hz;
			// Ein harter Ein- und Ausschaltvorgang knackt; die Rampe nicht.
			regler.gain.setValueAtTime(0.0001, start);
			regler.gain.exponentialRampToValueAtTime(0.22, start + 0.015);
			regler.gain.exponentialRampToValueAtTime(0.0001, start + dauer);
			ton.connect(regler).connect(kontext.destination);
			ton.start(start);
			ton.stop(start + dauer + 0.02);
			start += dauer * 0.85;
		}
	} catch {
		// Still bleiben ist immer besser als ein Fehler auf der Leinwand.
	}
};
