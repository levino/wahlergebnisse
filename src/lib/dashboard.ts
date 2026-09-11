import type { Behoerde } from "../data/behoerden.ts";
import { vorproduziere } from "./ansage-datei.ts";
import type { Kreis } from "../data/kreise.ts";
import { type Termin, istLive } from "../data/termine.ts";
import type { WahlEintragZeile } from "./abfragen.ts";
import {
	alleErgebnisse,
	eingaengeFuer,
	letzteEingaenge,
	wahlLabel,
	wahleintraege,
} from "./abfragen.ts";
import { staerkste } from "./anzeige.ts";
import { parteiFarbe } from "./farben.ts";
import { type ParteiStand, sprechsatz, vieleEinheiten } from "./meldungen.ts";
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
export const TAKT_MIN = 5;
export const TAKT_MAX = 300;

/** `?takt=25` aus der Adresse, auf einen sinnvollen Bereich gestutzt. */
export const taktAus = (wert: string | null | undefined): number => {
	const n = Number.parseInt(wert ?? "", 10);
	if (!Number.isFinite(n)) return TAKT_STANDARD;
	return Math.min(TAKT_MAX, Math.max(TAKT_MIN, n));
};

export const BALKEN_JE_FOLIE = 6;

export type DashboardBalken = BalkenModell & { name: string; zusatz?: string };

export type FolienKandidat = {
	name: string;
	partei: string;
	farbe: string;
	stimmen?: number;
	/** Wie das Mandat zustande kam ("direkt", "Listenplatz 2") – erst amtlich. */
	mandat?: string;
};

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
	marke: string;
	quelle: {
		behoerde: string;
		wahlId: number;
		/** Gesamtgebiet der Wahl – die Ebene, auf der nichts „eingeht". */
		gesamtGebietId: string;
		/** Untergebiet, sofern die Folie eines zeigt (Kreiswahlbereich). */
		gebietId?: string;
	};
	/** Größte Schrift der Folie: um welchen Ort geht es. */
	ort: string;
	/** Darüber, kleiner: welche Wahl. */
	wahl: string;
	href: string;
	zuschnitt: Zuschnitt;
	/** Erläuterung neben der Wahl, etwa die Gemeinden eines Wahlbereichs. */
	beisatz?: string;
	test: boolean;
	personenwahl: boolean;
	balken: DashboardBalken[];
	/** Wie viele Bewerber oder Listen unter den gezeigten Balken fehlen. */
	weitere: number;
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
	/** Zuletzt eingegangene Gebiete, neuestes zuerst. */
	eingegangen?: string[];
};

/** Marke der Überblicksfolie in der Adresse (`…/dashboard#ueberblick`). */
export const UEBERBLICK_MARKE = "ueberblick";

/** Eine Zeile des Überblicks: eine Folie in einer Zeile. */
export type UeberblickZeile = {
	key: string;
	/** Die Marke der Folie, zu der die Zeile führt. */
	marke: string;
	wahl: string;
	ort: string;
	anz: number;
	max: number;
	fertig: boolean;
	art: Datenstand["art"];
	/** Wer vorn liegt – leer, solange nichts ausgezählt ist. */
	spitze?: { name: string; prozent: number; farbe: string };
};

