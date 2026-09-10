/**
 * Kreiswahlbereiche sprechend benennen.
 *
 * votemanager führt die Kreiswahlbereiche nur als Buchstaben – "A", "B", …,
 * bei 2026 immerhin als "Wahlbereich A". Wer die Einteilung des Landkreises
 * nicht auswendig kennt, kann damit nichts anfangen. Deshalb hängen wir überall
 * die beteiligten Gemeinden an: "Wahlbereich B (Elze, Nordstemmen)".
 *
 * Welche Gemeinde zu welchem Bereich gehört, liefert die Quelle nirgends als
 * eigene Liste; es ergibt sich aus den Wahlräumen, die je Wahlraum den
 * Buchstaben seines Kreiswahlbereichs tragen. Zwei Fälle sind dabei kein
 * Sonderfall, sondern der Normalfall: mehrere kleine Gemeinden teilen sich
 * einen Bereich, und die Stadt Hildesheim ist auf mehrere Bereiche aufgeteilt –
 * sie gehört also zu jedem davon.
 *
 * Der Kern ist bewusst frei von Datenbank und Behördenwissen: Er bekommt
 * fertige Paare (Gemeinde, Buchstabe) und ist damit ohne Netz und ohne SQLite
 * prüfbar. Nur die beiden Funktionen am Ende holen diese Paare aus der
 * Datenbank.
 */
import { GEMEINDEN } from "../data/behoerden.ts";
import type { Behoerde } from "../data/behoerden.ts";
import { wahlraeume } from "./abfragen.ts";
import type { Wahlraum } from "./votemanager.ts";

/** Ein Wahlraum, reduziert auf das, was die Zuordnung braucht. */
export type WahlbereichsPaar = {
	/** Anzeigename der Gemeinde, z. B. "Nordstemmen" */
	gemeinde: string;
	/** Buchstabe des Kreiswahlbereichs; fehlt, wenn der Termin die Spalte nicht führt */
	kreiswahlbereich?: string;
};

/** Buchstabe → Gemeinden, alphabetisch und ohne Dubletten. */
export type Wahlbereiche = ReadonlyMap<string, readonly string[]>;

/**
 * Termin, dessen Wahlräume einspringen, solange ein neuer Termin die Spalte
 * "Kreiswahlbereich" noch nicht liefert. Der Zuschnitt ändert sich zwischen
 * zwei Kommunalwahlen allenfalls in Details – eine Zuordnung von vorgestern ist
 * allemal besser als gar keine.
 */
const RUECKFALL_TERMIN = "2021";

/**
 * Buchstabe aus einer Gebietsbezeichnung: "B", "Wahlbereich B",
 * "Kreiswahlbereich B" und auch "Wahlbereich F Nord" ergeben alle "F"
 * bzw. "B". Was sich nicht deuten lässt, ergibt `undefined` – dann bleibt
 * die Bezeichnung unangetastet, statt geraten zu werden.
 */
export const wahlbereichKuerzel = (
	bezeichnung: string | undefined,
): string | undefined => {
	const s = (bezeichnung ?? "").trim();
	const treffer =
		s.match(/^([A-Za-z])$/) ??
		s.match(/wahlbereich\s+([A-Za-z])\b/i) ??
		s.match(/\b([A-Za-z])\s*$/);
	return treffer ? treffer[1].toUpperCase() : undefined;
};

/** Baut die Zuordnung aus den Wahlraum-Paaren auf. */
export const sammleWahlbereiche = (
	paare: Iterable<WahlbereichsPaar>,
): Wahlbereiche => {
	const gesammelt = new Map<string, Set<string>>();
	for (const p of paare) {
		const kuerzel = wahlbereichKuerzel(p.kreiswahlbereich);
		const gemeinde = p.gemeinde.trim();
		if (!kuerzel || !gemeinde) continue;
		const menge = gesammelt.get(kuerzel) ?? new Set<string>();
		menge.add(gemeinde);
		gesammelt.set(kuerzel, menge);
	}
	return new Map(
		[...gesammelt].map(([kuerzel, menge]) => [
			kuerzel,
			[...menge].sort((a, b) => a.localeCompare(b, "de")),
		]),
	);
};

/** Gemeinden eines Kreiswahlbereichs; leer, wenn der Bereich unbekannt ist. */
export const gemeindenImWahlbereich = (
	kuerzel: string | undefined,
	wahlbereiche: Wahlbereiche,
): readonly string[] => {
	const k = wahlbereichKuerzel(kuerzel);
	return (k && wahlbereiche.get(k)) || [];
};

