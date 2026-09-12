import type { Ergebnis, Partei } from "./votemanager.ts";

export type Bewerber = {
	name: string;
	/** Stimmen dieser Person – null, wo die Wahlleitung sie nicht nennt */
	stimmen: number | null;
	/** Anteil an allen gültigen Stimmen des Gebiets */
	prozent: number | null;
	/** Anteil an den Kandidatenstimmen der eigenen Partei (Angabe der Wahlleitung) */
	prozentInPartei: number | null;
	/** Platz auf dem Wahlvorschlag, sofern eindeutig bestimmbar */
	platz: number | null;
	gewaehlt: boolean;
};

export type BewerberListe = {
	parteiKey: string;
	kurz: string;
	lang: string;
	farbe: string;
	listenstimmen: number | null;
	kandidatenstimmen: number | null;
	bewerber: Bewerber[];
};

/** Namensvergleich unabhängig von Reihenfolge, Titeln und Satzzeichen. */
export const normName = (s: string): string =>
	s
		.toLowerCase()
		.replace(/\b(dr|prof|med|rer|nat|h\.c)\b\.?/g, "")
		.replace(/[^a-zäöüß]+/g, " ")
		.trim()
		.split(" ")
		.filter(Boolean)
		.sort()
		.join(" ");

/** Schlüssel für die Platz-Zuordnung: Partei und normalisierter Name. */
export const platzSchluessel = (parteiKey: string, name: string): string =>
	`${parteiKey}|${normName(name)}`;

const bewerberEiner = (
	p: Partei,
	gueltigeStimmen: number | undefined,
	gewaehlt: Set<string>,
	plaetze: Map<string, number>,
): Bewerber[] =>
	(p.kandidaten ?? []).map((k) => ({
		name: k.name,
		stimmen: k.stimmen ?? null,
		prozent:
			gueltigeStimmen && gueltigeStimmen > 0 && k.stimmen !== undefined
				? Math.round((k.stimmen / gueltigeStimmen) * 10000) / 100
				: null,
		prozentInPartei: k.prozentInPartei ?? null,
		platz: plaetze.get(platzSchluessel(p.key, k.name)) ?? k.platz ?? null,
		gewaehlt: gewaehlt.has(normName(k.name)),
	}));

export const bewerberListen = (
	ergebnis: Ergebnis,
	plaetze: Map<string, number> = new Map(),
): BewerberListe[] => {
	const gewaehlt = new Set(
		(ergebnis.sitze?.gewaehlte ?? []).map((g) => normName(g.name)),
	);
	return ergebnis.parteien
		.filter((p) => p.kandidaten && p.kandidaten.length > 0)
		.map((p) => ({
			parteiKey: p.key,
			kurz: p.kurz,
			lang: p.lang,
			farbe: p.farbe,
			listenstimmen: p.listenstimmen ?? null,
			kandidatenstimmen: p.kandidatenstimmen ?? null,
			bewerber: bewerberEiner(
				p,
				ergebnis.kennzahlen.stimmen,
				gewaehlt,
				plaetze,
			),
		}));
};
