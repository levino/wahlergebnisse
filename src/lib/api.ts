import type { Behoerde } from "../data/behoerden.ts";
import {
	KREISE,
	type Kreis,
	STANDARD_KREIS,
	kreisByAgs,
	kreisBySlug,
	kreisVonBehoerde,
} from "../data/kreise.ts";
import { behoerdeImKreis } from "./pfade.ts";
import {
	TERMINE,
	type Termin,
	istAbgeschlossen,
	istLive,
	terminById,
	terminGiltFuerBehoerde,
	terminGiltFuerKreis,
} from "../data/termine.ts";
import {
	type ErgebnisZeile,
	ereignisse,
	gebieteDerWahl,
	listenplaetze,
	ergebnis,
	ergebnisseEbene,
	fortschritt,
	kreisVorhanden,
	uebersichten,
	version,
	wahlBySlug,
	wahlEbenen,
	wahlLabel,
	wahlStatus,
	wahlraeume,
	wahleintraege,
	zuletztGeprueft,
} from "./abfragen.ts";
import { type Bewerber, bewerberListen } from "./kandidaten.ts";
import { type Kreisdeckung, kreisdeckung } from "./kreisdeckung.ts";
import { type Wahltyp, istKreiswahl } from "./wahltyp.ts";
import { type Ebenennamen, ebeneVon } from "./ebenen.ts";

const standardKreis = (): Kreis => kreisBySlug(STANDARD_KREIS) ?? KREISE[0];

