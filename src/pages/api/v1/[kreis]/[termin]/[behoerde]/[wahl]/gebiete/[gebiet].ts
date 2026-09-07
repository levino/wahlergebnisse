import type { APIRoute } from "astro";
import {
	apiGebiet,
	behoerdeAus,
	terminAus,
} from "../../../../../../../lib/api.ts";
import {
	fehler,
	json,
	maxAgeFuer,
	optionen,
} from "../../../../../../../lib/http.ts";

export const prerender = false;

/** Ein einzelnes Gebiet (Gemeinde, Ortsteil, Wahlbezirk …) einer Wahl. */
export const GET: APIRoute = ({ params, request }) => {
	const termin = terminAus(params.termin ?? "");
	const behoerde = behoerdeAus(params.behoerde ?? "");
	if (!termin) return fehler(404, "Unbekannter Wahltermin");
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
			`Alle Gebiete: /api/v1/${termin.id}/${behoerde.slug}/${params.wahl}/gebiete`,
		);
	return json(request, g, { maxAge: maxAgeFuer(termin.live) });
};

export const OPTIONS: APIRoute = () => optionen();
