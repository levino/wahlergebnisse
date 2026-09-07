/**
 * Lesezugriffe für die Seiten. Alles synchron (node:sqlite), alles kleine
 * Mengen – die JSON-Spalten werden pro Aufruf geparst.
 */
import {
	BEHOERDEN,
	GEMEINDEN,
	KREIS_AGS,
	type Behoerde,
	behoerdeByAgs,
} from "../data/behoerden.ts";
import type { Termin } from "../data/termine.ts";
import { type Db, metaGet, oeffneDb } from "./db.ts";
import {
	type Ergebnis,
	type Uebersicht,
	type Wahlraum,
	ebeneVonGebietId,
} from "./votemanager.ts";
import { platzSchluessel } from "./kandidaten.ts";
import {
	WAHLTYP_LABEL,
	type Wahltyp,
	istKreiswahl,
	kurzBezeichnung,
} from "./wahltyp.ts";

export type WahlEintragZeile = {
	termin: string;
	behoerde: string;
	wahlId: number;
	gebietId: string;
	titel: string;
	gebietTitel: string;
	typ: Wahltyp;
	slug: string;
	/** Kurztitel ohne Gebiet ("Kreistagswahl") */
	kurz: string;
};

export type ErgebnisZeile = {
	termin: string;
	behoerde: string;
	wahlId: number;
	gebietId: string;
	ebene: number;
	titel: string;
	leer: boolean;
	standAnz: number | null;
	standMax: number | null;
	aktualisiert: string;
	eingegangenAm: string | null;
	ergebnis: Ergebnis;
};

export type Ereignis = {
	id: number;
	termin: string;
	zeit: string;
	behoerde: string;
	behoerdeName: string;
	wahlId: number;
	gebietId: string;
	art: string;
	text: string;
	daten: {
		anz?: number;
		max?: number;
		spitze?: Array<{ kurz: string; prozent: number; farbe: string }>;
		wahlbeteiligung?: number;
	};
};

const db = (): Db => oeffneDb();

const zuEintrag = (r: Record<string, unknown>): WahlEintragZeile => ({
	termin: r.termin as string,
	behoerde: r.behoerde as string,
	wahlId: r.wahl_id as number,
	gebietId: r.gebiet_id as string,
	titel: r.titel as string,
	gebietTitel: r.gebiet_titel as string,
	typ: r.typ as Wahltyp,
	slug: r.slug as string,
	kurz: kurzBezeichnung(r.titel as string, r.typ as Wahltyp),
});

/** Alle Wahlen einer Behörde für einen Termin, in Menü-Reihenfolge. */
export const wahleintraege = (
	termin: string,
	behoerde: string,
): WahlEintragZeile[] =>
	(
		db()
			.prepare(
				"SELECT * FROM wahleintraege WHERE termin = ? AND behoerde = ? ORDER BY reihenfolge",
			)
			.all(termin, behoerde) as Record<string, unknown>[]
	).map(zuEintrag);

/** Wahl per URL-Slug ("kreistag", "ortsrat-adensen"). */
export const wahlBySlug = (
	termin: string,
	behoerde: string,
	slug: string,
): WahlEintragZeile | undefined => {
	const r = db()
		.prepare(
			"SELECT * FROM wahleintraege WHERE termin = ? AND behoerde = ? AND slug = ?",
		)
		.get(termin, behoerde, slug) as Record<string, unknown> | undefined;
	return r ? zuEintrag(r) : undefined;
};

export const wahlStatus = (
	termin: string,
	behoerde: string,
	wahlId: number,
): string | undefined =>
	(
		db()
			.prepare(
				"SELECT status FROM wahlen WHERE termin = ? AND behoerde = ? AND wahl_id = ?",
			)
			.get(termin, behoerde, wahlId) as { status: string | null } | undefined
	)?.status ?? undefined;

const zuErgebnis = (r: Record<string, unknown>): ErgebnisZeile => ({
	termin: r.termin as string,
	behoerde: r.behoerde as string,
	wahlId: r.wahl_id as number,
	gebietId: r.gebiet_id as string,
	ebene: r.ebene as number,
	titel: r.titel as string,
	leer: Boolean(r.leer),
	standAnz: r.stand_anz as number | null,
	standMax: r.stand_max as number | null,
	aktualisiert: r.aktualisiert as string,
	eingegangenAm: r.eingegangen_am as string | null,
	ergebnis: JSON.parse(r.json as string) as Ergebnis,
});

