/**
 * Wie oft beim Landkreis nachgesehen wird. Am Wahlabend kommen die
 * Schnellmeldungen im Minutentakt – dann fragt die App enger ab, sonst
 * sparsam. Ausgelagert und rein gehalten, damit es prüfbar ist.
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

/**
 * Abfragetakt in Sekunden.
 *
 * Drei Stufen, weil die Quelle ein fremder Server ist, den wir nicht grundlos
 * belasten wollen: An gewöhnlichen Tagen ändert sich bis zum Wahltag nichts,
 * dort genügt ein ruhiger Takt. Am Wahltag selbst wird es enger, und ab 17 Uhr
 * kommen die Schnellmeldungen im Minutentakt.
 */
export const takt = (
	jetzt: Date,
	termine: Termin[],
	normal: number,
	wahlabend: number,
	ruhig = normal,
): number => {
	if (istWahlabend(jetzt, termine)) return wahlabend;
	return istWahltag(jetzt, termine) ? normal : Math.max(normal, ruhig);
};
