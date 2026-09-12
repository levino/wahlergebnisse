/** Was die Standanzeige zeigt. */
export type Zustand = "verbindet" | "verbunden" | "unterbrochen";

export const NACHSICHT_MS = 10_000;

export const PULS_AUSBLEIBEN_MS = 60_000;

export const ABSTAENDE_MS = [500, 1_000, 2_000, 3_000, 5_000];

/** Abstand zum nächsten Versuch nach `n` vergeblichen. */
export const abstandFuer = (versuche: number): number =>
	ABSTAENDE_MS[Math.min(Math.max(0, versuche), ABSTAENDE_MS.length - 1)];

export const ABFRAGE_MS = 10_000;

export const NACHHOL_ABSTAENDE_MS = [500, 1_000, 2_000, 5_000, 10_000];

export const nachholAbstandFuer = (versuche: number): number =>
	NACHHOL_ABSTAENDE_MS[
		Math.min(Math.max(0, versuche), NACHHOL_ABSTAENDE_MS.length - 1)
	];

export type Lage = {
	/** `EventSource.readyState`: 0 verbindet, 1 offen, 2 geschlossen. */
	readyState: number;
	/** Wann zuletzt etwas ankam (ms), 0 wenn noch nie. */
	letzterKontakt: number;
	/** Wann der laufende Versuch begonnen hat (ms). */
	verbindetSeit: number;
	/** Seit wann keine Leitung steht (ms): erster Aufbau oder Abriss. */
	ohneLeitungSeit: number;
	jetzt: number;
};

export const zustandVon = (l: Lage): Zustand => {
	const still = l.jetzt - l.letzterKontakt;
	if (l.readyState === 1)
		return still > PULS_AUSBLEIBEN_MS ? "unterbrochen" : "verbunden";
	const pulsBleibtAus = l.letzterKontakt > 0 && still > PULS_AUSBLEIBEN_MS;
	return pulsBleibtAus || l.jetzt - l.ohneLeitungSeit > NACHSICHT_MS
		? "unterbrochen"
		: "verbindet";
};

export const brauchtNeueLeitung = (l: Lage): boolean =>
	l.readyState === 2 ||
	(l.readyState === 1 && l.jetzt - l.letzterKontakt > PULS_AUSBLEIBEN_MS) ||
	(l.readyState === 0 && l.jetzt - l.verbindetSeit > NACHSICHT_MS);
