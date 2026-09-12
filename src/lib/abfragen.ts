import {
	BEHOERDEN,
	GEMEINDEN,
	type Behoerde,
	behoerdeByAgs,
} from "../data/behoerden.ts";
import type { Kreis } from "../data/kreise.ts";
import { type Termin, isoDatum } from "../data/termine.ts";
import { type Db, metaGet, oeffneDb } from "./db.ts";
import {
	type Ergebnis,
	type Uebersicht,
	type WahlInfo,
	type Wahlraum,
	ebeneVonGebietId,
} from "./votemanager.ts";
import { type Ebenennamen, ebenennamen } from "./ebenen.ts";
import { platzSchluessel } from "./kandidaten.ts";
import {
	type Wahltyp,
	gremiumName,
	istTestwahl,
	kurzBezeichnung,
} from "./wahltyp.ts";

export type WahlEintragZeile = {
	termin: string;
	behoerde: string;
	wahlId: number;
	gebietId: string;
	titel: string;
	/** Gebietsname der Wahlleitung, roh – kann "Ergebnis" heißen. */
	gebietTitel: string;
	/** Abgeleiteter Name des Gebiets; leer, wenn es das der Behörde selbst ist. */
	gebiet: string;
	typ: Wahltyp;
	slug: string;
	/** Kurztitel ohne Gebiet ("Kreistagswahl") */
	kurz: string;
	/** Testdatensatz der Wahlleitung – kein Wahlergebnis (siehe istTestwahl) */
	test: boolean;
	/**
	 * Wahltag dieser Wahl als ISO-Datum, wie ihn `wahl.json` führt.
	 *
	 * In der Regel der Wahltag des Termins; bei Stichwahlen der spätere Tag.
	 * Fehlt, solange `wahl.json` noch nicht abgeholt ist.
	 */
	datum?: string;
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
	gebiet: (r.gebiet as string | null) ?? "",
	typ: r.typ as Wahltyp,
	slug: r.slug as string,
	kurz: kurzBezeichnung(r.titel as string, r.typ as Wahltyp),
	test: istTestwahl(r.titel as string),
	datum: isoDatum(r.wahl_datum as string | null | undefined),
});

/** Wahleinträge samt dem Wahltag, den `wahl.json` zu jeder Wahl führt. */
const MIT_DATUM = `SELECT e.*, w.datum AS wahl_datum FROM wahleintraege e
	 LEFT JOIN wahlen w ON w.termin = e.termin AND w.behoerde = e.behoerde AND w.wahl_id = e.wahl_id`;

