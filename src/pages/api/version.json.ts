import type { APIRoute } from "astro";
import { terminById } from "../../data/termine.ts";
import { zuletztGeprueft } from "../../lib/abfragen.ts";
import { fehler, json, optionen } from "../../lib/http.ts";
import {
	bereichAusParametern,
	bereichsName,
	bereichsVersion,
} from "../../lib/stand.ts";

export const prerender = false;

/**
 * Versionsstempel eines Termins – auf Wunsch nur für einen Kreis oder eine
 * Behörde (`?termin=2026&kreis=hildesheim&behoerde=nordstemmen`). Der Stempel
 * ändert sich genau dann, wenn in diesem Ausschnitt neue Zahlen stehen; wie
 * fein das ist und warum, steht in `src/lib/stand.ts`.
 *
 * Die Seiten selbst fragen hier **nicht** mehr im Takt nach – sie lassen sich
 * den Stand über `/api/live` (SSE) zustellen. Der Endpunkt bleibt als
 * Nachschlagestelle: für Skripte, für die Fehlersuche und als Notnagel, wenn
 * eine Umgebung keine offenen Antworten durchreicht.
 *
 * Billig gehalten: kleine Antwort, ETag, und `no-cache` statt `no-store` –
 * damit ein unveränderter Stand mit 304 und ohne Rumpf beantwortet werden
 * kann, statt jedes Mal neu übertragen zu werden.
 */
export const GET: APIRoute = ({ request, url }) => {
	const termin = terminById(url.searchParams.get("termin") ?? "");
	if (!termin)
		return fehler(
			404,
			"Unbekannter Termin",
			"Der Parameter termin nennt keinen bekannten Wahltermin.",
		);
	const bereich = bereichAusParametern(url.searchParams);
	return json(
		request,
		{
			termin: termin.id,
			bereich: bereichsName(bereich),
			version: bereichsVersion(termin.id, bereich),
			geprueft: zuletztGeprueft(termin.id),
		},
		{ headers: { "cache-control": "no-cache" } },
	);
};

export const OPTIONS: APIRoute = () => optionen();
