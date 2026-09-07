import type { APIRoute } from "astro";
import {
	apiBehoerden,
	kreisAus,
	terminAus,
	termineImKreis,
} from "../../../../../lib/api.ts";
import { istLive } from "../../../../../data/termine.ts";
import { fehler, json, maxAgeFuer, optionen } from "../../../../../lib/http.ts";

export const prerender = false;

/** Alle Wahlleitungen des Termins mit ihren Wahlen und dem Auszählstand. */
export const GET: APIRoute = ({ params, request }) => {
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
	return json(
		request,
		{
			kreis: kreis.slug,
			termin: termin.id,
			behoerden: apiBehoerden(termin.id, kreis),
		},
		{ maxAge: maxAgeFuer(istLive(termin)) },
	);
};

export const OPTIONS: APIRoute = () => optionen();
