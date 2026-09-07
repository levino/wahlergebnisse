import type { APIRoute } from "astro";
import gemeinden from "../../../../data/geo/gemeinden.geo.json";
import ortsteile from "../../../../data/geo/ortsteile.geo.json";
import wahllokale from "../../../../data/geo/wahllokale.geo.json";
import { fehler, json, optionen } from "../../../../lib/http.ts";

export const prerender = false;

/**
 * Die Geodaten, die die Karten benutzen – votemanager liefert für den
 * Landkreis keine. Quellen und Lizenzen stehen unter /api/v1/.
 */
const DATEIEN: Record<string, { daten: unknown; quelle: string }> = {
	"gemeinden.geojson": {
		daten: gemeinden,
		quelle: "© GeoBasis-DE / BKG (VG250), dl-de/by-2-0",
	},
	"ortsteile.geojson": {
		daten: ortsteile,
		quelle:
			"Gemarkungen © LGLN (dl-de/by-2-0); Ortsteile der Stadt Hildesheim © OpenStreetMap-Mitwirkende (ODbL)",
	},
	"wahllokale.geojson": {
		daten: wahllokale,
		quelle:
			"Adressen aus der Wahlpräsentation des Landkreises, Koordinaten © OpenStreetMap-Mitwirkende (ODbL)",
	},
};

export const GET: APIRoute = ({ params, request }) => {
	const eintrag = DATEIEN[params.datei ?? ""];
	if (!eintrag)
		return fehler(404, "Unbekannte Geodatei", undefined, Object.keys(DATEIEN));
	return json(request, eintrag.daten, {
		maxAge: 86400,
		headers: { "x-quelle": eintrag.quelle },
	});
};

export const OPTIONS: APIRoute = () => optionen();
