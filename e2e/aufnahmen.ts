/**
 * Die aufgezeichneten Antworten der Gegenstelle – Schlüssel, Ablage, Form.
 *
 * Aufzeichnen und Wiedergeben müssen denselben Schlüssel bilden, sonst findet
 * die Wiedergabe nichts und die Aufzeichnung wäre umsonst. Deshalb steht die
 * Bildung hier und nur hier.
 *
 * Der Schlüssel ist der **Inhalt der Anfrage**: Modell, Stimme beziehungsweise
 * Anweisung und der Text. Nicht die Reihenfolge des Laufs, nicht eine laufende
 * Nummer – dieselbe Anfrage bekommt dieselbe Antwort, egal wann und in welchem
 * Test sie gestellt wird.
 *
 * Der Zugangsschlüssel steht in keiner Aufnahme: Abgelegt wird nur, was im
 * Rumpf steht, und der trägt ihn nicht (er steht im `authorization`-Kopf).
 * `scripts/ansage-aufzeichnen.ts` prüft das trotzdem ausdrücklich nach, bevor
 * es etwas schreibt.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type Aufnahmeart = "stimme" | "moderation";

/** Die Anfrage, auf das reduziert, was die Antwort bestimmt. */
export type Anfragekern = {
	art: Aufnahmeart;
	modell: string;
	/** Nur bei der Stimme gesetzt. */
	stimme?: string;
	anweisung: string;
	text: string;
};

export type Aufnahme = Anfragekern & {
	schluessel: string;
	/** Woher die Aufnahme stammt – lesbar, damit niemand raten muss. */
	herkunft: string;
	/** Bei der Moderation: die JSON-Antwort, so wie sie kam. */
	antwort?: unknown;
	/** Bei der Stimme: der Name der MP3-Datei daneben. */
	datei?: string;
};

export const AUFNAHMEN_PFAD = join(
	dirname(fileURLToPath(import.meta.url)),
	"aufnahmen",
);

export const STIMME_PFAD = "/audio/speech";
export const MODERATION_PFAD = "/chat/completions";

export const aufnahmeSchluessel = (kern: Anfragekern): string =>
	createHash("sha256")
		.update(
			[
				kern.art,
				kern.modell,
				kern.stimme ?? "",
				kern.anweisung,
				kern.text,
			].join(" "),
		)
		.digest("hex")
		.slice(0, 24);

const zeichen = (wert: unknown): string =>
	typeof wert === "string" ? wert : "";

/**
 * Was an der Gegenstelle ankommt, auf den Anfragekern bringen.
 *
 * `undefined` heißt: kein Pfad, den diese Anwendung je aufruft. Die Wiedergabe
 * beantwortet so etwas nicht, sie scheitert daran.
 */
export const kernAus = (
	pfad: string,
	rumpf: unknown,
): Anfragekern | undefined => {
	const r = (rumpf ?? {}) as Record<string, unknown>;
	if (pfad.endsWith(STIMME_PFAD))
		return {
			art: "stimme",
			modell: zeichen(r.model),
			stimme: zeichen(r.voice),
			anweisung: zeichen(r.instructions),
			text: zeichen(r.input),
		};
	if (pfad.endsWith(MODERATION_PFAD)) {
		const nachrichten = Array.isArray(r.messages)
			? (r.messages as Array<Record<string, unknown>>)
			: [];
		return {
			art: "moderation",
			modell: zeichen(r.model),
			anweisung: zeichen(nachrichten.find((n) => n.role === "system")?.content),
			text: zeichen(nachrichten.find((n) => n.role === "user")?.content),
		};
	}
	return undefined;
};

export const lies = (verzeichnis = AUFNAHMEN_PFAD): Map<string, Aufnahme> => {
	const raus = new Map<string, Aufnahme>();
	if (!existsSync(verzeichnis)) return raus;
	for (const name of readdirSync(verzeichnis).sort()) {
		if (!name.endsWith(".json")) continue;
		const a = JSON.parse(
			readFileSync(join(verzeichnis, name), "utf8"),
		) as Aufnahme;
		raus.set(a.schluessel, a);
	}
	return raus;
};

/**
 * Der eine Fall, den kein echtes Modell auf Zuruf liefert.
 *
 * „Antwortet das Modell unbrauchbar, kommt die feste Formulierung" ist der
 * wichtigste Riegel des Abends – aber ein Modell, das sich an die Anweisung
 * hält, erfindet keine Zahl. Diese eine Antwort wird deshalb schon beim
 * Mitschnitt ausgetauscht: Form und Weg bleiben echt, nur der Satz darin ist
 * der Fall, den wir prüfen wollen. Die Zahl steht in keinem Kontext dieses
 * Abends – genau darum geht es.
 */
export const VERFAELSCHUNGEN: Array<{ erkennung: string; satz: string }> = [
	{
		erkennung: "Ortsratswahl Klein Escherde",
		satz: "Da kommen neue Zahlen rein – in Klein Escherde kommen die Grünen jetzt auf 63,4 Prozent.",
	},
];

/**
 * Die Antwort, wie sie abgelegt wird – gegebenenfalls mit ausgetauschtem Satz.
 *
 * Der Vermerk in `herkunft` sagt jedem, der die Datei öffnet, dass hier von
 * Hand nachgeholfen wurde.
 */
export const verfaelschungFuer = (
	kern: Anfragekern,
): { satz: string } | undefined =>
	kern.art === "moderation"
		? VERFAELSCHUNGEN.find((v) => kern.text.includes(v.erkennung))
		: undefined;

/** Der Satz, den die Moderation zu dieser Anfrage zurückgibt. */
export const moderationsSatz = (a: Aufnahme | undefined): string => {
	const daten = a?.antwort as
		| { choices?: Array<{ message?: { content?: string } }> }
		| undefined;
	return daten?.choices?.[0]?.message?.content?.trim() ?? "";
};
