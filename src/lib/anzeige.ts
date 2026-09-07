/**
 * Kleine Regeln, nach denen die Anzeige aus vielen Zahlen wenige macht.
 *
 * Die Wahlpräsentation liefert die Parteien in **Stimmzettel-Reihenfolge**,
 * nicht nach Anteil: Auf dem Stimmzettel steht oben, wer bei der letzten Wahl
 * im selben Gebiet vorn lag, und wer neu antritt, hängt hinten dran. Wer davon
 * die ersten sechs zeigt, zeigt deshalb nicht die stärksten sechs – bei der
 * Ratswahl der Stadt Hildesheim 2021 fiel so die AfD aus der Übersichtskarte
 * heraus, während DIE LINKE. mit weniger Stimmen darin stand.
 *
 * Deshalb: Wo gekürzt wird, wird vorher sortiert. Ungekürzte Listen (die
 * vollständigen Balken einer Wahlseite) behalten die amtliche Reihenfolge.
 */

/** Nach Anteil absteigend; bei Gleichstand entscheiden die Stimmen. */
export const nachStaerke = <T extends { prozent: number; stimmen?: number }>(
	a: T,
	b: T,
): number => b.prozent - a.prozent || (b.stimmen ?? 0) - (a.stimmen ?? 0);

/**
 * Die `anzahl` stärksten Einträge – sortiert, damit eine gekürzte Liste die
 * größten Werte enthält und nicht die zuerst genannten.
 */
export const staerkste = <T extends { prozent: number; stimmen?: number }>(
	eintraege: readonly T[],
	anzahl: number,
): T[] => [...eintraege].sort(nachStaerke).slice(0, anzahl);
