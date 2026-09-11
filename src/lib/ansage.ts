import type { FolienStand } from "./meldungen.ts";

export const ANSAGE_PFAD = "/api/ansage";
export const ANSAGE_STAND_PFAD = "/api/ansage/stand";
export const MODERATION_PFAD = "/api/ansage/moderation";

/**
 * Der Riegel gilt für die Prozesslaufzeit. Ein Browser-Test, der ihn fallen
 * lässt, nähme jedem späteren Test den Ansagedienst weg; dieser Pfad setzt ihn
 * zurück. Er entsteht nur unter `WAHLEN_TESTGRIFF=1`.
 */
export const RIEGEL_PFAD = "/api/ansage/riegel-zuruecksetzen";

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

/** So lange wartet der Browser auf die Aufnahme; danach bleibt es still. */
export const ANSAGE_FRIST_MS = 10_000;

export const ANSAGE_HOECHSTLAENGE = 600;

export const ansageUrl = (text: string, behoerde: string): string =>
	`${ANSAGE_PFAD}?behoerde=${encodeURIComponent(behoerde)}&text=${encodeURIComponent(text)}`;

export const ansageStandUrl = (behoerde: string): string =>
	`${ANSAGE_STAND_PFAD}?behoerde=${encodeURIComponent(behoerde)}`;

export type AnsageStand = {
	verfuegbar: boolean;
	modell: string;
};

export type ModerationWahl = {
	marke: string;
	vorher: FolienStand;
	meldungen: string[];
};

export type ModerationAnfrage = {
	kreis: string;
	termin: string;
	behoerde: string;
	partei?: string;
	/** Der Einblender: Vorlage für das Modell und Rückfall zugleich. */
	fest: string;
	wahlen: ModerationWahl[];
};

export type ModerationAntwort = {
	satz: string;
	quelle: "modell" | "fest";
	/** Warum es die feste Formulierung wurde – nur dann gesetzt. */
	grund?: string;
};

/** So lange darf das Formulieren dauern, dann spricht die feste Ansage. */
export const MODERATION_FRIST_MS = 6000;

export const moderiere = async (
	anfrage: ModerationAnfrage,
	fristMs = MODERATION_FRIST_MS,
): Promise<ModerationAntwort> => {
	const fest = (grund: string): ModerationAntwort => ({
		satz: anfrage.fest,
		quelle: "fest",
		grund,
	});
	try {
		const antwort = await fetch(MODERATION_PFAD, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(anfrage),
			signal: AbortSignal.timeout(fristMs),
		});
		if (!antwort.ok) return fest(`Moderation antwortet HTTP ${antwort.status}`);
		const daten = (await antwort.json()) as Partial<ModerationAntwort>;
		if (typeof daten.satz !== "string" || !daten.satz.trim())
			return fest(daten.grund ?? "Moderation schickt keinen Satz");
		return {
			satz: daten.satz,
			quelle: daten.quelle ?? "modell",
			grund: daten.grund,
		};
	} catch (e) {
		const fehler = e as Error;
		return fest(
			fehler.name === "TimeoutError"
				? `Moderation nicht binnen ${fristMs} ms`
				: `Moderation nicht erreichbar: ${fehler.message}`,
		);
	}
};
