import type { APIRoute } from "astro";
import { terminById } from "../../data/termine.ts";
import { zuletztGeprueft } from "../../lib/abfragen.ts";
import { fehler, json, optionen } from "../../lib/http.ts";
import { topicAusParametern, topicVersion } from "../../lib/stand.ts";

export const prerender = false;

export const GET: APIRoute = ({ request, url }) => {
	const termin = terminById(url.searchParams.get("termin") ?? "");
	if (!termin)
		return fehler(
			404,
			"Unbekannter Termin",
			"Der Parameter termin nennt keinen bekannten Wahltermin.",
		);
	const topic = topicAusParametern(url.searchParams);
	return json(
		request,
		{
			termin: termin.id,
			topic,
			version: topicVersion(termin.id, topic),
			geprueft: zuletztGeprueft(termin.id),
		},
		{ headers: { "cache-control": "no-cache" } },
	);
};

export const OPTIONS: APIRoute = () => optionen();
