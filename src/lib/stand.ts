import type { Behoerde } from "../data/behoerden.ts";
import type { Kreis } from "../data/kreise.ts";
import { kreisBySlug } from "../data/kreise.ts";
import { type Db, metaGet, oeffneDb } from "./db.ts";

/**
 * Die Kennung einer Seite: Kreis und die Wahlleitungen, von deren Zahlen sie
 * lebt – `<kreis>/<ags>/<ags>…`, die eigene Wahlleitung zuerst.
 *
 * Der Server bildet sie dort, wo er die Seite baut. Für den Client ist sie
 * eine undurchsichtige Zeichenkette: Er abonniert sie und ruft damit ab,
 * mehr weiß er über den Zuschnitt nicht.
 */
export type Topic = string;

/** Das ganze Land – kein Kreis, keine Wahlleitung. */
export const TOPIC_ALLE: Topic = "alle";

export const topicAus = (
	kreis: Kreis | undefined,
	behoerden: readonly string[] = [],
): Topic =>
	kreis ? [kreis.slug, ...new Set(behoerden)].join("/") : TOPIC_ALLE;

/** Der Teil ohne eingestellte Partei – unter ihm hängt der Zuschnitt. */
export const basisVonTopic = (topic: Topic): Topic => topic.split("#")[0] ?? "";

type Teile = { kreis?: Kreis; behoerden: string[] };

/** Zerlegt eine Kennung und wirft weg, was es nicht gibt. */
const teileAus = (topic: Topic): Teile => {
	const [slug = "", ...roh] = basisVonTopic(topic).split("/").filter(Boolean);
	const kreis = kreisBySlug(slug);
	if (!kreis) return { behoerden: [] };
	const eigene = new Set(kreis.behoerden.map((b) => b.ags));
	return {
		kreis,
		behoerden: [...new Set(roh)].filter((ags) => eigene.has(ags)),
	};
};

/** Die Kennung einer Anfrage, auf Bekanntes gestutzt. */
export const topicAusParametern = (p: URLSearchParams): Topic => {
	const { kreis, behoerden } = teileAus(p.get("topic") ?? "");
	return topicAus(kreis, behoerden);
};

export const kreisAusTopic = (topic: Topic): Kreis | undefined =>
	teileAus(topic).kreis;

/** Die Wahlleitung, um die es auf der Seite geht – die erste der Kennung. */
export const wahlleitungAusTopic = (
	topic: Topic,
): { kreis: Kreis; behoerde: Behoerde } | undefined => {
	const { kreis, behoerden } = teileAus(topic);
	const behoerde = kreis?.behoerden.find((b) => b.ags === behoerden[0]);
	return kreis && behoerde ? { kreis, behoerde } : undefined;
};

/** Die Behörden, deren Daten in diese Kennung fallen. */
const behoerdenVon = (topic: Topic): string[] | undefined => {
	const { kreis, behoerden } = teileAus(topic);
	if (!kreis) return undefined;
	return behoerden.length > 0 ? behoerden : kreis.behoerden.map((b) => b.ags);
};

const ausDb = (db: Db, termin: string, agsListe: string[]): string => {
	const platzhalter = agsListe.map(() => "?").join(",");
	const zeile = db
		.prepare(
			`SELECT MAX(stand) AS stand FROM (
			   SELECT MAX(aktualisiert) AS stand FROM ergebnisse WHERE termin = ? AND behoerde IN (${platzhalter})
			   UNION ALL
			   SELECT MAX(aktualisiert) AS stand FROM uebersichten WHERE termin = ? AND behoerde IN (${platzhalter})
			 )`,
		)
		.get(termin, ...agsListe, termin, ...agsListe) as
		| { stand: string | null }
		| undefined;
	return zeile?.stand ?? "";
};

const gemerkt = new Map<string, { global: string; version: string }>();

/** Nur für Tests: den Zwischenspeicher leeren. */
export const vergissTopicVersionen = (): void => gemerkt.clear();

export const topicVersion = (terminId: string, topic: Topic): string => {
	const db = oeffneDb();
	const global = metaGet(db, `termin:${terminId}:version`) ?? "";
	const agsListe = behoerdenVon(topic);
	if (!agsListe) return global;
	const schluessel = `${terminId}|${agsListe.join(",")}`;
	const alt = gemerkt.get(schluessel);
	if (alt && alt.global === global) return alt.version;
	const version = ausDb(db, terminId, agsListe);
	gemerkt.set(schluessel, { global, version });
	return version;
};

/** Nur Kleinbuchstaben, Ziffern und Bindestrich – so bildet `parteiKey`. */
export const parteiKeyAus = (roh: string | null): string | undefined => {
	const k = (roh ?? "").trim().toLowerCase().slice(0, 40);
	return /^[a-z0-9-]+$/.test(k) ? k : undefined;
};

/**
 * Die Kennung samt eingestellter Partei.
 *
 * Die Partei gehört hinein, weil Jubel und Abstieg nur den angehen, der sie
 * eingestellt hat. Gleiche Partei, gleiches Paket; andere Partei, anderes.
 */
export const topicName = (basis: Topic, parteiKey?: string): Topic =>
	parteiKey ? `${basis}#${parteiKey}` : basis;
