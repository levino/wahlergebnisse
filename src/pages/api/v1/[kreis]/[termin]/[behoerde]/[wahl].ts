import type { APIRoute } from "astro";
import {
	apiWahl,
	behoerdeAus,
	kreisAus,
	terminAus,
	termineImKreis,
} from "../../../../../../lib/api.ts";
import { istLive } from "../../../../../../data/termine.ts";
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
	// Erst die Wahlleitung, dann der Termin: Ob es ihn gibt, entscheidet sich
	// auf **ihrer** Ebene. Die Bürgermeisterwahl vom 16.12.2018 gehört zu Bad
	// Salzdetfurth und zu keiner anderen Hildesheimer Gemeinde.
	const behoerde = behoerdeAus(params.behoerde ?? "", kreis);
	const termin = terminAus(params.termin ?? "", kreis, behoerde);
	if (!termin)
		return fehler(
			404,
			"Unbekannter Wahltermin",
			`Termine für ${behoerde?.kurz ?? kreis.kurz}`,
			termineImKreis(kreis, behoerde),
		);
	if (!behoerde) return fehler(404, "Unbekannte Behörde");
	const wahl = apiWahl(termin.id, behoerde, params.wahl ?? "");
	if (!wahl)
		return fehler(
			404,
			"Unbekannte Wahl",
			`Wahlen dieser Behörde: /api/v1/${kreis.slug}/${termin.id}/wahlen?behoerde=${behoerde.slug}`,
			wahleintraege(termin.id, behoerde.ags).map((w) => w.slug),
		);
	return json(request, wahl, { maxAge: maxAgeFuer(istLive(termin)) });
};

export const OPTIONS: APIRoute = () => optionen();
