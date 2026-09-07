import type { APIRoute } from "astro";
import { apiEreignisse, terminAus } from "../../../../lib/api.ts";
import { fehler, json, optionen } from "../../../../lib/http.ts";

export const prerender = false;

/** Ticker: eingegangene Schnellmeldungen, neueste zuerst. */
export const GET: APIRoute = ({ params, request, url }) => {
	const termin = terminAus(params.termin ?? "");
	if (!termin) return fehler(404, "Unbekannter Wahltermin");
	const limit = Math.min(
		500,
		Math.max(1, Number(url.searchParams.get("limit") ?? 50)),
	);
	const ereignisse = apiEreignisse(termin.id, {
		limit,
		behoerde: url.searchParams.get("behoerde") ?? undefined,
	});
	return json(
		request,
		{ termin: termin.id, anzahl: ereignisse.length, ereignisse },
		{ maxAge: 15 },
	);
};

export const OPTIONS: APIRoute = () => optionen();
