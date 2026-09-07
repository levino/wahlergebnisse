/**
 * Versionsstempel je Bereich – die Grundlage des Nachladens am Wahlabend.
 *
 * **Warum nicht ein Stempel für alles.** Der Poller setzt
 * `termin:<id>:version`, sobald *irgendwo* etwas Neues gespeichert wurde. Am
 * Wahlabend laufen in 38 Kreisen gleichzeitig Schnellmeldungen ein, dieser
 * eine Stempel ändert sich also praktisch bei jedem Lauf. Eine offene Seite,
 * die daran hängt, lädt sich dann alle 30 Sekunden neu – auch wenn im
 * angesehenen Kreis gar nichts passiert ist. Bei 45 Kreisen ist das etwa die
 * 45-fache Last, und die Seiten sind mehrere hundert Kilobyte groß.
 *
 * **Wie fein.** Zwei Stufen, mehr nicht:
 *
 * - *Kreis* – für die Seiten, die den ganzen Kreis zeigen (`/<kreis>/` und
 *   `/<kreis>/<termin>/`): Fortschritt aller Gemeinden, kreisweiter Ticker,
 *   Kreiswahlen. Sie hängen an jeder Behörde des Kreises.
 * - *Behörde* – sobald der Pfad eine Behörde nennt
 *   (`/<kreis>/<termin>/<behörde>/…`). Diese Seiten lesen ausschließlich die
 *   Daten dieser einen Wahlleitung (siehe `lib/seite.ts`): Wahlübersicht,
 *   Wahlseite, Untergebiete, Ticker der Behörde. Wer die Ergebnisse einer
 *   Gemeinde ansieht, wird damit von Meldungen am anderen Kreisende nicht
 *   mehr behelligt.
 *
 * Noch feiner (je Wahl oder je Gebiet) wäre kaum etwas gewonnen: In einer
 * Gemeinde meldet ein Wahlbezirk Rat, Kreistag und Ortsrat in einem Zug, die
 * Wahlen ändern sich also ohnehin zusammen. Dafür würde es teuer und
 * fehleranfällig – jede Seite zeigt neben „ihrer“ Zahl auch Nachbargebiete,
 * Wahl-Reiter und den Fortschritt der ganzen Wahl. Eine zu feine Einstufung
 * ließe die Seite stehen, obwohl daneben schon neue Zahlen stehen; das wäre
 * schlimmer als ein Neuladen zu viel.
 *
 * **Woraus der Stempel kommt.** Nicht aus einer weiteren Meta-Zeile des
 * Pollers, sondern aus den Daten selbst: dem jüngsten `aktualisiert` der
 * Ergebnisse und Übersichten dieses Bereichs. Beide Spalten werden nur
 * geschrieben, wenn sich der *Inhalt* geändert hat (`speichereErgebnis`
 * vergleicht den Hash, `holeDatei` meldet `geaendert` nur bei neuem Hash) –
 * ein neu ausgeliefertes, aber inhaltsgleiches votemanager-File löst also
 * kein Nachladen aus. Die Tabelle `wahlen` bleibt bewusst außen vor: deren
 * `aktualisiert` schreibt der Poller bei jedem Lauf neu, auch ohne Änderung.
 */
import type { Kreis } from "../data/kreise.ts";
import { kreisBySlug } from "../data/kreise.ts";
import { type Db, metaGet, oeffneDb } from "./db.ts";
import { behoerdeImKreis } from "./pfade.ts";

/** Ausschnitt der Daten, an dem eine Seite hängt. Leer = alles (ganzes Land). */
export type Bereich = {
	kreis?: Kreis;
	/** Schlüssel der Behörde (AGS), nicht ihr Slug – Slugs wiederholen sich. */
	behoerde?: string;
};

/**
 * Bereich eines Seitenpfads: `/<kreis>/<termin>/<behörde>/…`.
 *
 * Unbekannte Segmente werden verworfen statt geraten – eine Adresse mit
 * Tippfehler landet ohnehin in der 404, und ein erfundener Bereich hätte
 * einen Stempel, der sich nie ändert.
 */
