import type { APIRoute } from "astro";
import { apiTermine } from "../../../lib/api.ts";
import { json, optionen } from "../../../lib/http.ts";

export const prerender = false;

export const GET: APIRoute = ({ request }) =>
	json(request, { termine: apiTermine() }, { maxAge: 60 });

export const OPTIONS: APIRoute = () => optionen();
