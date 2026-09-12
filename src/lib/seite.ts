import type { Behoerde } from "../data/behoerden.ts";
import { type Kreis, nutztIvu } from "../data/kreise.ts";
import { wahlPfad } from "./pfade.ts";
import type { Termin } from "../data/termine.ts";
import {
	type ErgebnisZeile,
	alleErgebnisse,
	eigeneGebiete,
	type UebersichtZeileDb,
	type WahlEintragZeile,
	angekuendigteEbenen,
	ergebnisseEbene,
	listenplaetze,
	wahlLabel,
	uebersichten,
	wahlEbenen,
	wahleintraege,
} from "./abfragen.ts";
export { wahlLabel } from "./abfragen.ts";
import {
	type Gebietsknoten,
	baueGebietsbaum,
	baueIvuBaum,
} from "./gebietsbaum.ts";
import type { Kreisdeckung } from "./kreisdeckung.ts";
import { type Ebenennamen, ebeneVon, leereEbenen } from "./ebenen.ts";
import { gemeindePfadFuerKreiswahl } from "./kreiswahl.ts";
import { type BewerberListe, bewerberListen } from "./kandidaten.ts";
import { parteiFarbe } from "./farben.ts";
import { type KartenDaten, baueKarte, sieger } from "./karte.ts";
import {
	type Ergebnis,
	type UebersichtZeile,
	parteiKey,
} from "./votemanager.ts";
import { gebietstabelle } from "./gebietstabelle.ts";
import {
	type BalkenModell,
	type Datenstand,
	type SitzModell,
	type SitzeAusstehend,
	wahlKern,
} from "./wahlkern.ts";

export {
	type BalkenModell,
	type Datenstand,
	type SitzModell,
	type SitzeAusstehend,
	type WahlKern,
	UNSICHERHEIT_SATZ,
	wahlKern,
} from "./wahlkern.ts";
import {
	type Wahlbereiche,
	bereichVonGemeinde,
	kreisWahlbereiche,
	wahlbereichName,
} from "./wahlbereiche.ts";

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
	/** Gesetzt, wenn diese kreisweite Summe nicht das ganze Kreisgebiet umfasst. */
	deckung?: Kreisdeckung;
	/** Bewerberinnen und Bewerber mit Listenplatz, Anteil und Mandat */
	bewerber: BewerberListe[];
	tabellen: UntergebietTabelle[];
	karte?: KartenDaten;
	wahlen: WahlEintragZeile[];
	/** Anzeigename des aktuellen Gebiets (Wahlbereiche mit ihren Gemeinden) */
	gebietName: string;
	/** Ebene des aktuellen Gebiets, wie die Wahlleitung sie führt */
	ebeneName: string;
	/** Navigationskette: Gesamtgebiet → aktuelles Gebiet */
	pfad: Array<{ titel: string; href: string }>;
	/** Gebiete dieser Wahl als Baum (Umschalter im Kopf) */
	gebiete: Gebietsknoten[];
	/**
	 * Ebenen, die die Wahlleitung ankündigt, zu denen sie aber noch kein Gebiet
	 * veröffentlicht hat – in ihrer Schreibweise ("Kreiswahlbereiche").
	 */
	offeneEbenen: string[];
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
		deckung,
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

	const alleErg = alleErgebnisse(termin.id, behoerde.ags, eintrag.wahlId);
	const ergNachId = new Map(alleErg.map((e) => [e.gebietId, e]));
	const ebene3 =
		behoerde.art === "kreis" ? alleErg.filter((e) => e.ebene === 3) : [];
	const ebene3Id = new Map(
		ebene3.map((e) => [e.titel.toLowerCase(), e.gebietId]),
	);
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
	const ebenen = wahlEbenen(termin.id, behoerde.ags, eintrag.wahlId);
	let wahlbereicheCache: Wahlbereiche | undefined;
	const wahlbereiche = (): Wahlbereiche =>
		(wahlbereicheCache ??= kreisWahlbereiche(termin.id));
	const unterIds = new Set(
		aktuell?.ergebnis.untergebiete.flatMap((u) => u.gebiete.map((g) => g.id)) ??
			[],
	);
	const ortsratFilter = eigeneGebiete(termin.id, behoerde.ags, eintrag);

	const relevant = (u: UebersichtZeileDb): boolean => {
		if (istGesamt) return true;
		return u.uebersicht.zeilen.some(
			(z) => z.gebietId && unterIds.has(z.gebietId),
		);
	};
	const tabellen: UntergebietTabelle[] = alleUe
		.filter(relevant)
		.map((u) => {
			const kreisWahlbereichsTabelle =
				behoerde.art === "kreis" && /wahlbereich/i.test(u.titel);
			const zeilen = u.uebersicht.zeilen
				.filter((z) => {
					if (!istGesamt) return z.gebietId && unterIds.has(z.gebietId);
					if (ortsratFilter)
						return Boolean(
							z.gebietId && z.stimmbezirk && ortsratFilter.has(z.gebietId),
						);
					const id = z.gebietId ?? ebene3Id.get(z.label.toLowerCase());
					return id !== eintrag.gebietId;
				})
				.map((z) => {
					const id = z.gebietId ?? ebene3Id.get(z.label.toLowerCase());
					const s = sieger(z);
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
		.filter((t) => t.zeilen.length > 1)
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

	const baumArgs = {
		kreis,
		termin,
		behoerde,
		wahlSlug: eintrag.slug,
		wahlTyp: eintrag.typ,
		wahlId: eintrag.wahlId,
		gesamtId: eintrag.gebietId,
		aktivId: gid,
	};
	const gebiete = nutztIvu(kreis)
		? baueIvuBaum(baumArgs)
		: baueGebietsbaum({
				...baumArgs,
				wahlbereiche: wahlbereiche(),
				uebersichten: alleUe,
				bereichVonGemeinde: (name) => bereichVonGemeinde(name, wahlbereiche()),
			});

	const offeneEbenen = leereEbenen(
		angekuendigteEbenen(termin.id, behoerde.ags, eintrag.wahlId),
		alleErg.map((e) => e.gebietId),
	);

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

	const gebietName =
		istGesamt || !aktuell
			? eintrag.gebietTitel
			: behoerde.art === "kreis" && ebeneLabel(gid, ebenen) === "Wahlbereich"
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
		deckung,
		bewerber,
		tabellen,
		karte,
		wahlen,
		gebietName,
		ebeneName: ebeneVon(gid, ebenen),
		pfad,
		gebiete,
		offeneEbenen,
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

export const ebeneName = (gebietId: string, namen?: Ebenennamen): string =>
	ebeneVon(gebietId, namen);

/** Ebenenbezeichnung eines Gebiets ("Wahlbezirk", "Ortsteil", …). */
export const ebeneLabel = ebeneVon;
