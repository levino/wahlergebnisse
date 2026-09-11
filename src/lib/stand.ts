import type { Kreis } from "../data/kreise.ts";
import { kreisBySlug } from "../data/kreise.ts";
import { type Db, metaGet, oeffneDb } from "./db.ts";
import { behoerdeImKreis } from "./pfade.ts";

/** Ausschnitt der Daten, an dem eine Seite hängt. Leer = alles (ganzes Land). */
export type Bereich = {
	kreis?: Kreis;
	/** Schlüssel der Behörde (AGS), nicht ihr Slug – Slugs wiederholen sich. */
	behoerde?: string;
};

export const bereichAusPfad = (pfad: string): Bereich => {
	const segmente = pfad.split("/");
	const kreis = kreisBySlug(segmente[1] ?? "");
	if (!kreis) return {};
	const behoerde = segmente[3]
		? behoerdeImKreis(kreis, segmente[3])
		: undefined;
	return { kreis, behoerde: behoerde?.ags };
};

export const bereichAusParametern = (p: URLSearchParams): Bereich => {
	const kreis = kreisBySlug(p.get("kreis") ?? "");
	if (!kreis) return {};
	const wert = p.get("behoerde") ?? "";
	return {
		kreis,
		behoerde: wert ? behoerdeImKreis(kreis, wert)?.ags : undefined,
	};
};

/** Kurzname des Bereichs für die Antwort – damit sichtbar ist, was gilt. */
export const bereichsName = (b: Bereich): string =>
	b.kreis ? [b.kreis.slug, b.behoerde].filter(Boolean).join("/") : "alle";

/** Die Behörden, deren Daten in diesen Bereich fallen. */
const behoerdenVon = (b: Bereich): string[] | undefined =>
	b.behoerde
		? [b.behoerde]
		: b.kreis
			? b.kreis.behoerden.map((x) => x.ags)
			: undefined;

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
export const vergissBereichsversionen = (): void => gemerkt.clear();

export const bereichsVersion = (terminId: string, bereich: Bereich): string => {
	const db = oeffneDb();
	const global = metaGet(db, `termin:${terminId}:version`) ?? "";
	const agsListe = behoerdenVon(bereich);
	if (!agsListe) return global;
	const schluessel = `${terminId}|${agsListe.join(",")}`;
	const alt = gemerkt.get(schluessel);
	if (alt && alt.global === global) return alt.version;
	const version = ausDb(db, terminId, agsListe);
	gemerkt.set(schluessel, { global, version });
	return version;
};
