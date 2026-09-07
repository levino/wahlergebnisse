/**
 * Was auf der Startseite eines Wahltermins steht – als Modell, damit es sich
 * ohne Browser prüfen lässt.
 *
 * **Kreisfreie Städte.** Die Übersicht ging bisher davon aus, dass ein Kreis
 * aus einer Kreisbehörde und vielen Gemeinden besteht: oben die kreisweiten
 * Wahlen (Landrat, Kreistag), darunter die Gemeinden. Eine kreisfreie Stadt
 * hat aber weder Landrat noch Kreistag und keine einzige Gemeinde unter sich –
 * ihre Wahlleitung ist zugleich die Kreisbehörde. Braunschweig, Delmenhorst,
 * Emden, Oldenburg, Osnabrück und Wilhelmshaven zeigten deshalb „noch nicht
 * geladen“ und verlinkten keine einzige ihrer Wahlen, obwohl alle Zahlen da
 * waren.
 *
 * Die Regel gilt jetzt für beide gleich: **Als Karten stehen oben die Wahlen
 * der Kreisbehörde.** Beim Landkreis sind das Landrat und Kreistag, bei der
 * kreisfreien Stadt Oberbürgermeister und Rat. Ortsratswahlen (in einer
 * kreisfreien Stadt die Stadtbezirks- und Ortsräte) bekämen als Karten zu viel
 * Platz und stehen darunter als Liste. Gemeinden gibt es weiterhin nur da, wo
 * es welche gibt.
 */
import type { Behoerde } from "../data/behoerden.ts";
import type { Kreis } from "../data/kreise.ts";
import type { Termin } from "../data/termine.ts";
import {
	type ErgebnisZeile,
	type Fortschritt,
	type WahlEintragZeile,
	ergebnis,
	fortschritt,
	wahleintraege,
} from "./abfragen.ts";
import { istKreiswahl } from "./wahltyp.ts";

export type UebersichtKarte = {
	eintrag: WahlEintragZeile;
	ergebnis?: ErgebnisZeile;
};

export type TerminUebersichtModell = {
	/** Die Wahlleitung des Kreises; bei einer kreisfreien Stadt die Stadt selbst. */
	kreisBehoerde: Behoerde;
	/** Wahlen der Kreisbehörde, als Karten mit Balken */
	karten: UebersichtKarte[];
	/** Ortsratswahlen der Kreisbehörde – nur kreisfreie Städte haben welche */
	ortsraete: WahlEintragZeile[];
	/** Gemeinden mit Wahlen bei diesem Termin (leer bei einer kreisfreien Stadt) */
	gemeinden: Fortschritt[];
	/** Kein Gemeindeverband unter der Kreisbehörde – eine kreisfreie Stadt */
	kreisfrei: boolean;
	/** Liegt für diesen Termin überhaupt etwas vor? */
	daten: boolean;
	/** Schnellmeldungen über das ganze Kreisgebiet */
	gesamt: { anz: number; max: number };
};

export const terminUebersicht = (
	termin: Termin,
	kreis: Kreis,
): TerminUebersichtModell => {
	// Die Datenbank hält alle Kreise; hier zählt nur dieser. Deshalb überall die
	// Behörden dieses Kreises mitgeben statt der globalen Liste.
	const kreisBehoerde =
		kreis.behoerden.find((b) => b.ags === kreis.ags) ?? kreis.behoerden[0];
	const gemeindeBehoerden = kreis.behoerden.filter((b) => b.ags !== kreis.ags);
	const kreisfrei = gemeindeBehoerden.length === 0;

	const eigene = kreisBehoerde
		? wahleintraege(termin.id, kreisBehoerde.ags)
		: [];
	const karten: UebersichtKarte[] = eigene
		.filter((w) => w.typ !== "ortsrat")
		.map((eintrag) => ({
			eintrag,
			ergebnis: kreisBehoerde
				? ergebnis(
						termin.id,
						kreisBehoerde.ags,
						eintrag.wahlId,
						eintrag.gebietId,
					)
				: undefined,
		}));
	const ortsraete = eigene.filter((w) => w.typ === "ortsrat");

	// Der kreisweite Fortschritt zählt die Schnellmeldungen der Gemeinden; hat
	// der Kreis keine, zählt er die der Stadt selbst.
	const gemessen = fortschritt(
		termin.id,
		kreisfrei && kreisBehoerde ? [kreisBehoerde] : gemeindeBehoerden,
	);
	const gemeinden = kreisfrei
		? []
		: gemessen.filter((g) => g.wahlen.length > 0);

	return {
		kreisBehoerde,
		karten,
		ortsraete,
		gemeinden,
		kreisfrei,
		daten: eigene.length > 0 || gemeinden.length > 0,
		gesamt: {
			anz: gemessen.reduce((a, g) => a + g.anz, 0),
			max: gemessen.reduce((a, g) => a + g.max, 0),
		},
	};
};

/**
 * Zweite Zeile eines Gemeinde-Eintrags: welche Wahlen dort anstehen.
 *
 * Kreisweite Wahlen bleiben außen vor – sie stehen in jeder Gemeinde und
 * unterscheiden keine von der anderen. Alles andere wird genannt, auch wenn
 * die Wahlart nicht erkannt wurde: Die Stadt Alfeld stand sonst als einzige
 * Kommune ohne Untertitel da, weil ihre einzige Wahl als „sonstige“
 * eingestuft ist.
 */
export const gemeindeUntertitel = (wahlen: WahlEintragZeile[]): string => {
	const teile = wahlen
		.filter((w) => w.typ !== "ortsrat" && !istKreiswahl(w.typ))
		.map((w) => w.kurz);
	const ortsraete = wahlen.filter((w) => w.typ === "ortsrat").length;
	if (ortsraete === 1) teile.push("1 Ortsrat");
	else if (ortsraete > 1) teile.push(`${ortsraete} Ortsräte`);
	return teile.join(" · ");
};
