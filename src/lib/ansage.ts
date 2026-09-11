/**
 * Der Ansagedienst – was Browser, Server und Poller gemeinsam wissen.
 *
 * Läuft auch im Browser: keine Node-Bausteine, keine Geheimnisse. Alles, was
 * einen Schlüssel oder die Platte braucht, steht in `ansage-datei.ts`.
 */

import type { FolienStand } from "./meldungen.ts";

export const ANSAGE_PFAD = "/api/ansage";
export const ANSAGE_STAND_PFAD = "/api/ansage/stand";
export const MODERATION_PFAD = "/api/ansage/moderation";

/**
 * Das Sprachmodell. `tts-1` nimmt keine Vortragsanweisung entgegen – nur
 * dieses hier, und daran hängt der Ton.
 *
 * Der Alias und nicht ein Tagesstand: Der Betreiber hat die Stimmen gegen
 * genau diesen Alias durchgehört, und was er gehört hat, soll am 13. September
 * spielen. Der Preis ist derselbe. Die eine Gefahr dabei: Zieht der Alias
 * mitten am Abend auf einen neuen Stand, klingen die schon erzeugten Aufnahmen
 * anders als die neuen – der Dateiname enthält ja nur diesen Namen. Dann hilft
 * `ANSAGE_MODELL` mit einem festen Tagesstand (z. B.
 * `gpt-4o-mini-tts-2025-12-15`); das erzeugt neue Dateien statt einer Mischung.
 */
export const ANSAGE_MODELL = "gpt-4o-mini-tts";

/**
 * Das Textmodell der Moderation (siehe `formuliere` in `ansage-datei.ts`).
 * Das günstigste, das die Aufgabe trägt – ausdrückliche Vorgabe des
 * Betreibers.
 */
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

export type DienstStimme = { id: string; beschreibung: string };

/**
 * Die Stimmen des `voice`-Enums der API-Referenz. Eigens deutsche gibt es
 * nicht – dieselben Stimmen sprechen jede Sprache, und welche im Saal die
 * richtige ist, entscheidet der Probeknopf und nicht der Schreibtisch.
 */
export const DIENST_STIMMEN: DienstStimme[] = [
	{ id: "sage", beschreibung: "Sage – gewählt" },
	{ id: "ballad", beschreibung: "Ballad – weich, getragen" },
	{ id: "coral", beschreibung: "Coral – hell, freundlich" },
	{ id: "verse", beschreibung: "Verse – lebendig, betont" },
	{ id: "onyx", beschreibung: "Onyx – tief, ruhig" },
	{ id: "marin", beschreibung: "Marin – natürlich" },
	{ id: "cedar", beschreibung: "Cedar – ruhig" },
	{ id: "alloy", beschreibung: "Alloy – sachlich" },
	{ id: "ash", beschreibung: "Ash – warm, erzählend" },
	{ id: "echo", beschreibung: "Echo – nüchtern" },
	{ id: "shimmer", beschreibung: "Shimmer – hell, weich" },
];

/**
 * Die Vorgabestimme: durchgehört und gewählt, nicht empfohlen.
 *
 * Der Betreiber hat ballad, coral, sage, verse und onyx im selben Satz gehört
 * und `sage` genommen. Vorgabe, nicht Vorschrift – über die Anlage im Saal
 * trägt eine Stimme womöglich anders als über Kopfhörer, und dann wird in der
 * Leiste umgeschaltet. Der Server darf sie über `ANSAGE_STIMME` überschreiben.
 */
export const ANSAGE_STIMME_STANDARD = "sage";

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

export type AnsageStand = {
	verfuegbar: boolean;
	modell: string;
	/** Die Stimme, die ohne eigene Wahl spricht – der Server sagt, welche. */
	standard: string;
	stimmen: DienstStimme[];
};

/**
 * Was der Browser dem Server über einen Schub mitteilt.
 *
 * Nur das, was allein er weiß: welche Folien sich geändert haben, wie sie
 * **vorher** aussahen, was die Leinwand dazu einblendet und welche Partei der
 * Zuschauer eingestellt hat. Alles Übrige – Parteien, Sitze, Wahlbeteiligung,
 * Bewerber, Listen, Datenstand – holt der Server aus derselben Quelle, aus der
 * er die Seite gerendert hat; über die Leitung ginge es ein zweites Mal.
 */
export type ModerationWahl = {
	marke: string;
	vorher: FolienStand;
	meldungen: string[];
};

export type ModerationAnfrage = {
	kreis: string;
	termin: string;
	behoerde: string;
	/** Anzeigename der eingestellten Partei, sofern eine gewählt ist. */
	partei?: string;
	/** Die feste Formulierung: Vorlage für das Modell und Rückfall zugleich. */
	fest: string;
	wahlen: ModerationWahl[];
};

export type ModerationAntwort = { satz: string; quelle: "modell" | "fest" };

/**
 * So lange darf das Formulieren dauern, dann spricht die feste Ansage.
 *
 * Danach kommt die Sprachausgabe noch obendrauf. Mehr als drei Sekunden
 * Vorlauf hört sich im Saal nicht mehr nach einer Reaktion auf die neue Zahl
 * an, sondern nach einem Nachtrag.
 */
export const MODERATION_FRIST_MS = 3000;

/**
 * Den Satz holen, den die Stimme sprechen soll. Antwortet der Server nicht,
 * nicht rechtzeitig oder unbrauchbar, bleibt es bei der festen Formulierung –
 * still wird es nie deswegen.
 */
export const moderiere = async (
	anfrage: ModerationAnfrage,
	fristMs = MODERATION_FRIST_MS,
): Promise<string> => {
	try {
		const antwort = await fetch(MODERATION_PFAD, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(anfrage),
			signal: AbortSignal.timeout(fristMs),
		});
		if (!antwort.ok) return anfrage.fest;
		const daten = (await antwort.json()) as Partial<ModerationAntwort>;
		return typeof daten.satz === "string" && daten.satz.trim()
			? daten.satz
			: anfrage.fest;
	} catch {
		return anfrage.fest;
	}
};
