import type { Behoerde } from "../data/behoerden.ts";
import type { Kreis } from "../data/kreise.ts";
import { kreisBySlug } from "../data/kreise.ts";
import { type Termin, terminById } from "../data/termine.ts";
import { type Db, metaGet, oeffneDb } from "./db.ts";
import { ORT_PARAM } from "./live-kanal.ts";

/**
 * Die Kennung einer Seite – ihre Adresse: `<kreis>/<termin>/<wahlleitung>`.
 *
 * Sie wird nachgeschlagen, nicht gerechnet. Der Zuschnitt einer Seite steht in
 * ihrer Adresse, und die ändert sich nie; was gerade an Zahlen dasteht, hat
 * darauf keinen Einfluss.
 *
 * `topicFuer` ist die einzige Stelle, die sie bildet – für die ausgelieferte
 * Seite wie für den abgelegten Beitrag. Für den Browser ist sie eine
 * undurchsichtige Zeichenkette: Er trägt sie mit und deutet sie nicht.
 */
export type Topic = string;

/** Das ganze Land – kein Kreis, kein Termin, keine Wahlleitung. */
export const TOPIC_ALLE: Topic = "alle";

/** Woraus eine Kennung besteht; jedes Stück steht in der Adresse der Seite. */
export type Zuschnitt = {
	kreis?: Kreis;
	termin?: Termin;
	behoerde?: Behoerde;
};

export const topicFuer = (z: Zuschnitt): Topic => {
	if (!z.kreis) return TOPIC_ALLE;
	if (!z.termin) return z.kreis.slug;
	return [
		z.kreis.slug,
		z.termin.id,
		...(z.behoerde ? [z.behoerde.slug] : []),
	].join("/");
};

/** Dieselbe Kennung rückwärts: Was es nicht gibt, fällt weg. */
export const zuschnittVonTopic = (topic: Topic): Zuschnitt => {
	const [kreisSlug = "", terminId = "", behoerdeSlug = ""] = topic.split("/");
	const kreis = kreisBySlug(kreisSlug);
	if (!kreis) return {};
	const termin = terminById(terminId);
	if (!termin) return { kreis };
	const behoerde = kreis.behoerden.find((b) => b.slug === behoerdeSlug);
	return behoerde ? { kreis, termin, behoerde } : { kreis, termin };
};

/** Die Kennung einer Anfrage, auf Bekanntes gestutzt. */
export const topicAusParametern = (p: URLSearchParams): Topic =>
	topicFuer(zuschnittVonTopic(p.get(ORT_PARAM.topic) ?? ""));

export const kreisAusTopic = (topic: Topic): Kreis | undefined =>
	zuschnittVonTopic(topic).kreis;

/** Die Wahlleitung, um die es auf der Seite geht. */
export const wahlleitungAusTopic = (
	topic: Topic,
): { kreis: Kreis; behoerde: Behoerde } | undefined => {
	const { kreis, behoerde } = zuschnittVonTopic(topic);
	return kreis && behoerde ? { kreis, behoerde } : undefined;
};

/**
 * Die Behörden, deren Zahlen in diese Kennung fallen.
 *
 * Eine Wahlleitung bringt ihren Kreis mit: Auf ihrer Seite stehen auch die
 * kreisweiten Wahlen. Lieber eine Behörde zu viel – dann wird einmal zu oft
 * aufgefrischt – als eine zu wenig, denn dann bliebe die Seite stehen.
 */
const behoerdenVon = (topic: Topic): string[] | undefined => {
	const { kreis, behoerde } = zuschnittVonTopic(topic);
	if (!kreis) return undefined;
	return behoerde
		? [...new Set([behoerde.ags, kreis.ags])]
		: kreis.behoerden.map((b) => b.ags);
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

/** Die eingestellte Partei einer Anfrage – dieselbe Lesart überall. */
export const parteiAusParametern = (p: URLSearchParams): string | undefined =>
	parteiKeyAus(p.get(ORT_PARAM.partei));

/** Nur Kleinbuchstaben, Ziffern und Bindestrich – so bildet `parteiKey`. */
export const parteiKeyAus = (roh: string | null): string | undefined => {
	const k = (roh ?? "").trim().toLowerCase().slice(0, 40);
	return /^[a-z0-9-]+$/.test(k) ? k : undefined;
};
