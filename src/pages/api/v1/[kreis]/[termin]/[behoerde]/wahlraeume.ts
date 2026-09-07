import type { APIRoute } from "astro";
import {
	apiWahlraeume,
	behoerdeAus,
	kreisAus,
	terminAus,
	termineImKreis,
} from "../../../../../../lib/api.ts";
import { fehler, json, optionen } from "../../../../../../lib/http.ts";

export const prerender = false;

/** Wahlräume (Wahllokale) einer Behörde mit Zuordnung zu Bezirk und Ortsteil. */
export const GET: APIRoute = ({ params, request }) => {
	const kreis = kreisAus(params.kreis ?? "");
	if (!kreis) return fehler(404, "Unbekannter Kreis");
	const termin = terminAus(params.termin ?? "", kreis);
	const behoerde = behoerdeAus(params.behoerde ?? "", kreis);
	if (!termin)
		return fehler(
			404,
			"Unbekannter Wahltermin",
			`Termine für ${kreis.kurz}`,
			termineImKreis(kreis),
		);
	if (!behoerde)
		return fehler(
			404,
			"Unbekannte Behörde",
			"Verfügbare unter /api/v1/{kreis}/{termin}/behoerden",
		);
	const wahlraeume = apiWahlraeume(termin.id, behoerde);
	return json(
		request,
		{
			kreis: kreis.slug,
			termin: termin.id,
			behoerde: behoerde.slug,
			anzahl: wahlraeume.length,
			wahlraeume,
		},
		{ maxAge: 3600 },
	);
};

export const OPTIONS: APIRoute = () => optionen();
