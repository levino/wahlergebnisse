/**
 * Kreisweite Wahlen und ihre Gemeinden – die Brücke zwischen zwei
 * Wahlleitungen.
 *
 * Bei Kreistags- und Landratswahl führt der Kreis seine Gemeinden nur als
 * Zeilen einer Übersicht auf. Deren Verweis zeigt **nicht** auf eine
 * Gebiets-Id in seiner eigenen Präsentation, sondern auf die Präsentation der
 * Gemeinde ("../../03254026/praesentation/index.html"). Die Ergebnisdateien
 * des Kreises zu diesen Gemeinden gibt es zwar, sie stehen aber in keiner
 * Datei, die der Poller lesen kann – auffindbar wären sie allein über ein
 * Verzeichnislisting, und das liefert in Niedersachsen keine votemanager-
 * Instanz mehr aus. Ohne Zutun bliebe die Gemeinde deshalb überall im Land
 * unverlinkt: sichtbar in Tabelle und Karte, aber nicht anzuklicken.
 *
 * Die Zahlen sind trotzdem da, nur bei der anderen Wahlleitung: **Jede
 * Gemeinde führt die kreisweite Wahl in ihrer eigenen Präsentation mit** –
 * mit demselben Gebiet, denselben Zahlen und zusätzlich ihren Ortsteilen und
 * Wahlbezirken. Nachgewiesen für Hildesheim (wahlen.kreis-hi.de), Peine
 * (votemanager.kdo.de) und Hann. Münden (wahlen.hann.muenden.de) – drei
 * Kreise auf drei Hosts.
 *
 * Deshalb führt eine Gemeinde bei einer kreisweiten Wahl hier auf ihre eigene
 * Seite dieser Wahl. Das gilt für jeden Kreis gleich, hält die Daten an einer
 * Stelle (statt sie beim Kreis ein zweites Mal zu speichern) und zeigt mehr,
 * als der Kreis über die Gemeinde weiß. Wo eine Gemeinde ihre Präsentation
 * noch nicht angelegt hat, gibt es schlicht keinen Verweis – lieber kein Link
 * als einer ins Leere.
 */
import type { Behoerde } from "../data/behoerden.ts";
import { behoerdeByName } from "../data/behoerden.ts";
import type { Kreis } from "../data/kreise.ts";
import { type WahlEintragZeile, wahleintraege } from "./abfragen.ts";
import { wahlPfad } from "./pfade.ts";
import { agsAusPraesentationsUrl } from "./votemanager.ts";
import { type Wahltyp, istKreiswahl } from "./wahltyp.ts";

/** So viel braucht die Zuordnung von einer Übersichtszeile des Kreises. */
export type GemeindeZeile = { label: string; externeUrl?: string };

/**
 * Die Gemeinde, die eine Zeile der Kreisübersicht meint.
 *
 * Zuerst über den Gebietsschlüssel im Verweis – der ist eindeutig. Erst wenn
 * die Zeile keinen trägt (ältere Datenbestände, andere Programmversionen),
 * über den Namen, und dann ausdrücklich nur innerhalb dieses Kreises.
 */
export const gemeindeDerZeile = (
	kreis: Kreis,
	zeile: GemeindeZeile,
): Behoerde | undefined => {
	const ags = agsAusPraesentationsUrl(zeile.externeUrl);
	const gefunden =
		(ags && kreis.behoerden.find((b) => b.ags === ags)) ||
		behoerdeByName(zeile.label, kreis.behoerden);
	// Die Summenzeile des Kreises ist keine Gemeinde.
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

/**
 * Adresse der Gemeindeseite zu einer Zeile der Kreisübersicht – oder
 * undefined, wenn die Wahl nicht kreisweit ist, die Zeile keine Gemeinde
 * meint oder diese Gemeinde ihre Präsentation nicht angelegt hat.
 */
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
