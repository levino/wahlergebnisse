/**
 * Eine Ortschaft, quer über alle Wahlen.
 *
 * Die Wahlseiten sind nach Wahlen geordnet: eine Seite je Wahl, darin die
 * Gebiete. Am Wahlabend fragt im Saal aber niemand nach einer Wahl, sondern
 * nach einem Ort – „was ist in Rössing passiert?“ Und die Antwort darauf steht
 * bisher an fünf Stellen: in der Ortsratswahl Rössing, im Ortsteil Rössing der
 * Gemeindewahl, in dem der Bürgermeisterwahl, der Kreistagswahl und der
 * Landratswahl. Dieses Modul dreht die Sicht um und sammelt sie ein.
 *
 * Möglich ist das, weil die Wahlleitung jedem Ortsteil dieselbe Gebiets-Id
 * gibt, gleich in welcher Wahl: `ebene_8_id_112` ist Rössing in der
 * Gemeindewahl, in der Kreistagswahl und in der Landratswahl – und es ist
 * zugleich das Wahlgebiet der Ortsratswahl Rössing. Ein Schlüssel für alles.
 *
 * **Was hier nicht steht, ist der Auszählstand.** Er steht dabei, klein, weil
 * ohne ihn keine Zahl einzuordnen ist; die Seite handelt aber von Ergebnissen.
 */
import type { Behoerde } from "../data/behoerden.ts";
import type { Kreis } from "../data/kreise.ts";
import type { Termin } from "../data/termine.ts";
import {
	type WahlEintragZeile,
	ergebnisseEbene,
	listenplaetze,
	wahleintraege,
} from "./abfragen.ts";
import { DASHBOARD_FOLGE } from "./dashboard.ts";
import { type BewerberListe, bewerberListen } from "./kandidaten.ts";
import { ortPfad, wahlPfad } from "./pfade.ts";
import {
	type BalkenModell,
	type Datenstand,
	type SitzModell,
	wahlKern,
} from "./seite.ts";
import type { Ergebnis, Kennzahlen } from "./votemanager.ts";
import { slugify } from "./wahltyp.ts";

/** Die Ebene, auf der die Wahlleitung Ortsteile führt. */
const ORTSTEIL_EBENE = 8;

export type Ort = {
	name: string;
	slug: string;
	/** Gebiets-Id des Ortsteils; in allen Wahlen dieselbe. */
	gebietId: string;
};

/** Eine Wahl, wie sie sich in diesem Ort dargestellt hat. */
export type OrtWahl = {
	key: string;
	/** Überschrift der Karte ("Ortsratswahl", "Gemeindewahl", "Kreistagswahl") */
	titel: string;
	/**
	 * Die Wahl dieses Ortes selbst – der Ortsrat. Nur sie vergibt hier Sitze;
	 * bei allen anderen ist der Ort ein Ausschnitt eines größeren Wahlgebiets.
	 */
	eigen: boolean;
	href: string;
	personenwahl: boolean;
	balken: BalkenModell[];
	sitze?: SitzModell;
	datenstand: Datenstand;
	kennzahlen: Kennzahlen;
	anz: number;
	max: number;
	vergleichTitel?: string;
};

export type OrtSeiteModell = {
	kreis: Kreis;
	termin: Termin;
	behoerde: Behoerde;
	ort: Ort;
	/** Alle Ortschaften der Gemeinde – zum Weiterblättern */
	orte: Array<Ort & { href: string; aktiv: boolean }>;
	wahlen: OrtWahl[];
	/** Bewerberinnen und Bewerber der Ortsratswahl dieses Ortes */
	bewerber: BewerberListe[];
	/** Ergebnis der Ortsratswahl – für die Tabelle der Gewählten */
	ortsratErgebnis?: Ergebnis;
	/** Wahlbezirke, die zu diesem Ort gehören */
	bezirke: Array<{ titel: string; href?: string }>;
};

/**
 * Die Ortschaften einer Wahlleitung.
 *
 * Zusammengetragen aus den Ortsteil-Ergebnissen aller ihrer Wahlen: Wo die
 * Quelle keine Ortsteile führt – und das ist in den meisten Kreisen so –,
 * kommt eine leere Liste zurück, und es gibt schlicht keine Ortsseiten.
 */
export const orteDerBehoerde = (
	terminId: string,
	behoerde: Behoerde,
	wahlen: readonly WahlEintragZeile[],
): Ort[] => {
	const gefunden = new Map<string, Ort>();
	for (const w of wahlen)
		for (const e of ergebnisseEbene(
			terminId,
			behoerde.ags,
			w.wahlId,
			ORTSTEIL_EBENE,
		))
			if (!gefunden.has(e.gebietId))
				gefunden.set(e.gebietId, {
					name: e.titel,
					slug: slugify(e.titel),
					gebietId: e.gebietId,
				});
	return [...gefunden.values()].sort((a, b) =>
		a.name.localeCompare(b.name, "de"),
	);
};

