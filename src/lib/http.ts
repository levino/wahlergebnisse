/**
 * Antwort-Helfer für die öffentliche API: einheitliche Header, ETag/304,
 * CORS (die Daten sind öffentlich) und Fehler im selben Format wie Erfolge.
 */
import { hash } from "./hash.ts";

const CORS = {
	"access-control-allow-origin": "*",
	"access-control-allow-methods": "GET, OPTIONS",
	"access-control-allow-headers": "content-type",
};

export type AntwortOptionen = {
	/** Sekunden, die Zwischenspeicher die Antwort halten dürfen */
	maxAge?: number;
	/** Zusätzliche Header */
	headers?: Record<string, string>;
	/** Dateiname für den Download (setzt Content-Disposition) */
	dateiname?: string;
};

const basisHeader = (opts: AntwortOptionen): Record<string, string> => ({
	...CORS,
	"cache-control": `public, max-age=${opts.maxAge ?? 30}`,
	...(opts.dateiname
		? { "content-disposition": `attachment; filename="${opts.dateiname}"` }
		: {}),
	...opts.headers,
});

/** JSON-Antwort mit ETag; bei passendem If-None-Match kommt 304 zurück. */
export const json = (
	request: Request,
	daten: unknown,
	opts: AntwortOptionen = {},
): Response => {
	const text = JSON.stringify(daten, null, 2);
	const etag = `W/"${hash(text)}"`;
	if (request.headers.get("if-none-match") === etag) {
		return new Response(null, {
			status: 304,
			headers: { ...basisHeader(opts), etag },
		});
	}
	return new Response(text, {
		headers: {
			...basisHeader(opts),
			"content-type": "application/json; charset=utf-8",
			etag,
		},
	});
};

export const csv = (
	request: Request,
	text: string,
	opts: AntwortOptionen = {},
): Response => {
	const etag = `W/"${hash(text)}"`;
	if (request.headers.get("if-none-match") === etag) {
		return new Response(null, {
			status: 304,
			headers: { ...basisHeader(opts), etag },
		});
	}
	return new Response(text, {
		headers: {
			...basisHeader(opts),
			"content-type": "text/csv; charset=utf-8",
			etag,
		},
	});
};

/** Fehler im selben Stil wie RFC 9457 (problem details), aber schlicht. */
export const fehler = (
	status: number,
	titel: string,
	hinweis?: string,
	moeglich?: unknown,
): Response =>
	new Response(
		JSON.stringify({ fehler: { status, titel, hinweis, moeglich } }, null, 2),
		{
			status,
			headers: {
				...CORS,
				"content-type": "application/json; charset=utf-8",
				"cache-control": "no-store",
			},
		},
	);

export const optionen = (): Response =>
	new Response(null, { status: 204, headers: CORS });

/** Wie lange darf die Antwort gecacht werden? Live-Termine kurz, Archiv lange. */
export const maxAgeFuer = (live: boolean): number => (live ? 30 : 3600);

/** Wie lange eine Archivseite im Browser liegen bleiben darf. */
export const SEITEN_MAXAGE = 300;

/**
 * `Cache-Control` für ausgelieferte HTML-Seiten.
 *
 * Bisher gingen die Seiten ganz ohne Angabe hinaus – dann entscheidet jeder
 * Zwischenspeicher nach eigener Faustregel, und am Wahlabend ist das die
 * falsche Stelle zum Raten. Deshalb ausdrücklich:
 *
 * - **`private`** durchweg: Jede Seitenantwort trägt ein `Set-Cookie` für den
 *   gemerkten Kreis (siehe `middleware.ts`). Ein gemeinsamer Zwischenspeicher
 *   dürfte sie damit ohnehin nicht ablegen; gesagt zu haben ist besser als
 *   sich darauf zu verlassen.
 * - **Live-Termin → `no-cache`:** Die Seite darf abgelegt, aber nie
 *   ungefragt wiederverwendet werden. Das ist keine Förmlichkeit: Die Seite
 *   holt sich neuen Inhalt mit `navigate()`, und das ist ein gewöhnliches
 *   `fetch`. Mit einer Frist von auch nur wenigen Sekunden könnte der Browser
 *   darauf die *alte* Seite aus seinem Speicher zurückgeben – die
 *   Aktualisierung liefe ins Leere, und ausgerechnet am Wahlabend stünde die
 *   Anzeige still.
 * - **Archiv → kurze Frist:** Ergebnisse von 2021 ändern sich nicht mehr.
 *   Fünf Minuten nehmen dem Server die Wiederholungsaufrufe ab (Zurück-Taste,
 *   Suchmaschinen, jemand, der sich durch Ortsräte klickt) und sind kurz
 *   genug, dass ein nachgeladenes Archiv nicht lange verdeckt bleibt.
 */
export const seitenCacheControl = (live: boolean): string =>
	live ? "private, no-cache" : `private, max-age=${SEITEN_MAXAGE}`;

/**
 * Öffentliche Basis-URL dieser Seite.
 *
 * Hinter dem Reverse-Proxy sieht der Node-Server nur `localhost:8080`; die
 * Anfrage-URL taugt deshalb nicht für Adressen, die jemand kopieren soll — die
 * API nannte so lange `https://localhost/mcp` als Connector-Adresse.
 *
 * Reihenfolge: PUBLIC_SITE_URL aus der Umgebung (wirkt ohne Neubau, so steht
 * es im Deployment), dann die beim Bauen konfigurierte `site`, zuletzt die
 * Anfrage-URL.
 */
export const basisUrl = (site: URL | undefined, angefragt: URL): string => {
	const ausUmgebung = process.env.PUBLIC_SITE_URL;
	if (ausUmgebung) {
		try {
			return new URL(ausUmgebung).origin;
		} catch {
			// unbrauchbar gesetzt – dann die nächste Quelle
		}
	}
	return site ? site.origin : angefragt.origin;
};
