import type { Klangart } from "./klang.ts";
import { formatProzent } from "./zahlen.ts";

export type ParteiStand = {
	/** Normalisierter Kurzname (siehe `parteiKey`). */
	key: string;
	/** Platz, nach Stimmenanteil – 1 ist die Spitze. */
	platz: number;
	prozent: number;
	/** Sitze, sofern die Folie eine Sitzverteilung zeigt. */
	sitze?: number;
};

/** Der Stand einer Folie, wie ihn das Server-HTML mitbringt. */
export type FolienStand = {
	ort: string;
	wahl: string;
	anz: number;
	max: number;
	/** Zwischenstand, Hochrechnung, Endergebnis. */
	art: string;
	/** Wer vorn liegt – Partei oder Bewerber. */
	spitze: string;
	/** Alle Parteien der Folie – für die eigene Partei (siehe `eigeneMeldungen`). */
	parteien?: ParteiStand[];
	/** Zuletzt eingegangene Gebiete, neuestes zuerst. */
	eingegangen?: string[];
};

export type MeldungsArt =
	| "jubel"
	| "abstieg"
	| "fertig"
	| "endergebnis"
	| "hochrechnung"
	| "spitze"
	| "stand";

export type Meldung = {
	/** Die Folie, von der die Meldung handelt (siehe `WahlFolie.marke`). */
	marke: string;
	ort: string;
	wahl: string;
	art: MeldungsArt;
	text: string;
	anz?: number;
	max?: number;
	/** Überschrittene Zehnerschwelle in Prozent – nur bei großen Wahlen. */
	prozent?: number;
	anlass?: string;
};

export const MELDUNGS_RANG: MeldungsArt[] = [
	"jubel",
	"abstieg",
	"fertig",
	"endergebnis",
	"hochrechnung",
	"spitze",
	"stand",
];

/** So viele Einblender auf einmal – darüber liest sie niemand mehr. */
export const MELDUNGEN_HOECHSTENS = 4;

const fertig = (s: FolienStand): boolean => s.max > 0 && s.anz >= s.max;

export const satz = (m: Meldung): string => {
	const wo = m.wahl ? `${m.wahl} ${m.ort}` : m.ort;
	switch (m.art) {
		case "jubel":
		case "abstieg":
			return `${m.text} – ${wo}.`;
		case "fertig":
			return `${wo}: fertig ausgezählt!`;
		case "endergebnis":
			return `${wo}: das Endergebnis steht.`;
		case "hochrechnung":
			return `${wo}: erste Hochrechnung.`;
		default:
			return `${wo}: ${m.text}`;
	}
};

const EINER = [
	"null",
	"eins",
	"zwei",
	"drei",
	"vier",
	"fünf",
	"sechs",
	"sieben",
	"acht",
	"neun",
	"zehn",
	"elf",
	"zwölf",
	"dreizehn",
	"vierzehn",
	"fünfzehn",
	"sechzehn",
	"siebzehn",
	"achtzehn",
	"neunzehn",
];

const ZEHNER = [
	"",
	"",
	"zwanzig",
	"dreißig",
	"vierzig",
	"fünfzig",
	"sechzig",
	"siebzig",
	"achtzig",
	"neunzig",
];

export const zahlwort = (n: number): string => {
	if (!Number.isFinite(n) || n < 0 || n !== Math.floor(n) || n > 9999)
		return String(n);
	if (n < 20) return EINER[n];
	if (n < 100) {
		const z = Math.floor(n / 10);
		const e = n % 10;
		return e === 0 ? ZEHNER[z] : `${e === 1 ? "ein" : EINER[e]}und${ZEHNER[z]}`;
	}
	const teile = (wert: number, stelle: number, wort: string): string => {
		const vorn = Math.floor(wert / stelle);
		const rest = wert % stelle;
		const kopf = `${vorn === 1 ? "ein" : zahlwort(vorn)}${wort}`;
		return rest === 0 ? kopf : `${kopf}${zahlwort(rest)}`;
	};
	return n < 1000 ? teile(n, 100, "hundert") : teile(n, 1000, "tausend");
};

const gerundet = (text: string): string =>
	text
		.replace(/(\d+),(\d+)\s*%/g, (_, ganz) => `${ganz} Prozent`)
		.replace(/(\d+)\s*%/g, "$1 Prozent")
		.replace(/\b\d{1,2}\b/g, (n) => zahlwort(Number(n)));

