import type { APIRoute } from "astro";
import {
	alsCsv,
	alsTabelle,
	apiGebiete,
	behoerdeAus,
	kreisAus,
	terminAus,
	termineImKreis,
} from "../../../../../../../lib/api.ts";
import { istLive } from "../../../../../../../data/termine.ts";
import {
	csv,
	fehler,
	json,
	maxAgeFuer,
	optionen,
} from "../../../../../../../lib/http.ts";

export const prerender = false;

export const GET: APIRoute = ({ params, request, url }) => {
	const kreis = kreisAus(params.kreis ?? "");
	if (!kreis) return fehler(404, "Unbekannter Kreis");
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
	const ebene = url.searchParams.get("ebene") ?? undefined;
	const gebiete = apiGebiete(termin.id, behoerde, params.wahl ?? "", { ebene });
	if (!gebiete) return fehler(404, "Unbekannte Wahl");
	const maxAge = maxAgeFuer(istLive(termin));
	if (url.searchParams.get("format") === "csv") {
		const name = `wahlergebnisse-${kreis.slug}-${termin.id}-${behoerde.slug}-${params.wahl}${ebene ? `-${ebene}` : ""}.csv`;
		return csv(request, alsCsv(alsTabelle(gebiete)), {
			maxAge,
			dateiname: name,
		});
	}
	return json(
		request,
		{
			kreis: kreis.slug,
			termin: termin.id,
			behoerde: behoerde.slug,
			wahl: params.wahl,
			anzahl: gebiete.length,
			gebiete,
		},
		{ maxAge },
	);
};

export const OPTIONS: APIRoute = () => optionen();
