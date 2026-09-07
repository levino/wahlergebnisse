/**
 * Sitzverteilung nach Hare-Niemeyer – das Verfahren des niedersächsischen
 * Kommunalwahlrechts (§ 37 NKWG) für Kreistag, Räte und Ortsräte.
 *
 * Gebraucht für die Hochrechnung am Wahlabend: votemanager liefert die
 * Sitzverteilung erst mit dem vollständigen Ergebnis; solange Wahlbezirke
 * fehlen, rechnen wir sie aus dem bisherigen Stimmenverhältnis selbst.
 *
 * Nicht abgebildet: Losentscheid bei gleichen Bruchteilen (wird durch die
 * Reihenfolge der Eingabe entschieden) und die Verteilung auf Wahlbereiche.
 */
export type Stimmen = { key: string; stimmen: number };
export type Sitze = { key: string; sitze: number };

export const hareNiemeyer = (
	stimmen: Stimmen[],
	gesamtSitze: number,
): Sitze[] => {
	const total = stimmen.reduce((a, s) => a + Math.max(0, s.stimmen), 0);
	if (total <= 0 || gesamtSitze <= 0)
		return stimmen.map((s) => ({ key: s.key, sitze: 0 }));
	const quoten = stimmen.map((s) => {
		const q = (Math.max(0, s.stimmen) * gesamtSitze) / total;
		return { key: s.key, ganz: Math.floor(q), rest: q - Math.floor(q) };
	});
	let vergeben = quoten.reduce((a, q) => a + q.ganz, 0);
	const sitze = new Map(quoten.map((q) => [q.key, q.ganz]));
	const nachRest = [...quoten].sort((a, b) => b.rest - a.rest);
	for (const q of nachRest) {
		if (vergeben >= gesamtSitze) break;
		sitze.set(q.key, (sitze.get(q.key) ?? 0) + 1);
		vergeben++;
	}
	return stimmen.map((s) => ({ key: s.key, sitze: sitze.get(s.key) ?? 0 }));
};

/** Mehrheit: mehr als die Hälfte der Sitze. */
export const mehrheit = (gesamtSitze: number): number =>
	Math.floor(gesamtSitze / 2) + 1;

/**
 * Sitzzahlen der Gremien laut NKomVG (§ 46 Kreistag, § 46 Rat) als Vorgabe
 * für die Hochrechnung, wenn votemanager noch keine Sitzverteilung liefert.
 * Schlüssel: Termin, Behörde (AGS), Wahltyp. Quelle: Ergebnisse 2021
 * ("Es wurden N Sitze vergeben") – die Einwohnerzahlen und damit die
 * Ratsgrößen haben sich seither nicht klassenverändernd bewegt.
 */
export const SITZE_2021: Record<string, number> = {
	"03254000/kreistag": 64,
	"03254026/rat": 30,
};
