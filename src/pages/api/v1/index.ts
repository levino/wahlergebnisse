import type { APIRoute } from "astro";
import { apiTermine } from "../../../lib/api.ts";
import { json, optionen } from "../../../lib/http.ts";

export const prerender = false;

/** Einstieg: was es gibt und wo es liegt. */
export const GET: APIRoute = ({ request, url }) => {
	const b = `${url.origin}/api/v1`;
	return json(
		request,
		{
			name: "Wahlergebnisse Landkreis Hildesheim – offene API",
			beschreibung:
				"Alle Ergebnisse der Kommunalwahlen im Landkreis Hildesheim, aufbereitet aus der amtlichen Wahlpräsentation: benannte Felder statt D1_3-Spalten, jede Ebene im selben Format, JSON und CSV.",
			lizenz: {
				daten:
					"Amtliche Ergebnisse des Landkreises Hildesheim (votemanager). Weiterverwendung frei; maßgeblich sind die Bekanntmachungen der Wahlleitungen.",
				geodaten:
					"Gemeindegrenzen © GeoBasis-DE/BKG (dl-de/by-2-0), Gemarkungen © LGLN (dl-de/by-2-0), Ortsteile Hildesheim und Adressen © OpenStreetMap-Mitwirkende (ODbL)",
			},
			kontakt: "https://github.com/levino/wahlergebnisse/issues",
			openapi: `${b}/openapi.json`,
			mcp: `${url.origin}/mcp`,
			termine: apiTermine(),
			pfade: {
				termine: `${b}/termine`,
				ueberblick: `${b}/{termin}`,
				behoerden: `${b}/{termin}/behoerden`,
				wahlen: `${b}/{termin}/wahlen?behoerde=&typ=`,
				wahl: `${b}/{termin}/{behoerde}/{wahl}`,
				gebiete: `${b}/{termin}/{behoerde}/{wahl}/gebiete?ebene=&format=json|csv`,
				gebiet: `${b}/{termin}/{behoerde}/{wahl}/gebiete/{gebietId}`,
				wahlraeume: `${b}/{termin}/{behoerde}/wahlraeume`,
				ereignisse: `${b}/{termin}/ereignisse?limit=&behoerde=`,
				geodaten: `${b}/geo/{gemeinden|ortsteile|wahllokale}.geojson`,
			},
			hinweise: [
				"Alle Antworten tragen ein ETag; mit If-None-Match gibt es 304.",
				"format=csv liefert eine Zeile je Gebiet und Partei (Semikolon, UTF-8 mit BOM).",
				"Gebiets-Ids stammen aus der Wahlpräsentation und sind je Termin stabil.",
			],
		},
		{ maxAge: 300 },
	);
};

export const OPTIONS: APIRoute = () => optionen();
