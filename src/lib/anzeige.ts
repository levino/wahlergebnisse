/** Nach Anteil absteigend; bei Gleichstand entscheiden die Stimmen. */
export const nachStaerke = <T extends { prozent: number; stimmen?: number }>(
	a: T,
	b: T,
): number => b.prozent - a.prozent || (b.stimmen ?? 0) - (a.stimmen ?? 0);

export const staerkste = <T extends { prozent: number; stimmen?: number }>(
	eintraege: readonly T[],
	anzahl: number,
): T[] => [...eintraege].sort(nachStaerke).slice(0, anzahl);
