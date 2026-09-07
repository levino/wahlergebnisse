import type { APIRoute } from "astro";
import { apiKreis, apiTermine, kreisAus } from "../../../../lib/api.ts";
import { fehler, json, optionen } from "../../../../lib/http.ts";
import { KREISE } from "../../../../data/kreise.ts";

export const prerender = false;

/** Ein Kreis mit seinen Wahlleitungen und den Terminen, die es gibt. */
export const GET: APIRoute = ({ params, request }) => {
	const kreis = kreisAus(params.kreis ?? "");
	if (!kreis)
		return fehler(
			404,
			"Unbekannter Kreis",
			"Alle Kreise unter /api/v1/kreise",
			KREISE.map((k) => k.slug),
		);
	return json(
		request,
		{ ...apiKreis(kreis), termine: apiTermine(kreis) },
		{ maxAge: 3600 },
	);
};

export const OPTIONS: APIRoute = () => optionen();
