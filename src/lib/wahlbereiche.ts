import { GEMEINDEN } from "../data/behoerden.ts";
import type { Behoerde } from "../data/behoerden.ts";
import { kreisVonBehoerde } from "../data/kreise.ts";
import { kreisgliederung } from "../data/wahlgliederungen.ts";
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

/** Römische Zahl, einzelner Buchstabe oder ein- bis zweistellige Nummer. */
const KUERZEL = "[IVXLCDM]+|[A-Za-z]|\\d{1,2}";

/** „01“ und „1“ meinen denselben Bereich, „b“ und „B“ auch. */
const normKuerzel = (s: string): string =>
	/^\d+$/.test(s) ? String(Number(s)) : s.toUpperCase();

/**
 * Das Kürzel eines Wahlbereichs aus seiner Bezeichnung.
 *
 * Die Wahlleitungen schreiben es sehr verschieden: „B“, „II“,
 * „Wahlbereich 01“, „WB IV - Stadt Bassum …“, „11 - Nordost“. Erkannt wird
 * nur, was eindeutig als Kürzel dasteht – ein Buchstabe mitten in einem Wort
 * ist keines. Lieber nichts als das Falsche: ohne Kürzel bleibt der Bereich
 * unbeschriftet, mit einem falschen bekäme er fremde Gemeinden.
 */
export const wahlbereichKuerzel = (
	bezeichnung: string | undefined,
): string | undefined => {
	const s = (bezeichnung ?? "").trim();
	const treffer =
		s.match(new RegExp(`^(${KUERZEL})$`)) ??
		s.match(
			new RegExp(`(?:wahlbereich|wahlkreis|\\bwb\\.?)\\s+(${KUERZEL})\\b`, "i"),
		) ??
		s.match(/^([IVXLCDM]+|\d{1,2})(?=[\s\-–:.,])/) ??
		s.match(/(?:^|\s)([A-Za-z])\s*$/);
	return treffer ? normKuerzel(treffer[1]) : undefined;
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
		.replace(/^(gemeinde|stadt|flecken|samtgemeinde|sg\.?)\s+/, "")
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
 * Die Wahlräume dieses Termins – und nur dieses Termins. Kreiswahlbereiche
 * werden vor jeder Wahl neu zugeschnitten; eine Zuordnung aus einem anderen
 * Termin wäre erfunden.
 */
export const kreiswahlbereichsRaeume = (
	terminId: string,
	/** Ohne Angabe die des Standard-Kreises. */
	gemeinden: readonly Behoerde[] = GEMEINDEN,
): Array<{ behoerde: Behoerde; raeume: Wahlraum[] }> =>
	gemeinden.map((behoerde) => ({
		behoerde,
		raeume: wahlraeume(terminId, behoerde.ags),
	}));

/**
 * Zuordnung aus dem Verzeichnis der Wahlgliederung. Sie trägt den Termin, für
 * den sie erhoben wurde; ein anderer Termin steht dort nie.
 */
export const wahlbereicheAusVerzeichnis = (
	terminId: string,
	kreisSlug: string,
): Wahlbereiche => {
	const zuordnung = kreisgliederung(terminId, kreisSlug)?.wahlbereichszuordnung;
	if (zuordnung?.stand !== "belegt") return new Map();
	return new Map(
		zuordnung.eintraege.map((e) => [
			normKuerzel(e.kuerzel),
			[...e.gemeinden].sort((a, b) => a.localeCompare(b, "de")),
		]),
	);
};

/**
 * Fertige Zuordnung Buchstabe → Gemeinden für einen Termin. Führen die
 * Wahlräume die Spalte Kreiswahlbereich, gilt sie; sonst das Verzeichnis.
 */
export const kreisWahlbereiche = (
	terminId: string,
	gemeinden?: readonly Behoerde[],
): Wahlbereiche => {
	const ausRaeumen = wahlbereicheAusRaeumen(
		kreiswahlbereichsRaeume(terminId, gemeinden),
	);
	if (ausRaeumen.size) return ausRaeumen;
	const kreisSlug = kreisVonBehoerde(
		(gemeinden ?? GEMEINDEN)[0]?.ags ?? "",
	)?.slug;
	return kreisSlug
		? wahlbereicheAusVerzeichnis(terminId, kreisSlug)
		: new Map();
};

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