export const sprechsatz = (m: Meldung): string => {
	const wo = m.wahl ? `${m.wahl} ${m.ort}` : m.ort;
	switch (m.art) {
		case "jubel":
		case "abstieg":
			return `${gerundet(m.text)} – ${wo}.`;
		case "fertig":
			return `${wo} ist fertig ausgezählt.`;
		case "endergebnis":
			return `${wo}. Das Endergebnis steht.`;
		case "hochrechnung":
			return `${wo}. Erste Hochrechnung.`;
		case "spitze":
			return `${wo}. ${gerundet(m.anlass ?? m.text)}.`;
		default: {
			if (m.prozent !== undefined)
				return `${wo}. ${zahlwort(m.prozent)} Prozent ausgezählt.`;
			if (m.anz === undefined) return `${wo}. ${m.text}.`;
			if (m.max && m.max > 0)
				return `${wo}. ${zahlwort(m.anz)} von ${zahlwort(m.max)} Wahlbezirken ausgezählt.`;
			return `${wo}. ${zahlwort(m.anz)} Schnellmeldungen.`;
		}
	}
};

export const ANSAGE_ARTEN: MeldungsArt[] = [
	"jubel",
	"abstieg",
	"fertig",
	"endergebnis",
	"hochrechnung",
	"spitze",
	"stand",
];

export const ansage = (meldungen: readonly Meldung[]): string => {
	const erste = meldungen[0];
	if (!erste || !ANSAGE_ARTEN.includes(erste.art)) return "";
	return sprechsatz(erste);
};

const EINZELMELDUNGEN_BIS = 40;

/** Wahlen mit so vielen Einheiten melden nur Zehnerschwellen. */
export const vieleEinheiten = (max: number): boolean =>
	max > EINZELMELDUNGEN_BIS;

const zehnerschwelle = (a: FolienStand, n: FolienStand): number | undefined => {
	if (!vieleEinheiten(n.max) || a.max <= 0) return undefined;
	const vorher = Math.floor((a.anz / a.max) * 10);
	const jetzt = Math.floor((n.anz / n.max) * 10);
	if (jetzt <= vorher || jetzt === 0 || jetzt >= 10) return undefined;
	return jetzt * 10;
};

/** Die Gebiete, die seit dem letzten Blick auf die Leinwand dazugekommen sind. */
export const neueEingaenge = (a: FolienStand, n: FolienStand): string[] => {
	const alt = new Set(a.eingegangen ?? []);
	return (n.eingegangen ?? []).filter((name) => !alt.has(name));
};

const eingangsText = (a: FolienStand, n: FolienStand): string => {
	const namen = neueEingaenge(a, n);
	const dazu = Math.max(n.anz - a.anz, namen.length);
	if (dazu === 1 && namen.length === 1)
		return `Wahlbezirk ${namen[0]} ausgezählt`;
	if (dazu === 2 && namen.length === 2)
		return `Wahlbezirke ${namen[1]} und ${namen[0]} ausgezählt`;
	if (dazu > 1) return `${dazu} Wahlbezirke ausgezählt`;
	return "";
};

const standFakten = (
	a: FolienStand,
	n: FolienStand,
): Pick<Meldung, "text" | "anz" | "max" | "prozent"> => {
	const schwelle = zehnerschwelle(a, n);
	if (schwelle !== undefined)
		return {
			text: `${schwelle} Prozent ausgezählt`,
			anz: n.anz,
			max: n.max,
			prozent: schwelle,
		};
	const wer = eingangsText(a, n);
	const zaehler = n.max > 0 ? `${n.anz} von ${n.max}` : "";
	const text = wer
		? [wer, zaehler].filter(Boolean).join(" – ")
		: zaehler
			? `${zaehler} ausgezählt`
			: `${n.anz} Schnellmeldungen`;
	return { text, anz: n.anz, max: n.max };
};

export const vergleiche = (
	alt: Map<string, FolienStand>,
	neu: Map<string, FolienStand>,
): Meldung[] => {
	const raus: Meldung[] = [];
	for (const [marke, n] of neu) {
		const a = alt.get(marke);
		if (!a) continue;
		const kopf = { marke, ort: n.ort, wahl: n.wahl };
		if (fertig(n) && !fertig(a))
			raus.push({
				...kopf,
				art: "fertig",
				text: `${n.ort} ist fertig ausgezählt!`,
			});
		else if (n.art !== a.art && n.art === "endergebnis")
			raus.push({ ...kopf, art: "endergebnis", text: "Endergebnis steht" });
		else if (n.art !== a.art && n.art === "hochrechnung")
			raus.push({ ...kopf, art: "hochrechnung", text: "Erste Hochrechnung" });
		else if (n.spitze && a.spitze && n.spitze !== a.spitze)
			raus.push({
				...kopf,
				art: "spitze",
				anlass: `${n.spitze} zieht an ${a.spitze} vorbei`,
				...standFakten(a, n),
			});
		else if (n.anz > a.anz) {
			const fakten = standFakten(a, n);
			if (fakten.prozent !== undefined || !vieleEinheiten(n.max))
				raus.push({ ...kopf, art: "stand", ...fakten });
		}
	}
	return raus.sort(
		(x, y) => MELDUNGS_RANG.indexOf(x.art) - MELDUNGS_RANG.indexOf(y.art),
	);
};

export const kodiereStaende = (staende: readonly ParteiStand[]): string =>
	staende
		.map((p) =>
			[p.key, p.platz, p.prozent.toFixed(1), p.sitze ?? "-"].join(":"),
		)
		.join("|");

