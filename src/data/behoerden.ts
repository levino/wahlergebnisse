/**
 * Die Behörden (Wahlleitungen) im Landkreis Hildesheim, so wie votemanager sie
 * führt: der Landkreis plus 17 Städte/Gemeinden und die Samtgemeinde
 * Leinebergland (deren Mitgliedsgemeinden Duingen, Eime und Gronau haben
 * keine eigene Präsentation).
 *
 * `slug` ist das URL-Segment in dieser App; wo möglich identisch mit dem
 * Verbands-Slug auf cduhildesheim.de.
 */
export type BehoerdeArt = "kreis" | "stadt" | "gemeinde" | "samtgemeinde";

export type Behoerde = {
	ags: string;
	slug: string;
	/** Name, wie votemanager ihn in Übersichten schreibt ("Stadt Alfeld (Leine)") */
	name: string;
	/** Kurzname für Karten und Menüs */
	kurz: string;
	art: BehoerdeArt;
};

export const KREIS_AGS = "03254000";

export const BEHOERDEN: Behoerde[] = [
	{
		ags: KREIS_AGS,
		slug: "kreis",
		name: "Landkreis Hildesheim",
		kurz: "Landkreis",
		art: "kreis",
	},
	{
		ags: "03254002",
		slug: "alfeld",
		name: "Stadt Alfeld (Leine)",
		kurz: "Alfeld",
		art: "stadt",
	},
	{
		ags: "03254003",
		slug: "algermissen",
		name: "Gemeinde Algermissen",
		kurz: "Algermissen",
		art: "gemeinde",
	},
	{
		ags: "03254005",
		slug: "bad-salzdetfurth",
		name: "Stadt Bad Salzdetfurth",
		kurz: "Bad Salzdetfurth",
		art: "stadt",
	},
	{
		ags: "03254008",
		slug: "bockenem",
		name: "Stadt Bockenem",
		kurz: "Bockenem",
		art: "stadt",
	},
	{
		ags: "03254011",
		slug: "diekholzen",
		name: "Gemeinde Diekholzen",
		kurz: "Diekholzen",
		art: "gemeinde",
	},
	{
		ags: "03254014",
		slug: "elze",
		name: "Stadt Elze",
		kurz: "Elze",
		art: "stadt",
	},
	{
		ags: "03254017",
		slug: "giesen",
		name: "Gemeinde Giesen",
		kurz: "Giesen",
		art: "gemeinde",
	},
	{
		ags: "03254020",
		slug: "harsum",
		name: "Gemeinde Harsum",
		kurz: "Harsum",
		art: "gemeinde",
	},
	{
		ags: "03254021",
		slug: "hildesheim",
		name: "Stadt Hildesheim",
		kurz: "Hildesheim",
		art: "stadt",
	},
	{
		ags: "03254022",
		slug: "holle",
		name: "Gemeinde Holle",
		kurz: "Holle",
		art: "gemeinde",
	},
	{
		ags: "03254026",
		slug: "nordstemmen",
		name: "Gemeinde Nordstemmen",
		kurz: "Nordstemmen",
		art: "gemeinde",
	},
	{
		ags: "03254028",
		slug: "sarstedt",
		name: "Stadt Sarstedt",
		kurz: "Sarstedt",
		art: "stadt",
	},
	{
		ags: "03254029",
		slug: "schellerten",
		name: "Gemeinde Schellerten",
		kurz: "Schellerten",
		art: "gemeinde",
	},
	{
		ags: "03254032",
		slug: "soehlde",
		name: "Gemeinde Söhlde",
		kurz: "Söhlde",
		art: "gemeinde",
	},
	{
		ags: "03254042",
		slug: "freden",
		name: "Gemeinde Freden (Leine)",
		kurz: "Freden",
		art: "gemeinde",
	},
	{
		ags: "03254044",
		slug: "lamspringe",
		name: "Gemeinde Lamspringe",
		kurz: "Lamspringe",
		art: "gemeinde",
	},
	{
		ags: "03254045",
		slug: "sibbesse",
		name: "Gemeinde Sibbesse",
		kurz: "Sibbesse",
		art: "gemeinde",
	},
	{
		ags: "032545406",
		slug: "leinebergland",
		name: "Samtgemeinde Leinebergland",
		kurz: "Leinebergland",
		art: "samtgemeinde",
	},
];

export const GEMEINDEN = BEHOERDEN.filter((b) => b.art !== "kreis");

export const behoerdeBySlug = (slug: string) =>
	BEHOERDEN.find((b) => b.slug === slug);
export const behoerdeByAgs = (ags: string) =>
	BEHOERDEN.find((b) => b.ags === ags);

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** Findet eine Behörde zu einem votemanager-Gebietsnamen ("Gemeinde Nordstemmen", "Nordstemmen", …). */
export const behoerdeByName = (name: string): Behoerde | undefined => {
	const n = norm(name);
	return (
		BEHOERDEN.find((b) => norm(b.name) === n) ??
		BEHOERDEN.find((b) => norm(b.kurz) === n) ??
		BEHOERDEN.find((b) => n.endsWith(norm(b.kurz)) && b.art !== "kreis")
	);
};
