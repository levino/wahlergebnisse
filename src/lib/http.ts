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
