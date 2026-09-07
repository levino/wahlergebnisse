/**
 * Öffentliche Datenschicht: ein sauberes, dokumentiertes Schema über allem,
 * was der Poller aus der votemanager-Präsentation geholt hat.
 *
 * Warum es das gibt: Die amtlichen „Open Data“ des Landkreises sind CSVs mit
 * Spalten wie `D1_3` („Stimmen für Kandidat 3 von Partei 1“) – die Zuordnung
 * steht in einer zweiten Datei, Parteinamen und Sitze fehlen ganz, und pro
 * Wahl und Ebene gibt es eine eigene Datei. Hier bekommt jede Zahl einen
 * Namen, jedes Gebiet eine stabile Id und alles dasselbe Format.
 *
 * REST (`/api/v1/…`) und MCP (`/mcp`) benutzen dieselben Funktionen; die
 * Rückgaben sind reine Daten (JSON-serialisierbar, keine Klassen).
 */
import type { Behoerde } from "../data/behoerden.ts";
import {
	KREISE,
	type Kreis,
	STANDARD_KREIS,
	kreisByAgs,
	kreisBySlug,
} from "../data/kreise.ts";
import { behoerdeImKreis } from "./pfade.ts";
import {
	TERMINE,
	type Termin,
	terminById,
	terminGiltFuer,
} from "../data/termine.ts";
import {
	type ErgebnisZeile,
	alleErgebnisse,
	ereignisse,
	listenplaetze,
	ergebnis,
	ergebnisseEbene,
	fortschritt,
	kreisVorhanden,
	uebersichten,
	version,
	wahlBySlug,
	wahlLabel,
	wahlStatus,
	wahlraeume,
	wahleintraege,
	zuletztGeprueft,
} from "./abfragen.ts";
import { type Bewerber, bewerberListen } from "./kandidaten.ts";
import { WAHLTYP_LABEL, type Wahltyp } from "./wahltyp.ts";
import { ebeneVonGebietId } from "./votemanager.ts";

/**
 * Kreis, wenn keiner mitgegeben wurde. REST-Routen und MCP-Werkzeuge geben ihn
 * inzwischen alle mit – dort steht er im Pfad bzw. ist Pflichtargument. Der
 * Rückfall bleibt für Aufrufe aus Skripten und Tests, die nur einen Kreis
 * kennen.
 */
const standardKreis = (): Kreis => kreisBySlug(STANDARD_KREIS) ?? KREISE[0];

// ---------- Schema ----------

export type ApiTermin = {
	id: string;
	titel: string;
	/** ISO-Datum des Wahltags */
	datum: string;
	/** true = wird am Wahlabend laufend aktualisiert */
	live: boolean;
	beschreibung: string;
	/** Zeitpunkt der letzten inhaltlichen Änderung (ISO 8601) */
	stand: string | null;
	/** Zeitpunkt der letzten Prüfung beim Landkreis (ISO 8601) */
	geprueft: string | null;
	quelle: string;
};

export type ApiBehoerde = {
	/** Amtlicher Gemeindeschlüssel, zugleich Schlüssel beim Landkreis */
	ags: string;
	slug: string;
	name: string;
	kurz: string;
	art: Behoerde["art"];
	/** Anzahl bereits eingegangener und insgesamt erwarteter Schnellmeldungen */
	schnellmeldungen: { eingegangen: number; erwartet: number } | null;
	wahlen: Array<{ slug: string; typ: Wahltyp; titel: string; gebiet: string }>;
};

export type ApiPartei = {
	/** Stabiler Schlüssel (normalisierter Kurzname), z. B. "cdu" */
	key: string;
	kurz: string;
	name: string;
	farbe: string;
	stimmen: number;
	prozent: number;
	/** Verhältniswahl: Stimmen für die Liste bzw. Summe der Kandidatenstimmen */
	listenstimmen?: number;
	kandidatenstimmen?: number;
	sitze?: number;
	/** Personenwahl (Landrat, Bürgermeister): Name und Partei der Person */
	kandidat?: { name: string; partei: string };
	kandidaten?: ApiKandidat[];
};

