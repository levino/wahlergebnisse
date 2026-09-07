import type { APIRoute } from "astro";
import { apiBehoerden, terminAus } from "../../../../lib/api.ts";
import { fehler, json, maxAgeFuer, optionen } from "../../../../lib/http.ts";

export const prerender = false;

/** Alle Wahlleitungen des Termins mit ihren Wahlen und dem Auszählstand. */
export const GET: APIRoute = ({ params, request }) => {
	const termin = terminAus(params.termin ?? "");
	if (!termin) return fehler(404, "Unbekannter Wahltermin");
	return json(
		request,
		{ termin: termin.id, behoerden: apiBehoerden(termin.id) },
		{ maxAge: maxAgeFuer(termin.live) },
	);
};

export const OPTIONS: APIRoute = () => optionen();
