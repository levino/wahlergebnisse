/**
 * Adressen der App an einer Stelle. Seit dem Ausbau auf ganz Niedersachsen
 * steht der Kreis als erstes Segment in jedem Pfad; ohne ihn wären Gemeinden
 * gleichen Namens in zwei Kreisen nicht zu unterscheiden.
 *
 * Hier stehen die Bauer der Pfade und die Regel, nach der eine alte Adresse
 * ohne Kreis auf die neue umgeschrieben wird. Beides ist reine Rechnung, damit
 * es sich ohne Server prüfen lässt.
 */
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

/**
 * Erste Brotkrume einer Behördenseite: der Termin.
 *
 * Mit Verweis auf die Kreis-Terminseite – aber nur, wenn es die gibt. Einen
 * Termin, den bloß eine Gemeinde führt (Bürgermeisterwahl 2018 in Bad
 * Salzdetfurth), zeigt die Kreisebene nicht; die Krume steht dann als reine
 * Beschriftung da, statt auf eine Weiterleitung oder ins Leere zu führen.
 */
export const terminKrume = (
	kreis: Kreis,
	termin: Termin,
): { titel: string; href?: string } =>
	terminGiltFuerKreis(termin, kreis.slug)
		? { titel: termin.titel, href: terminPfad(kreis.slug, termin.id) }
		: { titel: termin.titel };

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

/**
 * Der Kreis, zu dem ein Pfad gehört – oder undefined, wenn das erste Segment
 * kein bekannter Kreis ist (Startseite, /api, /rechtliches, Unfug).
 */
export const kreisAusPfad = (pfad: string): string | undefined => {
	const erstes = pfad.split("/")[1] ?? "";
	return kreisBySlug(erstes) ? erstes : undefined;
};

/**
 * Alte Adresse ohne Kreis auf die neue umschreiben – für Seiten wie für die
 * Schnittstelle. Ergebnis ist der neue Pfad oder undefined, wenn nichts zu tun
 * ist.
 *
 * Erkennungsmerkmal ist der Wahltermin an der Stelle, an der heute der Kreis
 * steht: Termin-Ids sind Jahreszahlen, Kreis-Slugs sind Namen, eine Kollision
 * ist ausgeschlossen. Ein bereits gültiger Kreis wird nie erneut umgeleitet,
 * und ein unbekanntes Segment bleibt unangetastet – es führt zur 404 statt in
 * eine Schleife.
 */
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

/**
 * Behörde innerhalb eines Kreises auflösen – nach Slug oder Schlüssel. Bewusst
 * nicht über alle Kreise hinweg: Gemeindenamen wiederholen sich in
 * Niedersachsen, und eine Adresse soll nur die Behörde ihres eigenen Kreises
 * treffen.
 */
export const behoerdeImKreis = (
	kreis: Kreis,
	wert: string,
): Behoerde | undefined =>
	kreis.behoerden.find((b) => b.slug === wert) ??
	kreis.behoerden.find((b) => b.ags === wert);
