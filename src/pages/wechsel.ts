import type { APIRoute } from "astro";
import { KREISE, kreisBySlug } from "../data/kreise.ts";
import { kreisPfad } from "../lib/pfade.ts";

export const prerender = false;

const norm = (wert: string) => wert.trim().toLowerCase();

export const GET: APIRoute = ({ url, redirect }) => {
	const wert = norm(url.searchParams.get("kreis") ?? "");
	const treffer = wert
		? (kreisBySlug(wert) ??
			KREISE.find((k) => norm(k.kurz) === wert || norm(k.name) === wert) ??
			KREISE.find(
				(k) => norm(k.kurz).startsWith(wert) || norm(k.name).includes(wert),
			))
		: undefined;
	return redirect(
		treffer
			? kreisPfad(treffer.slug)
			: `/?unbekannt=${encodeURIComponent(url.searchParams.get("kreis") ?? "")}`,
		302,
	);
};
