import type { Behoerde } from "../data/behoerden.ts";
import {
	KREISE,
	type Kreis,
	STANDARD_KREIS,
	kreisBySlug,
} from "../data/kreise.ts";
import {
	type Termin,
	terminById,
	terminGiltFuerKreis,
} from "../data/termine.ts";

const teil = (wert: string | undefined) => (wert ? `${wert}/` : "");

export const kreisPfad = (kreis: string): string => `/${kreis}/`;

export const terminPfad = (kreis: string, termin: string): string =>
	`/${kreis}/${termin}/`;

export const behoerdePfad = (
	kreis: string,
	termin: string,
	behoerde: string,
): string => `/${kreis}/${termin}/${behoerde}/`;

export const terminKrume = (
	kreis: Kreis,
	termin: Termin,
): { titel: string; href?: string } =>
	terminGiltFuerKreis(termin, kreis.slug)
		? { titel: termin.titel, href: terminPfad(kreis.slug, termin.id) }
		: { titel: termin.titel };

export const dashboardPfad = (
	kreis: string,
	termin: string,
	behoerde: string,
): string => `/${kreis}/${termin}/${behoerde}/dashboard`;

export const ortPfad = (
	kreis: string,
	termin: string,
	behoerde: string,
	ort: string,
): string => `/${kreis}/${termin}/${behoerde}/ort/${ort}`;

export const wahlPfad = (
	kreis: string,
	termin: string,
	behoerde: string,
	wahl: string,
	gebiet?: string,
): string => `/${kreis}/${termin}/${behoerde}/${wahl}/${teil(gebiet)}`;

/** Präfix der Schnittstelle; der Kreis sitzt dahinter an derselben Stelle. */
export const API_PRAEFIX = "/api/v1";

export const apiKreisPfad = (kreis: string): string =>
	`${API_PRAEFIX}/${kreis}`;

export const kreisAusPfad = (pfad: string): string | undefined => {
	const erstes = pfad.split("/")[1] ?? "";
	return kreisBySlug(erstes) ? erstes : undefined;
};

export const altePfadUmschreibung = (pfad: string): string | undefined => {
	const api = pfad === API_PRAEFIX || pfad.startsWith(`${API_PRAEFIX}/`);
	const rumpf = api ? pfad.slice(API_PRAEFIX.length) : pfad;
	const segmente = rumpf.split("/");
	const kandidat = segmente[1] ?? "";
	if (!kandidat || kreisBySlug(kandidat) || !terminById(kandidat))
		return undefined;
	segmente.splice(1, 0, STANDARD_KREIS);
	return `${api ? API_PRAEFIX : ""}${segmente.join("/")}`;
};

/** Die Kreise für Menüs: alphabetisch, vorhandene zuerst erkennbar. */
export const kreiseSortiert = () =>
	[...KREISE].sort((a, b) => a.kurz.localeCompare(b.kurz, "de"));

export const behoerdeImKreis = (
	kreis: Kreis,
	wert: string,
): Behoerde | undefined =>
	kreis.behoerden.find((b) => b.slug === wert) ??
	kreis.behoerden.find((b) => b.ags === wert);
