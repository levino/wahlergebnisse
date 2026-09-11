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
	/** Wann der Beitrag entstanden ist, in Millisekunden seit Epoche. */
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

/**
 * Einreihen: Dringendes nach vorn, Gewöhnliches nach hinten.
 *
 * **Abgeschnitten wird nie.** Eine laufende Ansage mitten im Wort abzubrechen
 * ist im Saal schlimmer als drei Sekunden zu warten; deshalb überholt das
 * Dringende nur die Wartenden, nicht die Sprechende.
 */
export const einreihen = <T>(
	schlange: readonly Wartend<T>[],
	neu: Wartend<T>,
	hoechstens = SCHLANGE_HOECHSTENS,
): Wartend<T>[] => {
	const raus = neu.dringend ? [neu, ...schlange] : [...schlange, neu];
	while (raus.length > Math.max(1, hoechstens)) {
		// Das Älteste fällt heraus: Es ist das, dessen Zahl am weitesten
		// zurückliegt.
		let aeltestes = 0;
		for (let i = 1; i < raus.length; i++)
			if (raus[i].seit <= raus[aeltestes].seit) aeltestes = i;
		raus.splice(aeltestes, 1);
	}
	return raus;
};

export type Griff<T> = {
	/** Was als Nächstes gesprochen wird; fehlt, wenn nichts gültig ist. */
	naechste?: Wartend<T>;
	rest: Wartend<T>[];
	/** Was beim Drankommen zu alt war und deshalb entfällt. */
	verfallen: Wartend<T>[];
};

/** Den nächsten gültigen Beitrag herausnehmen; Verfallenes fällt dabei weg. */
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