export const ergebnis = (
	termin: string,
	behoerde: string,
	wahlId: number,
	gebietId: string,
): ErgebnisZeile | undefined => {
	const r = db()
		.prepare(
			"SELECT * FROM ergebnisse WHERE termin = ? AND behoerde = ? AND wahl_id = ? AND gebiet_id = ?",
		)
		.get(termin, behoerde, wahlId, gebietId) as
		| Record<string, unknown>
		| undefined;
	return r ? zuErgebnis(r) : undefined;
};

export const ergebnisseEbene = (
	termin: string,
	behoerde: string,
	wahlId: number,
	ebene: number,
): ErgebnisZeile[] =>
	(
		db()
			.prepare(
				"SELECT * FROM ergebnisse WHERE termin = ? AND behoerde = ? AND wahl_id = ? AND ebene = ? ORDER BY titel",
			)
			.all(termin, behoerde, wahlId, ebene) as Record<string, unknown>[]
	).map(zuErgebnis);

export const alleErgebnisse = (
	termin: string,
	behoerde: string,
	wahlId: number,
): ErgebnisZeile[] =>
	(
		db()
			.prepare(
				"SELECT * FROM ergebnisse WHERE termin = ? AND behoerde = ? AND wahl_id = ? ORDER BY ebene, titel",
			)
			.all(termin, behoerde, wahlId) as Record<string, unknown>[]
	).map(zuErgebnis);

export type UebersichtZeileDb = {
	ebene: string;
	titel: string;
	uebersicht: Uebersicht;
	aktualisiert: string;
};

export const uebersichten = (
	termin: string,
	behoerde: string,
	wahlId: number,
): UebersichtZeileDb[] =>
	(
		db()
			.prepare(
				"SELECT ebene, titel, json, aktualisiert FROM uebersichten WHERE termin = ? AND behoerde = ? AND wahl_id = ? AND titel <> ''",
			)
			.all(termin, behoerde, wahlId) as Array<{
			ebene: string;
			titel: string;
			json: string;
			aktualisiert: string;
		}>
	)
		.map((r) => ({
			ebene: r.ebene,
			titel: r.titel,
			uebersicht: JSON.parse(r.json) as Uebersicht,
			aktualisiert: r.aktualisiert,
		}))
		.filter((u) => u.uebersicht.zeilen.length > 0);

export const uebersicht = (
	termin: string,
	behoerde: string,
	wahlId: number,
	ebene: string,
): UebersichtZeileDb | undefined =>
	uebersichten(termin, behoerde, wahlId).find((u) => u.ebene === ebene);

export const wahlraeume = (termin: string, behoerde: string): Wahlraum[] =>
	(
		db()
			.prepare(
				"SELECT * FROM wahlraeume WHERE termin = ? AND behoerde = ? ORDER BY id",
			)
			.all(termin, behoerde) as Array<Record<string, unknown>>
	).map((r) => ({
		id: r.id as number,
		titel: r.titel as string,
		barrierefrei: Boolean(r.barrierefrei),
		bezirk: r.bezirk as string,
		ortsteil: (r.ortsteil as string | null) ?? undefined,
		wahlbereich: (r.wahlbereich as string | null) ?? undefined,
		kreiswahlbereich: (r.kreiswahlbereich as string | null) ?? undefined,
	}));

/**
 * Listenplätze einer Wahl: Partei+Name → Platz auf dem Wahlvorschlag.
 * Gefüllt vom Poller aus der Open-Data-CSV (siehe lib/liste.ts).
 */
export const listenplaetze = (
	termin: string,
	behoerde: string,
	wahlId: number,
	gebietId?: string,
): Map<string, number> => {
	const rows = (
		gebietId
			? db()
					.prepare(
						"SELECT partei_key, name, platz FROM wahlvorschlaege WHERE termin = ? AND behoerde = ? AND wahl_id = ? AND gebiet_id = ?",
					)
					.all(termin, behoerde, wahlId, gebietId)
			: db()
					.prepare(
						"SELECT partei_key, name, platz FROM wahlvorschlaege WHERE termin = ? AND behoerde = ? AND wahl_id = ?",
					)
					.all(termin, behoerde, wahlId)
	) as Array<{
		partei_key: string;
		name: string;
		platz: number;
	}>;
	return new Map(
		rows.map((r) => [platzSchluessel(r.partei_key, r.name), r.platz]),
	);
};