/** Siehe src/lib/kandidaten.ts – dieselbe Aufbereitung nutzen Seiten und API. */
export type ApiKandidat = Bewerber;

export type ApiErgebnis = {
	termin: string;
	behoerde: string;
	wahl: string;
	gebiet: {
		id: string;
		name: string;
		/** kreis | gemeinde | wahlbereich | ortsteil | wahlbezirk */
		ebene: string;
	};
	/** true, solange keine Zahlen vorliegen */
	leer: boolean;
	stand: {
		schnellmeldungen: { eingegangen: number | null; erwartet: number | null };
		vollstaendig: boolean;
		status: string | null;
		datenstand: string | null;
		abgerufen: string;
	};
	kennzahlen: {
		wahlberechtigte: number | null;
		waehler: number | null;
		wahlbeteiligung: number | null;
		ungueltig: number | null;
		gueltigeStimmzettel: number | null;
		gueltigeStimmen: number | null;
	};
	parteien: ApiPartei[];
	sitze: {
		gesamt: number;
		verteilung: Array<{ key: string; kurz: string; sitze: number }>;
		gewaehlte: Array<{
			partei: string;
			name: string;
			mandat: string;
			stimmen: number | null;
		}>;
	} | null;
};

export type ApiWahl = {
	termin: string;
	behoerde: { ags: string; slug: string; name: string };
	slug: string;
	typ: Wahltyp;
	typLabel: string;
	titel: string;
	gebiet: string;
	/** Personenwahl (ein Kreuz) statt Verhältniswahl (drei Stimmen, Listen) */
	personenwahl: boolean;
	/**
	 * Testdatensatz der Wahlleitung, kein Wahlergebnis. Kommt in der amtlichen
	 * Quelle vor („Direktwahl TEST“) und ist von einem echten Eintrag sonst
	 * nicht zu unterscheiden.
	 */
	test: boolean;
	status: string | null;
	ergebnis: ApiErgebnis | null;
	/** Vorhandene Untergebiets-Ebenen mit Anzahl */
	ebenen: Array<{ ebene: string; anzahl: number }>;
};

export type ApiEreignis = {
	zeit: string;
	termin: string;
	behoerde: string;
	behoerdeName: string;
	gebiet: string;
	art: string;
	text: string;
	schnellmeldungen: { eingegangen: number | null; erwartet: number | null };
	spitze: Array<{ kurz: string; prozent: number }>;
};

const EBENEN: Record<number, string> = {
	1: "kreis",
	3: "gemeinde",
	5: "wahlbereich",
	6: "wahlbezirk",
	8: "ortsteil",
	9: "wahlbereich",
};

/** votemanager-Ebenennummer → sprechender Name (2026 nutzt negative Nummern). */
export const ebeneName = (gebietId: string): string => {
	const n = ebeneVonGebietId(gebietId);
	if (EBENEN[n]) return EBENEN[n];
	// 2026: negative, laufend vergebene Ebenen-Ids; die Ebene steckt dort nicht
	// in der Nummer. Wahlbezirke sind auch dort Ebene 6.
	return n === 6 ? "wahlbezirk" : "gebiet";
};

const QUELLE =
	"https://wahlen.kreis-hi.de/ (votemanager, Landkreis Hildesheim)";

// ---------- Abbildungen ----------

export const apiTermin = (t: Termin): ApiTermin => ({
	id: t.id,
	titel: t.titel,
	datum: t.datum,
	live: t.live,
	beschreibung: t.beschreibung,
	stand: version(t.id) || null,
	geprueft: zuletztGeprueft(t.id) || null,
	quelle: QUELLE,
});

/**
 * Die Termine – für einen Kreis nur die, die es dort gibt.
 *
 * Ohne Kreis (landesweite Liste unter /api/v1/termine) stehen alle da. Mit
 * Kreis gilt dieselbe Auskunft wie für die Seiten: `terminGiltFuer`. Vorher
 * nannte die Schnittstelle jedem der 45 Kreise auch 2021 und 2020, deren
 * Seiten aber mit 404 antworteten – 88 Adressen, bei denen sich Seite und
 * Schnittstelle widersprachen.
 */
