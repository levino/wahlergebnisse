/**
 * Das Wahlabend-Dashboard: dieselben Zahlen wie überall, aber für den Beamer.
 *
 * Am Wahlabend steht der Raum voll, und vorne läuft eine Leinwand. Wer dort
 * hinsieht, sieht sie aus fünf Metern, für ein paar Sekunden und ohne Maus.
 * Daraus folgt alles Übrige: **eine** Wahl je Folie, der Ort als größte
 * Schrift auf der Fläche, wenige Zeilen darunter – und ein Karussell, das von
 * selbst weiterschaltet, damit niemand danebenstehen und klicken muss.
 *
 * Die Reihenfolge ist die, in der im Saal gefragt wird: erst der
 * Bürgermeister, dann der Rat, dann die Ortsräte, und zum Schluss Kreistag und
 * Landrat. Das ist bewusst **nicht** `WAHLTYP_REIHENFOLGE` aus `wahltyp.ts`:
 * Die Menü-Reihenfolge geht von oben nach unten durch die Ebenen (Kreis
 * zuerst), weil ein Menü Ordnung zeigen soll. Ein Wahlabend in einer Gemeinde
 * fängt bei der eigenen Wahl an.
 *
 * Zu jeder Gemeinde gehören auch die kreisweiten Wahlen: einmal mit den
 * Stimmen aus dem eigenen Gemeindegebiet (die führt die Gemeinde selbst mit)
 * und einmal für den ganzen Kreis, wie sie bei der Kreisbehörde stehen. Beides
 * ist am Wahlabend gefragt – „wie hat Nordstemmen gewählt“ und „wer wird
 * Landrat“ –, und beide Folien tragen ihr Gebiet in der Überschrift, damit
 * sich das nie verwechseln lässt.
 */
import type { Behoerde } from "../data/behoerden.ts";
import type { Kreis } from "../data/kreise.ts";
import { type Termin, istLive } from "../data/termine.ts";
import type { WahlEintragZeile } from "./abfragen.ts";
import { wahlLabel } from "./abfragen.ts";
import { staerkste } from "./anzeige.ts";
import { wahlPfad } from "./pfade.ts";
import {
	type BalkenModell,
	type Datenstand,
	type SitzModell,
	type WahlKern,
	wahlKern,
} from "./seite.ts";
import { type Wahltyp, istKreiswahl } from "./wahltyp.ts";

/**
 * Reihenfolge der Folien – die Erzählung des Abends, nicht die Gliederung der
 * Verwaltung. Eine Stichwahl steht direkt hinter der Wahl desselben Amtes:
 * Wo es beide gibt, gehören sie nebeneinander.
 */
export const DASHBOARD_FOLGE: Wahltyp[] = [
	"buergermeister",
	"buergermeister-stichwahl",
	"rat",
	"ortsrat",
	"sonstige",
	"kreistag",
	"landrat",
	"landrat-stichwahl",
];

/** Sekunden je Folie, wenn nichts anderes in der Adresse steht. */
export const TAKT_STANDARD = 18;
/**
 * Unter fünf Sekunden liest niemand eine Folie zu Ende, über fünf Minuten ist
 * es kein Karussell mehr. Beides begrenzt nicht den Nutzer, sondern den
 * Tippfehler in der Adresszeile.
 */
export const TAKT_MIN = 5;
export const TAKT_MAX = 300;

/** `?takt=25` aus der Adresse, auf einen sinnvollen Bereich gestutzt. */
export const taktAus = (wert: string | null | undefined): number => {
	const n = Number.parseInt(wert ?? "", 10);
	if (!Number.isFinite(n)) return TAKT_STANDARD;
	return Math.min(TAKT_MAX, Math.max(TAKT_MIN, n));
};

/**
 * So viele Balken passen auf eine Folie, ohne dass die Schrift unter die
 * Lesbarkeit aus fünf Metern fällt. Was darunter liegt, wird gezählt und in
 * einer Zeile genannt – weggelassen wird nichts stillschweigend.
 */
export const BALKEN_JE_FOLIE = 6;

export type DashboardBalken = BalkenModell & { name: string; zusatz?: string };

/** Eine Wahl, wie sie auf der Leinwand steht. */
export type WahlFolie = {
	art: "wahl";
	/** Stabil über Neuladen hinweg – daran hängt die Stelle im Karussell. */
	key: string;
	/** Größte Schrift der Folie: um welchen Ort geht es. */
	ort: string;
	/** Darüber, kleiner: welche Wahl. */
	wahl: string;
	href: string;
	/**
	 * Wahl einer anderen Wahlleitung – die kreisweiten Zahlen des Kreises,
	 * gezeigt im Dashboard einer Gemeinde.
	 */
	fremd: boolean;
	test: boolean;
	personenwahl: boolean;
	balken: DashboardBalken[];
	/** Wie viele Bewerber oder Listen unter den gezeigten Balken fehlen. */
	weitere: number;
	sitze?: SitzModell;
	datenstand: Datenstand;
	anz: number;
	max: number;
	wahlbeteiligung?: number;
	wahlbeteiligungVorher?: number;
	vergleichTitel?: string;
	/** Zeitstempel der Wahlleitung für diese Zahlen */
	zeitstempel?: string;
};

