/**
 * View-Modell einer Wahlseite (Gesamtgebiet oder Untergebiet). Bündelt die
 * Datenbankzugriffe, damit die .astro-Seiten nur noch rendern.
 */
import type { Behoerde } from "../data/behoerden.ts";
import type { Kreis } from "../data/kreise.ts";
import { wahlPfad } from "./pfade.ts";
import {
	type Termin,
	TERMINE,
	terminGiltFuerBehoerde,
} from "../data/termine.ts";
import {
	type ErgebnisZeile,
	alleErgebnisse,
	type UebersichtZeileDb,
	type WahlEintragZeile,
	ergebnis,
	ergebnisseEbene,
	gleichesGebiet,
	listenplaetze,
	wahlLabel,
	uebersichten,
	vergleich,
	wahlStatus,
	wahlBySlug,
	wahleintraege,
} from "./abfragen.ts";
export { wahlLabel } from "./abfragen.ts";
import { type Gebietsknoten, baueGebietsbaum } from "./gebietsbaum.ts";
import { gemeindePfadFuerKreiswahl } from "./kreiswahl.ts";
import { type BewerberListe, bewerberListen } from "./kandidaten.ts";
import { parteiFarbe } from "./farben.ts";
import { type KartenDaten, baueKarte, sieger } from "./karte.ts";
import { SITZE_2021, hareNiemeyer } from "./sitze.ts";
import {
	type Einheit,
	type Unsicherheit,
	MINDEST_MELDUNGEN,
	istBriefwahl,
	ordneZu,
	rechneHoch,
	schwelle,
	unsicherheit,
} from "./hochrechnung.ts";
import {
	type Ergebnis,
	type Partei,
	type UebersichtZeile,
	ebeneVonGebietId,
	parteiKey,
} from "./votemanager.ts";
import { gebietstabelle } from "./gebietstabelle.ts";
import { amtVon, istPersonenwahl } from "./wahltyp.ts";
import {
	type Wahlbereiche,
	bereichVonGemeinde,
	kreisWahlbereiche,
	wahlbereichName,
} from "./wahlbereiche.ts";

export type SitzModell = {
	quelle: "amtlich" | "hochrechnung";
	/**
	 * Woraus die Sitze gerechnet sind:
	 * - `amtlich`      – die Wahlleitung hat die Sitzverteilung selbst geliefert
	 * - `struktur`     – echte Hochrechnung über die Bezirksergebnisse der Vorwahl
	 * - `fortschreibung` – bloße Fortschreibung des Zwischenstands, weil keine
	 *   brauchbaren Vergleichsdaten vorlagen (siehe hochrechnung.ts)
	 */
	art: "amtlich" | "struktur" | "fortschreibung";
	gesamt: number;
	verteilung: Array<{
		key: string;
		kurz: string;
		lang: string;
		farbe: string;
		sitze: number;
		vorher?: number;
	}>;
	hinweis: string;
	/**
	 * Wie belastbar die Zahl ist – nur bei `quelle: "hochrechnung"` gesetzt.
	 * Eine amtliche Sitzverteilung ist keine Schätzung und bekommt deshalb
	 * auch keine Einstufung.
	 */
	unsicherheit?: Unsicherheit;
};

/**
 * Warum an dieser Stelle (noch) keine Sitzverteilung steht. Solange zu wenig
 * ausgezählt ist, wäre jede Verteilung Zufall – dann gehört die Begründung auf
 * die Seite und nicht eine Grafik, die niemand einordnen kann.
 */
export type SitzeAusstehend = {
	anz: number;
	max: number;
	/** Zahl der Schnellmeldungen, ab der gerechnet wird */
	noetig: number;
	/** Wahl mit so wenigen Wahlbezirken, dass erst das Schlussergebnis zählt */
	kleinesGebiet: boolean;
	text: string;
};

/** Der Stand in drei Worten – groß und aus einigen Metern lesbar. */
export type Datenstand = {
	art: "endergebnis" | "hochrechnung" | "zwischenstand";
	titel: string;
	text: string;
	/**
	 * Einstufung der Hochrechnung, die im Band neben dem Titel steht. Nur
	 * gesetzt, wo auch hochgerechnet wird – beim Endergebnis gibt es nichts
	 * einzustufen, und beim Zwischenstand wird gar nichts geschätzt.
	 */
	unsicherheit?: Unsicherheit;
};

/**
 * Was die Einstufung praktisch heißt – gesagt in Sitzen, denn danach fragt am
 * Wahlabend jeder im Raum, und nicht in Prozentpunkten. Die Zahlen, aus denen
 * diese Sätze stammen, stehen in `hochrechnung.ts`.
 */