/** Termin-Ids, die es in diesem Kreis gibt – für Fehlermeldungen. */
export const termineImKreis = (kreis: Kreis): string[] =>
	TERMINE.filter((t) => terminGiltFuer(t, kreis.slug)).map((t) => t.id);

export const apiTermine = (kreis?: Kreis): ApiTermin[] =>
	(kreis ? TERMINE.filter((t) => terminGiltFuer(t, kreis.slug)) : TERMINE).map(
		apiTermin,
	);

export const apiBehoerden = (
	terminId: string,
	kreis: Kreis = standardKreis(),
): ApiBehoerde[] => {
	const fort = new Map(
		fortschritt(
			terminId,
			kreis.behoerden.filter((b) => b.ags !== kreis.ags),
		).map((f) => [f.behoerde.ags, f]),
	);
	return kreis.behoerden
		.map((b) => {
			const wahlen = wahleintraege(terminId, b.ags);
			const f = fort.get(b.ags);
			return {
				ags: b.ags,
				slug: b.slug,
				name: b.name,
				kurz: b.kurz,
				art: b.art,
				schnellmeldungen:
					f && f.max > 0 ? { eingegangen: f.anz, erwartet: f.max } : null,
				wahlen: wahlen.map((w) => ({
					slug: w.slug,
					typ: w.typ,
					titel: wahlLabel(w),
					// Der abgeleitete Gebietsname, wo es einen gibt; sonst der
					// rohe der Wahlleitung – bei der Behörde selbst ist er richtig.
					gebiet: w.gebiet || w.gebietTitel,
				})),
			};
		})
		.filter((b) => b.wahlen.length > 0);
};

const zuApiErgebnis = (
	terminId: string,
	behoerde: Behoerde,
	wahlSlug: string,
	status: string | null,
	e: ErgebnisZeile,
	plaetze: Map<string, number> = new Map(),
): ApiErgebnis => {
	const erg = e.ergebnis;
	const k = erg.kennzahlen;
	const sitze = erg.sitze;
	const sitzeVon = new Map(
		(sitze?.verteilung ?? []).map((v) => [v.key, v.sitze]),
	);
	const listen = new Map(
		bewerberListen(erg, plaetze).map((l) => [l.parteiKey, l.bewerber]),
	);
	return {
		termin: terminId,
		behoerde: behoerde.slug,
		wahl: wahlSlug,
		gebiet: {
			id: e.gebietId,
			name: e.titel,
			ebene: ebeneName(e.gebietId),
		},
		leer: e.leer,
		stand: {
			schnellmeldungen: { eingegangen: e.standAnz, erwartet: e.standMax },
			vollstaendig:
				e.standAnz !== null && e.standMax !== null && e.standMax > 0
					? e.standAnz >= e.standMax
					: false,
			status,
			datenstand: erg.zeitstempel || null,
			abgerufen: e.aktualisiert,
		},
		kennzahlen: {
			wahlberechtigte: k.wahlberechtigte ?? null,
			waehler: k.waehler ?? null,
			wahlbeteiligung: k.wahlbeteiligung ?? null,
			ungueltig: k.ungueltig ?? null,
			gueltigeStimmzettel: k.gueltig ?? null,
			gueltigeStimmen: k.stimmen ?? null,
		},
		parteien: erg.parteien.map((p) => ({
			key: p.key,
			kurz: p.kurz,
			name: p.lang,
			farbe: p.farbe,
			stimmen: p.stimmen,
			prozent: p.prozent,
			...(p.listenstimmen !== undefined
				? { listenstimmen: p.listenstimmen }
				: {}),
			...(p.kandidatenstimmen !== undefined
				? { kandidatenstimmen: p.kandidatenstimmen }
				: {}),
			...(sitzeVon.has(p.key) ? { sitze: sitzeVon.get(p.key) } : {}),
			...(p.kandidat ? { kandidat: p.kandidat } : {}),
			...(listen.has(p.key) ? { kandidaten: listen.get(p.key) } : {}),
		})),
		sitze: sitze
			? {
					gesamt: sitze.gesamt,
					verteilung: sitze.verteilung.map((v) => ({
						key: v.key,
						kurz: v.kurz,
						sitze: v.sitze,
					})),
					gewaehlte: sitze.gewaehlte.map((g) => ({
						partei: g.partei,
						name: g.name,
						mandat: g.mandat,
						stimmen: g.stimmen ?? null,
					})),
				}
			: null,
	};
};

