import type { APIRoute } from "astro";
import { apiKreise } from "../../../lib/api.ts";
import { json, optionen } from "../../../lib/http.ts";

export const prerender = false;

/** Alle Kreise – das erste Segment jeder Adresse. */
export const GET: APIRoute = ({ request }) =>
	json(request, { kreise: apiKreise() }, { maxAge: 3600 });

export const OPTIONS: APIRoute = () => optionen();
