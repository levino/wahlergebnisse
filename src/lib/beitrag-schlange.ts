/**
 * Die Reihenfolge der Moderationsbeiträge – ohne `Audio`, ohne DOM, ohne Uhr.
 *
 * Ein Beitrag bringt Ton, Einblender und Stimme gemeinsam mit; deshalb steht er
 * als Ganzes in der Schlange. Zwei Stimmen übereinander versteht im Saal
 * niemand, also spricht immer nur eine, und was währenddessen hereinkommt,
 * wartet.
 */

export type Wartend<T> = {
	last: T;
	/**
	 * Wann der Beitrag in der Ablage entstanden ist, in Millisekunden seit
	 * Epoche. Nicht, wann der Browser ihn eingereiht hat: Ein Schwung, der nach
	 * einer Pause auf einmal hereinkommt, wäre sonst durchweg taufrisch.
	 */
	seit: number;
	/** Fertig ausgezählt, Jubel, Abstieg – kommt vor dem Gewöhnlichen dran. */
	dringend: boolean;
};

/**
 * So lange bleibt ein wartender Beitrag gültig.
 *
 * Ein moderierter Satz dauert grob zwanzig Sekunden. Wer länger als anderthalb
 * Minuten wartet, spricht über einen Stand, den die Leinwand längst überholt
 * hat – und eine Zahl von vorhin vorzulesen ist schlechter als Schweigen.
 */
export const ANSAGE_GILT_MS = 90_000;

/**
 * So viele warten höchstens.
 *
 * Bei zwanzig Sekunden je Ansage käme die vierte erst nach einer Minute dran
 * und wäre bis dahin ohnehin verfallen.
 */
export const SCHLANGE_HOECHSTENS = 3;

export type Einreihung<T> = {
	schlange: Wartend<T>[];
	/** Was der Deckel hinausgedrängt hat. */
	verdraengt: Wartend<T>[];
};

/**
 * Einreihen: Dringendes nach vorn, Gewöhnliches nach hinten.
 *
 * **Abgeschnitten wird nie.** Eine laufende Ansage mitten im Wort abzubrechen
 * ist im Saal schlimmer als drei Sekunden zu warten; deshalb überholt das
 * Dringende nur die Wartenden, nicht die Sprechende.
 *
 * Wird es zu voll, fällt das Älteste – am Wahlabend zählt die letzte Zahl, und
 * eine Ansage von vor zwei Minuten ist wertlos, auch wenn sie zuerst da war.
 * Tragen zwei denselben Zeitpunkt, fällt der schon Wartende.
 */
export const einreihen = <T>(
	schlange: readonly Wartend<T>[],
	neu: Wartend<T>,
	hoechstens = SCHLANGE_HOECHSTENS,
): Einreihung<T> => {
	const raus = neu.dringend ? [neu, ...schlange] : [...schlange, neu];
	const verdraengt: Wartend<T>[] = [];
	while (raus.length > Math.max(1, hoechstens)) {
		let weg = 0;
		for (let i = 1; i < raus.length; i++)
			if (
				raus[i].seit < raus[weg].seit ||
				(raus[i].seit === raus[weg].seit && raus[weg] === neu)
			)
				weg = i;
		verdraengt.push(...raus.splice(weg, 1));
	}
	return { schlange: raus, verdraengt };
};

export type Griff<T> = {
	/** Was als Nächstes gesprochen wird; fehlt, wenn nichts gültig ist. */
	naechste?: Wartend<T>;
	rest: Wartend<T>[];
	/** Was beim Drankommen zu alt war und deshalb entfällt. */
	verfallen: Wartend<T>[];
};

/**
 * Den nächsten gültigen Beitrag herausnehmen; Verfallenes fällt dabei weg.
 *
 * Gemessen wird hier, im Augenblick des Drankommens, und gegen den Zeitpunkt
 * des Beitrags. Beim Einreihen zu messen hieße, einen angestauten Schwung
 * geschlossen für frisch zu erklären.
 */
export const naechste = <T>(
	schlange: readonly Wartend<T>[],
	jetzt: number,
	giltMs = ANSAGE_GILT_MS,
): Griff<T> => {
	const verfallen: Wartend<T>[] = [];
	const rest = [...schlange];
	while (rest.length > 0) {
		const erste = rest.shift() as Wartend<T>;
		if (jetzt - erste.seit > giltMs) {
			verfallen.push(erste);
			continue;
		}
		return { naechste: erste, rest, verfallen };
	}
	return { rest: [], verfallen };
};
