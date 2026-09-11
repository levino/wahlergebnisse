import type { Behoerde } from "../data/behoerden.ts";
import type { Kreis } from "../data/kreise.ts";
import type { Termin } from "../data/termine.ts";
import { wahleintraege } from "./abfragen.ts";
import {
	type DashboardModell,
	kreisebeneFuer,
	ladeDashboard,
	parteiStaende,
} from "./dashboard.ts";
import { type Db, metaGet, metaSet } from "./db.ts";
import {
	type FolienStand,
	type Meldung,
	alleMeldungen,
	kodiereStaende,
	liesEingaenge,
	liesStaende,
} from "./meldungen.ts";
import { schreibtDieserProzess } from "./rolle.ts";

export type Schub = {
	termin: string;
	behoerde: string;
	meldungen: Meldung[];
	/** Der Stand, gegen den verglichen wurde – der Kontext der Moderation. */
	vorher: Map<string, FolienStand>;
	/** Identität des Schubs; gleicher Inhalt, gleicher Schlüssel. */
	schluessel: string;
};

/**
 * Der Stand einer Folie, wie ihn auch das Server-HTML mitbringt.
 *
 * Dieselben Kodierer wie `DashboardFolie.astro` und `liesStand` in
 * `Dashboard.astro`: Was der Server vergleicht, ist damit Zeichen für Zeichen
 * das, was der Browser lesen würde.
 */
type Abzug = {
	m: string;
	o: string;
	w: string;
	a: number;
	x: number;
	t: string;
	s: string;
	p: string;
	e: string;
};

export const staendeAus = (modell: DashboardModell): Map<string, FolienStand> =>
	new Map(
		modell.folien
			.filter((f) => f.art === "wahl")
			.map((f) => [
				f.marke,
				{
					ort: f.ort,
					wahl: f.wahl,
					anz: f.anz,
					max: f.max,
					art: f.datenstand.art,
					spitze: f.balken[0]?.name ?? "",
					parteien: liesStaende(kodiereStaende(parteiStaende(f))),
					eingegangen: f.eingegangen ?? [],
				},
			]),
	);

const alsAbzug = (marke: string, s: FolienStand): Abzug => ({
	m: marke,
	o: s.ort,
	w: s.wahl,
	a: s.anz,
	x: s.max,
	t: s.art,
	s: s.spitze,
	p: kodiereStaende(s.parteien ?? []),
	e: (s.eingegangen ?? []).join("|"),
});

const ausAbzug = (z: Abzug): [string, FolienStand] => [
	z.m,
	{
		ort: z.o,
		wahl: z.w,
		anz: z.a,
		max: z.x,
		art: z.t,
		spitze: z.s,
		parteien: liesStaende(z.p),
		eingegangen: liesEingaenge(z.e),
	},
];

export const standSchluessel = (termin: string, behoerde: string): string =>
	`schub:${termin}:${behoerde}`;

export const liesStand = (
	db: Db,
	termin: string,
	behoerde: string,
): Map<string, FolienStand> | undefined => {
	const roh = metaGet(db, standSchluessel(termin, behoerde));
	if (!roh) return undefined;
	try {
		return new Map((JSON.parse(roh) as Abzug[]).map(ausAbzug));
	} catch {
		return undefined;
	}
};

export const merkeStand = (
	db: Db,
	termin: string,
	behoerde: string,
	staende: Map<string, FolienStand>,
): void => {
	if (!schreibtDieserProzess())
		throw new Error("Stände merken geht nur in der schreibenden Rolle");
	metaSet(
		db,
		standSchluessel(termin, behoerde),
		JSON.stringify([...staende].map(([marke, s]) => alsAbzug(marke, s))),
	);
};

/**
 * Die Identität eines Schubs: Wahlleitung und der erreichte Stand je Folie.
 *
 * Zweimal derselbe Schub ergibt denselben Schlüssel, auch über einen Neustart
 * hinweg – daran erkennt die Ablage, dass sie nichts Neues anzulegen hat.
 */
export const schubSchluessel = (
	termin: string,
	behoerde: string,
	meldungen: readonly Meldung[],
): string =>
	[
		termin,
		behoerde,
		...meldungen.map(
			(m) => `${m.marke}=${m.art}:${m.anz ?? ""}/${m.max ?? ""}`,
		),
	].join(";");

export const modellFuer = (
	kreis: Kreis,
	termin: Termin,
	behoerde: Behoerde,
): DashboardModell => {
	const kreisBehoerde = kreis.behoerden.find((b) => b.ags === kreis.ags);
	return ladeDashboard(
		kreis,
		termin,
		behoerde,
		wahleintraege(termin.id, behoerde.ags),
		kreisBehoerde ? kreisebeneFuer(termin, kreisBehoerde, behoerde) : undefined,
	);
};

/**
 * Was sich für eine Wahlleitung getan hat, seit zuletzt nachgesehen wurde.
 *
 * Ohne gemerkten Stand entsteht kein Schub: Beim ersten Blick ist alles neu,
 * und ein Dutzend Meldungen über Zahlen, die längst dastehen, ist keine
 * Nachricht. Gemerkt wird trotzdem, damit der nächste Blick vergleichen kann.
 */
export const erkenneSchub = (
	db: Db,
	kreis: Kreis,
	termin: Termin,
	behoerde: Behoerde,
	opts: { merken?: boolean } = {},
): Schub | undefined => {
	const jetzt = staendeAus(modellFuer(kreis, termin, behoerde));
	const vorher = liesStand(db, termin.id, behoerde.ags);
	const merken = opts.merken ?? true;
	if (merken) merkeStand(db, termin.id, behoerde.ags, jetzt);
	if (!vorher) return undefined;
	const meldungen = alleMeldungen(vorher, jetzt);
	if (meldungen.length === 0) return undefined;
	return {
		termin: termin.id,
		behoerde: behoerde.ags,
		meldungen,
		vorher,
		schluessel: schubSchluessel(termin.id, behoerde.ags, meldungen),
	};
};