export const UNSICHERHEIT_SATZ: Record<Unsicherheit, string> = {
	hoch: "Es kann sich noch um mehrere Sitze verschieben.",
	mittel:
		"Das Bild steht in Umrissen; ein bis zwei Sitze können noch wechseln.",
	niedrig: "Höchstens noch ein Sitz wechselt.",
};

export type BalkenModell = Partei & {
	vorher?: number;
	diff?: number;
	sitze?: number;
};

export type UntergebietTabelle = {
	ebene: string;
	titel: string;
	spalten: Array<{ kurz: string; lang?: string; farbe: string }>;
	zeilen: Array<UebersichtZeile & { href?: string; siegerFarbe?: string }>;
};

/** Ein anderes Gebiet derselben Wahl, für den Umschalter im Kopf. */
export type GebietsWahl = {
	id: string;
	titel: string;
	ebene: string;
	href: string;
};

export type WahlSeiteModell = {
	kreis: Kreis;
	termin: Termin;
	behoerde: Behoerde;
	eintrag: WahlEintragZeile;
	gebietId: string;
	istGesamt: boolean;
	personenwahl: boolean;
	status?: string;
	aktuell?: ErgebnisZeile;
	gesamt?: ErgebnisZeile;
	vergleich?: ErgebnisZeile;
	vergleichTermin?: Termin;
	balken: BalkenModell[];
	sitze?: SitzModell;
	/** Gesetzt statt `sitze`, wenn zu wenig ausgezählt ist */
	sitzeAusstehend?: SitzeAusstehend;
	datenstand: Datenstand;
	/** Bewerberinnen und Bewerber mit Listenplatz, Anteil und Mandat */
	bewerber: BewerberListe[];
	tabellen: UntergebietTabelle[];
	karte?: KartenDaten;
	wahlen: WahlEintragZeile[];
	/** Anzeigename des aktuellen Gebiets (Wahlbereiche mit ihren Gemeinden) */
	gebietName: string;
	/** Navigationskette: Gesamtgebiet → aktuelles Gebiet */
	pfad: Array<{ titel: string; href: string }>;
	/** Gebiete dieser Wahl als Baum (Umschalter im Kopf) */
	gebiete: Gebietsknoten[];
	/** Dieselbe Wahl-Auswahl, aber möglichst im aktuellen Gebiet */
	wahlLinks: Array<{
		slug: string;
		label: string;
		href: string;
		aktiv: boolean;
	}>;
};

const farbenAus = (e?: ErgebnisZeile): Map<string, string> =>
	new Map((e?.ergebnis.parteien ?? []).map((p) => [p.key, p.farbe]));

/**
 * Ebenen, auf denen sich hochrechnen lässt, von fein nach grob. Wahlbezirke
 * sind die eigentliche Auszähleinheit; auf Kreisebene veröffentlicht die
 * Wahlleitung nur Gemeinden, dann sind das die Einheiten (jede mit ihrem
 * eigenen Auszählstand, deshalb rechnet `anteil` auch mit Bruchteilen).
 */
const HOCHRECHNUNGS_EBENEN = [6, 3, 8] as const;

/** Stimmen je Partei eines Ergebnisses als Karte. */
const stimmenVon = (e: ErgebnisZeile): Map<string, number> =>
	new Map(e.ergebnis.parteien.map((p) => [p.key, p.stimmen]));

/** Anteil der Schnellmeldungen dieser Einheit, die schon ausgezählt sind. */
const anteilVon = (e: ErgebnisZeile): number => {
	if (e.leer) return 0;
	if (e.standMax && e.standAnz !== null && e.standMax > 0)
		return Math.min(1, e.standAnz / e.standMax);
	return 1;
};

/**
 * Sammelt die Auszähleinheiten für die Hochrechnung: die feinste Ebene, auf
 * der die Vergleichswahl genug Gebiete hat. Einheiten, die es 2021 gab, heute
 * aber noch nicht gemeldet haben, kommen als „nichts ausgezählt“ dazu – sonst
 * würde die Rechnung die fehlende Masse gar nicht kennen.
 */
