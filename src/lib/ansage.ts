/**
 * Der Ansagedienst – was Browser, Server und Poller gemeinsam wissen.
 *
 * Läuft auch im Browser: keine Node-Bausteine, keine Geheimnisse. Alles, was
 * einen Schlüssel oder die Platte braucht, steht in `ansage-datei.ts`.
 */

export const ANSAGE_PFAD = "/api/ansage";
export const ANSAGE_STAND_PFAD = "/api/ansage/stand";

/**
 * Auf den Tagesstand festgenagelt: `tts-1` nimmt keine Vortragsanweisung
 * entgegen, und ein Alias kann sich unter der Hand ändern. Was durchgehört
 * wurde, soll am 13. September so klingen.
 */
export const ANSAGE_MODELL = "gpt-4o-mini-tts-2025-12-15";

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

export type DienstStimme = { id: string; beschreibung: string };

/**
 * Die Stimmen des `voice`-Enums der API-Referenz. Eigens deutsche gibt es
 * nicht – dieselben Stimmen sprechen jede Sprache, und welche im Saal die
 * richtige ist, entscheidet der Probeknopf und nicht der Schreibtisch.
 */
export const DIENST_STIMMEN: DienstStimme[] = [
	{ id: "marin", beschreibung: "Marin – empfohlen, natürlich" },
	{ id: "cedar", beschreibung: "Cedar – empfohlen, ruhig" },
	{ id: "ballad", beschreibung: "Ballad – weich, getragen" },
	{ id: "coral", beschreibung: "Coral – hell, freundlich" },
	{ id: "sage", beschreibung: "Sage – ruhig, sachlich" },
	{ id: "verse", beschreibung: "Verse – lebendig, betont" },
	{ id: "alloy", beschreibung: "Alloy – sachlich" },
	{ id: "ash", beschreibung: "Ash – warm, erzählend" },
	{ id: "echo", beschreibung: "Echo – nüchtern" },
	{ id: "shimmer", beschreibung: "Shimmer – hell, weich" },
];

export const ANSAGE_STIMME_STANDARD = "marin";

export const istDienstStimme = (id: string): boolean =>
	DIENST_STIMMEN.some((s) => s.id === id);

/**
 * So lange wartet der Browser, dann spricht er selbst. Im Regelfall liegt die
 * Datei längst da; die Frist deckt den Ausnahmefall, in dem erst erzeugt wird
 * (gemessenes 95.-Perzentil des Dienstes: knapp vier Sekunden).
 */
export const ANSAGE_FRIST_MS = 2500;

export const ANSAGE_HOECHSTLAENGE = 240;

export const ansageUrl = (
	text: string,
	stimme: string,
	behoerde: string,
): string =>
	`${ANSAGE_PFAD}?stimme=${encodeURIComponent(stimme)}&behoerde=${encodeURIComponent(behoerde)}&text=${encodeURIComponent(text)}`;

export const ansageStandUrl = (behoerde: string): string =>
	`${ANSAGE_STAND_PFAD}?behoerde=${encodeURIComponent(behoerde)}`;

/** Der Anbieter verlangt, den Zuhörern zu sagen, dass die Stimme erzeugt ist. */
export const KI_HINWEIS = "Ansage: KI-erzeugte Stimme";

export type AnsageStand = {
	verfuegbar: boolean;
	modell: string;
	stimmen: DienstStimme[];
};