export type UeberblickFolie = {
	art: "ueberblick";
	key: string;
	marke: string;
	ort: string;
	wahl: string;
	zeilen: UeberblickZeile[];
	/** Auszählstand über die eigenen Wahlen der Wahlleitung. */
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

const markeVon = (a: Anwaerter): string => {
	if (a.zuschnitt === "eigen") return a.eintrag.slug;
	if (a.zuschnitt === "kreis") return `${a.eintrag.slug}-kreis`;
	return `${a.eintrag.slug}-${slugify(a.ort ?? "wahlbereich")}`;
};

const ueberblickZeile = (f: WahlFolie): UeberblickZeile => {
	const spitze = f.balken[0];
	return {
		key: f.key,
		marke: f.marke,
		wahl: f.wahl,
		ort: f.ort,
		anz: f.anz,
		max: f.max,
		fertig: f.max > 0 && f.anz >= f.max,
		art: f.datenstand.art,
		spitze:
			spitze && spitze.prozent > 0
				? { name: spitze.name, prozent: spitze.prozent, farbe: spitze.farbe }
				: undefined,
	};
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
		quelle: {
			behoerde: a.behoerde.ags,
			wahlId: a.eintrag.wahlId,
			gesamtGebietId: a.eintrag.gebietId,
			gebietId: a.gebietId,
		},
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
	wahlbereich?: {
		gebietId: string;
		name: string;
		gemeinden: string;
		gewaehlte: Array<{ name: string; partei: string; mandat: string }>;
	};
};

export const mandatsWahlbereich = (mandat: string): string | undefined => {
	const m = mandat.trim().match(/^([A-Za-z])\s*,/);
	return m ? m[1].toUpperCase() : undefined;
};

/** Ebenen, auf denen die Quelle Kreiswahlbereiche führt (siehe `ebeneLabel`). */
const WAHLBEREICHS_EBENEN = [9, 5];

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

/** So viele eingegangene Gebiete führt eine Folie mit. */
export const EINGAENGE_JE_FOLIE = 5;

const eingaengeEintragen = (termin: Termin, folien: WahlFolie[]): void => {
	const offen = folien.filter(
		(f) => !f.quelle.gebietId && !vieleEinheiten(f.max),
	);
	if (offen.length === 0) return;
	const eingaenge = letzteEingaenge(
		termin.id,
		offen.map((f) => ({
			behoerde: f.quelle.behoerde,
			wahlId: f.quelle.wahlId,
		})),
	);
	for (const f of offen)
		f.eingegangen = eingaengeFuer(eingaenge, f.quelle.behoerde, f.quelle.wahlId)
			.filter((e) => e.gebietId !== f.quelle.gesamtGebietId && e.name)
			.slice(0, EINGAENGE_JE_FOLIE)
			.map((e) => e.name);
};

export const ladeDashboard = (
	kreis: Kreis,
	termin: Termin,
	behoerde: Behoerde,
	wahlen: WahlEintragZeile[],
	kreisebene: Kreisebene | undefined,
	takt = TAKT_STANDARD,
): DashboardModell => {
	const oben =
		kreisebene && kreisebene.behoerde.ags !== behoerde.ags
			? kreisebene
			: undefined;
	const eigene: Anwaerter[] = wahlen
		.filter((e) => !oben || !istKreiswahl(e.typ))
		.map((eintrag) => ({
			behoerde,
			eintrag,
			zuschnitt: "eigen" as const,
		}));
	const kreisweite = (oben?.wahlen ?? []).filter((w) => istKreiswahl(w.typ));
	const darueber: Anwaerter[] = oben
		? [
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

	const zeigen = (f: WahlFolie): boolean =>
		istLive(termin) || f.max > 0 || f.balken.length > 0;
	const wahlFolien = dashboardReihenfolge([...eigene, ...darueber])
		.map((a) => folieAus(kreis, termin, a))
		.filter((f): f is WahlFolie => f !== undefined)
		.filter(zeigen);

	const vergeben = new Set<string>([UEBERBLICK_MARKE]);
	for (const f of wahlFolien) {
		let marke = f.marke;
		for (let n = 2; vergeben.has(marke); n++) marke = `${f.marke}-${n}`;
		vergeben.add(marke);
		f.marke = marke;
	}

	if (istLive(termin)) eingaengeEintragen(termin, wahlFolien);

	const eigeneFolien = wahlFolien.filter((f) => f.zuschnitt === "eigen");
	const ueberblick: UeberblickFolie = {
		art: "ueberblick",
		key: UEBERBLICK_MARKE,
		marke: UEBERBLICK_MARKE,
		ort: behoerde.kurz,
		wahl: termin.titel,
		zeilen: wahlFolien.map(ueberblickZeile),
		anz: eigeneFolien.reduce((s, f) => s + f.anz, 0),
		max: eigeneFolien.reduce((s, f) => s + f.max, 0),
	};

	const modell: DashboardModell = {
		kreis,
		termin,
		behoerde,
		folien: wahlFolien.length > 0 ? [ueberblick, ...wahlFolien] : [],
		takt,
	};
	if (istLive(termin)) ansagenVorbereiten(modell);
	return modell;
};

const ansagenVorbereiten = (m: DashboardModell): void => {
	for (const f of m.folien) {
		if (f.max <= 0 || f.anz < f.max - 1) continue;
		vorproduziere(
			sprechsatz({
				marke: f.marke,
				ort: f.ort,
				wahl: f.wahl,
				art: "fertig",
				text: "",
			}),
			m.behoerde.ags,
		);
	}
};

export const parteiStaende = (f: WahlFolie): ParteiStand[] =>
	f.balken.map((b, i) => ({
		key: b.key,
		platz: i + 1,
		prozent: b.prozent,
		sitze: f.sitze?.verteilung.find((v) => v.key === b.key)?.sitze,
	}));

/** Eine Partei, wie sie in der Auswahl „Meine Partei“ steht. */
export type ParteiWahl = { key: string; kurz: string; farbe: string };

export const parteienZurAuswahl = (folien: readonly Folie[]): ParteiWahl[] => {
	const raus = new Map<string, ParteiWahl>();
	const merke = (key: string, kurz: string, farbe: string): void => {
		if (!key || !kurz || raus.has(key)) return;
		raus.set(key, { key, kurz, farbe });
	};
	for (const f of folien) {
		if (f.art !== "wahl") continue;
		for (const b of f.balken) merke(b.key, b.kurz, b.farbe);
		for (const l of f.listen ?? [])
			merke(parteiKey(l.partei), l.partei, l.farbe);
		for (const k of f.kandidaten ?? [])
			merke(parteiKey(k.partei), k.partei, k.farbe);
	}
	return [...raus.values()].sort((a, b) => a.kurz.localeCompare(b.kurz, "de"));
};
