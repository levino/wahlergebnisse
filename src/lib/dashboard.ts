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
 * Zu jeder Gemeinde gehören auch die kreisweiten Wahlen, und zwar in den
 * beiden Zuschnitten, nach denen im Saal gefragt wird:
 *
 * 1. **der ganze Kreis** – „wie sieht der Kreistag aus“, „wer wird Landrat“,
 * 2. **der eigene Kreiswahlbereich** – „kommt unser Kandidat in den Kreistag“:
 *    Die Kreistagssitze werden je Wahlbereich vergeben, und Nordstemmen liegt
 *    mit Elze im Wahlbereich B. Diese Zahlen stehen nur bei der Kreisbehörde,
 *    eine Ebene unter dem Kreisergebnis; die Folie zeigt deshalb Personen und
 *    keine Parteianteile.
 *
 * **Nicht dabei: der eigene Anteil an einer Kreiswahl.** Wie Nordstemmen beim
 * Kreistag oder beim Landrat abgestimmt hat, ist eine Zahl über Nordstemmen –
 * entschieden wird damit nichts, und im Karussell stünde daneben dieselbe Wahl
 * noch einmal, diesmal mit der Antwort. Auf der Wahlseite der Gemeinde stehen
 * diese Zahlen weiter; auf die Leinwand gehören sie nicht.
 *
 * Jede Folie trägt ihr Gebiet als Überschrift, damit sich die Zuschnitte nie
 * verwechseln lassen.
 */
import type { Behoerde } from "../data/behoerden.ts";
import type { Kreis } from "../data/kreise.ts";
import { type Termin, istLive } from "../data/termine.ts";
import type { WahlEintragZeile } from "./abfragen.ts";
import { alleErgebnisse, wahlLabel, wahleintraege } from "./abfragen.ts";
import { staerkste } from "./anzeige.ts";
import { parteiFarbe } from "./farben.ts";
import { wahlPfad } from "./pfade.ts";
import {
	type BalkenModell,
	type Datenstand,
	type SitzModell,
	type WahlKern,
	wahlKern,
} from "./seite.ts";
import {
	bereichVonGemeinde,
	gemeindenImWahlbereich,
	kreisWahlbereiche,
	wahlbereichKuerzel,
} from "./wahlbereiche.ts";
import { type Partei, parteiKey } from "./votemanager.ts";
import { type Wahltyp, istKreiswahl, slugify } from "./wahltyp.ts";

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

/**
 * Eine Bewerberin, ein Bewerber – für die Folien, auf denen es um Personen
 * geht und nicht um Parteianteile.
 */
export type FolienKandidat = {
	name: string;
	partei: string;
	farbe: string;
	stimmen?: number;
	/** Wie das Mandat zustande kam ("direkt", "Listenplatz 2") – erst amtlich. */
	mandat?: string;
};

/**
 * Eine Liste auf der Wahlbereichsfolie: die Partei und ihre vordersten
 * Bewerber – nicht der Sieger je Partei, sondern das Rennen *innerhalb* der
 * Liste.
 *
 * Beim Kreistag entscheidet die Personenstimme über die Reihenfolge, in der
 * eine Liste ihre Sitze besetzt. Wer auf einer Liste steht, will deshalb nicht
 * wissen, wer seine Partei anführt, sondern wie weit er hinter dem Vordersten
 * liegt – zwischen Platz eins und zwei dieser Liste entscheidet sich sein
 * Abend.
 */
export type FolienListe = {
	partei: string;
	farbe: string;
	kandidaten: Array<{ name: string; stimmen?: number }>;
	/** Wie viele Bewerber dieser Liste nicht gezeigt werden. */
	weitere: number;
};

