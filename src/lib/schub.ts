import type { Behoerde } from "../data/behoerden.ts";
import type { Kreis } from "../data/kreise.ts";
import type { Termin } from "../data/termine.ts";
import { wahleintraege } from "./abfragen.ts";
import {
	type DashboardModell,
	kreisebeneFuer,
	ladeDashboard,
	parteiStaende,
	parteienZurAuswahl,
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
import type { MeinePartei } from "./partei.ts";
import { schreibtDieserProzess } from "./rolle.ts";

export type Schub = {
	termin: string;
	behoerde: string;
	meldungen: Meldung[];
	/** Der Stand, gegen den verglichen wurde – der Kontext der Moderation. */
	vorher: Map<string, FolienStand>;
	/** Identität des Schubs; gleicher Inhalt, gleicher Schlüssel. */
	schluessel: string;
	/** Für wen dieser Schub gilt; ohne Angabe für alle ohne eigene Partei. */
	partei?: MeinePartei;
	/** Der angefragte Schlüssel – auch dann, wenn es die Partei hier nicht gibt. */
	parteiKey: string;
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
): Schub | undefined =>
	erkenneSchuebe(db, kreis, termin, behoerde, [""], opts).schuebe[0];

/**
 * Dieselbe Erkennung für mehrere eingestellte Parteien – mit **einem** Modell.
 *
 * `ladeDashboard` ist der ganze Preis eines Takts (rund 7 ms für dreizehn
 * Folien). Je Partei neu zu bauen vervielfachte ihn, obwohl sich nur die
 * Meldungen zur eigenen Partei unterscheiden; der Stand der Folien ist für
 * alle derselbe. Deshalb einmal bauen, einmal merken, je Partei vergleichen.
 */
export const erkenneSchuebe = (
	db: Db,
	kreis: Kreis,
	termin: Termin,
	behoerde: Behoerde,
	/** Schlüssel der eingestellten Parteien; `""` steht für „keine". */
	parteiKeys: readonly string[],
	opts: { merken?: boolean } = {},
): { modell: DashboardModell; schuebe: Schub[] } => {
	const modell = modellFuer(kreis, termin, behoerde);
	const jetzt = staendeAus(modell);
	const vorher = liesStand(db, termin.id, behoerde.ags);
	if (opts.merken ?? true) merkeStand(db, termin.id, behoerde.ags, jetzt);
	if (!vorher) return { modell, schuebe: [] };
	// Eine Partei, die auf keiner Folie steht, hat hier nichts zu jubeln; der
	// Zuschauer bekommt dann dasselbe wie alle – aber unter seinem Topic.
	const auswahl = new Map(
		parteienZurAuswahl(modell.folien).map((p) => [p.key, p] as const),
	);
	const schuebe: Schub[] = [];
	for (const key of new Set(parteiKeys)) {
		const partei = key ? auswahl.get(key) : undefined;
		const meldungen = alleMeldungen(vorher, jetzt, partei);
		if (meldungen.length === 0) continue;
		schuebe.push({
			termin: termin.id,
			behoerde: behoerde.ags,
			meldungen,
			vorher,
			schluessel: schubSchluessel(termin.id, behoerde.ags, meldungen),
			...(partei ? { partei } : {}),
			parteiKey: key,
		});
	}
	return { modell, schuebe };
};

/**
 * So viele Sekunden liegen mindestens zwischen zwei Beiträgen einer
 * Wahlleitung.
 *
 * Gemessen an der Aufnahme in `test/kassetten/schub-roessing.json`: 41 Wörter
 * in 22,5 Sekunden, also 0,55 Sekunden je Wort. Die Anweisung deckelt bei 90
 * Wörtern; die längste Ansage, die überhaupt entstehen kann, dauert damit rund
 * 49 Sekunden. Sechzig lassen ihr Luft und halten den Saal trotzdem wach.
 *
 * Echte Sekunden, auch in der Generalprobe: Eine Ansage dauert dort genauso
 * lang wie am Wahlabend, gleich wie schnell die Probe die Zahlen dreht.
 */
export const ANSAGE_FENSTER_S = 60;

/** Verstellbar über `ANSAGE_FENSTER_SEKUNDEN`, gelesen bei jedem Takt. */
export const ansageFensterMs = (): number => {
	const n = Number(process.env.ANSAGE_FENSTER_SEKUNDEN);
	return (Number.isFinite(n) && n >= 0 ? n : ANSAGE_FENSTER_S) * 1000;
};

const fensterSchluessel = (termin: string, behoerde: string): string =>
	`ansage:${termin}:${behoerde}`;

/** Wann zuletzt ein Schub geschnitten wurde; 0, wenn noch nie. */
export const letzteAnsage = (
	db: Db,
	termin: string,
	behoerde: string,
): number => {
	const n = Number(metaGet(db, fensterSchluessel(termin, behoerde)) ?? "");
	return Number.isFinite(n) && n > 0 ? n : 0;
};

export const merkeAnsage = (
	db: Db,
	termin: string,
	behoerde: string,
	jetztMs: number,
): void => {
	if (!schreibtDieserProzess())
		throw new Error("Das Ansagefenster merkt nur die schreibende Rolle");
	metaSet(db, fensterSchluessel(termin, behoerde), String(jetztMs));
};

export type GetakteteSchuebe = {
	/** Fehlt, solange das Fenster läuft – dann wurde gar nicht nachgesehen. */
	modell?: DashboardModell;
	schuebe: Schub[];
	/** Das Fenster läuft noch; der nächste Takt sieht wieder nach. */
	wartet: boolean;
};

/**
 * Dieselbe Erkennung, aber höchstens einmal je Fenster.
 *
 * Läuft das Fenster noch, wird der gemerkte Stand **nicht** fortgeschrieben.
 * Was in der Zwischenzeit hereinkommt, steht deshalb beim nächsten offenen
 * Fenster noch im Vergleich: Aus drei Schnellmeldungen wird ein Schub, der
 * alle drei trägt und die Zahlen des jüngsten Standes nennt. Verworfen wird
 * nichts – gespart wird der Aufruf, nicht die Nachricht.
 *
 * Gemerkt wird im Augenblick des Schnitts, nicht nach der Aufnahme: Stirbt der
 * Prozess dazwischen, sind Stand und Fenster beide weitergerückt, statt sofort
 * den nächsten Beitrag auszulösen.
 */
export const erkenneSchuebeGetaktet = (
	db: Db,
	kreis: Kreis,
	termin: Termin,
	behoerde: Behoerde,
	parteiKeys: readonly string[],
	fenster: { jetzt: number; ms?: number },
): GetakteteSchuebe => {
	const ms = fenster.ms ?? ansageFensterMs();
	if (fenster.jetzt - letzteAnsage(db, termin.id, behoerde.ags) < ms)
		return { schuebe: [], wartet: true };
	const raus = erkenneSchuebe(db, kreis, termin, behoerde, parteiKeys);
	if (raus.schuebe.length > 0)
		merkeAnsage(db, termin.id, behoerde.ags, fenster.jetzt);
	return { ...raus, wartet: false };
};