export type ApiTermin = {
	id: string;
	titel: string;
	/** ISO-Datum des Wahltags */
	datum: string;
	/** true = wird am Wahlabend laufend aktualisiert */
	live: boolean;
	abgeschlossen: string | null;
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
		/** Gesetzt, wenn diese kreisweite Summe nicht das ganze Kreisgebiet umfasst */
		teilgebiet: {
			kommunen: number;
			fehlend: string[];
			quelle: string;
			dokument: string;
		} | null;
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

/** Ebene eines Gebiets, kleingeschrieben – so, wie die Wahlleitung sie führt. */
export const ebeneName = (gebietId: string, namen?: Ebenennamen): string =>
	ebeneVon(gebietId, namen).toLowerCase();

const QUELLE =
	"https://wahlen.kreis-hi.de/ (votemanager, Landkreis Hildesheim)";

export const apiTermin = (t: Termin): ApiTermin => ({
	id: t.id,
	titel: t.titel,
	datum: t.datum,
	live: istLive(t),
	abgeschlossen: istAbgeschlossen(t) ? (t.abgeschlossen ?? t.datum) : null,
	beschreibung: t.beschreibung,
	stand: version(t.id) || null,
	geprueft: zuletztGeprueft(t.id) || null,
	quelle: QUELLE,
});

const termineDerEbene = (kreis?: Kreis, behoerde?: Behoerde): Termin[] =>
	kreis
		? TERMINE.filter((t) =>
				behoerde
					? terminGiltFuerBehoerde(t, kreis, behoerde)
					: terminGiltFuerKreis(t, kreis.slug),
			)
		: TERMINE;

/** Termin-Ids, die es auf dieser Ebene gibt – für Fehlermeldungen. */
export const termineImKreis = (kreis: Kreis, behoerde?: Behoerde): string[] =>
	termineDerEbene(kreis, behoerde).map((t) => t.id);

export const terminEbenenHinweis = (kreis: Kreis, wert: string): string => {
	const t = terminById(wert);
	const traeger = t
		? kreis.behoerden.filter((b) => b.archive?.includes(t.id))
		: [];
	return traeger.length
		? `'${wert}' ist kein kreisweiter Wahltag, sondern der von ${traeger.map((b) => b.slug).join(", ")} – abrufbar unter /api/v1/${kreis.slug}/${wert}/<behoerde>/. Kreisweite Termine für ${kreis.kurz}`
		: `Termine für ${kreis.kurz}`;
};

export const apiTermine = (kreis?: Kreis, behoerde?: Behoerde): ApiTermin[] =>
	termineDerEbene(kreis, behoerde).map(apiTermin);

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
	ebenen?: Ebenennamen,
	deckung?: Kreisdeckung,
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
			ebene: ebeneName(e.gebietId, ebenen),
		},
		leer: e.leer,
		stand: {
			schnellmeldungen: { eingegangen: e.standAnz, erwartet: e.standMax },
			vollstaendig:
				!deckung && e.standAnz !== null && e.standMax !== null && e.standMax > 0
					? e.standAnz >= e.standMax
					: false,
			teilgebiet: deckung
				? {
						kommunen: deckung.kommunen,
						fehlend: deckung.fehlend,
						quelle: deckung.quelle,
						dokument: deckung.dokument,
					}
				: null,
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

/** Die Deckungslücke einer kreisweiten Gesamtsumme – sonst nichts. */
const deckungFuer = (
	terminId: string,
	behoerde: Behoerde,
	typ: Wahltyp,
	istGesamt: boolean,
): Kreisdeckung | undefined => {
	if (!istGesamt || !istKreiswahl(typ)) return undefined;
	const kreis = kreisVonBehoerde(behoerde.ags);
	if (!kreis || kreis.ags !== behoerde.ags) return undefined;
	return kreisdeckung(terminId, kreis);
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
	const alle = gebieteDerWahl(terminId, behoerde.ags, w);
	const ebenen = wahlEbenen(terminId, behoerde.ags, w.wahlId);
	const proEbene = new Map<string, number>();
	for (const e of alle) {
		if (e.gebietId === w.gebietId) continue;
		const n = ebeneName(e.gebietId, ebenen);
		proEbene.set(n, (proEbene.get(n) ?? 0) + 1);
	}
	return {
		termin: terminId,
		behoerde: { ags: behoerde.ags, slug: behoerde.slug, name: behoerde.name },
		slug: w.slug,
		typ: w.typ,
		typLabel: w.kurz,
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
						ebenen,
						deckungFuer(terminId, behoerde, w.typ, true),
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
	const ebenen = wahlEbenen(terminId, behoerde.ags, w.wahlId);
	const deckung = deckungFuer(terminId, behoerde, w.typ, true);
	return gebieteDerWahl(terminId, behoerde.ags, w)
		.filter((e) => !opts.ebene || ebeneName(e.gebietId, ebenen) === opts.ebene)
		.map((e) =>
			zuApiErgebnis(
				terminId,
				behoerde,
				w.slug,
				status,
				e,
				listenplaetze(terminId, behoerde.ags, w.wahlId, e.gebietId),
				ebenen,
				e.gebietId === w.gebietId ? deckung : undefined,
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
		wahlEbenen(terminId, behoerde.ags, w.wahlId),
		deckungFuer(terminId, behoerde, w.typ, e.gebietId === w.gebietId),
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
	vorhanden: boolean;
	behoerden: Array<{
		ags: string;
		slug: string;
		name: string;
		termine?: string[];
	}>;
};

export const apiKreis = (k: Kreis): ApiKreis => ({
	slug: k.slug,
	ags: k.ags,
	name: k.name,
	kurz: k.kurz,
	vorhanden: kreisVorhanden(k),
	behoerden: k.behoerden.map((b) => {
		const eigene = (b.archive ?? [])
			.map(terminById)
			.filter((t): t is Termin => !!t && !terminGiltFuerKreis(t, k.slug))
			.map((t) => t.id);
		return {
			ags: b.ags,
			slug: b.slug,
			name: b.name,
			...(eigene.length ? { termine: eigene } : {}),
		};
	}),
});

export const apiKreise = (): ApiKreis[] => KREISE.map(apiKreis);

/** Kreis aus dem Pfadsegment – Slug oder Schlüssel. */
export const kreisAus = (wert: string): Kreis | undefined =>
	kreisBySlug(wert) ?? kreisByAgs(wert);

export const terminAus = (
	wert: string,
	kreis?: Kreis,
	behoerde?: Behoerde,
): Termin | undefined => {
	const t = terminById(wert);
	if (!t || !kreis) return t;
	const gilt = behoerde
		? terminGiltFuerBehoerde(t, kreis, behoerde)
		: terminGiltFuerKreis(t, kreis.slug);
	return gilt ? t : undefined;
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