export const ereignisse = (
	termin: string,
	limit = 40,
	behoerde?: string,
): Ereignis[] => {
	const rows = behoerde
		? db()
				.prepare(
					"SELECT * FROM ereignisse WHERE termin = ? AND behoerde = ? ORDER BY id DESC LIMIT ?",
				)
				.all(termin, behoerde, limit)
		: db()
				.prepare(
					"SELECT * FROM ereignisse WHERE termin = ? ORDER BY id DESC LIMIT ?",
				)
				.all(termin, limit);
	return (rows as Array<Record<string, unknown>>).map((r) => ({
		id: r.id as number,
		termin: r.termin as string,
		zeit: r.zeit as string,
		behoerde: r.behoerde as string,
		behoerdeName:
			behoerdeByAgs(r.behoerde as string)?.kurz ?? (r.behoerde as string),
		wahlId: r.wahl_id as number,
		gebietId: r.gebiet_id as string,
		art: r.art as string,
		text: r.text as string,
		daten: r.json ? JSON.parse(r.json as string) : {},
	}));
};

/** Versionsstempel: ändert sich, sobald der Poller etwas Neues gespeichert hat. */
export const version = (termin: string): string =>
	metaGet(db(), `termin:${termin}:version`) ?? "";
export const zuletztGeprueft = (termin: string): string =>
	metaGet(db(), `termin:${termin}:zuletzt`) ?? "";

export const letzterLauf = (termin: string) =>
	db()
		.prepare("SELECT * FROM laeufe WHERE termin = ? ORDER BY id DESC LIMIT 1")
		.get(termin) as
		| {
				gestartet: string;
				beendet: string | null;
				anfragen: number;
				geaendert: number;
				fehler: string | null;
		  }
		| undefined;

export const hatDaten = (termin: string): boolean =>
	Boolean(
		db()
			.prepare("SELECT 1 FROM wahleintraege WHERE termin = ? LIMIT 1")
			.get(termin),
	);

/** Fortschritt einer Behörde: Schnellmeldungen der Kreistags-/Ratswahl (Gesamtgebiet). */
export type Fortschritt = {
	behoerde: Behoerde;
	anz: number;
	max: number;
	prozent: number;
	wahlen: WahlEintragZeile[];
};

export const fortschritt = (termin: string): Fortschritt[] =>
	GEMEINDEN.map((b) => {
		const wahlen = wahleintraege(termin, b.ags);
		// Als Maßstab die kreisweite Wahl (überall gleich viele Bezirke), sonst die Ratswahl
		const mass =
			wahlen.find((w) => w.typ === "kreistag") ??
			wahlen.find((w) => w.typ === "rat") ??
			wahlen[0];
		const e = mass
			? ergebnis(termin, b.ags, mass.wahlId, mass.gebietId)
			: undefined;
		const anz = e?.standAnz ?? 0;
		const max = e?.standMax ?? 0;
		return {
			behoerde: b,
			anz,
			max,
			prozent: max > 0 ? Math.round((anz / max) * 100) : 0,
			wahlen,
		};
	});

/** Gesamtergebnis-Karten für die Startseite: Kreiswahlen des Landkreises. */
export const kreiswahlen = (
	termin: string,
): Array<{ eintrag: WahlEintragZeile; ergebnis?: ErgebnisZeile }> =>
	wahleintraege(termin, KREIS_AGS)
		.filter((w) => istKreiswahl(w.typ))
		.map((eintrag) => ({
			eintrag,
			ergebnis: ergebnis(termin, KREIS_AGS, eintrag.wahlId, eintrag.gebietId),
		}));

/** Vergleichsergebnis: dieselbe Wahlart derselben Behörde bei einem anderen Termin (Gesamtgebiet). */
export const vergleich = (
	terminId: string,
	behoerde: string,
	typ: Wahltyp,
	gebietTitel?: string,
): ErgebnisZeile | undefined => {
	const e = wahleintraege(terminId, behoerde).filter((w) => w.typ === typ);
	const eintrag = gebietTitel
		? (e.find((w) => w.gebietTitel === gebietTitel) ??
			e.find((w) => w.gebietTitel.endsWith(gebietTitel)))
		: e[0];
	return eintrag
		? ergebnis(terminId, behoerde, eintrag.wahlId, eintrag.gebietId)
		: undefined;
};

export const wahltypLabel = (typ: Wahltyp): string => WAHLTYP_LABEL[typ];

export const alleBehoerden = (): Behoerde[] => BEHOERDEN;

export const ebene = (gebietId: string): number => ebeneVonGebietId(gebietId);

export const terminLabel = (t: Termin): string => t.titel;