/** Alle Wahlen einer Behörde für einen Termin, in Menü-Reihenfolge. */
export const wahleintraege = (
	termin: string,
	behoerde: string,
): WahlEintragZeile[] =>
	(
		db()
			.prepare(
				`${MIT_DATUM} WHERE e.termin = ? AND e.behoerde = ? ORDER BY e.reihenfolge`,
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
			`${MIT_DATUM} WHERE e.termin = ? AND e.behoerde = ? AND e.slug = ?`,
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

/** Was `wahl.json` unter `menu_links` an Ebenen ankündigt. */
export const angekuendigteEbenen = (
	termin: string,
	behoerde: string,
	wahlId: number,
): Array<{ ebene: string; titel: string }> => {
	const r = db()
		.prepare(
			"SELECT json FROM wahlen WHERE termin = ? AND behoerde = ? AND wahl_id = ?",
		)
		.get(termin, behoerde, wahlId) as { json: string } | undefined;
	return r ? ((JSON.parse(r.json) as WahlInfo).uebersichten ?? []) : [];
};

/** Ebenenbezeichnungen dieser Wahl, wie die Wahlleitung sie führt. */
export const wahlEbenen = (
	termin: string,
	behoerde: string,
	wahlId: number,
): Ebenennamen => ebenennamen(angekuendigteEbenen(termin, behoerde, wahlId));

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

/** So viel von einer Wahl, wie die Gebietszuordnung braucht. */
export type WahlAnker = Pick<WahlEintragZeile, "wahlId" | "gebietId" | "typ">;

/**
 * Die Untergebiete, die die Wahlleitung dieser Wahl zuschreibt – `undefined`
 * heißt: keine Einschränkung, alles unter der Wahl-Id gehört dazu.
 *
 * Eine Ortsratswahl wird allein in den Wahlbezirken ihrer Ortschaft gewählt,
 * unter ihrer Wahl-Id kann aber die ganze Gemeinde liegen: 2021 teilen sich
 * alle Ortsräte einer Gemeinde eine Wahl-Id, und Nordstemmen legt 2026 in den
 * Ordner jeder Ortsratswahl die Ergebnisdatei jedes Gemeinde-Wahlbezirks. Was
 * dazugehört, sagt allein das Gesamtgebiet mit seiner Gebietsverlinkung; nennt
 * es nichts, führt die Wahl kein Untergebiet.
 */
export const eigeneGebiete = (
	termin: string,
	behoerde: string,
	wahl: WahlAnker,
): Set<string> | undefined => {
	if (wahl.typ !== "ortsrat") return undefined;
	const gesamt = ergebnis(termin, behoerde, wahl.wahlId, wahl.gebietId);
	return new Set(
		gesamt?.ergebnis.untergebiete.flatMap((u) => u.gebiete.map((g) => g.id)) ??
			[],
	);
};

/** Alle Ergebniszeilen dieser Wahl – Gesamtgebiet und die eigenen Untergebiete. */
export const gebieteDerWahl = (
	termin: string,
	behoerde: string,
	wahl: WahlAnker,
): ErgebnisZeile[] => {
	const alle = alleErgebnisse(termin, behoerde, wahl.wahlId);
	const eigen = eigeneGebiete(termin, behoerde, wahl);
	return eigen
		? alle.filter((e) => e.gebietId === wahl.gebietId || eigen.has(e.gebietId))
		: alle;
};

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

const platzhalter = (n: number): string =>
	Array.from({ length: n }, () => "?").join(",");

export type WahlAdresse = { slug: string; gebietId: string };

export const wahlAdressen = (
	termin: string,
	behoerden: string[],
): Map<string, WahlAdresse> => {
	if (behoerden.length === 0) return new Map();
	const rows = db()
		.prepare(
			`SELECT behoerde, wahl_id, gebiet_id, slug FROM wahleintraege WHERE termin = ? AND behoerde IN (${platzhalter(behoerden.length)})`,
		)
		.all(termin, ...behoerden) as Array<{
		behoerde: string;
		wahl_id: number;
		gebiet_id: string;
		slug: string;
	}>;
	return new Map(
		rows.map((r) => [
			`${r.behoerde}:${r.wahl_id}`,
			{ slug: r.slug, gebietId: r.gebiet_id },
		]),
	);
};

/** Wahlbezirke sind Ebene 6 – die Ebene, auf der ein Wahlraum steht. */
const EBENE_WAHLBEZIRK = 6;

export const wahllokale = (
	termin: string,
	behoerden: string[],
): Map<string, string> => {
	if (behoerden.length === 0) return new Map();
	const rows = db()
		.prepare(
			`SELECT behoerde, id, titel FROM wahlraeume WHERE termin = ? AND behoerde IN (${platzhalter(behoerden.length)})`,
		)
		.all(termin, ...behoerden) as Array<{
		behoerde: string;
		id: number;
		titel: string;
	}>;
	return new Map(
		rows.map((r) => [
			`${r.behoerde}:ebene_${EBENE_WAHLBEZIRK}_id_${r.id}`,
			r.titel,
		]),
	);
};

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

/** Ein Gebiet, das seine Zahlen eingetragen hat. */
export type Eingang = {
	behoerde: string;
	wahlId: number;
	gebietId: string;
	name: string;
};

/** Das Gesamtgebiet gehört dazu: Ortsräte teilen sich mitunter eine Wahl-Id. */
const eingangSchluessel = (
	behoerde: string,
	wahlId: number,
	gesamtGebietId: string,
): string => `${behoerde}:${wahlId}:${gesamtGebietId}`;

/**
 * Die zuletzt eingegangenen Gebiete, je Wahl gebündelt.
 *
 * Eine Abfrage für alle genannten Wahlen: Die Leinwand wird am Wahlabend im
 * Sekundentakt neu geholt, eine Abfrage je Folie wäre ein Dutzend davon.
 */
export const letzteEingaenge = (
	termin: string,
	wahlen: ReadonlyArray<{
		behoerde: string;
		wahlId: number;
		gesamtGebietId: string;
		/** Nur diese Gebiete gehören zur Wahl (siehe `eigeneGebiete`). */
		gebiete?: ReadonlySet<string>;
	}>,
	jeWahl = 8,
): Map<string, Eingang[]> => {
	const raus = new Map<string, Eingang[]>();
	if (wahlen.length === 0) return raus;
	const behoerden = [...new Set(wahlen.map((w) => w.behoerde))];
	const wahlIds = [...new Set(wahlen.map((w) => w.wahlId))];
	const rows = db()
		.prepare(
			`SELECT e.behoerde, e.wahl_id, e.gebiet_id, COALESCE(g.titel, '') AS titel
			 FROM ereignisse e
			 LEFT JOIN ergebnisse g
			   ON g.termin = e.termin AND g.behoerde = e.behoerde
			   AND g.wahl_id = e.wahl_id AND g.gebiet_id = e.gebiet_id
			 WHERE e.termin = ?
			   AND e.behoerde IN (${platzhalter(behoerden.length)})
			   AND e.wahl_id IN (${platzhalter(wahlIds.length)})
			 ORDER BY e.id DESC LIMIT ?`,
		)
		.all(termin, ...behoerden, ...wahlIds, wahlen.length * jeWahl) as Array<{
		behoerde: string;
		wahl_id: number;
		gebiet_id: string;
		titel: string;
	}>;
	for (const r of rows)
		for (const w of wahlen) {
			if (w.behoerde !== r.behoerde || w.wahlId !== r.wahl_id) continue;
			if (
				w.gebiete &&
				!w.gebiete.has(r.gebiet_id) &&
				r.gebiet_id !== w.gesamtGebietId
			)
				continue;
			const schluessel = eingangSchluessel(
				w.behoerde,
				w.wahlId,
				w.gesamtGebietId,
			);
			const liste = raus.get(schluessel) ?? [];
			if (liste.length >= jeWahl) continue;
			liste.push({
				behoerde: r.behoerde,
				wahlId: r.wahl_id,
				gebietId: r.gebiet_id,
				name: r.titel,
			});
			raus.set(schluessel, liste);
		}
	return raus;
};

export const eingaengeFuer = (
	eingaenge: Map<string, Eingang[]>,
	behoerde: string,
	wahlId: number,
	gesamtGebietId: string,
): Eingang[] =>
	eingaenge.get(eingangSchluessel(behoerde, wahlId, gesamtGebietId)) ?? [];

export const ereignisse = (
	termin: string,
	limit = 40,
	behoerde?: string | string[],
): Ereignis[] => {
	const schluessel =
		behoerde === undefined
			? undefined
			: Array.isArray(behoerde)
				? behoerde
				: [behoerde];
	const rows = schluessel
		? db()
				.prepare(
					`SELECT * FROM ereignisse WHERE termin = ? AND behoerde IN (${schluessel.map(() => "?").join(",")}) ORDER BY id DESC LIMIT ?`,
				)
				.all(termin, ...schluessel, limit)
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

export const kreisHatDaten = (kreis: Kreis): boolean => {
	if (kreis.behoerden.length === 0) return false;
	const platzhalter = kreis.behoerden.map(() => "?").join(", ");
	return Boolean(
		db()
			.prepare(
				`SELECT 1 FROM wahleintraege WHERE behoerde IN (${platzhalter}) LIMIT 1`,
			)
			.get(...kreis.behoerden.map((b) => b.ags)),
	);
};

export const kreisVorhanden = (kreis: Kreis): boolean =>
	kreis.vorhanden || kreisHatDaten(kreis);

/** Fortschritt einer Behörde: Schnellmeldungen der Kreistags-/Ratswahl (Gesamtgebiet). */
export type Fortschritt = {
	behoerde: Behoerde;
	anz: number;
	max: number;
	prozent: number;
	wahlen: WahlEintragZeile[];
};

export const fortschritt = (
	termin: string,
	gemeinden: Behoerde[] = GEMEINDEN,
): Fortschritt[] =>
	gemeinden.map((b) => {
		const wahlen = wahleintraege(termin, b.ags);
		const echte = wahlen.filter((w) => !w.test);
		const mass =
			echte.find((w) => w.typ === "kreistag") ??
			echte.find((w) => w.typ === "rat") ??
			echte[0];
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

export const vergleich = (
	terminId: string,
	behoerde: string,
	typ: Wahltyp,
	gebiet?: string,
): ErgebnisZeile | undefined => {
	const e = wahleintraege(terminId, behoerde).filter((w) => w.typ === typ);
	const eintrag = gebiet
		? e.find((w) => gleichesGebiet(w, gebiet))
		: e.find((w) => untergebietVon(w) === undefined);
	return eintrag
		? ergebnis(terminId, behoerde, eintrag.wahlId, eintrag.gebietId)
		: undefined;
};

export const gleichesGebiet = (w: WahlEintragZeile, gebiet: string): boolean =>
	w.gebiet === gebiet || w.gebietTitel.replace(/^Ortschaft /, "") === gebiet;

/** Das eigene Untergebiet eines Eintrags; fehlt bei der Wahl der Behörde selbst. */
export const untergebietVon = (w: WahlEintragZeile): string | undefined => {
	if (w.gebiet) return w.gebiet;
	if (w.typ !== "ortsrat") return undefined;
	return w.gebietTitel.replace(/^Ortschaft /, "") || undefined;
};

export const wahlLabel = (w: WahlEintragZeile): string => {
	const gebiet = w.gebiet || w.gebietTitel.replace(/^Ortschaft /, "");
	if (w.typ === "ortsrat") return `${gremiumName(w.titel, w.typ)} ${gebiet}`;
	return w.gebiet && w.typ === "rat" ? `Rat ${w.gebiet}` : w.kurz;
};

export const alleBehoerden = (): Behoerde[] => BEHOERDEN;

export const ebene = (gebietId: string): number => ebeneVonGebietId(gebietId);

export const terminLabel = (t: Termin): string => t.titel;
