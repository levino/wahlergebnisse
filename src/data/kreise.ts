/**
 * Die Landkreise und kreisfreien Städte, die diese App abdeckt – alle 45 in
 * Niedersachsen.
 *
 * Jeder Kreis bündelt seine Behörden (Wahlleitungen). Die Wurzel der
 * votemanager-Präsentation gehört zur **Behörde**, nicht zum Kreis: Bei
 * einigen Kreisen liegt die Kreisbehörde auf einem anderen Host als ihre
 * Gemeinden. Siehe docs/ausbau-niedersachsen.md.
 *
 * Die Daten stehen in kreis-katalog.ts und werden von
 * scripts/kreise-erzeugen.ts aus scripts/quellen/ erzeugt. Hier stehen nur
 * Typ und Zugriffe – die bleiben von Hand gepflegt.
 */
import type { Behoerde } from "./behoerden.ts";
import { KATALOG } from "./kreis-katalog.ts";

export type Kreis = {
	/** URL-Segment, stabil */
	slug: string;
	/** 8-stelliger Schlüssel der Kreisbehörde */
	ags: string;
	/** wie votemanager ihn schreibt: "Landkreis Hildesheim" */
	name: string;
	/** für Menüs und Titel: "Hildesheim" */
	kurz: string;
	/**
	 * Wurzel der Präsentation, gegen die Termin- und Datenpfade aufgelöst
	 * werden – mit Schrägstrich am Ende. Gilt als Vorgabe für die Behörden
	 * dieses Kreises, die keine eigene mitbringen.
	 */
	basis: string;
	behoerden: Behoerde[];
	/**
	 * Liegt für diesen Kreis überhaupt eine nutzbare Präsentation vor? Sieben
	 * niedersächsische Kreise haben den 13.09.2026 nicht (benutzbar) angelegt,
	 * zwei benutzen gar keinen votemanager. Sie werden angezeigt, aber nicht
	 * abgefragt.
	 */
	vorhanden: boolean;
	/** Warum nicht vorhanden – kurzer Satz aus der Erhebung, für die Anzeige. */
	hinweis?: string;
};

export const KREISE: Kreis[] = KATALOG;

/** Der Kreis, mit dem angefangen wurde – Rückfall, wenn nichts gemerkt ist. */
export const STANDARD_KREIS = "hildesheim";

export const kreisBySlug = (slug: string): Kreis | undefined =>
	KREISE.find((k) => k.slug === slug);

export const kreisByAgs = (ags: string): Kreis | undefined =>
	KREISE.find((k) => k.ags === ags);

/**
 * Kreis einer Behörde. Die ersten fünf Stellen des Gebietsschlüssels sind der
 * Kreis – bei achtstelligen Gemeindeschlüsseln wie bei den neunstelligen der
 * Samtgemeinden.
 */
export const kreisVonBehoerde = (ags: string): Kreis | undefined =>
	kreisByAgs(`${ags.slice(0, 5)}000`);

/** Kreise, die abgefragt werden können. */
export const VORHANDENE_KREISE: Kreis[] = KREISE.filter((k) => k.vorhanden);

/** Alle Behörden aller Kreise – 416 Stück. */
export const ALLE_BEHOERDEN: Behoerde[] = KREISE.flatMap((k) => k.behoerden);

/**
 * Wurzel der Präsentation einer Behörde, mit Schrägstrich am Ende.
 *
 * `VOTEMANAGER_BASIS` biegt sie global um – darauf beruhen die Tests und die
 * Vorschau-Umgebungen, die gegen einen Mock laufen statt gegen 45 fremde
 * Server.
 */
export const wurzelVon = (kreis: Kreis, behoerde?: Behoerde): string => {
	const umleitung = process.env.VOTEMANAGER_BASIS;
	if (umleitung) return umleitung.endsWith("/") ? umleitung : `${umleitung}/`;
	return behoerde?.wurzel ?? kreis.basis;
};
