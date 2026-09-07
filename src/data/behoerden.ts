/**
 * Behörden (Wahlleitungen), so wie votemanager sie führt: je Kreis die
 * Kreisbehörde plus ihre Städte, Gemeinden und Samtgemeinden.
 *
 * Hier stehen der Typ und die Zugriffe. Die Daten liegen im Katalog
 * (kreis-katalog.ts, erzeugt aus scripts/quellen/); dieses Modul zeigt
 * denselben Bestand aus der Sicht **eines** Kreises, weil große Teile der App
 * noch mit einem festen Kreis arbeiten. Welcher das ist, sagt
 * `STANDARD_KREIS`.
 *
 * `slug` ist das URL-Segment in dieser App. Slugs stehen in Adressen und
 * bleiben deshalb unverändert, auch wenn die Überlegung, aus der sie einmal
 * entstanden sind, nicht mehr gilt: Eine Adresse, die einmal veröffentlicht
 * wurde, soll weiter funktionieren.
 */
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
	/**
	 * Abweichende Wurzel der Präsentation (mit Schrägstrich am Ende). Fehlt
	 * sie, gilt die des Kreises. In drei Kreisen liegen Kreisbehörde und
	 * Gemeinden auf verschiedenen Hosts.
	 */
	wurzel?: string;
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

/**
 * Findet eine Behörde zu einem votemanager-Gebietsnamen ("Gemeinde
 * Nordstemmen", "Nordstemmen", …).
 *
 * Ohne Angabe wird im Standard-Kreis gesucht. Wer einen anderen Kreis vor sich
 * hat, gibt dessen Behörden mit: Gemeindenamen wiederholen sich in
 * Niedersachsen (Bergen, Neuenkirchen, …), und eine Zeile aus der Übersicht
 * eines Kreises meint immer nur eine Behörde **dieses** Kreises.
 */
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
