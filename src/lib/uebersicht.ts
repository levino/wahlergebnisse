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

export const gemeindeUntertitel = (wahlen: WahlEintragZeile[]): string => {
	const teile = wahlen
		.filter((w) => w.typ !== "ortsrat" && !istKreiswahl(w.typ))
		.map((w) => w.kurz);
	const ortsraete = wahlen.filter((w) => w.typ === "ortsrat").length;
	if (ortsraete === 1) teile.push("1 Ortsrat");
	else if (ortsraete > 1) teile.push(`${ortsraete} Ortsräte`);
	return teile.join(" · ");
};
