/**
 * View-Modell einer Wahlseite (Gesamtgebiet oder Untergebiet). Bündelt die
 * Datenbankzugriffe, damit die .astro-Seiten nur noch rendern.
 */
import type { Behoerde } from "../data/behoerden.ts";
import type { Kreis } from "../data/kreise.ts";
import { wahlPfad } from "./pfade.ts";
import { type Termin, TERMINE } from "../data/termine.ts";
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
	type Partei,
	type UebersichtZeile,
	ebeneVonGebietId,
	parteiKey,
} from "./votemanager.ts";
import { istPersonenwahl } from "./wahltyp.ts";
import {
	type Wahlbereiche,
	bereichVonGemeinde,
	kreisWahlbereiche,
	wahlbereichName,
} from "./wahlbereiche.ts";

export type SitzModell = {
	quelle: "amtlich" | "hochrechnung";
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

const sitzeFuer = (
	behoerde: Behoerde,
	eintrag: WahlEintragZeile,
	aktuell: ErgebnisZeile | undefined,
	vergleichE: ErgebnisZeile | undefined,
): SitzModell | undefined => {
	if (!aktuell || aktuell.leer || istPersonenwahl(eintrag.typ))
		return undefined;
	const vorherMap = new Map(
		(vergleichE?.ergebnis.sitze?.verteilung ?? []).map((v) => [v.key, v.sitze]),
	);
	const amtlich = aktuell.ergebnis.sitze;
	if (amtlich && amtlich.gesamt > 0) {
		return {
			quelle: "amtlich",
			gesamt: amtlich.gesamt,
			hinweis: amtlich.hinweis,
			verteilung: amtlich.verteilung.map((v) => ({
				...v,
				vorher: vorherMap.get(v.key),
			})),
		};
	}
	// Hochrechnung: Sitzzahl aus dem Vergleichsergebnis oder der Tabelle
	const gesamt =
		vergleichE?.ergebnis.sitze?.gesamt ??
		SITZE_2021[`${behoerde.ags}/${eintrag.typ}`];
	const parteien = aktuell.ergebnis.parteien.filter((p) => p.stimmen > 0);
	if (!gesamt || !parteien.length) return undefined;
	const hn = hareNiemeyer(
		parteien.map((p) => ({ key: p.key, stimmen: p.stimmen })),
		gesamt,
	);
	const anz = aktuell.standAnz ?? 0;
	const max = aktuell.standMax ?? 0;
	return {
		quelle: "hochrechnung",
		gesamt,
		hinweis: `Hochrechnung nach Hare-Niemeyer aus ${anz} von ${max} Schnellmeldungen, ${gesamt} Sitze wie ${vergleichE ? "bei der letzten Wahl" : "vorgegeben"}`,
		verteilung: parteien.map((p) => ({
			key: p.key,
			kurz: p.kurz,
			lang: p.lang,
			farbe: p.farbe,
			sitze: hn.find((h) => h.key === p.key)?.sitze ?? 0,
			vorher: vorherMap.get(p.key),
		})),
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

export const ladeWahlSeite = (
	kreis: Kreis,
	termin: Termin,
	behoerde: Behoerde,
	wahlSlug: string,
	gebietId?: string,
): WahlSeiteModell | undefined => {
	const eintrag = wahlBySlug(termin.id, behoerde.ags, wahlSlug);
	if (!eintrag) return undefined;
	const wahlen = wahleintraege(termin.id, behoerde.ags);
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

	// Vergleichstermin je Wahlart: der jüngste frühere Termin, bei dem es diese
	// Wahl in dieser Behörde überhaupt gab. Sonst stünde die Nordstemmer
	// Bürgermeisterwahl 2026 neben 2021 – dort wurde kein Bürgermeister gewählt,
	// die richtige Vergleichsgröße ist 2020.
	const vergleichTermin = TERMINE.filter((t) => t.datum < termin.datum)
		.sort((a, b) => b.datum.localeCompare(a.datum))
		.find((t) =>
			wahleintraege(t.id, behoerde.ags).some(
				(w) =>
					w.typ === eintrag.typ &&
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

	const sitze = sitzeFuer(behoerde, eintrag, aktuell, vergleichE);
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
	const alleUe = uebersichten(termin.id, behoerde.ags, eintrag.wahlId);
	const ebene3 =
		behoerde.art === "kreis"
			? ergebnisseEbene(termin.id, behoerde.ags, eintrag.wahlId, 3)
			: [];
	const ebene3Id = new Map(
		ebene3.map((e) => [e.titel.toLowerCase(), e.gebietId]),
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
