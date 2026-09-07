import type { APIRoute } from "astro";
import {
	apiWahlen,
	behoerdeAus,
	kreisAus,
	terminAus,
	terminEbenenHinweis,
	termineImKreis,
} from "../../../../../lib/api.ts";
import { istLive } from "../../../../../data/termine.ts";
import { fehler, json, maxAgeFuer, optionen } from "../../../../../lib/http.ts";
import { WAHLTYP_REIHENFOLGE } from "../../../../../lib/wahltyp.ts";

export const prerender = false;

/**
 * Alle Wahlen eines Termins, flach und filterbar:
 *   ?behoerde=nordstemmen   (Slug oder AGS)
 *   ?typ=ortsrat            (landrat, kreistag, buergermeister, rat, ortsrat, …)
 */
export const GET: APIRoute = ({ params, request, url }) => {
	const kreis = kreisAus(params.kreis ?? "");
	if (!kreis) return fehler(404, "Unbekannter Kreis");
	// `?behoerde=` gibt die Ebene vor: Mit Angabe zählt, was diese Wahlleitung
	// führt – so kommt man an die Wahlen der Bürgermeisterwahl 2018 in Bad
	// Salzdetfurth, ohne dass sie zum Termin des ganzen Landkreises würde.
	// Ohne Angabe fragt die Adresse kreisweit und wird kreisweit beantwortet.
	const filter = url.searchParams.get("behoerde") ?? undefined;
	const behoerde = filter ? behoerdeAus(filter, kreis) : undefined;
	const termin = terminAus(params.termin ?? "", kreis, behoerde);
	if (!termin)
		return fehler(
			404,
			"Unbekannter Wahltermin",
			behoerde
				? `Termine für ${behoerde.kurz}`
				: terminEbenenHinweis(kreis, params.termin ?? ""),
			termineImKreis(kreis, behoerde),
		);
	const typ = url.searchParams.get("typ") ?? undefined;
	if (typ && !WAHLTYP_REIHENFOLGE.includes(typ as never))
		return fehler(
			400,
			"Unbekannte Wahlart",
			"Parameter typ",
			WAHLTYP_REIHENFOLGE,
		);
	const wahlen = apiWahlen(termin.id, { behoerde: filter, typ }, kreis);
	return json(
		request,
		{ kreis: kreis.slug, termin: termin.id, anzahl: wahlen.length, wahlen },
		{ maxAge: maxAgeFuer(istLive(termin)) },
	);
};

export const OPTIONS: APIRoute = () => optionen();
