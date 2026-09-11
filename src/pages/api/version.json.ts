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
