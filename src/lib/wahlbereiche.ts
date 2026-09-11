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

const RUECKFALL_TERMIN = "2021";

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

export const kreiswahlbereichsRaeume = (
	terminId: string,
	/** Ohne Angabe die des Standard-Kreises. */
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
