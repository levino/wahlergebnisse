export const ANSAGE_MODELL = "gpt-4o-mini-tts";

export const MODERATION_MODELL = "gpt-4o-mini";

export const ANSAGE_ANWEISUNG = [
	"Sprache: Deutsch, hochdeutsch, ohne englischen Einschlag.",
	"Rolle: jemand, der am Wahlabend im Saal das Mikrofon hat.",
	"Tonfall: freundlich, wach, deutlich, mit ruhiger Freude – gute Nachricht,",
	"keine Sensation. Tempo mittel, kurze Pause vor der Nachricht.",
	"Ortsnamen und Zahlen klar betonen, Parteikürzel buchstabieren.",
	"Nicht: Nachrichtensprecher-Singsang, Pathos, Jubel, Werbestimme.",
].join(" ");

/** Zählt in den Dateinamen hinein: neue Anweisung, neue Aufnahmen. */
export const ANSAGE_FASSUNG = 1;

/** Eine Stimme für alle Zuschauer – nur der Server entscheidet sie. */
export const ANSAGE_STIMME_STANDARD = "sage";

/** So lang darf ein Satz höchstens sein, der gesprochen wird. */
export const ANSAGE_HOECHSTLAENGE = 2000;
