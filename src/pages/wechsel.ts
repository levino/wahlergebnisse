import type { APIRoute } from "astro";
import { KREISE, kreisBySlug } from "../data/kreise.ts";
import { kreisPfad } from "../lib/pfade.ts";

export const prerender = false;

const norm = (wert: string) => wert.trim().toLowerCase();

/**
 * Ziel des Suchfelds im Kreis-Umschalter. Ein eigener Pfad, weil ein Formular
 * ohne JavaScript nur an eine feste Adresse schicken kann; die Umleitung
 * bringt den Besucher dann auf die saubere Kreis-Adresse.
 *
 * Angenommen wird, was Menschen tippen: der Slug, der Kurzname, der volle
 * Name, sonst der erste Kreis, der so anfängt.
 */
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
