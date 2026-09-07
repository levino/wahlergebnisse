import type { APIRoute } from "astro";
import { terminById } from "../../data/termine.ts";
import { version, zuletztGeprueft } from "../../lib/abfragen.ts";

export const prerender = false;

/** Versionsstempel eines Termins – die Seiten fragen ihn alle 30 s ab und laden bei Änderung neu. */
export const GET: APIRoute = ({ url }) => {
	const termin = terminById(url.searchParams.get("termin") ?? "");
	if (!termin)
		return new Response(JSON.stringify({ error: "unbekannter Termin" }), {
			status: 404,
			headers: { "content-type": "application/json" },
		});
	return new Response(
		JSON.stringify({
			termin: termin.id,
			version: version(termin.id),
			geprueft: zuletztGeprueft(termin.id),
		}),
		{
			headers: {
				"content-type": "application/json; charset=utf-8",
				"cache-control": "no-store",
			},
		},
	);
};