/** Eine Wahl, wie sie auf der Leinwand steht. */
export type WahlFolie = {
	art: "wahl";
	/** Stabil über Neuladen hinweg – daran hängt die Stelle im Karussell. */
	key: string;
	/**
	 * Name dieser Folie in der Adresse (`…/dashboard#ortsrat-roessing`).
	 *
	 * Lesbar, weil er verschickt wird: Wer im Saal sagt „schau dir Rössing
	 * an", schickt einen Verweis, und der soll erkennen lassen, wohin er
	 * führt. Der `key` taugt dafür nicht – er trägt die interne Kennung der
	 * Wahlleitung.
	 */
	marke: string;
	/** Größte Schrift der Folie: um welchen Ort geht es. */
	ort: string;
	/** Darüber, kleiner: welche Wahl. */
	wahl: string;
	href: string;
	/**
	 * Wie weit das Gebiet dieser Folie über die eigene Wahlleitung hinausgeht:
	 * `eigen` sind ihre eigenen Zahlen, `wahlbereich` der Kreiswahlbereich, in
	 * dem sie liegt, `kreis` das Ergebnis des ganzen Kreises.
	 */
	zuschnitt: Zuschnitt;
	/** Erläuterung neben der Wahl, etwa die Gemeinden eines Wahlbereichs. */
	beisatz?: string;
	test: boolean;
	personenwahl: boolean;
	balken: DashboardBalken[];
	/** Wie viele Bewerber oder Listen unter den gezeigten Balken fehlen. */
	weitere: number;
	/**
	 * Personen statt Parteien – gesetzt auf der Wahlbereichsfolie. Im
	 * Kreiswahlbereich entscheidet sich nicht, wie der Kreistag zusammengesetzt
	 * ist, sondern **wer aus dieser Gegend hineinkommt**; danach wird im Saal
	 * gefragt, und die Folie zeigt dann diese Liste statt der Balken.
	 */
	kandidaten?: FolienKandidat[];
	/** Überschrift über der Kandidatenliste. */
	kandidatenTitel?: string;
	/** Die vordersten Bewerber je Liste – solange die Sitze nicht stehen. */
	listen?: FolienListe[];
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

export type Folie = WahlFolie;

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

/**
 * Der Zuschnitt einer Folie – wie weit ihr Gebiet über die eigene Wahlleitung
 * hinausgeht. Er entscheidet zugleich über die Reihenfolge: erst das eigene
 * Gebiet, dann das Ergebnis des ganzen Kreises, dann der Wahlbereich.
 *
 * Der Wahlbereich steht **hinter** dem Kreis, obwohl er das kleinere Gebiet
 * ist: Er beantwortet nicht „wie sieht der Kreistag aus“, sondern „wer von
 * hier sitzt darin“ – die Nachfrage zum Kreisergebnis, nicht der Weg dorthin.
 */
export type Zuschnitt = "eigen" | "wahlbereich" | "kreis";

const ZUSCHNITT_RANG: Record<Zuschnitt, number> = {
	eigen: 0,
	kreis: 1,
	wahlbereich: 2,
};

/** Was eine Folie ausmacht, bevor die Zahlen dazukommen. */
type Anwaerter = {
	behoerde: Behoerde;
	eintrag: WahlEintragZeile;
	zuschnitt: Zuschnitt;
	/** Gebiet innerhalb der Wahl; fehlt, wenn es das Wahlgebiet selbst ist. */
	gebietId?: string;
	/** Überschrift, wo sie nicht aus Wahl und Behörde folgt (Wahlbereiche). */
	ort?: string;
	/** Kleiner Zusatz neben der Wahl ("Elze, Nordstemmen"). */
	beisatz?: string;
	/** Gewählte dieses Wahlbereichs, sofern die Wahlleitung sie schon nennt. */
	gewaehlte?: Array<{ name: string; partei: string; mandat: string }>;
	/** Statt der Parteibalken Personen zeigen. */
	personen?: boolean;
};

/**
 * Die Wahlen des Abends in Folienreihenfolge.
 *
 * Erst die Wahlart, dann der Zuschnitt von innen nach außen (Nordstemmen,
 * Wahlbereich B, Landkreis), dann der Ortsname. Die neun Ortsräte einer
 * Gemeinde stehen so alphabetisch – eine Reihenfolge, die man auf der Leinwand
 * wiedererkennt, während die Reihenfolge der Wahlleitung von ihren internen
 * Wahl-Ids abhängt.
 */
export const dashboardReihenfolge = <T extends Anwaerter>(
	anwaerter: readonly T[],
): T[] =>
	[...anwaerter].sort(
		(a, b) =>
			rang(a.eintrag.typ) - rang(b.eintrag.typ) ||
			ZUSCHNITT_RANG[a.zuschnitt] - ZUSCHNITT_RANG[b.zuschnitt] ||
			wahlLabel(a.eintrag).localeCompare(wahlLabel(b.eintrag), "de"),
	);

/** Der Ort, der als Überschrift über der Folie steht. */
const ortVon = (a: Anwaerter): string =>
	a.ort ??
	(a.eintrag.typ === "ortsrat"
		? a.eintrag.gebiet || a.eintrag.gebietTitel.replace(/^Ortschaft /, "")
		: a.behoerde.kurz);

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

/** So viele Namen passen auf eine Folie, ohne dass die Schrift zu klein wird. */
export const KANDIDATEN_JE_FOLIE = 8;

/** So viele Listen zeigt die Wahlbereichsfolie – die stärksten zuerst. */
export const LISTEN_JE_FOLIE = 4;
/** Und so viele Namen je Liste: der Vorderste und seine nächsten Verfolger. */
export const NAMEN_JE_LISTE = 3;

/**
 * Die Personen einer Wahlbereichsfolie.
 *
 * Zwei Zustände, und der Unterschied ist der Abend selbst: Solange gezählt
 * wird, gibt es nur die Bewerber mit ihren bisherigen Stimmen – die beste
 * Auskunft, die es dann gibt, und die Frage, die im Saal gestellt wird („wie
 * steht unser Kandidat da?“). Sobald die Wahlleitung die Sitze verteilt hat,
 * steht die Antwort fest, und dann zeigt die Folie sie: wer aus diesem
 * Wahlbereich in den Kreistag einzieht, direkt oder über die Liste.
 *
 * Die Zahl der Sitze **je Wahlbereich** veröffentlicht die Quelle nirgends;
 * sie ließe sich also vorher nicht ausrechnen. Deshalb wird sie auch nicht
 * geschätzt – eine Liste „das sind die Gewählten“ wäre am frühen Abend
 * schlicht erfunden.
 */
/**
 * Die stärksten Listen mit ihren vordersten Bewerbern.
 *
 * Zweimal nach Stimmen sortiert, und beide Male aus demselben Grund: Die
 * Wahlpräsentation liefert in Stimmzettel-Reihenfolge, und auf einer Folie,
 * die gekürzt wird, wäre das schlicht falsch – gekürzt gehört das Schwächste
 * weg, nicht das Letzte auf dem Zettel.
 */
export const listenAus = (parteien: readonly Partei[]): FolienListe[] =>
	[...parteien]
		.filter((p) => (p.kandidaten?.length ?? 0) > 0)
		.sort((a, b) => b.stimmen - a.stimmen)
		.slice(0, LISTEN_JE_FOLIE)
		.map((p) => {
			const sortiert = [...(p.kandidaten ?? [])].sort(
				(a, b) => b.stimmen - a.stimmen,
			);
			return {
				partei: p.kurz,
				farbe: p.farbe,
				kandidaten: sortiert.slice(0, NAMEN_JE_LISTE).map((k) => ({
					name: k.name,
					stimmen: k.stimmen,
				})),
				weitere: Math.max(0, sortiert.length - NAMEN_JE_LISTE),
			};
		});

const listenFuer = (kern: WahlKern): FolienListe[] =>
	listenAus(kern.aktuell?.ergebnis.parteien ?? []);

const kandidatenFuer = (
	kern: WahlKern,
	gewaehlte: Array<{ name: string; partei: string; mandat: string }>,
): {
	kandidaten: FolienKandidat[];
	kandidatenTitel: string;
	listen?: FolienListe[];
} => {
	const parteien = kern.aktuell?.ergebnis.parteien ?? [];
	const farbe = (partei: string): string =>
		parteien.find((p) => parteiKey(p.kurz) === parteiKey(partei))?.farbe ??
		parteiFarbe(parteiKey(partei));
	if (gewaehlte.length > 0)
		return {
			kandidaten: gewaehlte.map((g) => ({
				name: g.name,
				partei: g.partei,
				farbe: farbe(g.partei),
				// Der Wahlbereich steht dem Mandat voran und ist auf dieser Folie
				// schon die Überschrift – hier bleibt, wie es zustande kam.
				mandat: g.mandat.replace(/^[A-Za-z]\s*,\s*/, ""),
			})),
			kandidatenTitel: "Gewählt in den Kreistag",
		};
	const bewerber = parteien.flatMap((p) =>
		(p.kandidaten ?? []).map((k) => ({
			name: k.name,
			partei: p.kurz,
			farbe: p.farbe,
			stimmen: k.stimmen,
		})),
	);
	return {
		kandidaten: bewerber
			.sort((a, b) => (b.stimmen ?? 0) - (a.stimmen ?? 0))
			.slice(0, KANDIDATEN_JE_FOLIE),
		kandidatenTitel: "Personenstimmen je Liste",
		listen: listenFuer(kern),
	};
};

/**
 * Der Name einer Folie in der Adresse.
 *
 * Der Wahl-Slug reicht fast: Er ist lesbar und je Wahlleitung eindeutig. Nur
 * die kreisweiten Wahlen stehen mehrfach im Karussell – einmal je Zuschnitt –,
 * und die bekommen den Zuschnitt angehängt.
 */
const markeVon = (a: Anwaerter): string => {
	if (a.zuschnitt === "eigen") return a.eintrag.slug;
	if (a.zuschnitt === "kreis") return `${a.eintrag.slug}-kreis`;
	return `${a.eintrag.slug}-${slugify(a.ort ?? "wahlbereich")}`;
};

const folieAus = (
	kreis: Kreis,
	termin: Termin,
	a: Anwaerter,
): WahlFolie | undefined => {
	const kern = wahlKern(kreis, termin, a.behoerde, a.eintrag.slug, a.gebietId);
	if (!kern) return undefined;
	const { balken, weitere } = balkenFuerFolie(kern);
	const personen = a.personen
		? kandidatenFuer(kern, a.gewaehlte ?? [])
		: undefined;
	return {
		art: "wahl",
		key: `${a.behoerde.ags}-${a.eintrag.slug}${a.gebietId ? `-${a.gebietId}` : ""}`,
		marke: markeVon(a),
		ort: ortVon(a),
		wahl: wahlVon(a),
		href: wahlPfad(
			kreis.slug,
			termin.id,
			a.behoerde.slug,
			a.eintrag.slug,
			a.gebietId,
		),
		zuschnitt: a.zuschnitt,
		beisatz: a.beisatz,
		test: a.eintrag.test,
		personenwahl: kern.personenwahl,
		balken,
		weitere,
		kandidaten: personen?.kandidaten.length ? personen.kandidaten : undefined,
		kandidatenTitel: personen?.kandidaten.length
			? personen.kandidatenTitel
			: undefined,
		// Solange die Sitze nicht verteilt sind, zählt das Rennen innerhalb der
		// Listen – dann zeigt die Folie die statt der Rangliste über alle.
		listen: personen?.listen?.length ? personen.listen : undefined,
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

/** Was das Dashboard über den Kreis oben drüber braucht. */
export type Kreisebene = {
	behoerde: Behoerde;
	wahlen: WahlEintragZeile[];
	/**
	 * Der Kreiswahlbereich dieser Gemeinde: Ergebnis-Id und Anzeigename. Fehlt,
	 * wo die Quelle keine Wahlbereiche führt oder eine Stadt auf mehrere
	 * verteilt ist – dann entfällt die Folie, statt einen davon zu raten.
	 */
	wahlbereich?: {
		gebietId: string;
		name: string;
		gemeinden: string;
		/**
		 * Die Gewählten dieses Wahlbereichs, sobald die Wahlleitung die Sitze
		 * verteilt hat. Sie stehen am Gesamtergebnis des Kreises und tragen
		 * ihren Wahlbereich im Mandat („B, direkt“) – anders wäre nicht
		 * herauszufinden, wer aus welcher Gegend kommt.
		 */
		gewaehlte: Array<{ name: string; partei: string; mandat: string }>;
	};
};

/**
 * Der Wahlbereich, aus dem ein Mandat stammt: Die Wahlleitung schreibt ihn dem
 * Mandat voran („B, direkt“, „B, Listenplatz 1“). Wo das Feld anders aussieht,
 * kommt `undefined` zurück – dann bleibt die Zuordnung aus, statt geraten zu
 * werden.
 */
export const mandatsWahlbereich = (mandat: string): string | undefined => {
	const m = mandat.trim().match(/^([A-Za-z])\s*,/);
	return m ? m[1].toUpperCase() : undefined;
};

/** Ebenen, auf denen die Quelle Kreiswahlbereiche führt (siehe `ebeneLabel`). */
const WAHLBEREICHS_EBENEN = [9, 5];

/**
 * Die Kreisebene über einer Gemeinde: die kreisweiten Wahlen und der
 * Kreiswahlbereich, in dem sie liegt.
 *
 * Der Wahlbereich ist der Grund, warum das hier überhaupt in die Datenbank
 * greift: Welche Gemeinde in welchem Bereich liegt, steht nirgends als Liste,
 * sondern ergibt sich aus den Wahlräumen (siehe `wahlbereiche.ts`), und das
 * Ergebnis des Bereichs führt allein die Kreisbehörde – die Gemeinde selbst
 * kennt nur ihren eigenen Anteil daran.
 */
export const kreisebeneFuer = (
	termin: Termin,
	kreisBehoerde: Behoerde,
	gemeinde: Behoerde,
): Kreisebene => {
	const wahlen = wahleintraege(termin.id, kreisBehoerde.ags);
	const kuerzel = bereichVonGemeinde(
		gemeinde.kurz,
		kreisWahlbereiche(termin.id),
	);
	const kreistag = wahlen.find((w) => w.typ === "kreistag");
	// Ohne Buchstabe, ohne Kreistagswahl oder ohne Ergebnis des Bereichs gibt
	// es die Folie nicht. Eine Stadt, die auf mehrere Bereiche verteilt ist
	// (Hildesheim), liefert schon keinen Buchstaben – lieber keine Folie als
	// eine von dreien, willkürlich gewählt.
	const treffer =
		kuerzel && kreistag
			? alleErgebnisse(termin.id, kreisBehoerde.ags, kreistag.wahlId).find(
					(e) =>
						WAHLBEREICHS_EBENEN.includes(e.ebene) &&
						wahlbereichKuerzel(e.titel) === kuerzel,
				)
			: undefined;
	const gemeinden = kuerzel
		? gemeindenImWahlbereich(kuerzel, kreisWahlbereiche(termin.id))
		: [];
	const gewaehlte =
		kuerzel && kreistag
			? (
					alleErgebnisse(termin.id, kreisBehoerde.ags, kreistag.wahlId).find(
						(e) => e.ergebnis.sitze,
					)?.ergebnis.sitze?.gewaehlte ?? []
				).filter((g) => mandatsWahlbereich(g.mandat) === kuerzel)
			: [];
	return {
		behoerde: kreisBehoerde,
		wahlen,
		wahlbereich:
			treffer && kuerzel
				? {
						gebietId: treffer.gebietId,
						name: `Wahlbereich ${kuerzel}`,
						gemeinden: gemeinden.join(", "),
						gewaehlte,
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
	kreisebene: Kreisebene | undefined,
	takt = TAKT_STANDARD,
): DashboardModell => {
	// Die Zahlen der Kreisbehörde kommen nur in einer Gemeinde dazu. Im
	// Dashboard des Kreises selbst wären sie dieselbe Folie zweimal.
	const oben =
		kreisebene && kreisebene.behoerde.ags !== behoerde.ags
			? kreisebene
			: undefined;
	const eigene: Anwaerter[] = wahlen
		// Steht das Kreisergebnis ohnehin gleich daneben, entfällt der eigene
		// Anteil an einer Wahl, die im ganzen Kreis entschieden wird.
		.filter((e) => !oben || !istKreiswahl(e.typ))
		.map((eintrag) => ({
			behoerde,
			eintrag,
			zuschnitt: "eigen" as const,
		}));
	const kreisweite = (oben?.wahlen ?? []).filter((w) => istKreiswahl(w.typ));
	const darueber: Anwaerter[] = oben
		? [
				// Der eigene Kreiswahlbereich – die Ebene, auf der die
				// Kreistagssitze wirklich vergeben werden. Nur beim Kreistag: Der
				// Landrat wird im ganzen Kreis gewählt, ein Wahlbereichsergebnis
				// entschiede dort über nichts.
				...(oben.wahlbereich
					? kreisweite
							.filter((w) => w.typ === "kreistag")
							.map((eintrag) => ({
								behoerde: oben.behoerde,
								eintrag,
								zuschnitt: "wahlbereich" as const,
								gebietId: oben.wahlbereich?.gebietId,
								ort: oben.wahlbereich?.name,
								beisatz: oben.wahlbereich?.gemeinden,
								gewaehlte: oben.wahlbereich?.gewaehlte,
								personen: true,
							}))
					: []),
				...kreisweite.map((eintrag) => ({
					behoerde: oben.behoerde,
					eintrag,
					zuschnitt: "kreis" as const,
				})),
			]
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
	const wahlFolien = dashboardReihenfolge([...eigene, ...darueber])
		.map((a) => folieAus(kreis, termin, a))
		.filter((f): f is WahlFolie => f !== undefined)
		.filter(zeigen);

	// Zwei Folien mit derselben Marke wären zwei Verweise auf dieselbe Stelle:
	// Der zweite führte zur ersten. Vorkommen kann das nur, wo eine
	// Wahlleitung zwei Wahlen mit gleichem Slug führt – dann zählt die zweite
	// mit.
	const folien: Folie[] = wahlFolien;
	const vergeben = new Set<string>();
	for (const f of folien) {
		let marke = f.marke;
		for (let n = 2; vergeben.has(marke); n++) marke = `${f.marke}-${n}`;
		vergeben.add(marke);
		f.marke = marke;
	}

	return { kreis, termin, behoerde, folien, takt };
};
