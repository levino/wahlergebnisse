import { KREISE, STANDARD_KREIS, kreisBySlug } from "./kreise.ts";

export type BehoerdeArt = "kreis" | "stadt" | "gemeinde" | "samtgemeinde";

export type Behoerde = {
	/** Gebietsschlüssel, 8-stellig (Gemeinden) oder 9-stellig (Samtgemeinden) */
	ags: string;
	slug: string;
	/** Name, wie votemanager ihn in Übersichten schreibt ("Stadt Alfeld (Leine)") */
	name: string;
	/** Kurzname für Karten und Menüs */
	kurz: string;
	art: BehoerdeArt;
	wurzel?: string;
	archive?: string[];
};

const standard = kreisBySlug(STANDARD_KREIS) ?? KREISE[0];

/** Schlüssel der Kreisbehörde des Standard-Kreises. */
export const KREIS_AGS = standard.ags;

/** Die Behörden des Standard-Kreises. */
export const BEHOERDEN: Behoerde[] = standard.behoerden;

export const GEMEINDEN = BEHOERDEN.filter((b) => b.art !== "kreis");

export const behoerdeBySlug = (slug: string) =>
	BEHOERDEN.find((b) => b.slug === slug);
export const behoerdeByAgs = (ags: string) =>
	BEHOERDEN.find((b) => b.ags === ags);

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

export const behoerdeByName = (
	name: string,
	behoerden: readonly Behoerde[] = BEHOERDEN,
): Behoerde | undefined => {
	const n = norm(name);
	return (
		behoerden.find((b) => norm(b.name) === n) ??
		behoerden.find((b) => norm(b.kurz) === n) ??
		behoerden.find((b) => n.endsWith(norm(b.kurz)) && b.art !== "kreis")
	);
};
