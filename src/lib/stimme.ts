/**
 * Die Ansage: Was auf der Leinwand erscheint, wird auch gesagt.
 *
 * Am Wahlabend steht der Saal voll, und die wenigsten sehen in dem Moment auf
 * die Leinwand, in dem eine Meldung kommt. Ein Ton sagt „etwas ist passiert",
 * ein Satz sagt **was** – und genau darum geht es: „Ortsratswahl Rössing ist
 * fertig ausgezählt." Danach dreht sich der Saal um.
 *
 * **Ohne Datei und ohne Dienst.** `speechSynthesis` steckt im Browser; es geht
 * kein Aufruf nach außen, es fällt kein Ladevorgang an, und am Wahlabend hängt
 * nichts an einer fremden Verfügbarkeit.
 *
 * **Was nicht angesagt wird.** Alles gleichzeitig. Kommen fünf Meldungen auf
 * einmal, wird die wichtigste gesagt und der Rest gezählt – eine Stimme, die
 * eine Minute lang Zahlen herunterbetet, schaltet jeder ab.
 */

/** Wo der Wunsch des Nutzers steht – dieselbe Schublade wie beim Ton. */
export const STIMME_SCHLUESSEL = "wahlen:ansage";

/** Ist die Ansage eingeschaltet? Ohne Angabe: ja. */
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
	} catch {
		// Nicht speicherbar – gilt dann nur für diese Sitzung.
	}
};

/**
 * Eine deutsche Stimme, wenn der Browser eine hat.
 *
 * Die Liste ist beim ersten Aufruf oft noch leer und füllt sich erst später
 * (`voiceschanged`); deshalb wird sie bei jedem Satz neu gefragt, statt sie
 * einmal zu merken.
 */
const deutscheStimme = (): SpeechSynthesisVoice | undefined => {
	const alle = speechSynthesis.getVoices();
	return (
		alle.find(
			(s) => s.lang?.toLowerCase().startsWith("de") && s.localService,
		) ?? alle.find((s) => s.lang?.toLowerCase().startsWith("de"))
	);
};

/**
 * Sagt einen Satz an. Ein neuer Satz verdrängt einen wartenden – am
 * Wahlabend zählt der neueste Stand, nicht die Reihenfolge des Eingangs.
 */
export const sprich = (satz: string, dringend = false): void => {
	if (!satz || !ansageAn()) return;
	try {
		if (!("speechSynthesis" in window)) return;
		// Was noch nicht gesprochen ist, ist überholt: Bei „fertig ausgezählt"
		// interessiert niemanden mehr, dass vorher 21 von 23 vorlagen.
		if (dringend || speechSynthesis.pending) speechSynthesis.cancel();
		const rede = new SpeechSynthesisUtterance(satz);
		rede.lang = "de-DE";
		const stimme = deutscheStimme();
		if (stimme) rede.voice = stimme;
		// Etwas schneller als die Vorgabe: Im Saal soll der Satz vorbei sein,
		// bevor die nächste Zahl kommt.
		rede.rate = 1.08;
		rede.pitch = 1;
		speechSynthesis.speak(rede);
	} catch {
		// Kein Sprachausgabedienst – dann bleibt es bei Einblender und Ton.
	}
};
