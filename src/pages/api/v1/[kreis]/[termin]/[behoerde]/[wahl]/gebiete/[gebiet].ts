import type { APIRoute } from "astro";
import {
	apiGebiet,
	behoerdeAus,
	kreisAus,
	terminAus,
	termineImKreis,
} from "../../../../../../../../lib/api.ts";
import { istLive } from "../../../../../../../../data/termine.ts";
import {
	fehler,
	json,
	maxAgeFuer,
	optionen,
} from "../../../../../../../../lib/http.ts";

export const prerender = false;

/** Ein einzelnes Gebiet (Gemeinde, Ortsteil, Wahlbezirk …) einer Wahl. */
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
	if (!behoerde) return fehler(404, "Unbekannte Behörde");
	const g = apiGebiet(
		termin.id,
		behoerde,
		params.wahl ?? "",
		params.gebiet ?? "",
	);
	if (!g)
		return fehler(
			404,
			"Unbekanntes Gebiet",
			`Alle Gebiete: /api/v1/${kreis.slug}/${termin.id}/${behoerde.slug}/${params.wahl}/gebiete`,
		);
	return json(request, g, { maxAge: maxAgeFuer(istLive(termin)) });
};

export const OPTIONS: APIRoute = () => optionen();