/** Alle Wahlen eines Termins, optional gefiltert. */
export const apiWahlen = (
	terminId: string,
	filter: { behoerde?: string; typ?: string } = {},
	kreis: Kreis = standardKreis(),
): ApiWahl[] => {
	const behoerden = filter.behoerde
		? [behoerdeImKreis(kreis, filter.behoerde)].filter((b): b is Behoerde =>
				Boolean(b),
			)
		: kreis.behoerden;
	const out: ApiWahl[] = [];
	for (const b of behoerden) {
		for (const w of wahleintraege(terminId, b.ags)) {
			if (filter.typ && w.typ !== filter.typ) continue;
			out.push(apiWahl(terminId, b, w.slug, { mitErgebnis: false }) as ApiWahl);
		}
	}
	return out;
};

export const apiWahl = (
	terminId: string,
	behoerde: Behoerde,
	wahlSlug: string,
	opts: { mitErgebnis?: boolean } = {},
): ApiWahl | undefined => {
	const w = wahlBySlug(terminId, behoerde.ags, wahlSlug);
	if (!w) return undefined;
	const status = wahlStatus(terminId, behoerde.ags, w.wahlId) ?? null;
	const gesamt = ergebnis(terminId, behoerde.ags, w.wahlId, w.gebietId);
	const alle = alleErgebnisse(terminId, behoerde.ags, w.wahlId);
	const proEbene = new Map<string, number>();
	for (const e of alle) {
		if (e.gebietId === w.gebietId) continue;
		const n = ebeneName(e.gebietId);
		proEbene.set(n, (proEbene.get(n) ?? 0) + 1);
	}
	return {
		termin: terminId,
		behoerde: { ags: behoerde.ags, slug: behoerde.slug, name: behoerde.name },
		slug: w.slug,
		typ: w.typ,
		typLabel: WAHLTYP_LABEL[w.typ],
		titel: wahlLabel(w),
		gebiet: w.gebiet || w.gebietTitel,
		personenwahl: gesamt?.ergebnis.personenwahl ?? false,
		test: w.test,
		status,
		ergebnis:
			opts.mitErgebnis === false || !gesamt
				? null
				: zuApiErgebnis(
						terminId,
						behoerde,
						w.slug,
						status,
						gesamt,
						listenplaetze(terminId, behoerde.ags, w.wahlId, gesamt.gebietId),
					),
		ebenen: [...proEbene].map(([ebene, anzahl]) => ({ ebene, anzahl })),
	};
};

/** Alle Untergebiete einer Wahl – flach, optional auf eine Ebene begrenzt. */
export const apiGebiete = (
	terminId: string,
	behoerde: Behoerde,
	wahlSlug: string,
	opts: { ebene?: string } = {},
): ApiErgebnis[] | undefined => {
	const w = wahlBySlug(terminId, behoerde.ags, wahlSlug);
	if (!w) return undefined;
	const status = wahlStatus(terminId, behoerde.ags, w.wahlId) ?? null;
	return alleErgebnisse(terminId, behoerde.ags, w.wahlId)
		.filter((e) => !opts.ebene || ebeneName(e.gebietId) === opts.ebene)
		.map((e) =>
			zuApiErgebnis(
				terminId,
				behoerde,
				w.slug,
				status,
				e,
				listenplaetze(terminId, behoerde.ags, w.wahlId, e.gebietId),
			),
		);
};

