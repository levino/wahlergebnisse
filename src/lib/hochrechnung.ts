/** Eine Auszähleinheit – in der Regel ein Wahlbezirk, auf Kreisebene eine Gemeinde. */
export type Einheit = {
	/** Stabiler Schlüssel innerhalb der Wahl (Gebiets-ID) */
	id: string;
	/** Name, über den die Einheit der Vorwahl zugeordnet wird */
	name: string;
	briefwahl: boolean;
	anteil: number;
	/** Bisher ausgezählte Stimmen dieser Einheit, je Partei */
	stimmen: Map<string, number>;
	/** Stimmen derselben Einheit bei der Vergleichswahl, je Partei */
	vorwert?: Map<string, number>;
};

export type Hochrechnung = {
	/** Hochgerechnete Gesamtstimmen je Partei */
	stimmen: Map<string, number>;
	abdeckung: number;
	/** Einheiten mit Vorwert, aus denen die Veränderung geschätzt wurde */
	basis: number;
	/** Wurde die Briefwahl getrennt gerechnet, weil eigene Werte vorlagen? */
	briefwahlGetrennt: boolean;
};

const summe = (m: Map<string, number>): number => {
	let s = 0;
	for (const v of m.values()) s += Math.max(0, v);
	return s;
};

const addiere = (
	ziel: Map<string, number>,
	quelle: Map<string, number>,
	faktor = 1,
): void => {
	for (const [k, v] of quelle) ziel.set(k, (ziel.get(k) ?? 0) + v * faktor);
};

export const istBriefwahl = (name: string): boolean => /\bbrief/i.test(name);

export const bezirksNummer = (name: string): string | undefined => {
	const m = name.trim().match(/^0*(\d+)\b/);
	return m ? m[1] : undefined;
};

const normName = (name: string): string =>
	name
		.toLowerCase()
		.replace(/ä/g, "a")
		.replace(/ö/g, "o")
		.replace(/ü/g, "u")
		.replace(/ß/g, "s")
		.replace(/[^a-z0-9]/g, "");

export const ordneZu = <
	T extends { name: string; briefwahl: boolean },
	V extends { name: string; stimmen: Map<string, number> },
>(
	aktuell: T[],
	vorher: V[],
): { treffer: Map<T, Map<string, number>>; uebrig: V[] } => {
	const offen = vorher.map((v) => ({
		eintrag: v,
		brief: istBriefwahl(v.name),
		norm: normName(v.name),
		nr: bezirksNummer(v.name),
		vergeben: false,
	}));
	const treffer = new Map<T, Map<string, number>>();
	for (const a of aktuell) {
		const n = normName(a.name);
		const v = offen.find((o) => !o.vergeben && o.norm === n);
		if (v) {
			v.vergeben = true;
			treffer.set(a, v.eintrag.stimmen);
		}
	}
	for (const a of aktuell) {
		if (treffer.has(a)) continue;
		const nr = bezirksNummer(a.name);
		if (!nr) continue;
		const v = offen.find(
			(o) => !o.vergeben && o.nr === nr && o.brief === a.briefwahl,
		);
		if (v) {
			v.vergeben = true;
			treffer.set(a, v.eintrag.stimmen);
		}
	}
	return {
		treffer,
		uebrig: offen.filter((o) => !o.vergeben).map((o) => o.eintrag),
	};
};

type Gruppe = {
	/** Vorwahl-Stimmen der ausgezählten Anteile, je Partei */
	basisVor: Map<string, number>;
	/** aktuelle Stimmen der ausgezählten Anteile, je Partei */
	basisJetzt: Map<string, number>;
	/** Vorwahl-Stimmen der fehlenden Anteile, je Partei */
	fehlendVor: Map<string, number>;
	/** fehlende Anteile ohne Vorwert, in Einheiten gezählt */
	fehlendOhneVorwert: number;
	/** Einheiten mit Vorwert (für die Mittelgröße) */
	mitVorwert: number;
	/** Vorwahl-Stimmen aller Einheiten mit Vorwert */
	vorGesamt: number;
};

const leereGruppe = (): Gruppe => ({
	basisVor: new Map(),
	basisJetzt: new Map(),
	fehlendVor: new Map(),
	fehlendOhneVorwert: 0,
	mitVorwert: 0,
	vorGesamt: 0,
});

const FAKTOR_MAX = 4;

type Veraenderung =
	| { art: "faktor"; wert: number }
	| { art: "neu"; anteil: number };

const faktoren = (g: Gruppe): Map<string, Veraenderung> | undefined => {
	const vor = summe(g.basisVor);
	const jetzt = summe(g.basisJetzt);
	if (vor <= 0 || jetzt <= 0) return undefined;
	const f = new Map<string, Veraenderung>();
	const keys = new Set([...g.basisVor.keys(), ...g.basisJetzt.keys()]);
	for (const k of keys) {
		const a = (g.basisVor.get(k) ?? 0) / vor;
		const b = (g.basisJetzt.get(k) ?? 0) / jetzt;
		f.set(
			k,
			a > 0
				? { art: "faktor", wert: Math.min(FAKTOR_MAX, b / a) }
				: { art: "neu", anteil: b },
		);
	}
	return f;
};