/** Rang einer Wahlart – dieselbe Erzählung wie auf dem Dashboard. */
const rang = (w: WahlEintragZeile): number => {
	const i = DASHBOARD_FOLGE.indexOf(w.typ);
	return i === -1 ? DASHBOARD_FOLGE.length : i;
};

export const ladeOrtSeite = (
	kreis: Kreis,
	termin: Termin,
	behoerde: Behoerde,
	ortSlug: string,
): OrtSeiteModell | undefined => {
	const alleWahlen = wahleintraege(termin.id, behoerde.ags);
	const orte = orteDerBehoerde(termin.id, behoerde, alleWahlen);
	const ort = orte.find((o) => o.slug === ortSlug);
	if (!ort) return undefined;

	/**
	 * Welche Wahlen gehören auf diese Seite?
	 *
	 * Alles außer den Ortsratswahlen der **anderen** Orte: Die Quelle führt
	 * auch dort alle neun Ortsteile auf, aber in der Ortsratswahl Adensen hat
	 * Rössing nichts gewählt, und eine Zeile mit lauter Nullen wäre keine
	 * Auskunft, sondern eine Falle.
	 */
	const eigeneOrtsratswahl = alleWahlen.find(
		(w) => w.typ === "ortsrat" && w.gebietId === ort.gebietId,
	);
	const passend = alleWahlen.filter(
		(w) => w.typ !== "ortsrat" || w.gebietId === ort.gebietId,
	);

	const wahlen = passend
		.sort(
			(a, b) =>
				// Der eigene Ortsrat zuerst: Er ist die Wahl dieses Ortes, alles
				// andere ist der Anteil des Ortes an einer größeren Wahl.
				Number(b.gebietId === ort.gebietId) -
					Number(a.gebietId === ort.gebietId) || rang(a) - rang(b),
		)
		.flatMap((eintrag) => {
			const eigen = eintrag.gebietId === ort.gebietId;
			const kern = wahlKern(
				kreis,
				termin,
				behoerde,
				eintrag.slug,
				eigen ? undefined : ort.gebietId,
			);
			if (!kern?.aktuell) return [];
			return [
				{
					key: eintrag.slug,
					titel: eigen ? "Ortsratswahl" : eintrag.kurz,
					eigen,
					href: wahlPfad(
						kreis.slug,
						termin.id,
						behoerde.slug,
						eintrag.slug,
						eigen ? undefined : ort.gebietId,
					),
					personenwahl: kern.personenwahl,
					balken: kern.balken,
					sitze: kern.sitze,
					datenstand: kern.datenstand,
					kennzahlen: kern.aktuell.ergebnis.kennzahlen,
					anz: kern.aktuell.standAnz ?? 0,
					max: kern.aktuell.standMax ?? 0,
					vergleichTitel: kern.vergleichTermin?.titel,
				} satisfies OrtWahl,
			];
		});

	// Bewerberinnen und Bewerber des Ortsrats: In einem Dorf ist das die Frage
	// des Abends – wer sitzt künftig drin.
	const ortsratKern = eigeneOrtsratswahl
		? wahlKern(kreis, termin, behoerde, eigeneOrtsratswahl.slug)
		: undefined;
	const bewerber =
		eigeneOrtsratswahl && ortsratKern?.aktuell
			? bewerberListen(
					ortsratKern.aktuell.ergebnis,
					listenplaetze(
						termin.id,
						behoerde.ags,
						eigeneOrtsratswahl.wahlId,
						ortsratKern.aktuell.gebietId,
					),
				)
			: [];

	// Die Wahlbezirke des Ortes stehen als Untergebiete an seinem
	// Ortsteil-Ergebnis; verlinkt wird in die Wahl, die es überall gibt.
	const traeger = wahlen[0];
	const bezirkWahl = alleWahlen.find((w) => w.typ === "rat") ?? alleWahlen[0];
	const bezirkKern = traeger
		? wahlKern(
				kreis,
				termin,
				behoerde,
				traeger.eigen && eigeneOrtsratswahl
					? eigeneOrtsratswahl.slug
					: bezirkWahl.slug,
				traeger.eigen ? undefined : ort.gebietId,
			)
		: undefined;
	const bezirke = (bezirkKern?.aktuell?.ergebnis.untergebiete ?? [])
		.flatMap((u) => u.gebiete)
		.map((g) => ({
			titel: g.titel,
			href: bezirkWahl
				? wahlPfad(kreis.slug, termin.id, behoerde.slug, bezirkWahl.slug, g.id)
				: undefined,
		}));

	return {
		kreis,
		termin,
		behoerde,
		ort,
		orte: orte.map((o) => ({
			...o,
			href: ortPfad(kreis.slug, termin.id, behoerde.slug, o.slug),
			aktiv: o.slug === ort.slug,
		})),
		wahlen,
		bewerber,
		ortsratErgebnis: ortsratKern?.aktuell?.ergebnis,
		bezirke,
	};
};