export const apiGebiet = (
	terminId: string,
	behoerde: Behoerde,
	wahlSlug: string,
	gebietId: string,
): ApiErgebnis | undefined => {
	const w = wahlBySlug(terminId, behoerde.ags, wahlSlug);
	if (!w) return undefined;
	const e = ergebnis(terminId, behoerde.ags, w.wahlId, gebietId);
	if (!e) return undefined;
	return zuApiErgebnis(
		terminId,
		behoerde,
		w.slug,
		wahlStatus(terminId, behoerde.ags, w.wahlId) ?? null,
		e,
		listenplaetze(terminId, behoerde.ags, w.wahlId, e.gebietId),
	);
};

export const apiEreignisse = (
	terminId: string,
	opts: { limit?: number; behoerde?: string } = {},
	kreis: Kreis = standardKreis(),
): ApiEreignis[] => {
	const nur = opts.behoerde ? behoerdeImKreis(kreis, opts.behoerde) : undefined;
	return ereignisse(
		terminId,
		opts.limit ?? 50,
		nur ? nur.ags : kreis.behoerden.map((x) => x.ags),
	).map((e) => {
		// Im eigenen Kreis nachschlagen, nicht im Standard-Kreis: Sonst trüge der
		// Ticker außerhalb Hildesheims den Gebietsschlüssel statt Slug und Namen.
		const b = kreis.behoerden.find((x) => x.ags === e.behoerde);
		return {
			zeit: e.zeit,
			termin: e.termin,
			behoerde: b?.slug ?? e.behoerde,
			behoerdeName: b?.kurz ?? e.behoerdeName,
			gebiet: e.gebietId,
			art: e.art,
			text: e.text,
			schnellmeldungen: {
				eingegangen: e.daten.anz ?? null,
				erwartet: e.daten.max ?? null,
			},
			spitze: (e.daten.spitze ?? []).map((s) => ({
				kurz: s.kurz,
				prozent: s.prozent,
			})),
		};
	});
};

/** Wahlräume (Wahllokale) einer Behörde – Adresse, Barrierefreiheit, Zuordnung. */
export const apiWahlraeume = (terminId: string, behoerde: Behoerde) =>
	wahlraeume(terminId, behoerde.ags).map((r) => ({
		id: r.id,
		name: r.titel,
		wahlbezirk: r.bezirk,
		ortsteil: r.ortsteil ?? null,
		wahlbereich: r.wahlbereich ?? null,
		kreiswahlbereich: r.kreiswahlbereich ?? null,
		barrierefrei: r.barrierefrei,
	}));

/**
 * Dieselben Ergebnisse als flache Tabelle: eine Zeile je Gebiet und Partei.
 * Das ist die Form, die man für Auswertungen tatsächlich braucht – und die
 * es beim Landkreis nicht gibt.
 */
export const alsTabelle = (
	ergebnisse: ApiErgebnis[],
): Array<Record<string, string | number | null>> => {
	const zeilen: Array<Record<string, string | number | null>> = [];
	for (const e of ergebnisse) {
		for (const p of e.parteien) {
			zeilen.push({
				termin: e.termin,
				behoerde: e.behoerde,
				wahl: e.wahl,
				gebiet_id: e.gebiet.id,
				gebiet_name: e.gebiet.name,
				ebene: e.gebiet.ebene,
				schnellmeldungen_eingegangen: e.stand.schnellmeldungen.eingegangen,
				schnellmeldungen_erwartet: e.stand.schnellmeldungen.erwartet,
				wahlberechtigte: e.kennzahlen.wahlberechtigte,
				waehler: e.kennzahlen.waehler,
				wahlbeteiligung_prozent: e.kennzahlen.wahlbeteiligung,
				ungueltig: e.kennzahlen.ungueltig,
				gueltige_stimmen: e.kennzahlen.gueltigeStimmen,
				partei_key: p.key,
				partei_kurz: p.kurz,
				partei_name: p.name,
				kandidat: p.kandidat?.name ?? null,
				stimmen: p.stimmen,
				prozent: p.prozent,
				listenstimmen: p.listenstimmen ?? null,
				kandidatenstimmen: p.kandidatenstimmen ?? null,
				sitze: p.sitze ?? null,
			});
		}
	}
	return zeilen;
};