const sammleEinheiten = (
	termin: Termin,
	behoerde: Behoerde,
	eintrag: WahlEintragZeile,
	vTermin: Termin,
	vEintrag: WahlEintragZeile,
	nurGebiete?: Set<string>,
	nurVergleichsGebiete?: Set<string>,
): Einheit[] | undefined => {
	for (const ebene of HOCHRECHNUNGS_EBENEN) {
		const vorher = ergebnisseEbene(
			vTermin.id,
			behoerde.ags,
			vEintrag.wahlId,
			ebene,
		).filter(
			(e) =>
				!e.leer &&
				(!nurVergleichsGebiete || nurVergleichsGebiete.has(e.gebietId)),
		);
		if (vorher.length < 2) continue;
		const jetzt = ergebnisseEbene(
			termin.id,
			behoerde.ags,
			eintrag.wahlId,
			ebene,
		).filter((e) => !nurGebiete || nurGebiete.has(e.gebietId));
		const kandidaten = jetzt.map((e) => ({
			id: e.gebietId,
			name: e.titel,
			briefwahl: istBriefwahl(e.titel),
			anteil: anteilVon(e),
			stimmen: stimmenVon(e),
		}));
		const { treffer, uebrig } = ordneZu(
			kandidaten,
			vorher.map((v) => ({ name: v.titel, stimmen: stimmenVon(v) })),
		);
		return [
			...kandidaten.map((k) => ({ ...k, vorwert: treffer.get(k) })),
			// Bezirke der Vorwahl, aus denen heute noch nichts vorliegt
			...uebrig.map((v, i) => ({
				id: `fehlt-${i}`,
				name: v.name,
				briefwahl: istBriefwahl(v.name),
				anteil: 0,
				stimmen: new Map<string, number>(),
				vorwert: v.stimmen,
			})),
		];
	}
	return undefined;
};

type SitzKontext = {
	termin: Termin;
	behoerde: Behoerde;
	eintrag: WahlEintragZeile;
	aktuell?: ErgebnisZeile;
	vergleichE?: ErgebnisZeile;
	vergleichTermin?: Termin;
	vEintrag?: WahlEintragZeile;
	nurGebiete?: Set<string>;
	nurVergleichsGebiete?: Set<string>;
};

const sitzeFuer = (
	k: SitzKontext,
): { sitze?: SitzModell; ausstehend?: SitzeAusstehend } => {
	const { aktuell, eintrag, behoerde, vergleichE } = k;
	if (!aktuell || aktuell.leer || istPersonenwahl(eintrag.typ)) return {};
	const vorherMap = new Map(
		(vergleichE?.ergebnis.sitze?.verteilung ?? []).map((v) => [v.key, v.sitze]),
	);
	const amtlich = aktuell.ergebnis.sitze;
	if (amtlich && amtlich.gesamt > 0) {
		return {
			sitze: {
				quelle: "amtlich",
				art: "amtlich",
				gesamt: amtlich.gesamt,
				hinweis: amtlich.hinweis,
				verteilung: amtlich.verteilung.map((v) => ({
					...v,
					vorher: vorherMap.get(v.key),
				})),
			},
		};
	}
	// Sitzzahl des Gremiums aus dem Vergleichsergebnis oder der Tabelle
	const gesamt =
		vergleichE?.ergebnis.sitze?.gesamt ??
		SITZE_2021[`${behoerde.ags}/${eintrag.typ}`];
	if (!gesamt) return {};

	const anz = aktuell.standAnz ?? 0;
	const max = aktuell.standMax ?? 0;
	const noetig = schwelle(max);
	if (max > 0 && anz < noetig) {
		const kleinesGebiet = max <= MINDEST_MELDUNGEN;
		return {
			ausstehend: {
				anz,
				max,
				noetig,
				kleinesGebiet,
				text: kleinesGebiet
					? `Dieses Wahlgebiet hat nur ${max} Wahlbezirke. Aus einem Teil davon lässt sich nichts hochrechnen – die Sitzverteilung erscheint hier erst, wenn alle ${max} Schnellmeldungen vorliegen.`
					: `Erst ab ${noetig} von ${max} Schnellmeldungen. Vorher hängt die Sitzverteilung fast nur davon ab, welche Wahlbezirke zufällig zuerst fertig waren.`,
			},
		};
	}

	// Echte Hochrechnung, wenn Bezirksergebnisse der Vergleichswahl vorliegen
	const einheiten =
		k.vergleichTermin && k.vEintrag
			? sammleEinheiten(
					k.termin,
					behoerde,
					eintrag,
					k.vergleichTermin,
					k.vEintrag,
					k.nurGebiete,
					k.nurVergleichsGebiete,
				)
			: undefined;
	const hr = einheiten ? rechneHoch(einheiten) : undefined;

	const parteien = aktuell.ergebnis.parteien;
	const stimmen = hr
		? parteien.map((p) => ({
				key: p.key,
				stimmen: hr.stimmen.get(p.key) ?? p.stimmen,
			}))
		: parteien
				.filter((p) => p.stimmen > 0)
				.map((p) => ({ key: p.key, stimmen: p.stimmen }));
	if (!stimmen.length) return {};
	const hn = hareNiemeyer(stimmen, gesamt);
	const stand = `${anz} von ${max} Schnellmeldungen`;
	const stufe = unsicherheit(anz, max, !hr);
	return {
		sitze: {
			quelle: "hochrechnung",
			art: hr ? "struktur" : "fortschreibung",
			gesamt,
			unsicherheit: stufe,
			hinweis: hr
				? `Hochgerechnet aus ${stand}: Die Veränderung gegenüber ${k.vergleichTermin?.titel ?? "der letzten Wahl"} wird auf die fehlenden Wahlbezirke übertragen, gewichtet mit deren damaliger Stimmenzahl. ${gesamt} Sitze nach Hare-Niemeyer. Unsicherheit ${stufe}: ${UNSICHERHEIT_SATZ[stufe]} Keine Prognose der Wahlleitung.`
				: `Fortschreibung von ${stand}: Für diese Wahl liegen keine vergleichbaren Bezirksergebnisse der letzten Wahl vor – der Zwischenstand wird deshalb ungewichtet auf ${gesamt} Sitze umgerechnet. Die Unsicherheit ist damit hoch, unabhängig vom Auszählstand: Es fehlen gerade die Bezirke, die zuletzt melden. Keine Prognose der Wahlleitung.`,
			verteilung: stimmen.map((s) => {
				const p = parteien.find((x) => x.key === s.key);
				return {
					key: s.key,
					kurz: p?.kurz ?? s.key,
					lang: p?.lang ?? s.key,
					farbe: p?.farbe ?? "#999",
					sitze: hn.find((h) => h.key === s.key)?.sitze ?? 0,
					vorher: vorherMap.get(s.key),
				};
			}),
		},
	};
};

