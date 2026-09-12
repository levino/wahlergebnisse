import type { APIRoute } from "astro";
import {
	TERMINE,
	type Termin,
	istLive,
	terminById,
} from "../../data/termine.ts";
import { zuletztGeprueft } from "../../lib/abfragen.ts";
import { fehler, json, optionen } from "../../lib/http.ts";
import { ORT_PARAM, type VersionAntwort } from "../../lib/live-kanal.ts";
import { topicAusParametern, topicVersion } from "../../lib/stand.ts";

export const prerender = false;

/** Ohne Parameter der laufende Termin – und nur er, nie ein Ausweichtermin. */
const gefragterTermin = (genannt: string | null): Termin | undefined =>
	genannt ? terminById(genannt) : TERMINE.find(istLive);

export const GET: APIRoute = ({ request, url }) => {
	const genannt = url.searchParams.get(ORT_PARAM.termin);
	const termin = gefragterTermin(genannt);
	if (!termin)
		return fehler(
			404,
			genannt ? "Unbekannter Termin" : "Kein laufender Termin",
			genannt
				? "Der Parameter termin nennt keinen bekannten Wahltermin."
				: "Ohne Parameter antwortet der Puls für den laufenden Termin; gerade läuft keiner. Nenne einen Termin mit ?termin=…",
		);
	const topic = topicAusParametern(url.searchParams);
	const antwort: VersionAntwort = {
		termin: termin.id,
		topic,
		version: topicVersion(termin.id, topic),
		geprueft: zuletztGeprueft(termin.id),
	};
	return json(request, antwort, {
		headers: { "cache-control": "no-cache" },
	});
};

export const OPTIONS: APIRoute = () => optionen();
