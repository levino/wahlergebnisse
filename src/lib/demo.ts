import { hash } from "./hash.ts";
import type { Ergebnis, Kandidat, Partei } from "./votemanager.ts";

export const demoAn = (): boolean =>
	(process.env.WAHLEN_DEMO ?? "").trim() === "1";

/** Sekunden je Durchlauf, aus `WAHLEN_DEMO_ZYKLUS`. */
export const demoZyklusSekunden = (): number => {
	const n = Number.parseInt(process.env.WAHLEN_DEMO_ZYKLUS ?? "", 10);
	return Number.isFinite(n) && n >= 60 ? n : ZYKLUS_SEKUNDEN_STANDARD;
};

export const demoBehoerden = (): string[] | undefined =>
	process.env.WAHLEN_DEMO_BEHOERDEN?.split(",")
		.map((s) => s.trim())
		.filter(Boolean);

export const NULLPUNKT_SCHLUESSEL = "demo:nullpunkt";

/** `WAHLEN_DEMO_NEUSTART=1` – den gemerkten Nullpunkt einmal überschreiben. */
export const demoNeustart = (): boolean =>
	(process.env.WAHLEN_DEMO_NEUSTART ?? "").trim() === "1";

export const nullpunkt = (
	gemerkt: string | undefined,
	jetztMs: number,
	opts: { neustart: boolean; darfSchreiben: boolean },
): { beginn: number; merken: boolean } => {
	const alt = Number(gemerkt ?? "");
	const gueltig = Number.isFinite(alt) && alt > 0;
	if (gueltig && !opts.neustart) return { beginn: alt, merken: false };
	if (!opts.darfSchreiben)
		return { beginn: gueltig ? alt : jetztMs, merken: false };
	return { beginn: jetztMs, merken: true };
};

export const DEMO_HINWEIS =
	"Simulation – keine echten Wahlergebnisse. Nachgespielt wird ein vergangener Wahlabend; die Zahlen sind verändert und laufen in einer Schleife.";

/** Wie lange ein voller Durchlauf dauert – vom leeren Saal bis ausgezählt. */
export const ZYKLUS_SEKUNDEN_STANDARD = 600;

export const VORLAUF_ANTEIL = 0.08;

export const NACHLAUF_SEKUNDEN = 60;

export type Zyklus = {
	/** Fortlaufende Nummer des Durchlaufs. */
	nummer: number;
	/** Anteil der Wahlbezirke, die eingegangen sind (0…1). */
	fortschritt: number;
	/** Absoluter Zeitpunkt (ms), zu dem dieser Durchlauf begonnen hat. */
	beginn: number;
	/** Dauer eines Durchlaufs in Millisekunden. */
	dauer: number;
	/** Der leere Saal am Anfang, in Millisekunden. */
	vorlaufMs: number;
	/** Die Zeit, in der gezählt wird, in Millisekunden. */
	zaehlenMs: number;
};

export const zyklusVon = (
	jetztMs: number,
	zyklusSekunden = ZYKLUS_SEKUNDEN_STANDARD,
	beginnMs = 0,
): Zyklus => {
	const dauer = Math.max(1, zyklusSekunden) * 1000;
	const seit = jetztMs - beginnMs;
	const nummer = Math.floor(seit / dauer);
	const imZyklus = ((seit % dauer) + dauer) % dauer;
	const vorlaufMs = VORLAUF_ANTEIL * dauer;
	const nachlaufMs = Math.min(NACHLAUF_SEKUNDEN * 1000, dauer * 0.4);
	const zaehlenMs = dauer - vorlaufMs - nachlaufMs;
	const roh = (imZyklus - vorlaufMs) / zaehlenMs;
	return {
		nummer,
		fortschritt: Math.min(1, Math.max(0, roh)),
		beginn: beginnMs + nummer * dauer,
		dauer,
		vorlaufMs,
		zaehlenMs,
	};
};

const streu = (...teile: Array<string | number>): number => {
	const h = hash(teile.join("|"));
	return Number.parseInt(h.slice(0, 8), 16) / 0xffffffff;
};

const EINGANG_KRUEMMUNG = 1.3;

export const eingangsAnteil = (schluessel: string): number =>
	Math.min(
		1,
		Math.max(
			Number.MIN_VALUE,
			streu("eingang", schluessel) ** EINGANG_KRUEMMUNG,
		),
	);

export const eingangsZeit = (
	zyklus: Zyklus,
	anteile: readonly number[],
): number => {
	let letzte = 0;
	for (const a of anteile) if (a > letzte) letzte = Math.min(1, a);
	return Math.round(
		zyklus.beginn + zyklus.vorlaufMs + letzte * zyklus.zaehlenMs,
	);
};

export const mische = <T>(items: readonly T[], startwert: string): T[] => {
	const a = [...items];
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(streu(startwert, i) * (i + 1));
		[a[i], a[j]] = [a[j], a[i]];
	}
	return a;
};

