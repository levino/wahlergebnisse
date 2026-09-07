/**
 * Die Landkreise und kreisfreien Städte, die diese App abdeckt.
 *
 * Jeder Kreis bündelt seine Behörden (Wahlleitungen). Die Wurzel der
 * votemanager-Präsentation gehört zur **Behörde**, nicht zum Kreis: Bei
 * einigen Kreisen liegt die Kreisbehörde auf einem anderen Host als ihre
 * Gemeinden. Siehe docs/ausbau-niedersachsen.md.
 *
 * Der Katalog entsteht aus scripts/quellen/ und wird von
 * scripts/kreise-erzeugen.ts erneuert; die Slugs sind aber Handarbeit, weil
 * sie in Adressen stehen und stabil bleiben müssen.
 */
import { BEHOERDEN, KREIS_AGS, type Behoerde } from "./behoerden.ts";

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
	 * Liegt für diesen Kreis überhaupt eine nutzbare Präsentation vor? Sechs
	 * niedersächsische Kreise haben den 13.09.2026 nicht angelegt, zwei
	 * benutzen gar keinen votemanager. Sie werden angezeigt, aber nicht
	 * abgefragt.
	 */
	vorhanden: boolean;
};

export const KREISE: Kreis[] = [
	{
		slug: "hildesheim",
		ags: KREIS_AGS,
		name: "Landkreis Hildesheim",
		kurz: "Hildesheim",
		basis: "http://wahlen.kreis-hi.de/wahlen/",
		behoerden: BEHOERDEN,
		vorhanden: true,
	},
];

/** Der Kreis, mit dem angefangen wurde – Rückfall, wenn nichts gemerkt ist. */
export const STANDARD_KREIS = "hildesheim";

export const kreisBySlug = (slug: string): Kreis | undefined =>
	KREISE.find((k) => k.slug === slug);

export const kreisByAgs = (ags: string): Kreis | undefined =>
	KREISE.find((k) => k.ags === ags);