export const bereichAusPfad = (pfad: string): Bereich => {
	const segmente = pfad.split("/");
	const kreis = kreisBySlug(segmente[1] ?? "");
	if (!kreis) return {};
	const behoerde = segmente[3]
		? behoerdeImKreis(kreis, segmente[3])
		: undefined;
	return { kreis, behoerde: behoerde?.ags };
};

/**
 * Bereich aus den Abfrageparametern des Versions-Endpunkts. Unbekanntes fällt
 * auf die nächstgröbere Stufe zurück: lieber einmal zu viel nachladen als eine
 * Seite, die stehen bleibt.
 */
export const bereichAusParametern = (p: URLSearchParams): Bereich => {
	const kreis = kreisBySlug(p.get("kreis") ?? "");
	if (!kreis) return {};
	const wert = p.get("behoerde") ?? "";
	return {
		kreis,
		behoerde: wert ? behoerdeImKreis(kreis, wert)?.ags : undefined,
	};
};

/** Kurzname des Bereichs für die Antwort – damit sichtbar ist, was gilt. */
export const bereichsName = (b: Bereich): string =>
	b.kreis ? [b.kreis.slug, b.behoerde].filter(Boolean).join("/") : "alle";

/** Die Behörden, deren Daten in diesen Bereich fallen. */
const behoerdenVon = (b: Bereich): string[] | undefined =>
	b.behoerde
		? [b.behoerde]
		: b.kreis
			? b.kreis.behoerden.map((x) => x.ags)
			: undefined;

const ausDb = (db: Db, termin: string, agsListe: string[]): string => {
	const platzhalter = agsListe.map(() => "?").join(",");
	const zeile = db
		.prepare(
			`SELECT MAX(stand) AS stand FROM (
			   SELECT MAX(aktualisiert) AS stand FROM ergebnisse WHERE termin = ? AND behoerde IN (${platzhalter})
			   UNION ALL
			   SELECT MAX(aktualisiert) AS stand FROM uebersichten WHERE termin = ? AND behoerde IN (${platzhalter})
			 )`,
		)
		.get(termin, ...agsListe, termin, ...agsListe) as
		| { stand: string | null }
		| undefined;
	return zeile?.stand ?? "";
};

/**
 * Gemerkte Bereichsstempel, geschlüsselt auf den globalen Stempel des Termins.
 *
 * Am Wahlabend fragt jede offene Seite alle 30 Sekunden nach; das `MAX` über
 * die Ergebnisse eines Kreises jedes Mal neu zu rechnen wäre Arbeit für
 * nichts. Der globale Stempel ändert sich genau dann, wenn ein Lauf
 * *irgendwo* etwas gespeichert hat – hat er sich nicht geändert, kann sich
 * auch kein Bereichsstempel geändert haben. Der Zwischenspeicher ist damit
 * nicht bloß eine Näherung, sondern exakt: gerechnet wird höchstens einmal je
 * Bereich und Poller-Lauf.
 */
const gemerkt = new Map<string, { global: string; version: string }>();

/** Nur für Tests: den Zwischenspeicher leeren. */
export const vergissBereichsversionen = (): void => gemerkt.clear();

/**
 * Versionsstempel des Bereichs. Ändert sich genau dann, wenn in diesem
 * Ausschnitt neue Zahlen stehen. Leer, solange dort nichts vorliegt – dann
 * gibt es auch nichts nachzuladen.
 */
export const bereichsVersion = (terminId: string, bereich: Bereich): string => {
	const db = oeffneDb();
	const global = metaGet(db, `termin:${terminId}:version`) ?? "";
	const agsListe = behoerdenVon(bereich);
	if (!agsListe) return global;
	const schluessel = `${terminId}|${agsListe.join(",")}`;
	const alt = gemerkt.get(schluessel);
	if (alt && alt.global === global) return alt.version;
	const version = ausDb(db, terminId, agsListe);
	gemerkt.set(schluessel, { global, version });
	return version;
};