export const rauschFaktor = (schluessel: string, parteiKey: string): number =>
	0.92 + streu("rausch", schluessel, parteiKey) * 0.16;

export const verrausche = (
	e: Ergebnis,
	faktor: (parteiKey: string) => number,
): Ergebnis => ({
	...e,
	parteien: e.parteien.map((p) => {
		const f = faktor(p.key);
		const mal = (n: number | undefined) =>
			n === undefined ? undefined : Math.round(n * f);
		return {
			...p,
			stimmen: Math.round(p.stimmen * f),
			listenstimmen: mal(p.listenstimmen),
			kandidatenstimmen: mal(p.kandidatenstimmen),
			kandidaten: p.kandidaten?.map((k) => ({
				...k,
				stimmen: Math.round(k.stimmen * f),
			})),
		};
	}),
});

const rundeAuf = (n: number, stellen = 2): number => {
	const f = 10 ** stellen;
	return Math.round(n * f) / f;
};

/** Summe über eine Zahl, die auch fehlen darf. */
const plus = (
	a: number | undefined,
	b: number | undefined,
): number | undefined =>
	a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0);

const kandidatenSumme = (
	listen: Array<Kandidat[] | undefined>,
): Kandidat[] | undefined => {
	const nach = new Map<string, Kandidat>();
	let hatte = false;
	for (const liste of listen) {
		if (!liste) continue;
		hatte = true;
		for (const k of liste) {
			const alt = nach.get(k.name);
			nach.set(k.name, {
				...k,
				stimmen: (alt?.stimmen ?? 0) + k.stimmen,
				prozentInPartei: undefined,
			});
		}
	}
	if (!hatte) return undefined;
	return [...nach.values()].sort((a, b) => b.stimmen - a.stimmen);
};

export const zaehleZusammen = (
	vorlage: Ergebnis,
	bausteine: readonly Ergebnis[],
	anz: number,
	max: number,
	/** Zeitstempel dieses Stands; ohne Angabe die Uhr. */
	stempel?: string,
): Ergebnis => {
	const stimmenJe = new Map<string, number>();
	const listenJe = new Map<string, number | undefined>();
	const kandidatenJe = new Map<string, number | undefined>();
	const kandidatenListen = new Map<string, Array<Kandidat[] | undefined>>();
	for (const b of bausteine)
		for (const p of b.parteien) {
			stimmenJe.set(p.key, (stimmenJe.get(p.key) ?? 0) + p.stimmen);
			listenJe.set(p.key, plus(listenJe.get(p.key), p.listenstimmen));
			kandidatenJe.set(
				p.key,
				plus(kandidatenJe.get(p.key), p.kandidatenstimmen),
			);
			kandidatenListen.set(p.key, [
				...(kandidatenListen.get(p.key) ?? []),
				p.kandidaten,
			]);
		}
	const runde = (n: number | undefined) =>
		n === undefined ? undefined : Math.round(n);
	const gesamt = [...stimmenJe.values()].reduce((s, v) => s + v, 0);
	const parteien: Partei[] = vorlage.parteien.map((p) => {
		const stimmen = Math.round(stimmenJe.get(p.key) ?? 0);
		const kandidaten = kandidatenSumme(kandidatenListen.get(p.key) ?? []);
		const kStimmen = kandidaten?.reduce((s, k) => s + k.stimmen, 0) ?? 0;
		return {
			...p,
			stimmen,
			prozent: gesamt > 0 ? rundeAuf((stimmen / gesamt) * 100) : 0,
			listenstimmen: runde(listenJe.get(p.key)),
			kandidatenstimmen: runde(kandidatenJe.get(p.key)),
			kandidaten: kandidaten?.map((k) => ({
				...k,
				stimmen: Math.round(k.stimmen),
				prozentInPartei:
					kStimmen > 0 ? rundeAuf((k.stimmen / kStimmen) * 100) : undefined,
			})),
		};
	});

	const summe = (feld: (e: Ergebnis) => number | undefined) => {
		let s: number | undefined;
		for (const b of bausteine) s = plus(s, feld(b));
		return s === undefined ? undefined : Math.round(s);
	};
	const wahlberechtigte = summe((e) => e.kennzahlen.wahlberechtigte);
	const waehler = summe((e) => e.kennzahlen.waehler);

	return {
		...vorlage,
		leer: bausteine.length === 0,
		zeitstempel: stempel ?? new Date().toISOString(),
		stand: { ...vorlage.stand, anz, max, hinweis: [`${anz} von ${max}`] },
		kennzahlen: {
			wahlberechtigte,
			waehler,
			wahlbeteiligung:
				wahlberechtigte && waehler
					? rundeAuf((waehler / wahlberechtigte) * 100)
					: undefined,
			ungueltig: summe((e) => e.kennzahlen.ungueltig),
			gueltig: summe((e) => e.kennzahlen.gueltig),
			stimmen: summe((e) => e.kennzahlen.stimmen),
		},
		parteien,
		sitze: anz >= max && max > 0 ? vorlage.sitze : undefined,
	};
};
