import type { Behoerde } from "../data/behoerden.ts";
import { behoerdeByName } from "../data/behoerden.ts";
import type { Kreis } from "../data/kreise.ts";
import { type WahlEintragZeile, wahleintraege } from "./abfragen.ts";
import { wahlPfad } from "./pfade.ts";
import { agsAusPraesentationsUrl } from "./votemanager.ts";
import { type Wahltyp, istKreiswahl } from "./wahltyp.ts";

/** So viel braucht die Zuordnung von einer Übersichtszeile des Kreises. */
export type GemeindeZeile = { label: string; externeUrl?: string };

export const gemeindeDerZeile = (
	kreis: Kreis,
	zeile: GemeindeZeile,
): Behoerde | undefined => {
	const ags = agsAusPraesentationsUrl(zeile.externeUrl);
	const gefunden =
		(ags && kreis.behoerden.find((b) => b.ags === ags)) ||
		behoerdeByName(zeile.label, kreis.behoerden);
	return gefunden && gefunden.art !== "kreis" ? gefunden : undefined;
};

/** Dieselbe kreisweite Wahl in der Präsentation einer Gemeinde – falls sie sie führt. */
export const kreiswahlInGemeinde = (
	terminId: string,
	gemeinde: Behoerde,
	typ: Wahltyp,
): WahlEintragZeile | undefined =>
	istKreiswahl(typ)
		? wahleintraege(terminId, gemeinde.ags).find((w) => w.typ === typ)
		: undefined;

export const gemeindePfadFuerKreiswahl = (args: {
	kreis: Kreis;
	terminId: string;
	typ: Wahltyp;
	zeile: GemeindeZeile;
}): string | undefined => {
	if (!istKreiswahl(args.typ)) return undefined;
	const gemeinde = gemeindeDerZeile(args.kreis, args.zeile);
	if (!gemeinde) return undefined;
	const wahl = kreiswahlInGemeinde(args.terminId, gemeinde, args.typ);
	return wahl
		? wahlPfad(args.kreis.slug, args.terminId, gemeinde.slug, wahl.slug)
		: undefined;
};