/** Beschriftung des Datenstands: Endergebnis, Hochrechnung oder Zwischenstand. */
const datenstandVon = (
	aktuell: ErgebnisZeile | undefined,
	status: string | undefined,
	sitze: SitzModell | undefined,
): Datenstand => {
	const anz = aktuell?.standAnz ?? 0;
	const max = aktuell?.standMax ?? 0;
	const stand = max > 0 ? `${anz} von ${max} Schnellmeldungen` : "";
	const fertig = max > 0 && anz >= max;
	if (sitze?.quelle === "amtlich" || (fertig && status))
		return {
			art: "endergebnis",
			titel: status ?? "Endergebnis",
			text: stand ? `Alle ${max} Schnellmeldungen ausgezählt.` : "",
		};
	if (fertig)
		return {
			art: "endergebnis",
			titel: "Ausgezählt",
			text: `Alle ${max} Schnellmeldungen liegen vor; die Wahlleitung hat das Ergebnis noch nicht für amtlich erklärt.`,
		};
	if (sitze?.quelle === "hochrechnung") {
		// Die Einstufung gehört neben den Titel und nicht ans Ende des Absatzes:
		// Wer vom Beamer abliest, liest die erste Zeile und sonst nichts.
		const stufe = sitze.unsicherheit ?? "hoch";
		return {
			art: "hochrechnung",
			titel: "Hochrechnung",
			unsicherheit: stufe,
			text: stand
				? `${UNSICHERHEIT_SATZ[stufe]} Stimmen: ausgezählter Zwischenstand aus ${stand}. Sitze: eigene Hochrechnung, keine Prognose der Wahlleitung.`
				: `${UNSICHERHEIT_SATZ[stufe]} Eigene Hochrechnung, keine Prognose der Wahlleitung.`,
		};
	}
	return {
		art: "zwischenstand",
		titel: "Zwischenstand",
		text: stand
			? `Die Auszählung läuft: ${stand}. Die Zahlen sind ein Teilergebnis, kein Hochrechnungswert.`
			: "Die Auszählung läuft. Die Zahlen sind ein Teilergebnis.",
	};
};

/** Der Gebietsname eines Eintrags – abgeleitet, sonst der rohe ohne "Ortschaft". */
const gebietNameVon = (w: WahlEintragZeile): string =>
	w.gebiet || w.gebietTitel.replace(/^Ortschaft /, "");

/** Vergleichsergebnis für ein Untergebiet: gleicher Gebietsname bei der Vergleichswahl. */
const vergleichFuerGebiet = (
	vTermin: Termin | undefined,
	behoerde: Behoerde,
	eintrag: WahlEintragZeile,
	aktuell: ErgebnisZeile | undefined,
	istGesamt: boolean,
): ErgebnisZeile | undefined => {
	if (!vTermin) return undefined;
	if (istGesamt)
		return vergleich(
			vTermin.id,
			behoerde.ags,
			eintrag.typ,
			eintrag.typ === "ortsrat" ? gebietNameVon(eintrag) : undefined,
		);
	if (!aktuell) return undefined;
	const vEintrag = wahleintraege(vTermin.id, behoerde.ags).find(
		(w) =>
			w.typ === eintrag.typ &&
			(eintrag.typ !== "ortsrat" || gleichesGebiet(w, gebietNameVon(eintrag))),
	);
	if (!vEintrag) return undefined;
	const kandidaten = ergebnisseEbene(
		vTermin.id,
		behoerde.ags,
		vEintrag.wahlId,
		aktuell.ebene,
	);
	const n = (s: string) =>
		s
			.toLowerCase()
			.replace(/^\d+\s*-\s*/, "")
			.replace(/[^a-zäöüß]/g, "");
	return kandidaten.find((k) => n(k.titel) === n(aktuell.titel));
};