/**
 * Anzeigename zu einer Gebietsbezeichnung: "B" → "Wahlbereich B (Elze,
 * Nordstemmen)". Ist der Bereich unbekannt, bleibt es beim Buchstaben – lieber
 * knapp als falsch.
 */
/**
 * Umgekehrte Richtung: In welchem Wahlbereich liegt eine Gemeinde? Für den
 * Gebietsbaum, der die Gemeinden unter ihren Bereich hängt. Städte, die auf
 * mehrere Bereiche verteilt sind (Hildesheim), ergeben `undefined` – sie
 * stehen im Menü dann eigenständig.
 */
export const bereichVonGemeinde = (
	gemeinde: string,
	wahlbereiche: Wahlbereiche,
): string | undefined => {
	const gesucht = normGemeinde(gemeinde);
	const treffer: string[] = [];
	for (const [kuerzel, gemeinden] of wahlbereiche) {
		if (gemeinden.some((g) => normGemeinde(g) === gesucht))
			treffer.push(kuerzel);
	}
	return treffer.length === 1 ? treffer[0] : undefined;
};

const normGemeinde = (s: string): string =>
	s
		.toLowerCase()
		.replace(/^(gemeinde|stadt|flecken|samtgemeinde)\s+/, "")
		.replace(/\s*\(.*\)$/, "")
		.trim();

export const wahlbereichName = (
	bezeichnung: string,
	wahlbereiche: Wahlbereiche,
): string => {
	const kuerzel = wahlbereichKuerzel(bezeichnung);
	if (!kuerzel) return bezeichnung;
	const gemeinden = gemeindenImWahlbereich(kuerzel, wahlbereiche);
	return gemeinden.length
		? `Wahlbereich ${kuerzel} (${gemeinden.join(", ")})`
		: `Wahlbereich ${kuerzel}`;
};

/**
 * Wahlräume aller Gemeinden für einen Termin – mit Rückgriff auf
 * {@link RUECKFALL_TERMIN}, solange der eigene Termin die Spalte
 * "Kreiswahlbereich" nicht führt.
 *
 * Gibt die Wahlräume mit heraus (statt nur die fertige Zuordnung), weil die
 * Karte aus denselben Zeilen zusätzlich die Ortsteile der Stadt Hildesheim
 * braucht und sie dafür kein zweites Mal lesen soll.
 */
export const kreiswahlbereichsRaeume = (
	terminId: string,
	/**
	 * Die Gemeinden, deren Wahlräume gelesen werden. Ohne Angabe die des
	 * Standard-Kreises – das ist die Sicht, mit der große Teile der Anwendung
	 * noch arbeiten. Die Generalprobe spielt jeden betrachteten Kreis nach und
	 * muss deshalb sagen können, um welchen es geht: Sonst suchte sie die
	 * Gemeinden der Region Hannover unter den Hildesheimer und fände keine.
	 */
	gemeinden: readonly Behoerde[] = GEMEINDEN,
): Array<{ behoerde: Behoerde; raeume: Wahlraum[] }> => {
	const lesen = (id: string) =>
		gemeinden.map((behoerde) => ({
			behoerde,
			raeume: wahlraeume(id, behoerde.ags),
		}));
	const eigene = lesen(terminId);
	if (eigene.some((e) => e.raeume.some((r) => r.kreiswahlbereich)))
		return eigene;
	return terminId === RUECKFALL_TERMIN ? eigene : lesen(RUECKFALL_TERMIN);
};

/** Fertige Zuordnung Buchstabe → Gemeinden für einen Termin. */
export const kreisWahlbereiche = (
	terminId: string,
	gemeinden?: readonly Behoerde[],
): Wahlbereiche =>
	wahlbereicheAusRaeumen(kreiswahlbereichsRaeume(terminId, gemeinden));

/** Zuordnung aus bereits gelesenen Wahlräumen (siehe {@link kreiswahlbereichsRaeume}). */
export const wahlbereicheAusRaeumen = (
	raeume: Array<{ behoerde: Behoerde; raeume: Wahlraum[] }>,
): Wahlbereiche =>
	sammleWahlbereiche(
		raeume.flatMap(({ behoerde, raeume: rs }) =>
			rs.map((r) => ({
				gemeinde: behoerde.kurz,
				kreiswahlbereich: r.kreiswahlbereich,
			})),
		),
	);