const MINDEST_VERGLEICHBARKEIT = 0.5;

export const MINDEST_ANTEIL = 0.2;
export const MINDEST_MELDUNGEN = 5;

/** Wie viele Schnellmeldungen es braucht, bevor Sitze gezeigt werden. */
export const schwelle = (erwartet: number): number =>
	erwartet <= 0
		? 0
		: Math.min(
				erwartet,
				Math.max(MINDEST_MELDUNGEN, Math.ceil(erwartet * MINDEST_ANTEIL)),
			);

export type Unsicherheit = "hoch" | "mittel" | "niedrig";

export const MITTEL_AB = 0.37;
export const NIEDRIG_AB = 0.67;

export const unsicherheit = (
	anz: number,
	erwartet: number,
	fortschreibung: boolean,
): Unsicherheit => {
	if (fortschreibung || erwartet <= 0) return "hoch";
	const anteil = anz / erwartet;
	if (anteil >= NIEDRIG_AB) return "niedrig";
	return anteil >= MITTEL_AB ? "mittel" : "hoch";
};

export const rechneHoch = (einheiten: Einheit[]): Hochrechnung | undefined => {
	const gruppen: Record<"urne" | "brief", Gruppe> = {
		urne: leereGruppe(),
		brief: leereGruppe(),
	};
	const gezaehlt = new Map<string, number>();
	for (const e of einheiten) {
		const g = gruppen[e.briefwahl ? "brief" : "urne"];
		addiere(gezaehlt, e.stimmen);
		const anteil = Math.min(1, Math.max(0, e.anteil));
		if (!e.vorwert || summe(e.vorwert) <= 0) {
			g.fehlendOhneVorwert += 1 - anteil;
			continue;
		}
		g.mitVorwert += 1;
		g.vorGesamt += summe(e.vorwert);
		addiere(g.basisVor, e.vorwert, anteil);
		addiere(g.fehlendVor, e.vorwert, 1 - anteil);
		if (anteil > 0) addiere(g.basisJetzt, e.stimmen);
	}

	const vorGesamt = gruppen.urne.vorGesamt + gruppen.brief.vorGesamt;
	const basisVor = summe(gruppen.urne.basisVor) + summe(gruppen.brief.basisVor);
	if (vorGesamt <= 0) return undefined;
	const abdeckung = basisVor / vorGesamt;

	const fUrne = faktoren(gruppen.urne);
	const fBrief = faktoren(gruppen.brief);
	if (!fUrne && !fBrief) return undefined;

	const jetztGesamt =
		summe(gruppen.urne.basisJetzt) + summe(gruppen.brief.basisJetzt);
	let bekannt = 0;
	for (const art of ["urne", "brief"] as const)
		for (const [k, v] of gruppen[art].basisJetzt)
			if (
				(gruppen.urne.basisVor.get(k) ?? 0) +
					(gruppen.brief.basisVor.get(k) ?? 0) +
					(gruppen.urne.fehlendVor.get(k) ?? 0) +
					(gruppen.brief.fehlendVor.get(k) ?? 0) >
				0
			)
				bekannt += v;
	if (jetztGesamt <= 0 || bekannt / jetztGesamt < MINDEST_VERGLEICHBARKEIT)
		return undefined;

	const stimmen = new Map(gezaehlt);
	for (const art of ["urne", "brief"] as const) {
		const g = gruppen[art];
		const eigen = art === "urne" ? fUrne : fBrief;
		const f = eigen ?? (art === "urne" ? fBrief : fUrne);
		if (!f) continue;
		const vor = summe(g.basisVor);
		const jetzt = summe(g.basisJetzt);
		const fremd = art === "urne" ? gruppen.brief : gruppen.urne;
		const beteiligung =
			vor > 0 && jetzt > 0
				? jetzt / vor
				: summe(fremd.basisVor) > 0
					? summe(fremd.basisJetzt) / summe(fremd.basisVor)
					: 1;
		const mittel = g.mitVorwert > 0 ? g.vorGesamt / g.mitVorwert : 0;
		const fehlendVorSumme = summe(g.fehlendVor) + g.fehlendOhneVorwert * mittel;
		if (fehlendVorSumme <= 0) continue;
		const roh = new Map<string, number>();
		for (const [k, v] of f) {
			const gewicht =
				v.art === "faktor"
					? (g.fehlendVor.get(k) ?? 0) * v.wert
					: fehlendVorSumme * v.anteil;
			if (gewicht > 0) roh.set(k, gewicht);
		}
		const rohSumme = summe(roh);
		if (rohSumme <= 0) continue;
		const erwartet = fehlendVorSumme * beteiligung;
		for (const [k, w] of roh)
			stimmen.set(k, (stimmen.get(k) ?? 0) + (w / rohSumme) * erwartet);
	}

	return {
		stimmen,
		abdeckung,
		basis: gruppen.urne.mitVorwert + gruppen.brief.mitVorwert,
		briefwahlGetrennt: Boolean(fUrne && fBrief),
	};
};