/** Eine Zeile des Überblicks: eine Wahl in einer Zeile. */
export type UeberblickZeile = {
	key: string;
	wahl: string;
	ort: string;
	anz: number;
	max: number;
	fertig: boolean;
	art: Datenstand["art"];
	/** Wer vorn liegt – leer, solange nichts ausgezählt ist. */
	spitze?: { name: string; prozent: number; farbe: string };
};

/**
 * Die erste Folie: alle Wahlen des Abends auf einen Blick. Sie beantwortet
 * die Frage, mit der am Wahlabend jeder in den Raum kommt – wie weit ist es,
 * und wo steht was.
 */
export type UeberblickFolie = {
	art: "ueberblick";
	key: string;
	ort: string;
	wahl: string;
	zeilen: UeberblickZeile[];
	/** Summe der Schnellmeldungen über alle eigenen Wahlen */
	anz: number;
	max: number;
};

export type Folie = UeberblickFolie | WahlFolie;

export type DashboardModell = {
	kreis: Kreis;
	termin: Termin;
	behoerde: Behoerde;
	folien: Folie[];
	/** Sekunden je Folie */
	takt: number;
};

/** Rang einer Wahlart in der Folienreihenfolge; Unbekanntes ans Ende. */
const rang = (typ: Wahltyp): number => {
	const i = DASHBOARD_FOLGE.indexOf(typ);
	return i === -1 ? DASHBOARD_FOLGE.length : i;
};

/** Was eine Folie ausmacht, bevor die Zahlen dazukommen. */
type Anwaerter = {
	behoerde: Behoerde;
	eintrag: WahlEintragZeile;
	fremd: boolean;
};

/**
 * Die Wahlen des Abends in Folienreihenfolge.
 *
 * Erst die Wahlart, dann die eigene Wahlleitung vor der fremden (das
 * Gemeindeergebnis der Kreistagswahl vor dem des ganzen Kreises), dann der
 * Ortsname. Die neun Ortsräte einer Gemeinde stehen so alphabetisch – eine
 * Reihenfolge, die man auf der Leinwand wiedererkennt, während die Reihenfolge
 * der Wahlleitung von ihren internen Wahl-Ids abhängt.
 */
export const dashboardReihenfolge = <T extends Anwaerter>(
	anwaerter: readonly T[],
): T[] =>
	[...anwaerter].sort(
		(a, b) =>
			rang(a.eintrag.typ) - rang(b.eintrag.typ) ||
			Number(a.fremd) - Number(b.fremd) ||
			wahlLabel(a.eintrag).localeCompare(wahlLabel(b.eintrag), "de"),
	);

/** Der Ort, der als Überschrift über der Folie steht. */
const ortVon = (a: Anwaerter): string =>
	a.eintrag.typ === "ortsrat"
		? a.eintrag.gebiet || a.eintrag.gebietTitel.replace(/^Ortschaft /, "")
		: a.behoerde.kurz;

/** Die Wahl, die über dem Ort steht ("Ortsratswahl", "Kreistagswahl"). */
const wahlVon = (a: Anwaerter): string =>
	a.eintrag.typ === "ortsrat" ? "Ortsratswahl" : a.eintrag.kurz;

/**
 * Balken für die Leinwand: nach Stärke sortiert und auf die ersten gekürzt.
 *
 * Sortiert werden muss, weil die Wahlpräsentation nach Stimmzettel-Reihenfolge
 * liefert (siehe `anzeige.ts`) – ungekürzt ist das die amtliche Ordnung und
 * bleibt auf der Wahlseite so stehen, gekürzt wäre es schlicht falsch.
 */
const balkenFuerFolie = (
	kern: WahlKern,
): { balken: DashboardBalken[]; weitere: number } => {
	const alle = kern.balken.filter((b) => b.stimmen > 0 || b.prozent > 0);
	const gezeigt = staerkste(alle, BALKEN_JE_FOLIE);
	return {
		balken: gezeigt.map((b) => ({
			...b,
			name: kern.personenwahl && b.kandidat ? b.kandidat.name : b.kurz,
			zusatz: kern.personenwahl ? b.kandidat?.partei : undefined,
		})),
		weitere: alle.length - gezeigt.length,
	};
};

