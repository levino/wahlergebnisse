import type { APIRoute } from "astro";
import { terminById } from "../../data/termine.ts";
import { zuletztGeprueft } from "../../lib/abfragen.ts";
import { fehler, json, optionen } from "../../lib/http.ts";
import { ORT_PARAM, type VersionAntwort } from "../../lib/live-kanal.ts";
import { topicAusParametern, topicVersion } from "../../lib/stand.ts";

export const prerender = false;

export const GET: APIRoute = ({ request, url }) => {
	const termin = terminById(url.searchParams.get(ORT_PARAM.termin) ?? "");
	if (!termin)
		return fehler(
			404,
			"Unbekannter Termin",
			"Der Parameter termin nennt keinen bekannten Wahltermin.",
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
