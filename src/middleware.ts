import { defineMiddleware } from "astro:middleware";
import { TERMINE, type Termin, terminById } from "./data/termine.ts";
import { seitenCacheControl } from "./lib/http.ts";
import {
	KREIS_COOKIE,
	KREIS_COOKIE_MAXAGE,
	altePfadUmschreibung,
	kreisAusPfad,
} from "./lib/pfade.ts";

/**
 * Der Wahltermin, den eine Seite zeigt – aus ihrem Pfad
 * (`/<kreis>/<termin>/…`). Die Kreis-Startseite `/<kreis>/` nennt keinen und
 * zeigt den laufenden; ohne Kreis im Pfad (`/`, `/ueber`, `/api`) geht es um
 * keinen Termin.
 */
const seitenTermin = (pfad: string): Termin | undefined =>
	terminById(pfad.split("/")[2] ?? "") ??
	(kreisAusPfad(pfad)
		? (TERMINE.find((t) => t.live) ?? TERMINE[0])
		: undefined);

/**
 * Drei Dinge, die für jede Anfrage gelten und deshalb nicht in die einzelnen
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
 *
 * **Zwischenspeicher-Regel für die Seiten.** Die Schnittstelle setzt ihre
 * Kopfzeilen selbst (`lib/http.ts`), die HTML-Seiten gingen bisher ganz ohne
 * Angabe hinaus. Was für sie richtig ist und warum, steht bei
 * `seitenCacheControl`; hier wird es nur angehängt – an echte Seiten (200 und
 * HTML), und nur, wenn die Seite nicht selbst schon etwas gesagt hat.
 */
export const onRequest = defineMiddleware(async (context, next) => {
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

	const antwort = await next();
	if (
		antwort.status === 200 &&
		(antwort.headers.get("content-type") ?? "").startsWith("text/html") &&
		!antwort.headers.has("cache-control")
	)
		antwort.headers.set(
			"cache-control",
			seitenCacheControl(Boolean(seitenTermin(pathname)?.live)),
		);
	return antwort;
});