/** CSV (RFC 4180, Semikolon wie im deutschen Amtsgebrauch, UTF-8 mit BOM für Excel). */
export const alsCsv = (
	zeilen: Array<Record<string, string | number | null>>,
): string => {
	if (zeilen.length === 0) return "";
	const spalten = Object.keys(zeilen[0]);
	const feld = (v: string | number | null): string => {
		if (v === null) return "";
		const s = String(v);
		return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
	};
	return `﻿${[
		spalten.join(";"),
		...zeilen.map((z) => spalten.map((s) => feld(z[s])).join(";")),
	].join("\n")}\n`;
};

export const behoerdeAus = (
	wert: string,
	kreis: Kreis = standardKreis(),
): Behoerde | undefined => behoerdeImKreis(kreis, wert);

export type ApiKreis = {
	slug: string;
	/** 8-stelliger Schlüssel der Kreisbehörde */
	ags: string;
	name: string;
	kurz: string;
	/**
	 * false: Von dieser Wahlleitung liegt hier nichts vor – sie veröffentlicht
	 * nicht über votemanager oder hat den Termin noch nicht freigeschaltet.
	 * Der Wert folgt dem Bestand, nicht dem Katalog: Schaltet eine Wahlleitung
	 * frei, wird er ohne Zutun true.
	 */
	vorhanden: boolean;
	behoerden: Array<{ ags: string; slug: string; name: string }>;
};

export const apiKreis = (k: Kreis): ApiKreis => ({
	slug: k.slug,
	ags: k.ags,
	name: k.name,
	kurz: k.kurz,
	vorhanden: kreisVorhanden(k),
	behoerden: k.behoerden.map((b) => ({
		ags: b.ags,
		slug: b.slug,
		name: b.name,
	})),
});

export const apiKreise = (): ApiKreis[] => KREISE.map(apiKreis);

/** Kreis aus dem Pfadsegment – Slug oder Schlüssel. */
export const kreisAus = (wert: string): Kreis | undefined =>
	kreisBySlug(wert) ?? kreisByAgs(wert);

/**
 * Termin aus dem Pfadsegment. Mit Kreis nur, wenn er dort auch gilt – sonst
 * antwortete die Schnittstelle 200 auf einen Termin, dessen Seite es im selben
 * Kreis gar nicht gibt.
 */
export const terminAus = (wert: string, kreis?: Kreis): Termin | undefined => {
	const t = terminById(wert);
	return t && (!kreis || terminGiltFuer(t, kreis.slug)) ? t : undefined;
};

/** Kurzer Überblick für den Einstieg (auch als MCP-Tool sinnvoll). */
export const apiUeberblick = (
	terminId: string,
	kreis: Kreis = standardKreis(),
) => {
	const t = terminById(terminId);
	if (!t) return undefined;
	const fort = fortschritt(
		terminId,
		kreis.behoerden.filter((b) => b.ags !== kreis.ags),
	);
	const eingegangen = fort.reduce((a, f) => a + f.anz, 0);
	const erwartet = fort.reduce((a, f) => a + f.max, 0);
	return {
		kreis: { slug: kreis.slug, name: kreis.name },
		termin: apiTermin(t),
		schnellmeldungen: {
			eingegangen,
			erwartet,
			prozent:
				erwartet > 0 ? Math.round((eingegangen / erwartet) * 1000) / 10 : 0,
		},
		gemeinden: fort.map((f) => ({
			slug: f.behoerde.slug,
			name: f.behoerde.name,
			eingegangen: f.anz,
			erwartet: f.max,
		})),
	};
};

export { uebersichten, ergebnisseEbene };