export const liesEingaenge = (text: string | undefined): string[] =>
	text ? text.split("|").filter(Boolean) : [];

export const liesStaende = (text: string | undefined): ParteiStand[] => {
	if (!text) return [];
	const raus: ParteiStand[] = [];
	for (const stueck of text.split("|")) {
		const [key, platz, prozent, sitze] = stueck.split(":");
		if (!key) continue;
		const s = Number(sitze);
		raus.push({
			key,
			platz: Number(platz) || 0,
			prozent: Number(prozent) || 0,
			sitze: sitze === "-" || Number.isNaN(s) ? undefined : s,
		});
	}
	return raus;
};

export /** Eine Veraenderung von Anteilen wird in Prozentpunkten angegeben. */
const formatPunkte = (d: number): string => {
	const n = Math.abs(d).toFixed(1).replace(".", ",");
	return `${n} ${Math.abs(d) === 1 ? "Punkt" : "Punkte"}`;
};

const PROZENT_SCHWELLE = 1;

const standVon = (
	s: FolienStand | undefined,
	key: string,
): ParteiStand | undefined => s?.parteien?.find((p) => p.key === key);

export const eigeneMeldungen = (
	alt: Map<string, FolienStand>,
	neu: Map<string, FolienStand>,
	partei: { key: string; kurz: string } | undefined,
): Meldung[] => {
	if (!partei?.key) return [];
	const raus: Meldung[] = [];
	const wir = partei.kurz;
	for (const [marke, n] of neu) {
		const a = alt.get(marke);
		if (!a) continue;
		const vorher = standVon(a, partei.key);
		const jetzt = standVon(n, partei.key);
		if (!vorher || !jetzt) continue;
		const kopf = { marke, ort: n.ort, wahl: n.wahl };
		if (jetzt.platz !== vorher.platz) {
			const auf = jetzt.platz < vorher.platz;
			raus.push({
				...kopf,
				art: auf ? "jubel" : "abstieg",
				text: auf
					? jetzt.platz === 1
						? `${wir} liegt vorn!`
						: `${wir} klettert auf Platz ${jetzt.platz}`
					: vorher.platz === 1
						? `${wir} liegt nicht mehr vorn`
						: `${wir} rutscht auf Platz ${jetzt.platz}`,
			});
			continue;
		}
		if (
			jetzt.sitze !== undefined &&
			vorher.sitze !== undefined &&
			jetzt.sitze !== vorher.sitze
		) {
			const d = jetzt.sitze - vorher.sitze;
			const wieviel = Math.abs(d) === 1 ? "einen Sitz" : `${Math.abs(d)} Sitze`;
			raus.push({
				...kopf,
				art: d > 0 ? "jubel" : "abstieg",
				text:
					d > 0
						? `${wir} gewinnt ${wieviel} – jetzt ${jetzt.sitze}`
						: `${wir} verliert ${wieviel} – nur noch ${jetzt.sitze}`,
			});
			continue;
		}
		const diff = jetzt.prozent - vorher.prozent;
		if (Math.abs(diff) >= PROZENT_SCHWELLE)
			raus.push({
				...kopf,
				art: diff > 0 ? "jubel" : "abstieg",
				text: `${wir} ${diff > 0 ? "legt zu" : "verliert"}: ${formatPunkte(
					diff,
				)} – jetzt ${formatProzent(jetzt.prozent)}`,
			});
	}
	return raus;
};

export const alleMeldungen = (
	alt: Map<string, FolienStand>,
	neu: Map<string, FolienStand>,
	partei?: { key: string; kurz: string },
): Meldung[] =>
	[...eigeneMeldungen(alt, neu, partei), ...vergleiche(alt, neu)].sort(
		(x, y) => MELDUNGS_RANG.indexOf(x.art) - MELDUNGS_RANG.indexOf(y.art),
	);

export const schubFolien = (
	alt: Map<string, FolienStand>,
	meldungen: readonly Meldung[],
): Array<{ marke: string; vorher: FolienStand; meldungen: string[] }> => {
	const raus = new Map<
		string,
		{ marke: string; vorher: FolienStand; meldungen: string[] }
	>();
	for (const m of meldungen) {
		const vorher = alt.get(m.marke);
		if (!vorher) continue;
		const zeilen = [satz(m), ...(m.anlass ? [m.anlass] : [])];
		const da = raus.get(m.marke);
		if (da) da.meldungen.push(...zeilen);
		else raus.set(m.marke, { marke: m.marke, vorher, meldungen: zeilen });
	}
	return [...raus.values()];
};

export const klangArt = (meldungen: readonly Meldung[]): Klangart => {
	switch (meldungen[0]?.art) {
		case "jubel":
			return "jubel";
		case "abstieg":
			return "abstieg";
		case "fertig":
			return "fertig";
		default:
			return "neu";
	}
};
