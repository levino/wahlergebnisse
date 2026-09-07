import type { APIRoute } from "astro";
import {
	apiWahlraeume,
	behoerdeAus,
	terminAus,
} from "../../../../../lib/api.ts";
import { fehler, json, optionen } from "../../../../../lib/http.ts";

export const prerender = false;

/** Wahlräume (Wahllokale) einer Behörde mit Zuordnung zu Bezirk und Ortsteil. */
export const GET: APIRoute = ({ params, request }) => {
	const termin = terminAus(params.termin ?? "");
	const behoerde = behoerdeAus(params.behoerde ?? "");
	if (!termin) return fehler(404, "Unbekannter Wahltermin");
	if (!behoerde)
		return fehler(
			404,
			"Unbekannte Behörde",
			"Verfügbare unter /api/v1/{termin}/behoerden",
		);
	const wahlraeume = apiWahlraeume(termin.id, behoerde);
	return json(
		request,
		{
			termin: termin.id,
			behoerde: behoerde.slug,
			anzahl: wahlraeume.length,
			wahlraeume,
		},
		{ maxAge: 3600 },
	);
};

export const OPTIONS: APIRoute = () => optionen();
