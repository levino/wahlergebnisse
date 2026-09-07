/**
 * Die Landkreise und kreisfreien Städte, die diese App abdeckt – alle 45 in
 * Niedersachsen.
 *
 * Jeder Kreis bündelt seine Behörden (Wahlleitungen). Die Wurzel der
 * votemanager-Präsentation gehört zur **Behörde**, nicht zum Kreis: Bei
 * einigen Kreisen liegt die Kreisbehörde auf einem anderen Host als ihre
 * Gemeinden. Siehe docs/ausbau-niedersachsen.md.
 *
 * Die Daten stehen in kreis-katalog.ts und werden von
 * scripts/kreise-erzeugen.ts aus scripts/quellen/ erzeugt. Hier stehen nur
 * Typ und Zugriffe – die bleiben von Hand gepflegt.
 */
import type { Behoerde } from "./behoerden.ts";
import { KATALOG } from "./kreis-katalog.ts";

/**
 * Fundstelle, an der eine Wahlleitung ihre Ergebnisse selbst veröffentlicht.
 *
 * Sie steht dort, wo diese Seiten nichts anzubieten haben. Denn „wir haben
 * keine Zahlen“ und „es gibt keine Zahlen“ sind zweierlei, und der Unterschied
 * ist genau das, was jemanden interessiert, der hier landet: Er sucht ein
 * Ergebnis, nicht eine Auskunft über unsere Datenlage. Jeder Eintrag ist von
 * Hand geprüft (Abruf mit Status und Größe, siehe scripts/quellen/erhebung.md)
 * – geraten wird hier nichts, ein toter Link wäre schlimmer als keiner.
 */
export type AmtlicheQuelle = {
	/** Vollständige Adresse, auf die verlinkt wird */
	url: string;
	/** Was dort zu sehen ist: „Kreistagswahl 2021“ */
	titel: string;
};

export type Kreis = {
	/** URL-Segment, stabil */
	slug: string;
	/** 8-stelliger Schlüssel der Kreisbehörde */
	ags: string;
	/** wie votemanager ihn schreibt: "Landkreis Hildesheim" */
	name: string;
	/** für Menüs und Titel: "Hildesheim" */
	kurz: string;
	/**
	 * Wurzel der Präsentation, gegen die Termin- und Datenpfade aufgelöst
	 * werden – mit Schrägstrich am Ende. Gilt als Vorgabe für die Behörden
	 * dieses Kreises, die keine eigene mitbringen.
	 */
	basis: string;
	behoerden: Behoerde[];
	/**
	 * Lag beim letzten Abzug eine nutzbare Präsentation für den kommenden
	 * Termin vor?
	 *
	 * Das ist die **Ausgangsannahme**, nicht die Wahrheit: Sieben Kreise hatten
	 * den 13.09.2026 am 07.09.2026 nicht (abrufbar) angelegt, und mindestens
	 * die Region Hannover schaltet erkennbar erst kurz vor der Wahl frei. Was
	 * wirklich gilt, stellt der Poller fest – er sieht bei diesen Kreisen von
	 * Zeit zu Zeit nach und führt sie normal weiter, sobald Daten kommen
	 * (`src/lib/poll.ts`). Die Anzeige richtet sich danach, ob Daten in der
	 * Datenbank stehen.
	 */
	vorhanden: boolean;
	/** Warum nicht vorhanden – kurzer Satz aus der Erhebung, für die Anzeige. */
	hinweis?: string;
	/**
	 * Wo die Wahlleitung ihre Ergebnisse selbst veröffentlicht.
	 *
	 * Gepflegt für jeden Kreis, dessen Zahlen hier (noch) nicht ankommen. Dass
	 * unsere Anbindung fehlt, heißt nicht, dass es keine Ergebnisse gibt – wer
	 * die Kreisseite aufruft, soll von hier aus dorthin kommen, wo sie stehen.
	 */
	quellen?: AmtlicheQuelle[];
	/**
	 * Archivtermine, die für diesen Kreis vorliegen (Termin-Ids).
	 *
	 * Erhoben aus dem Termin-Index der Kreisbehörde (siehe
	 * scripts/quellen/nds-termine-2021.json): Ein Archivtermin, den eine
	 * Wahlleitung nie geführt hat, soll gar nicht erst angeboten werden. Der
	 * laufende Termin steht hier nicht – der gilt landesweit.
	 */
	archive?: string[];
};

export const KREISE: Kreis[] = KATALOG;

/** Der Kreis, mit dem angefangen wurde – Rückfall, wenn nichts gemerkt ist. */
export const STANDARD_KREIS = "hildesheim";

export const kreisBySlug = (slug: string): Kreis | undefined =>
	KREISE.find((k) => k.slug === slug);

export const kreisByAgs = (ags: string): Kreis | undefined =>
	KREISE.find((k) => k.ags === ags);

/**
 * Kreis einer Behörde. Die ersten fünf Stellen des Gebietsschlüssels sind der
 * Kreis – bei achtstelligen Gemeindeschlüsseln wie bei den neunstelligen der
 * Samtgemeinden.
 */
export const kreisVonBehoerde = (ags: string): Kreis | undefined =>
	kreisByAgs(`${ags.slice(0, 5)}000`);

/**
 * Kreise, bei denen der Poller überhaupt nachsieht.
 *
 * Das sind alle, zu denen eine Wahlleitung mit votemanager-Präsentation
 * bekannt ist – auch solche, die den kommenden Termin noch nicht ausliefern.
 * Denn genau die muss er im Blick behalten: Wer erst am Wahlabend freischaltet
 * (Region Hannover), soll von selbst auftauchen und keinen Eingriff brauchen.
 * Was ein Lauf bei so einem Kreis kostet, entscheidet der Poller: voller
 * Durchgang, wenn Daten da sind, sonst eine einzelne Nachschau.
 *
 * Draußen bleiben nur die Kreise ohne jede Adresse – Celle und Uelzen
 * benutzen keinen votemanager und stehen in keinem der 3 174 Einträge des
 * bundesweiten Verzeichnisses. Für sie gibt es auf diesem Weg nie Daten, und
 * eine Anfrage ins Leere wäre keine Nachschau, sondern Lärm.
 */
export const VORHANDENE_KREISE: Kreis[] = KREISE.filter(
	(k) => k.behoerden.length > 0,
);

/**
 * Kreise, für die es auf diesem Weg dauerhaft keine Daten gibt: keine
 * Wahlleitung im votemanager-Verzeichnis, also auch nichts zum Nachsehen.
 */
export const KREISE_OHNE_QUELLE: Kreis[] = KREISE.filter(
	(k) => k.behoerden.length === 0,
);

/** Alle Behörden aller Kreise – 416 Stück. */
export const ALLE_BEHOERDEN: Behoerde[] = KREISE.flatMap((k) => k.behoerden);

/**
 * Wurzel der Präsentation einer Behörde, mit Schrägstrich am Ende.
 *
 * `VOTEMANAGER_BASIS` biegt sie global um – darauf beruhen die Tests und die
 * Vorschau-Umgebungen, die gegen einen Mock laufen statt gegen 45 fremde
 * Server.
 */
export const wurzelVon = (kreis: Kreis, behoerde?: Behoerde): string => {
	const umleitung = process.env.VOTEMANAGER_BASIS;
	if (umleitung) return umleitung.endsWith("/") ? umleitung : `${umleitung}/`;
	return behoerde?.wurzel ?? kreis.basis;
};
