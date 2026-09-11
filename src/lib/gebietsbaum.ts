import type { Behoerde } from "../data/behoerden.ts";
import type { Kreis } from "../data/kreise.ts";
import { wahlPfad } from "./pfade.ts";
import type { Termin } from "../data/termine.ts";
import {
	type UebersichtZeileDb,
	alleErgebnisse,
	wahleintraege,
} from "./abfragen.ts";
import { gemeindeDerZeile, gemeindePfadFuerKreiswahl } from "./kreiswahl.ts";
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

export const baueGebietsbaum = (args: {
	/** Der Kreis: sein Slug steht in jeder Adresse, seine Behörden ordnen die Gemeinden zu */
	kreis: Kreis;
	termin: Termin;
	behoerde: Behoerde;
	wahlSlug: string;
	wahlTyp: Wahltyp;
	wahlId: number;
	gesamtId: string;
	aktivId: string;
	wahlbereiche: Wahlbereiche;
	/** Übersichten dieser Wahl – bei kreisweiten Wahlen die Quelle der Gemeinden */
	uebersichten: UebersichtZeileDb[];
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
		kreis.slug,
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

	if (behoerde.art !== "kreis") {
		const rang = (e: Eintrag) =>
			e.ebene === "Wahlbereich" ? 0 : e.ebene === "Ortsteil" ? 1 : 2;
		return [...eigene]
			.sort((a, b) => rang(a) - rang(b) || a.titel.localeCompare(b.titel, "de"))
			.map((e) => knoten(e));
	}

	const gemeindenDesKreises = (): Eintrag[] => {
		const ausErgebnissen = eigene.filter((e) => e.ebene === "Gemeinde");
		const ue = args.uebersichten.find((u) => /gemeinde/i.test(u.titel));
		if (!ue) return ausErgebnissen;
		const beimKreis = new Map(
			ausErgebnissen.map((e) => [e.titel.toLowerCase(), e]),
		);
		return ue.uebersicht.zeilen.flatMap((z) => {
			const gemeinde = gemeindeDerZeile(kreis, z);
			if (!gemeinde) return [];
			const eigeneSeite = gemeindePfadFuerKreiswahl({
				kreis,
				terminId: termin.id,
				typ: args.wahlTyp,
				zeile: z,
			});
			const alt = beimKreis.get(z.label.toLowerCase());
			const href = eigeneSeite ?? alt?.href;
			if (!href) return [];
			return [
				{
					id: alt?.id ?? gemeinde.ags,
					titel: z.label,
					ebene: "Gemeinde",
					href,
				},
			];
		});
	};

	const bereiche = eigene.filter((e) => e.ebene === "Wahlbereich");
	const gemeinden = gemeindenDesKreises();

	const unterhalb = (gemeindeTitel: string): Eintrag[] => {
		const gem = gemeindeDerZeile(kreis, { label: gemeindeTitel });
		if (!gem) return [];
		const w = wahleintraege(termin.id, gem.ags).find(
			(x) => x.typ === args.wahlTyp,
		);
		if (!w) return [];
		const tiefer = gebieteEiner(
			kreis.slug,
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
