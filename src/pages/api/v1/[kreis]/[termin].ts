import type { APIRoute } from "astro";
import {
	apiUeberblick,
	kreisAus,
	terminAus,
	terminEbenenHinweis,
	termineImKreis,
} from "../../../../lib/api.ts";
import { istLive } from "../../../../data/termine.ts";
import { fehler, json, maxAgeFuer, optionen } from "../../../../lib/http.ts";

export const prerender = false;

/** Überblick eines Termins: Stand, Fortschritt kreisweit und je Gemeinde. */
export const GET: APIRoute = ({ params, request }) => {
	const kreis = kreisAus(params.kreis ?? "");
	if (!kreis)
		return fehler(404, "Unbekannter Kreis", "Alle unter /api/v1/kreise");
	const termin = terminAus(params.termin ?? "", kreis);
	if (!termin)
		return fehler(
			404,
			"Unbekannter Wahltermin",
			terminEbenenHinweis(kreis, params.termin ?? ""),
			termineImKreis(kreis),
		);
	return json(request, apiUeberblick(termin.id, kreis), {
		maxAge: maxAgeFuer(istLive(termin)),
	});
};

export const OPTIONS: APIRoute = () => optionen();
