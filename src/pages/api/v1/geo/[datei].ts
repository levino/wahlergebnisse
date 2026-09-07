import type { APIRoute } from "astro";
import {
	type Feature,
	GEMEINDEN,
	ORTSTEILE,
	WAHLLOKALE,
	alsSammlung,
	gemeindenFuerKreis,
	kreisSchluessel,
	ortsteileFuerKreis,
	wahllokaleFuerKreis,
} from "../../../../lib/geo.ts";
import { fehler, json, optionen } from "../../../../lib/http.ts";

export const prerender = false;

/**
 * Die Geodaten, die die Karten benutzen – votemanager liefert für fast alle
 * Kreise keine. Quellen und Lizenzen stehen unter /api/v1/.
 *
 * `?kreis=03254` schneidet auf einen Kreis zu; ohne den Parameter kommt der
 * ganze Bestand. Ortsteile und Wahllokale gibt es bisher nur für Hildesheim,
 * andere Kreise liefern dort also eine leere Sammlung statt eines Fehlers.
 */
const DATEIEN: Record<
	string,
	{
		alle: () => Feature<unknown>[];
		kreis: (ags: string) => Feature<unknown>[];
		quelle: string;
	}
> = {
	"gemeinden.geojson": {
		alle: () => GEMEINDEN,
		kreis: gemeindenFuerKreis,
		quelle: "© GeoBasis-DE / BKG (VG250), dl-de/by-2-0",
	},
	"ortsteile.geojson": {
		alle: () => ORTSTEILE,
		kreis: ortsteileFuerKreis,
		quelle:
			"Gemarkungen © LGLN (dl-de/by-2-0); Ortsteile der Stadt Hildesheim © OpenStreetMap-Mitwirkende (ODbL)",
	},
	"wahllokale.geojson": {
		alle: () => WAHLLOKALE,
		kreis: wahllokaleFuerKreis,
		quelle:
			"Adressen aus der Wahlpräsentation des Landkreises, Koordinaten © OpenStreetMap-Mitwirkende (ODbL)",
	},
};

export const GET: APIRoute = ({ params, request }) => {
	const eintrag = DATEIEN[params.datei ?? ""];
	if (!eintrag)
		return fehler(404, "Unbekannte Geodatei", undefined, Object.keys(DATEIEN));
	const kreis = new URL(request.url).searchParams.get("kreis");
	if (kreis && !/^\d{5}(\d{3})?$/.test(kreis))
		return fehler(
			400,
			"kreis muss ein 5- oder 8-stelliger Kreisschlüssel sein",
			undefined,
			["03254", "03254000"],
		);
	const features = kreis
		? eintrag.kreis(kreisSchluessel(kreis))
		: eintrag.alle();
	return json(request, alsSammlung(features), {
		maxAge: 86400,
		headers: { "x-quelle": eintrag.quelle },
	});
};

export const OPTIONS: APIRoute = () => optionen();
