import {
	type Ergebnis,
	type Partei,
	type Uebersicht,
	type UebersichtZeile,
	parteiKey,
} from "./votemanager.ts";

/** Die Restspalte der Wahlpräsentation. */
const SONSTIGE = /^sonstige/i;

const KENNZAHL = /^gültig/i;

const runde = (n: number): number => Math.round(n * 100) / 100;

/** Wahlvorschläge absteigend nach Anteil; bei Gleichstand nach Stimmen. */
export const nachStaerke = (parteien: Partei[]): Partei[] =>
	[...parteien].sort((a, b) => b.prozent - a.prozent || b.stimmen - a.stimmen);

const zeileMitSpalten = (
	zeile: UebersichtZeile,
	spalten: Array<{ kurz: string }>,
	gezeigt: Set<string>,
	ergebnis: Ergebnis | undefined,
): UebersichtZeile => {
	const ausQuelle = new Map(zeile.werte.map((w) => [w.kurz, w]));
	if (!ergebnis || ergebnis.parteien.length === 0)
		return {
			...zeile,
			werte: spalten.map((s) => ausQuelle.get(s.kurz) ?? { kurz: s.kurz }),
		};
	const nachKey = new Map(ergebnis.parteien.map((p) => [p.key, p]));
	const rest = ergebnis.parteien.filter((p) => !gezeigt.has(p.key));
	return {
		...zeile,
		werte: spalten.map((s) => {
			if (SONSTIGE.test(s.kurz))
				return {
					kurz: s.kurz,
					absolut: rest.reduce((a, p) => a + p.stimmen, 0),
					prozent: runde(rest.reduce((a, p) => a + p.prozent, 0)),
				};
			const p = nachKey.get(parteiKey(s.kurz));
			if (p) return { kurz: s.kurz, absolut: p.stimmen, prozent: p.prozent };
			return ausQuelle.get(s.kurz) ?? { kurz: s.kurz };
		}),
	};
};

export const gebietstabelle = (
	uebersicht: Uebersicht,
	parteien: Partei[],
	ergebnisFuer: (zeile: UebersichtZeile) => Ergebnis | undefined,
): Uebersicht => {
	const eigene = new Set(parteien.map((p) => p.key));
	const kennzahlen = uebersicht.spalten.filter(
		(s) => KENNZAHL.test(s.kurz) && !eigene.has(parteiKey(s.kurz)),
	);
	const hatSonstige = uebersicht.spalten.some((s) => SONSTIGE.test(s.kurz));
	const plaetze =
		uebersicht.spalten.length - kennzahlen.length - (hatSonstige ? 1 : 0);
	if (plaetze < 1 || parteien.length === 0) return uebersicht;
	const gezeigt = nachStaerke(parteien).slice(0, plaetze);
	const spalten = [
		...kennzahlen,
		...gezeigt.map((p) => ({ kurz: p.kurz, lang: p.lang })),
		...(parteien.length > gezeigt.length ? [{ kurz: "Sonstige" }] : []),
	];
	const gezeigteKeys = new Set(gezeigt.map((p) => p.key));
	return {
		...uebersicht,
		spalten,
		zeilen: uebersicht.zeilen.map((z) =>
			zeileMitSpalten(z, spalten, gezeigteKeys, ergebnisFuer(z)),
		),
	};
};
