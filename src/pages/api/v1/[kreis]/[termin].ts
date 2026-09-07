import type { APIRoute } from "astro";
import { apiUeberblick, kreisAus, terminAus } from "../../../../lib/api.ts";
import { fehler, json, maxAgeFuer, optionen } from "../../../../lib/http.ts";
import { TERMINE } from "../../../../data/termine.ts";

export const prerender = false;

/** Überblick eines Termins: Stand, Fortschritt kreisweit und je Gemeinde. */
export const GET: APIRoute = ({ params, request }) => {
	const kreis = kreisAus(params.kreis ?? "");
	if (!kreis)
		return fehler(404, "Unbekannter Kreis", "Alle unter /api/v1/kreise");
	const termin = terminAus(params.termin ?? "");
	if (!termin)
		return fehler(
			404,
			"Unbekannter Wahltermin",
			"Verfügbare Termine unter /api/v1/termine",
			TERMINE.map((t) => t.id),
		);
	return json(request, apiUeberblick(termin.id, kreis), {
		maxAge: maxAgeFuer(termin.live),
	});
};

export const OPTIONS: APIRoute = () => optionen();
