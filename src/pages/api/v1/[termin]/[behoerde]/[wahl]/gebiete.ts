import type { APIRoute } from "astro";
import {
	alsCsv,
	alsTabelle,
	apiGebiete,
	behoerdeAus,
	terminAus,
} from "../../../../../../lib/api.ts";
import {
	csv,
	fehler,
	json,
	maxAgeFuer,
	optionen,
} from "../../../../../../lib/http.ts";

export const prerender = false;

/**
 * Alle Gebiete einer Wahl mit Ergebnis – die Sicht, die man für Auswertungen
 * braucht. `?ebene=wahlbezirk` grenzt ein, `?format=csv` liefert eine Zeile je
 * Gebiet und Partei.
 */
export const GET: APIRoute = ({ params, request, url }) => {
	const termin = terminAus(params.termin ?? "");
	const behoerde = behoerdeAus(params.behoerde ?? "");
	if (!termin) return fehler(404, "Unbekannter Wahltermin");
	if (!behoerde) return fehler(404, "Unbekannte Behörde");
	const ebene = url.searchParams.get("ebene") ?? undefined;
	const gebiete = apiGebiete(termin.id, behoerde, params.wahl ?? "", { ebene });
	if (!gebiete) return fehler(404, "Unbekannte Wahl");
	const maxAge = maxAgeFuer(termin.live);
	if (url.searchParams.get("format") === "csv") {
		const name = `wahlergebnisse-${termin.id}-${behoerde.slug}-${params.wahl}${ebene ? `-${ebene}` : ""}.csv`;
		return csv(request, alsCsv(alsTabelle(gebiete)), {
			maxAge,
			dateiname: name,
		});
	}
	return json(
		request,
		{
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