/**
 * Der gemeinsame Kern einer Wahlanzeige: die Zahlen selbst.
 *
 * Wahlseite und Wahlabend-Dashboard zeigen dieselbe Wahl in verschiedener
 * Ausführlichkeit – Balken, Sitze und die Einstufung des Datenstands sind bei
 * beiden dieselben; Karte, Untergebietstabellen und Bewerberlisten gibt es nur
 * auf der Seite. Was beide brauchen, steht deshalb hier; was nur die Seite
 * braucht, kommt in `ladeWahlSeite` dazu.
 *
 * Der Unterschied ist nicht bloß Ordnung, sondern Aufwand: Das Dashboard zeigt
 * zwei Dutzend Wahlen hintereinander. Mit dem vollen Seitenmodell je Wahl
 * baute es für jede davon Karten und schlüsselte Gebietstabellen auf, die
 * niemand zu sehen bekommt.
 */
export type WahlKern = {
	eintrag: WahlEintragZeile;
	gebietId: string;
	istGesamt: boolean;
	personenwahl: boolean;
	status?: string;
	aktuell?: ErgebnisZeile;
	gesamt?: ErgebnisZeile;
	vergleich?: ErgebnisZeile;
	vergleichTermin?: Termin;
	balken: BalkenModell[];
	sitze?: SitzModell;
	sitzeAusstehend?: SitzeAusstehend;
	datenstand: Datenstand;
};

export const wahlKern = (
	kreis: Kreis,
	termin: Termin,
	behoerde: Behoerde,
	wahlSlug: string,
	gebietId?: string,
): WahlKern | undefined => {
	const eintrag = wahlBySlug(termin.id, behoerde.ags, wahlSlug);
	if (!eintrag) return undefined;
	const istGesamt = !gebietId || gebietId === eintrag.gebietId;
	const gid = gebietId ?? eintrag.gebietId;
	const gesamt = ergebnis(
		termin.id,
		behoerde.ags,
		eintrag.wahlId,
		eintrag.gebietId,
	);
	const aktuell = istGesamt
		? gesamt
		: ergebnis(termin.id, behoerde.ags, eintrag.wahlId, gid);
	if (!istGesamt && !aktuell) return undefined;
	const personenwahl = istPersonenwahl(eintrag.typ);
	const status = wahlStatus(termin.id, behoerde.ags, eintrag.wahlId);

	// Vergleichstermin je **Amt**: der jüngste frühere Termin, bei dem dieses
	// Amt in dieser Behörde besetzt wurde. Sonst stünde die Nordstemmer
	// Bürgermeisterwahl 2026 neben 2021 – dort wurde kein Bürgermeister gewählt,
	// die richtige Vergleichsgröße ist 2020.
	//
	// Gesucht wird über `amtVon` und nicht über den Wahltyp, weil Haupt- und
	// Stichwahl denselben Posten besetzen: Die Stichwahl 2026 soll neben der
	// letzten Wahl dieses Amtes stehen, nicht neben der letzten Wahl, die
	// zufällig auch in einer Stichwahl endete. Wo dort kein zweiter Wahlgang
	// nötig war, bleibt die Anzeige ohne Vergleichszahlen – das ist die
	// ehrliche Auskunft, während der Sprung Jahre zurück eine falsche wäre.
	//
	// Vorgefiltert wird am Katalog: Seit die Vorwerte der Direktwahlen
	// dazugehören, sind es 28 Termine statt drei, und für die allermeisten
	// Behörden gelten davon zwei. `terminGiltFuerBehoerde` beantwortet das ohne
	// Datenbank – sonst kostete jede Wahlseite zwei Dutzend Abfragen ins Leere.
	const amt = amtVon(eintrag.typ);
	const vergleichTermin = TERMINE.filter(
		(t) => t.datum < termin.datum && terminGiltFuerBehoerde(t, kreis, behoerde),
	)
		.sort((a, b) => b.datum.localeCompare(a.datum))
		.find((t) =>
			wahleintraege(t.id, behoerde.ags).some(
				(w) =>
					amtVon(w.typ) === amt &&
					(eintrag.typ !== "ortsrat" ||
						gleichesGebiet(w, gebietNameVon(eintrag))),
			),
		);
	const vergleichE = vergleichFuerGebiet(
		vergleichTermin,
		behoerde,
		eintrag,
		aktuell,
		istGesamt,
	);
	const vorherMap = new Map(
		(vergleichE?.ergebnis.parteien ?? []).map((p) => [
			personenwahl ? parteiKey(p.kandidat?.partei ?? p.kurz) : p.key,
			p.prozent,
		]),
	);
	const sitzeMap = new Map(
		(aktuell?.ergebnis.sitze?.verteilung ?? []).map((v) => [v.key, v.sitze]),
	);
	const balken: BalkenModell[] = (aktuell?.ergebnis.parteien ?? []).map((p) => {
		const vorher = vorherMap.get(
			personenwahl ? parteiKey(p.kandidat?.partei ?? p.kurz) : p.key,
		);
		return {
			...p,
			farbe: parteiFarbe(p.key, p.farbe),
			vorher,
			diff: vorher !== undefined ? p.prozent - vorher : undefined,
			sitze: sitzeMap.get(p.key),
		};
	});

	// Eintrag derselben Wahlart beim Vergleichstermin – aus ihm kommen die
	// Bezirksergebnisse, mit denen hochgerechnet wird.
	const vEintrag = vergleichTermin
		? wahleintraege(vergleichTermin.id, behoerde.ags).find(
				(w) =>
					w.typ === eintrag.typ &&
					(eintrag.typ !== "ortsrat" ||
						gleichesGebiet(w, gebietNameVon(eintrag))),
			)
		: undefined;
	// Eine Ortsratswahl teilt sich die Wahlbezirks-Ebene mit den Ortsratswahlen
	// der Nachbarorte; deshalb nur die Bezirke des eigenen Wahlgebiets.
	const eigeneBezirke =
		eintrag.typ === "ortsrat"
			? new Set(
					(gesamt ?? aktuell)?.ergebnis.untergebiete.flatMap((u) =>
						u.gebiete.map((g) => g.id),
					) ?? [],
				)
			: undefined;
	const vergleichsBezirke =
		eintrag.typ === "ortsrat" && vergleichE
			? new Set(
					vergleichE.ergebnis.untergebiete.flatMap((u) =>
						u.gebiete.map((g) => g.id),
					),
				)
			: undefined;
	const { sitze, ausstehend: sitzeAusstehend } = sitzeFuer({
		termin,
		behoerde,
		eintrag,
		aktuell,
		vergleichE,
		vergleichTermin,
		vEintrag,
		nurGebiete: eigeneBezirke?.size ? eigeneBezirke : undefined,
		nurVergleichsGebiete: vergleichsBezirke?.size
			? vergleichsBezirke
			: undefined,
	});
	const datenstand = datenstandVon(aktuell, status, sitze);
	return {
		eintrag,
		gebietId: gid,
		istGesamt,
		personenwahl,
		status,
		aktuell,
		gesamt,
		vergleich: vergleichE,
		vergleichTermin: vergleichE ? vergleichTermin : undefined,
		balken,
		sitze,
		sitzeAusstehend,
		datenstand,
	};
};

