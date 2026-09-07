import type { APIRoute } from "astro";
import {
	apiEreignisse,
	kreisAus,
	terminAus,
	termineImKreis,
} from "../../../../../lib/api.ts";
import { fehler, json, optionen } from "../../../../../lib/http.ts";

export const prerender = false;

/** Ticker: eingegangene Schnellmeldungen, neueste zuerst. */
export const GET: APIRoute = ({ params, request, url }) => {
	const kreis = kreisAus(params.kreis ?? "");
	if (!kreis) return fehler(404, "Unbekannter Kreis");
	const termin = terminAus(params.termin ?? "", kreis);
	if (!termin)
		return fehler(
			404,
			"Unbekannter Wahltermin",
			`Termine für ${kreis.kurz}`,
			termineImKreis(kreis),
		);
	const limit = Math.min(
		500,
		Math.max(1, Number(url.searchParams.get("limit") ?? 50)),
	);
	const ereignisse = apiEreignisse(
		termin.id,
		{
			limit,
			behoerde: url.searchParams.get("behoerde") ?? undefined,
		},
		kreis,
	);
	return json(
		request,
		{
			kreis: kreis.slug,
			termin: termin.id,
			anzahl: ereignisse.length,
			ereignisse,
		},
		{ maxAge: 15 },
	);
};

export const OPTIONS: APIRoute = () => optionen();
