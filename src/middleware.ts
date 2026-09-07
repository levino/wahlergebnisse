import { defineMiddleware } from "astro:middleware";
import {
	KREIS_COOKIE,
	KREIS_COOKIE_MAXAGE,
	altePfadUmschreibung,
	kreisAusPfad,
} from "./lib/pfade.ts";

/**
 * Zwei Dinge, die für jede Anfrage gelten und deshalb nicht in die einzelnen
 * Seiten gehören.
 *
 * **Alte Adressen.** Bis zum Ausbau auf Niedersachsen lagen die Ergebnisse
 * unter `/2021/kreis/kreistag/`, ohne Kreis davor. Diese Links sind im Umlauf
 * und stehen bei den Suchmaschinen, also leiten sie dauerhaft (301) auf den
 * Landkreis Hildesheim weiter, unter dem sie liegen. Welche Regel greift,
 * entscheidet `altePfadUmschreibung` in `src/lib/pfade.ts` – dort ist sie auch
 * getestet. Sie leitet nie einen gültigen Kreis-Pfad um und schreibt nur um,
 * was an der Stelle des Kreises einen bekannten Wahltermin trägt; alles andere
 * läuft in die saubere 404 statt in eine Schleife.
 *
 * **Merken des Kreises.** Wer eine Kreis-Seite ansieht, soll beim nächsten
 * Aufruf von `/` dort landen. Das Cookie hier zu setzen erspart es jeder
 * einzelnen Seite – und gilt damit auch für die Weiterleitungsziele.
 */
export const onRequest = defineMiddleware((context, next) => {
	const { pathname, search } = context.url;

	const ziel = altePfadUmschreibung(pathname);
	if (ziel) return context.redirect(`${ziel}${search}`, 301);

	// Nur Seitenaufrufe merken: Ein Skript, das die Schnittstelle abfragt,
	// soll die Wahl im Browser des Menschen nicht überschreiben.
	const kreis = kreisAusPfad(pathname);
	if (kreis && !pathname.startsWith("/api/"))
		context.cookies.set(KREIS_COOKIE, kreis, {
			path: "/",
			maxAge: KREIS_COOKIE_MAXAGE,
			sameSite: "lax",
			httpOnly: false,
		});

	return next();
});
