import type { APIRoute } from "astro";
import {
	apiWahl,
	behoerdeAus,
	kreisAus,
	terminAus,
} from "../../../../../../lib/api.ts";
import {
	fehler,
	json,
	maxAgeFuer,
	optionen,
} from "../../../../../../lib/http.ts";
import { wahleintraege } from "../../../../../../lib/abfragen.ts";

export const prerender = false;

/** Eine Wahl mit ihrem Gesamtergebnis. */
export const GET: APIRoute = ({ params, request }) => {
	const kreis = kreisAus(params.kreis ?? "");
	if (!kreis) return fehler(404, "Unbekannter Kreis");
	const termin = terminAus(params.termin ?? "");
	const behoerde = behoerdeAus(params.behoerde ?? "", kreis);
	if (!termin) return fehler(404, "Unbekannter Wahltermin");
	if (!behoerde) return fehler(404, "Unbekannte Behörde");
	const wahl = apiWahl(termin.id, behoerde, params.wahl ?? "");
	if (!wahl)
		return fehler(
			404,
			"Unbekannte Wahl",
			`Wahlen dieser Behörde: /api/v1/${kreis.slug}/${termin.id}/wahlen?behoerde=${behoerde.slug}`,
			wahleintraege(termin.id, behoerde.ags).map((w) => w.slug),
		);
	return json(request, wahl, { maxAge: maxAgeFuer(termin.live) });
};

export const OPTIONS: APIRoute = () => optionen();
