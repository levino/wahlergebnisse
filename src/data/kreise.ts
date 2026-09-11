import type { Behoerde } from "./behoerden.ts";
import { KATALOG } from "./kreis-katalog.ts";

export type AmtlicheQuelle = {
	/** Vollständige Adresse, auf die verlinkt wird */
	url: string;
	/** Was dort zu sehen ist: „Kreistagswahl 2021“ */
	titel: string;
};

export type Kreis = {
	/** URL-Segment, stabil */
	slug: string;
	/** 8-stelliger Schlüssel der Kreisbehörde */
	ags: string;
	/** wie votemanager ihn schreibt: "Landkreis Hildesheim" */
	name: string;
	/** für Menüs und Titel: "Hildesheim" */
	kurz: string;
	basis: string;
	behoerden: Behoerde[];
	vorhanden: boolean;
	/** Warum nicht vorhanden – kurzer Satz aus der Erhebung, für die Anzeige. */
	hinweis?: string;
	quellen?: AmtlicheQuelle[];
	archive?: string[];
};

export const KREISE: Kreis[] = KATALOG;

/** Der Kreis, mit dem angefangen wurde – Rückfall, wenn nichts gemerkt ist. */
export const STANDARD_KREIS = "hildesheim";

export const kreisBySlug = (slug: string): Kreis | undefined =>
	KREISE.find((k) => k.slug === slug);

export const kreisByAgs = (ags: string): Kreis | undefined =>
	KREISE.find((k) => k.ags === ags);

export const kreisVonBehoerde = (ags: string): Kreis | undefined =>
	kreisByAgs(`${ags.slice(0, 5)}000`);

export const VORHANDENE_KREISE: Kreis[] = KREISE.filter(
	(k) => k.behoerden.length > 0,
);

export const KREISE_OHNE_QUELLE: Kreis[] = KREISE.filter(
	(k) => k.behoerden.length === 0,
);

/** Alle Behörden aller Kreise – 416 Stück. */
export const ALLE_BEHOERDEN: Behoerde[] = KREISE.flatMap((k) => k.behoerden);

export const wurzelVon = (kreis: Kreis, behoerde?: Behoerde): string => {
	const umleitung = process.env.VOTEMANAGER_BASIS;
	if (umleitung) return umleitung.endsWith("/") ? umleitung : `${umleitung}/`;
	return behoerde?.wurzel ?? kreis.basis;
};

export const kreisbehoerdeVon = (kreis: Kreis): Behoerde | undefined =>
	kreis.behoerden.find((b) => b.ags === kreis.ags);