const folieAus = (
	kreis: Kreis,
	termin: Termin,
	a: Anwaerter,
): WahlFolie | undefined => {
	const kern = wahlKern(kreis, termin, a.behoerde, a.eintrag.slug);
	if (!kern) return undefined;
	const { balken, weitere } = balkenFuerFolie(kern);
	return {
		art: "wahl",
		key: `${a.behoerde.ags}-${a.eintrag.slug}`,
		ort: ortVon(a),
		wahl: wahlVon(a),
		href: wahlPfad(kreis.slug, termin.id, a.behoerde.slug, a.eintrag.slug),
		fremd: a.fremd,
		test: a.eintrag.test,
		personenwahl: kern.personenwahl,
		balken,
		weitere,
		sitze: kern.sitze,
		datenstand: kern.datenstand,
		anz: kern.aktuell?.standAnz ?? 0,
		max: kern.aktuell?.standMax ?? 0,
		wahlbeteiligung: kern.aktuell?.ergebnis.kennzahlen.wahlbeteiligung,
		wahlbeteiligungVorher: kern.vergleich?.ergebnis.kennzahlen.wahlbeteiligung,
		vergleichTitel: kern.vergleichTermin?.titel,
		zeitstempel: kern.aktuell?.ergebnis.zeitstempel,
	};
};

const ueberblickZeile = (f: WahlFolie): UeberblickZeile => {
	const spitze = f.balken[0];
	return {
		key: f.key,
		wahl: f.wahl,
		ort: f.ort,
		anz: f.anz,
		max: f.max,
		fertig: f.max > 0 && f.anz >= f.max,
		art: f.datenstand.art,
		spitze:
			spitze && spitze.prozent > 0
				? {
						name: spitze.name,
						prozent: spitze.prozent,
						farbe: spitze.farbe,
					}
				: undefined,
	};
};

/**
 * Alle Folien eines Wahlabends für eine Wahlleitung.
 *
 * `takt` kommt aus der Adresse (`?takt=`), damit sich die Verweildauer vor Ort
 * anpassen lässt, ohne dass jemand am Code etwas ändert – auf einer großen
 * Leinwand liest man schneller als auf einem Fernseher am anderen Ende des
 * Saals.
 */
export const ladeDashboard = (
	kreis: Kreis,
	termin: Termin,
	behoerde: Behoerde,
	wahlen: WahlEintragZeile[],
	kreisWahlen: WahlEintragZeile[],
	kreisBehoerde: Behoerde | undefined,
	takt = TAKT_STANDARD,
): DashboardModell => {
	const eigene: Anwaerter[] = wahlen.map((eintrag) => ({
		behoerde,
		eintrag,
		fremd: false,
	}));
	// Die kreisweiten Wahlen der Kreisbehörde kommen nur in einer Gemeinde
	// dazu. Im Dashboard des Kreises selbst wären sie dieselbe Folie zweimal.
	const fremde: Anwaerter[] =
		kreisBehoerde && kreisBehoerde.ags !== behoerde.ags
			? kreisWahlen
					.filter((w) => istKreiswahl(w.typ))
					.map((eintrag) => ({ behoerde: kreisBehoerde, eintrag, fremd: true }))
			: [];
	/**
	 * Eine Wahl ohne jede Zahl gehört nur vor die Auszählung.
	 *
	 * Am Wahlabend selbst ist sie die Regel und keine Lücke: Um 18 Uhr steht
	 * jede Folie auf null, und genau das soll die Leinwand dann auch zeigen –
	 * die Aufstellung des Abends, bevor die erste Schnellmeldung eingeht. Im
	 * Archiv ist dieselbe Folie dagegen ein Rest: Der Landkreis Hildesheim
	 * führt zu 2021 eine Stichwahl des Landrats, die nie stattgefunden hat.
	 * Sie durchlaufen zu lassen hieße, die Rückschau mit leeren Bildern zu
	 * strecken.
	 */
	const zeigen = (f: WahlFolie): boolean =>
		istLive(termin) || f.max > 0 || f.balken.length > 0;
	const wahlFolien = dashboardReihenfolge([...eigene, ...fremde])
		.map((a) => folieAus(kreis, termin, a))
		.filter((f): f is WahlFolie => f !== undefined)
		.filter(zeigen);

	// Der Fortschritt des Überblicks zählt nur die eigenen Wahlen: Die
	// Schnellmeldungen des ganzen Kreises gehören nicht zum Abend dieser
	// Gemeinde und ließen ihre Auszählung zäher aussehen, als sie ist.
	const eigeneFolien = wahlFolien.filter((f) => !f.fremd);
	const ueberblick: UeberblickFolie = {
		art: "ueberblick",
		key: "ueberblick",
		ort: behoerde.kurz,
		wahl: termin.titel,
		zeilen: wahlFolien.map(ueberblickZeile),
		anz: eigeneFolien.reduce((s, f) => s + f.anz, 0),
		max: eigeneFolien.reduce((s, f) => s + f.max, 0),
	};

	return {
		kreis,
		termin,
		behoerde,
		folien: wahlFolien.length > 0 ? [ueberblick, ...wahlFolien] : [],
		takt,
	};
};
