/**
 * Der Gebietsbaum für den Umschalter im Kopf.
 *
 * Gedacht ist er zum schnellen Durchklicken: Bei der Kreistagswahl steht oben
 * der Wahlbereich, darunter seine Gemeinden, darunter deren Ortsteile und
 * schließlich die einzelnen Wahllokale.
 *
 * Der Haken dabei: Die amtliche Präsentation trennt nach Wahlleitung. Der
 * Landkreis führt zur Kreistagswahl nur Gemeinden und Wahlbereiche; die
 * Wahlbezirke derselben Wahl liegen in der Präsentation der jeweiligen
 * Gemeinde. Der Baum überschreitet diese Grenze deshalb bewusst: Unterhalb
 * einer Gemeinde stehen die Gebiete aus deren eigener Präsentation.
 */
import { type Behoerde, behoerdeByName } from "../data/behoerden.ts";
import { wahlPfad } from "./pfade.ts";
import type { Termin } from "../data/termine.ts";
import { alleErgebnisse, wahleintraege } from "./abfragen.ts";
import type { Wahlbereiche } from "./wahlbereiche.ts";
import { wahlbereichKuerzel, wahlbereichName } from "./wahlbereiche.ts";
import { ebeneVonGebietId } from "./votemanager.ts";
import type { Wahltyp } from "./wahltyp.ts";

export type Gebietsknoten = {
	id: string;
	titel: string;
	ebene: string;
	href: string;
	/** true, wenn dieser Knoten gerade angezeigt wird */
	aktiv: boolean;
	kinder: Gebietsknoten[];
};

const EBENE: Record<number, string> = {
	1: "Kreis",
	3: "Gemeinde",
	5: "Wahlbereich",
	6: "Wahlbezirk",
	8: "Ortsteil",
	9: "Wahlbereich",
};

export const ebeneVon = (gebietId: string): string => {
	const n = ebeneVonGebietId(gebietId);
	return EBENE[n] ?? (n === 6 ? "Wahlbezirk" : "Gebiet");
};

type Eintrag = { id: string; titel: string; ebene: string; href: string };

const gebieteEiner = (
	kreis: string,
	terminId: string,
	behoerde: Behoerde,
	wahlId: number,
	wahlSlug: string,
	gesamtId: string,
): Eintrag[] =>
	alleErgebnisse(terminId, behoerde.ags, wahlId)
		.filter((e) => e.gebietId !== gesamtId)
		.map((e) => ({
			id: e.gebietId,
			titel: e.titel,
			ebene: ebeneVon(e.gebietId),
			href: wahlPfad(kreis, terminId, behoerde.slug, wahlSlug, e.gebietId),
		}));

/**
 * Baut den Baum für eine Wahl.
 *
 * @param gemeindeGebiete  liefert die Gebiete derselben Wahl aus der
 *   Präsentation einer Gemeinde – nur für kreisweite Wahlen sinnvoll
 */
export const baueGebietsbaum = (args: {
	/** Slug des Kreises – erstes Segment jeder Adresse */
	kreis: string;
	termin: Termin;
	behoerde: Behoerde;
	wahlSlug: string;
	wahlTyp: Wahltyp;
	wahlId: number;
	gesamtId: string;
	aktivId: string;
	wahlbereiche: Wahlbereiche;
	/** Zuordnung Gemeinde → Kreiswahlbereich, für die Verschachtelung */
	bereichVonGemeinde: (gemeinde: string) => string | undefined;
}): Gebietsknoten[] => {
	const {
		kreis,
		termin,
		behoerde,
		wahlSlug,
		wahlId,
		gesamtId,
		aktivId,
		wahlbereiche,
		bereichVonGemeinde,
	} = args;
	const eigene = gebieteEiner(
		kreis,
		termin.id,
		behoerde,
		wahlId,
		wahlSlug,
		gesamtId,
	);
	const knoten = (e: Eintrag, kinder: Gebietsknoten[] = []): Gebietsknoten => ({
		...e,
		aktiv: e.id === aktivId,
		kinder,
	});

	// Innerhalb einer Gemeinde: alles auf einer Ebene, Ortsteile vor Wahllokalen
	if (behoerde.art !== "kreis") {
		const rang = (e: Eintrag) =>
			e.ebene === "Wahlbereich" ? 0 : e.ebene === "Ortsteil" ? 1 : 2;
		return [...eigene]
			.sort((a, b) => rang(a) - rang(b) || a.titel.localeCompare(b.titel, "de"))
			.map((e) => knoten(e));
	}

	// Kreisebene: Wahlbereich → Gemeinden → (Ortsteile → Wahlbezirke)
	const bereiche = eigene.filter((e) => e.ebene === "Wahlbereich");
	const gemeinden = eigene.filter((e) => e.ebene === "Gemeinde");

	/**
	 * Gebiete derselben Wahl aus der Präsentation einer Gemeinde – flach.
	 * Gemeinde, Ortsteile und Wahllokale stehen im Menü auf einer Ebene, damit
	 * man ein Wahllokal direkt aus dem Wahlbereich heraus anspringen kann,
	 * statt sich durch drei Stufen zu klicken.
	 */
	const unterhalb = (gemeindeTitel: string): Eintrag[] => {
		const gem = behoerdeByName(gemeindeTitel);
		if (!gem) return [];
		const w = wahleintraege(termin.id, gem.ags).find(
			(x) => x.typ === args.wahlTyp,
		);
		if (!w) return [];
		const tiefer = gebieteEiner(
			kreis,
			termin.id,
			gem,
			w.wahlId,
			w.slug,
			w.gebietId,
		);
		const rang = (e: Eintrag) =>
			e.ebene === "Ortsteil" ? 0 : e.ebene === "Wahlbezirk" ? 1 : 2;
		return tiefer.sort(
			(a, b) => rang(a) - rang(b) || a.titel.localeCompare(b.titel, "de"),
		);
	};

	const gemeindeMitInhalt = (g: Eintrag): Gebietsknoten[] => [
		knoten(g),
		...unterhalb(g.titel).map((e) => knoten(e)),
	];

	if (bereiche.length === 0) return gemeinden.flatMap(gemeindeMitInhalt);

	const zugeordnet = new Set<string>();
	const baum = bereiche.map((b) => {
		const kuerzel = wahlbereichKuerzel(b.titel);
		const kinder = gemeinden
			.filter((g) => kuerzel && bereichVonGemeinde(g.titel) === kuerzel)
			.flatMap((g) => {
				zugeordnet.add(g.id);
				return gemeindeMitInhalt(g);
			});
		return knoten(
			{ ...b, titel: wahlbereichName(b.titel, wahlbereiche) },
			kinder,
		);
	});
	// Gemeinden, die zu mehreren Bereichen gehören (Stadt Hildesheim), bleiben
	// zusätzlich als eigene Einträge stehen – sonst fände man sie nicht.
	const uebrig = gemeinden.filter((g) => !zugeordnet.has(g.id));
	return [...baum, ...uebrig.flatMap(gemeindeMitInhalt)];
};

/** Flache Liste für ein <select>, mit Einrückung nach Tiefe. */
export const alsAuswahl = (
	knoten: Gebietsknoten[],
	tiefe = 0,
): Array<{ href: string; titel: string; aktiv: boolean; tiefe: number }> =>
	knoten.flatMap((k) => [
		{ href: k.href, titel: k.titel, aktiv: k.aktiv, tiefe },
		...alsAuswahl(k.kinder, tiefe + 1),
	]);
