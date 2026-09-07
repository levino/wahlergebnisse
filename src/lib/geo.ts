/**
 * Geodaten für die Karten und ihre Zuordnung zu votemanager-Gebieten.
 *
 * Quellen (alle einmalig per scripts/geo_*.py erzeugt, im Repo eingecheckt):
 *   gemeinden.geo.json   BKG VG250 – Gemeindegrenzen (© GeoBasis-DE/BKG, dl-de/by-2-0)
 *   ortsteile.geo.json   LGLN Gemarkungen (© LGLN, dl-de/by-2-0) und OSM-Ortsteile der Stadt Hildesheim (ODbL)
 *   wahllokale.geo.json  Wahlräume aus votemanager, geocodiert über Nominatim/OSM (ODbL)
 *
 * votemanager kennt für den Landkreis keine Geometrien; die Zuordnung läuft
 * über Namen (Gemeinde, Ortsteil) bzw. die Wahlbezirksnummer (Wahllokale).
 */
import gemeindenRoh from "../data/geo/gemeinden.geo.json";
import ortsteileRoh from "../data/geo/ortsteile.geo.json";
import wahllokaleRoh from "../data/geo/wahllokale.geo.json";
import { behoerdeByName } from "../data/behoerden.ts";

export type Geometrie =
	| { type: "Polygon" | "MultiPolygon"; coordinates: unknown }
	| { type: "Point"; coordinates: [number, number] }
	| null;
export type Feature<P> = {
	type: "Feature";
	properties: P;
	geometry: Geometrie;
};

export type GemeindeProps = {
	ags: string;
	behoerde: string;
	name: string;
	bez: string;
	samtgemeinde: boolean;
};
export type OrtsteilProps = {
	ags: string;
	gemeinde: string;
	name: string;
	quelle: "lgln" | "osm";
	teil?: string;
};
export type WahllokalProps = {
	termin: string;
	behoerde: string;
	wahlbezirk: string;
	wahlraum: number | null;
	bezirk: string;
	ortsteil: string;
	name: string;
	adresse: string;
};

type FC<P> = { type: "FeatureCollection"; features: Feature<P>[] };

export const GEMEINDEN = (gemeindenRoh as FC<GemeindeProps>).features;
const ORTSTEILE_ALLE = (ortsteileRoh as FC<OrtsteilProps>).features;
export const WAHLLOKALE = (wahllokaleRoh as FC<WahllokalProps>).features;

/** Für die Stadt Hildesheim liegen OSM-Ortsteile vor; die LGLN-Gemarkungen dort weglassen. */
const agsMitOsm = new Set(
	ORTSTEILE_ALLE.filter((f) => f.properties.quelle === "osm").map(
		(f) => f.properties.ags,
	),
);
export const ORTSTEILE = ORTSTEILE_ALLE.filter(
	(f) => f.properties.quelle === "osm" || !agsMitOsm.has(f.properties.ags),
);

/** Normalisierung für Namensvergleiche: Umlaute, Klammern, Trennzeichen. */
export const normName = (s: string): string =>
	s
		.toLowerCase()
		.replace(/\(.*?\)/g, "")
		.replace(/[äöü]/g, (c) => ({ ä: "ae", ö: "oe", ü: "ue" })[c] ?? c)
		.replace(/ß/g, "ss")
		.replace(/^(gemeinde|stadt|flecken|ortschaft|samtgemeinde)\s+/, "")
		.replace(/[^a-z0-9]+/g, "");

/** Gemeinde-Feature(s) zu einer votemanager-Behörde (AGS). Samtgemeinde → alle Mitgliedsgemeinden. */
export const gemeindenFuerBehoerde = (ags: string): Feature<GemeindeProps>[] =>
	GEMEINDEN.filter((f) => f.properties.behoerde === ags);

/** Behörde (AGS) zu einer Übersichtszeile der Kreisebene ("Stadt Alfeld (Leine)"). */
export const behoerdeAgsFuerLabel = (label: string): string | undefined =>
	behoerdeByName(label)?.ags;

/**
 * Ortsteil-Feature(s) einer Behörde zu einem votemanager-Ortsteilnamen.
 * Gemarkungen heißen gelegentlich anders als die Ortschaft; ein kleiner
 * Alias-Katalog fängt die bekannten Fälle ab.
 */
const ALIAS: Record<string, string[]> = {
	// votemanager-Name → Gemarkungsnamen
	"langenholzen/sack": ["langenholzen", "sack"],
	"brunkensen-luetgenholzen": ["brunkensen", "luetgenholzen"],
	"imsen/wispenstein": ["imsen", "wispenstein"],
	"woltershausen-hornsen": ["woltershausenhornsen"],
	"garmissen-garbolzum": ["garmissengarbolzum"],
};

export const ortsteileFuer = (
	agsListe: string[],
	name: string,
): Feature<OrtsteilProps>[] => {
	const n = normName(name);
	const kandidaten = ORTSTEILE.filter((f) =>
		agsListe.includes(f.properties.ags),
	);
	const direkt = kandidaten.filter((f) => normName(f.properties.name) === n);
	if (direkt.length) return direkt;
	const aliasKey = name
		.toLowerCase()
		.replace(/ß/g, "ss")
		.replace(/ü/g, "ue")
		.replace(/ö/g, "oe")
		.replace(/ä/g, "ae")
		.replace(/\s+/g, "");
	const alias = ALIAS[aliasKey];
	if (alias)
		return kandidaten.filter((f) =>
			alias.includes(normName(f.properties.name)),
		);
	// "Groß Escherde" ↔ "Gross Escherde", "Nordstemmen" ↔ "Nordstemmen": bereits abgedeckt; Rest: Präfixvergleich
	return kandidaten.filter(
		(f) =>
			normName(f.properties.name).startsWith(n) ||
			n.startsWith(normName(f.properties.name)),
	);
};

/** Wahlbezirksnummer aus einem votemanager-Label "09 - Rössing - DGH" → "9". */
export const wahlbezirkNr = (label: string): string => {
	const m = label.trim().match(/^(\d+)/);
	return m ? String(Number(m[1])) : "";
};

/** Wahllokal-Feature zu einem Wahlbezirk (Termin, Behörde, Nummer). */
export const wahllokalFuer = (
	termin: string,
	behoerde: string,
	nr: string,
): Feature<WahllokalProps> | undefined =>
	WAHLLOKALE.find(
		(f) =>
			f.properties.termin === termin &&
			f.properties.behoerde === behoerde &&
			String(Number(f.properties.wahlbezirk)) === nr &&
			f.geometry,
	);

/** Bounding-Box [[minLon, minLat], [maxLon, maxLat]] einer Feature-Liste. */
export const bbox = (
	features: Array<Feature<unknown>>,
): [[number, number], [number, number]] | undefined => {
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	const walk = (c: unknown) => {
		if (!Array.isArray(c)) return;
		if (typeof c[0] === "number") {
			const [x, y] = c as number[];
			if (x < minX) minX = x;
			if (x > maxX) maxX = x;
			if (y < minY) minY = y;
			if (y > maxY) maxY = y;
			return;
		}
		for (const k of c) walk(k);
	};
	for (const f of features) if (f.geometry) walk(f.geometry.coordinates);
	return Number.isFinite(minX)
		? [
				[minX, minY],
				[maxX, maxY],
			]
		: undefined;
};
