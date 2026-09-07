import type { APIRoute } from "astro";
import { apiKreise, apiTermine } from "../../../lib/api.ts";
import { basisUrl, json, optionen } from "../../../lib/http.ts";

export const prerender = false;

/** Einstieg: was es gibt und wo es liegt. */
export const GET: APIRoute = ({ request, url, site }) => {
	const basis = basisUrl(site, url);
	const b = `${basis}/api/v1`;
	return json(
		request,
		{
			name: "Wahlergebnisse Niedersachsen – offene API",
			beschreibung:
				"Ergebnisse der Kommunalwahlen in den niedersächsischen Landkreisen und kreisfreien Städten, aufbereitet aus den amtlichen Wahlpräsentationen: benannte Felder statt D1_3-Spalten, jede Ebene im selben Format, JSON und CSV. Der Kreis ist das erste Segment jedes Pfades.",
			lizenz: {
				daten:
					"Amtliche Ergebnisse der Wahlleitungen (votemanager). Weiterverwendung frei; maßgeblich sind die Bekanntmachungen der Wahlleitungen.",
				geodaten:
					"Gemeindegrenzen © GeoBasis-DE/BKG (dl-de/by-2-0), Gemarkungen © LGLN (dl-de/by-2-0), Ortsteile Hildesheim und Adressen © OpenStreetMap-Mitwirkende (ODbL)",
			},
			kontakt: "https://github.com/levino/wahlergebnisse/issues",
			openapi: `${b}/openapi.json`,
			mcp: `${basis}/mcp`,
			termine: apiTermine(),
			kreise: apiKreise(),
			pfade: {
				termine: `${b}/termine`,
				kreise: `${b}/kreise`,
				kreis: `${b}/{kreis}`,
				ueberblick: `${b}/{kreis}/{termin}`,
				behoerden: `${b}/{kreis}/{termin}/behoerden`,
				wahlen: `${b}/{kreis}/{termin}/wahlen?behoerde=&typ=`,
				wahl: `${b}/{kreis}/{termin}/{behoerde}/{wahl}`,
				gebiete: `${b}/{kreis}/{termin}/{behoerde}/{wahl}/gebiete?ebene=&format=json|csv`,
				gebiet: `${b}/{kreis}/{termin}/{behoerde}/{wahl}/gebiete/{gebietId}`,
				wahlraeume: `${b}/{kreis}/{termin}/{behoerde}/wahlraeume`,
				ereignisse: `${b}/{kreis}/{termin}/ereignisse?limit=&behoerde=`,
				geodaten: `${b}/geo/{gemeinden|ortsteile|wahllokale}.geojson`,
			},
			hinweise: [
				"Alle Antworten tragen ein ETag; mit If-None-Match gibt es 304.",
				"format=csv liefert eine Zeile je Gebiet und Partei (Semikolon, UTF-8 mit BOM).",
				"Gebiets-Ids stammen aus der Wahlpräsentation und sind je Termin stabil.",
				"Adressen ohne Kreis werden dauerhaft (301) auf den Landkreis Hildesheim umgeleitet, unter dem sie früher lagen.",
			],
		},
		{ maxAge: 300 },
	);
};

export const OPTIONS: APIRoute = () => optionen();
