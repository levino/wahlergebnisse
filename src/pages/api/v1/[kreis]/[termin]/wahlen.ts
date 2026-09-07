import type { APIRoute } from "astro";
import { apiWahlen, kreisAus, terminAus } from "../../../../../lib/api.ts";
import { fehler, json, maxAgeFuer, optionen } from "../../../../../lib/http.ts";
import { WAHLTYP_REIHENFOLGE } from "../../../../../lib/wahltyp.ts";

export const prerender = false;

/**
 * Alle Wahlen eines Termins, flach und filterbar:
 *   ?behoerde=nordstemmen   (Slug oder AGS)
 *   ?typ=ortsrat            (landrat, kreistag, buergermeister, rat, ortsrat, …)
 */
export const GET: APIRoute = ({ params, request, url }) => {
	const kreis = kreisAus(params.kreis ?? "");
	if (!kreis) return fehler(404, "Unbekannter Kreis");
	const termin = terminAus(params.termin ?? "");
	if (!termin) return fehler(404, "Unbekannter Wahltermin");
	const typ = url.searchParams.get("typ") ?? undefined;
	if (typ && !WAHLTYP_REIHENFOLGE.includes(typ as never))
		return fehler(
			400,
			"Unbekannte Wahlart",
			"Parameter typ",
			WAHLTYP_REIHENFOLGE,
		);
	const wahlen = apiWahlen(
		termin.id,
		{
			behoerde: url.searchParams.get("behoerde") ?? undefined,
			typ,
		},
		kreis,
	);
	return json(
		request,
		{ kreis: kreis.slug, termin: termin.id, anzahl: wahlen.length, wahlen },
		{ maxAge: maxAgeFuer(termin.live) },
	);
};

export const OPTIONS: APIRoute = () => optionen();
