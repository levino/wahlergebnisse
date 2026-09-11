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
	jubel: [
		[523, 0.1],
		[659, 0.1],
		[784, 0.12],
		[1047, 0.34],
	],
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
		return true;
	}
};

export const setzeTon = (an: boolean): void => {
	try {
		localStorage.setItem(TON_SCHLUESSEL, an ? "an" : "aus");
	} catch {}
};

let frei = false;

export const tonFrei = (): boolean => frei;

const zuhoerer = new Set<() => void>();

/** Wird gerufen, sobald der Ton freigegeben ist – für die Anzeige in der Leiste. */
export const beiFreigabe = (fn: () => void): void => {
	zuhoerer.add(fn);
};

export const gibTonFrei = (): void => {
	try {
		const f = window as Fenster;
		const Ctor = f.AudioContext ?? f.webkitAudioContext;
		if (Ctor) {
			if (!kontext) kontext = new Ctor();
			if (kontext.state === "suspended") void kontext.resume();
		}
	} catch {}
	try {
		if ("speechSynthesis" in window) {
			const stumm = new SpeechSynthesisUtterance("");
			stumm.volume = 0;
			speechSynthesis.speak(stumm);
		}
	} catch {}
	if (frei) return;
	frei = true;
	for (const fn of zuhoerer) fn();
};

export const horcheAufGeste = (): void => {
	if (frei) return;
	const einmal = () => {
		gibTonFrei();
		for (const art of ["pointerdown", "keydown", "touchstart"])
			document.removeEventListener(art, einmal);
	};
	for (const art of ["pointerdown", "keydown", "touchstart"])
		document.addEventListener(art, einmal, { passive: true });
};

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
			regler.gain.setValueAtTime(0.0001, start);
			regler.gain.exponentialRampToValueAtTime(0.22, start + 0.015);
			regler.gain.exponentialRampToValueAtTime(0.0001, start + dauer);
			ton.connect(regler).connect(kontext.destination);
			ton.start(start);
			ton.stop(start + dauer + 0.02);
			start += dauer * 0.85;
		}
	} catch {}
};
