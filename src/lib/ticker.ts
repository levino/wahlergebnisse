/**
 * Was ein Ticker-Eintrag anzeigt und wohin er führt.
 *
 * Jeder Eintrag berichtet von genau einem Gebiet (`gebiet_id` der Tabelle
 * `ereignisse`) – also führt er auch dorthin und nicht bloß zur Wahlleitung.
 * Wo die Wahlleitung ihre Wahlräume veröffentlicht, steht statt der
 * Gebietsbezeichnung der Name des Wahllokals.
 *
 * Alle Einträge einer Seite werden in einem Zug aufgelöst: zwei Abfragen je
 * Seite, keine je Eintrag.
 */
import { behoerdeByAgs } from "../data/behoerden.ts";
import { type Ereignis, wahlAdressen, wahllokale } from "./abfragen.ts";
import { behoerdePfad, wahlPfad } from "./pfade.ts";

export type TickerEintrag = {
	ereignis: Ereignis;
	/** Seite des gemeldeten Gebiets; sonst die nächstbeste vorhandene Seite. */
	href: string;
	/** Wahllokal, sonst das gemeldete Gebiet, sonst die Wahlleitung. */
	name: string;
	/** Die Meldung ohne den vorangestellten Gebietsnamen. */
	text: string;
	behoerdeHref?: string;
};

const GEBIETS_ID = /^ebene_-?\d+_id_\d+$/;

export const tickerEintraege = (
	kreis: string,
	terminId: string,
	ereignisse: Ereignis[],
): TickerEintrag[] => {
	const behoerden = [...new Set(ereignisse.map((e) => e.behoerde))];
	const adressen = wahlAdressen(terminId, behoerden);
	const lokale = wahllokale(terminId, behoerden);
	return ereignisse.map((e) => {
		const b = behoerdeByAgs(e.behoerde);
		const behoerdeHref = b ? behoerdePfad(kreis, terminId, b.slug) : undefined;
		const wahl = adressen.get(`${e.behoerde}:${e.wahlId}`);
		const gebiet =
			wahl && e.gebietId !== wahl.gebietId && GEBIETS_ID.test(e.gebietId)
				? e.gebietId
				: undefined;
		const trenner = e.text.indexOf(": ");
		const gebietName = trenner > 0 ? e.text.slice(0, trenner) : "";
		return {
			ereignis: e,
			href:
				b && wahl
					? wahlPfad(kreis, terminId, b.slug, wahl.slug, gebiet)
					: (behoerdeHref ?? "#"),
			name:
				lokale.get(`${e.behoerde}:${e.gebietId}`) ??
				(gebietName || e.behoerdeName),
			text: gebietName ? e.text.slice(trenner + 2) : e.text,
			behoerdeHref,
		};
	});
};