export const ladeWahlSeite = (
	kreis: Kreis,
	termin: Termin,
	behoerde: Behoerde,
	wahlSlug: string,
	gebietId?: string,
): WahlSeiteModell | undefined => {
	const kern = wahlKern(kreis, termin, behoerde, wahlSlug, gebietId);
	if (!kern) return undefined;
	const {
		eintrag,
		gebietId: gid,
		istGesamt,
		personenwahl,
		status,
		aktuell,
		gesamt,
		vergleich: vergleichE,
		vergleichTermin,
		balken,
		sitze,
		sitzeAusstehend,
		datenstand,
	} = kern;
	const wahlen = wahleintraege(termin.id, behoerde.ags);
	const bewerber = aktuell
		? bewerberListen(
				aktuell.ergebnis,
				listenplaetze(
					termin.id,
					behoerde.ags,
					eintrag.wahlId,
					aktuell.gebietId,
				),
			)
		: [];

	// Untergebiete: Übersichten der Wahl; bei Untergebiet-Seiten nur die verlinkten Gebiete
	//
	// Dafür wird jedes Gebietsergebnis dieser Wahl gebraucht: Die Kopfzeile der
	// Quelle gilt der ganzen Wahl-Id und nicht dem angezeigten Wahlgebiet, die
	// richtigen Spalten stehen deshalb nur in den Ergebnissen selbst (siehe
	// gebietstabelle.ts).
	const alleErg = alleErgebnisse(termin.id, behoerde.ags, eintrag.wahlId);
	const ergNachId = new Map(alleErg.map((e) => [e.gebietId, e]));
	const ebene3 =
		behoerde.art === "kreis" ? alleErg.filter((e) => e.ebene === 3) : [];
	const ebene3Id = new Map(
		ebene3.map((e) => [e.titel.toLowerCase(), e.gebietId]),
	);
	// Kreisweite Wahlen führen ihre Gemeinden ohne Gebiets-Id auf (der Link
	// zeigt auf deren eigene Präsentation) – dann hilft nur der Name.
	const ergebnisZuZeile = (z: UebersichtZeile): Ergebnis | undefined =>
		ergNachId.get(z.gebietId ?? ebene3Id.get(z.label.toLowerCase()) ?? "")
			?.ergebnis;
	const alleUe = uebersichten(termin.id, behoerde.ags, eintrag.wahlId).map(
		(u) => ({
			...u,
			uebersicht: gebietstabelle(
				u.uebersicht,
				(gesamt ?? aktuell)?.ergebnis.parteien ?? [],
				ergebnisZuZeile,
			),
		}),
	);
	const farben = farbenAus(gesamt);
	// Kreiswahlbereiche heißen in der Quelle nur "A", "B", … – welche Gemeinden
	// dazugehören, steht erst in den Wahlräumen. Erst nachschlagen, wenn die
	// Wahl überhaupt eine Wahlbereichs-Tabelle hat (das kostet Abfragen).
	let wahlbereicheCache: Wahlbereiche | undefined;
	const wahlbereiche = (): Wahlbereiche =>
		(wahlbereicheCache ??= kreisWahlbereiche(termin.id));
	const unterIds = new Set(
		aktuell?.ergebnis.untergebiete.flatMap((u) => u.gebiete.map((g) => g.id)) ??
			[],
	);
	const ortsratFilter =
		eintrag.typ === "ortsrat" && gesamt
			? new Set(
					gesamt.ergebnis.untergebiete.flatMap((u) =>
						u.gebiete.map((g) => g.id),
					),
				)
			: undefined;

	const relevant = (u: UebersichtZeileDb): boolean => {
		if (istGesamt) return true;
		// Untergebiet: nur Ebenen unterhalb der aktuellen, und nur verlinkte Zeilen
		return u.uebersicht.zeilen.some(
			(z) => z.gebietId && unterIds.has(z.gebietId),
		);
	};
	const tabellen: UntergebietTabelle[] = alleUe
		.filter(relevant)
		.map((u) => {
			// Nur auf Kreisebene: dort meint "Wahlbereich" den Kreiswahlbereich.
			// In einer Gemeinde sind es deren eigene Wahlbereiche für die Ratswahl.
			const kreisWahlbereichsTabelle =
				behoerde.art === "kreis" && /wahlbereich/i.test(u.titel);
			const zeilen = u.uebersicht.zeilen
				.filter((z) => {
					if (!istGesamt) return z.gebietId && unterIds.has(z.gebietId);
					// Ortsratswahl: nur die Wahlbezirke dieser Ortschaft. Alles
					// andere (Ortsteile, Wahlbereiche, Gemeinde) vermischt die
					// Zahlen mit den Ortsratswahlen der Nachbarorte.
					if (ortsratFilter)
						return Boolean(
							z.gebietId && z.stimmbezirk && ortsratFilter.has(z.gebietId),
						);
					// Summenzeile des Gesamtgebiets nicht als Untergebiet führen
					const id = z.gebietId ?? ebene3Id.get(z.label.toLowerCase());
					return id !== eintrag.gebietId;
				})
				.map((z) => {
					const id = z.gebietId ?? ebene3Id.get(z.label.toLowerCase());
					const s = sieger(z);
					// Kreisweite Wahl: Die Gemeinde führt in ihre eigene
					// Präsentation, denn dort – und nur dort verlässlich – steht
					// ihr Teilergebnis dieser Wahl (siehe kreiswahl.ts).
					const gemeinde =
						behoerde.art === "kreis"
							? gemeindePfadFuerKreiswahl({
									kreis,
									terminId: termin.id,
									typ: eintrag.typ,
									zeile: z,
								})
							: undefined;
					return {
						...z,
						label: kreisWahlbereichsTabelle
							? wahlbereichName(z.label, wahlbereiche())
							: z.label,
						href:
							gemeinde ??
							(id && id !== eintrag.gebietId
								? wahlPfad(
										kreis.slug,
										termin.id,
										behoerde.slug,
										eintrag.slug,
										id,
									)
								: id === eintrag.gebietId
									? wahlPfad(kreis.slug, termin.id, behoerde.slug, eintrag.slug)
									: undefined),
						siegerFarbe: s
							? (farben.get(parteiKey(s.kurz)) ??
								parteiFarbe(parteiKey(s.kurz)))
							: undefined,
					};
				});
			return {
				ebene: u.ebene,
				titel: u.titel,
				spalten: u.uebersicht.spalten.map((s) => ({
					...s,
					farbe:
						farben.get(parteiKey(s.kurz)) ?? parteiFarbe(parteiKey(s.kurz)),
				})),
				zeilen,
			};
		})
		// Eine Ebene mit nur einer Zeile gliedert nichts auf: Bei einer
		// Ortsratswahl liefert die Quelle auch „Gemeinden“ und „Wahlbereiche“,
		// die dann bloß das Wahlgebiet selbst wiederholen.
		.filter((t) => t.zeilen.length > 1)
		// Reihenfolge: grob → fein (Gemeinden, Wahlbereiche, Ortsteile, Wahlbezirke)
		.sort((a, b) => rang(a.titel) - rang(b.titel));

	const karte = baueKarte({
		kreis,
		terminId: termin.id,
		behoerde,
		wahlSlug: eintrag.slug,
		wahlTyp: eintrag.typ,
		gebietId: gid,
		gesamt,
		uebersichten: alleUe,
		ergebnisseEbene3: ebene3,
		nurGebiete: ortsratFilter,
	});

	// Gebiete dieser Wahl als Baum für den Umschalter im Kopf: bei der
	// Kreistagswahl Wahlbereich → Gemeinden, Ortsteile und Wahllokale.
	const gebiete = baueGebietsbaum({
		kreis,
		termin,
		behoerde,
		wahlSlug: eintrag.slug,
		wahlTyp: eintrag.typ,
		wahlId: eintrag.wahlId,
		gesamtId: eintrag.gebietId,
		aktivId: gid,
		wahlbereiche: wahlbereiche(),
		uebersichten: alleUe,
		bereichVonGemeinde: (name) => bereichVonGemeinde(name, wahlbereiche()),
	});

	// Wahl wechseln und dabei möglichst im selben Gebiet bleiben
	const wahlLinks = wahlen.map((w) => {
		const basis = wahlPfad(kreis.slug, termin.id, behoerde.slug, w.slug);
		if (w.slug === eintrag.slug || istGesamt || !aktuell)
			return {
				slug: w.slug,
				label: wahlLabel(w),
				href: basis,
				aktiv: w.slug === eintrag.slug,
			};
		const treffer = ergebnisseEbene(
			termin.id,
			behoerde.ags,
			w.wahlId,
			aktuell.ebene,
		).find((e) => e.titel === aktuell.titel);
		return {
			slug: w.slug,
			label: wahlLabel(w),
			href: treffer ? `${basis}${treffer.gebietId}/` : basis,
			aktiv: false,
		};
	});

	// Ein Kreiswahlbereich heißt in der Quelle nur "B". Auf seiner eigenen Seite
	// soll stehen, worum es geht.
	const gebietName =
		istGesamt || !aktuell
			? eintrag.gebietTitel
			: behoerde.art === "kreis" && ebeneLabel(gid) === "Wahlbereich"
				? wahlbereichName(aktuell.titel, wahlbereiche())
				: aktuell.titel;

	const pfad = [
		{
			titel: eintrag.gebietTitel,
			href: wahlPfad(kreis.slug, termin.id, behoerde.slug, eintrag.slug),
		},
	];
	if (!istGesamt && aktuell)
		pfad.push({
			titel: gebietName,
			href: wahlPfad(kreis.slug, termin.id, behoerde.slug, eintrag.slug, gid),
		});

	return {
		kreis,
		termin,
		behoerde,
		eintrag,
		gebietId: gid,
		istGesamt,
		personenwahl,
		status,
		aktuell,
		gesamt,
		vergleich: vergleichE,
		vergleichTermin: vergleichE ? vergleichTermin : undefined,
		balken,
		sitze,
		sitzeAusstehend,
		datenstand,
		bewerber,
		tabellen,
		karte,
		wahlen,
		gebietName,
		pfad,
		gebiete,
		wahlLinks,
	};
};

const rangEbene = (ebene: string): number =>
	["Gemeinde", "Wahlbereich", "Ortsteil", "Wahlbezirk"].indexOf(ebene) + 1 || 9;

const rang = (titel: string): number => {
	const t = titel.toLowerCase();
	if (t.includes("gemeinde")) return 1;
	if (t.includes("wahlbereich")) return 2;
	if (t.includes("ortsteil") || t.includes("ortschaft")) return 3;
	if (t.includes("wahlbezirk")) return 4;
	return 5;
};

export const ebeneName = (gebietId: string): string => ebeneLabel(gebietId);

/** Ebenenbezeichnung eines Gebiets ("Wahlbezirk", "Ortsteil", …). */
export const ebeneLabel = (gebietId: string): string => {
	const e = ebeneVonGebietId(gebietId);
	return e === 6
		? "Wahlbezirk"
		: e === 8
			? "Ortsteil"
			: e === 3
				? "Gemeinde"
				: e === 5 || e === 9
					? "Wahlbereich"
					: "Gebiet";
};
