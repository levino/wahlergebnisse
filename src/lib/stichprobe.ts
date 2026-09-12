import type { Behoerde } from "../data/behoerden.ts";
import { KREISE, type Kreis, wurzelVon } from "../data/kreise.ts";
import {
	type Fundort,
	type RohTerminIndex,
	type Termin,
	apiBasisVon,
	findeOrdner,
	openDataUrl,
	opendataBasisVon,
	parseTerminIndex,
	praesentationUrlVon,
	terminGiltFuerBehoerde,
	terminGiltIrgendwoImKreis,
	terminIndexUrl,
	vorgabeFundort,
} from "../data/termine.ts";
import type { ApiErgebnis, ApiWahl } from "./api.ts";
import { type Grenze, hostDrossel } from "./drossel.ts";
import { ebenenBezeichnung } from "./ebenen.ts";
import { normName } from "./kandidaten.ts";
import {
	type CsvEintrag,
	ordneCsvsZuWahlen,
	parseCsv,
	parteienAusOpenData,
} from "./liste.ts";
import {
	type Ergebnis,
	parteiKey,
	type RohErgebnis,
	type RohTermin,
	type RohUebersicht,
	type RohWahl,
	type RohWahlraeume,
	istGebietId,
	parseErgebnis,
	parseErgebnisDateiname,
	parseListing,
	parseTermin,
	parseUebersicht,
	parseWahl,
	parseWahlraeume,
} from "./votemanager.ts";
import {
	type Wahltyp,
	erkenneWahltyp,
	istPersonenwahl,
	wahlSlugs,
} from "./wahltyp.ts";

const UA =
	"wahlergebnisse-stichprobe/1.0 (+https://wahlergebnisse.levinkeller.de; post@levinkeller.de)";

const TIMEOUT_MS = 20_000;

export const STICHPROBE_GRENZE: Grenze = { proSekunde: 4, spitze: 8 };

export const HOECHSTZAHL_ANFRAGEN = 300;

export const STANDARD_API = "https://wahlergebnisse.levinkeller.de";

export class NichtErreichbar extends Error {
	url: string;
	grund: string;
	constructor(url: string, grund: string) {
		super(`${url}: ${grund}`);
		this.url = url;
		this.grund = grund;
	}
}

export class BudgetErschoepft extends Error {
	hoechstzahl: number;
	constructor(hoechstzahl: number) {
		super(`Anfragebudget von ${hoechstzahl} Anfragen erschöpft`);
		this.hoechstzahl = hoechstzahl;
	}
}

export type Antwort = { status: number; text: string; stand?: string };

export type Holer = {
	hole: (url: string) => Promise<Antwort | undefined>;
	json: <T>(url: string) => Promise<T | undefined>;
	anzahl: () => number;
};

export const holer = (
	opts: { hoechstzahl?: number; grenze?: Grenze } = {},
): Holer => {
	const hoechstzahl = opts.hoechstzahl ?? HOECHSTZAHL_ANFRAGEN;
	const drossel = hostDrossel({
		grenzen: {},
		standard: opts.grenze ?? STICHPROBE_GRENZE,
	});
	let anzahl = 0;
	const hole = async (url: string): Promise<Antwort | undefined> => {
		if (anzahl >= hoechstzahl) throw new BudgetErschoepft(hoechstzahl);
		await drossel.nimm(new URL(url).host);
		anzahl++;
		let res: Response;
		try {
			res = await fetch(url, {
				headers: {
					"User-Agent": UA,
					Accept: "application/json, text/html;q=0.5, */*;q=0.1",
				},
				signal: AbortSignal.timeout(TIMEOUT_MS),
			});
		} catch (err) {
			throw new NichtErreichbar(url, (err as Error).message);
		}
		if (res.status === 404) return undefined;
		if (res.status === 403 || res.status === 401)
			return { status: res.status, text: "" };
		if (!res.ok)
			throw new NichtErreichbar(url, `${res.status} ${res.statusText}`);
		return {
			status: res.status,
			text: await res.text(),
			stand: res.headers.get("last-modified") ?? undefined,
		};
	};
	return {
		hole,
		json: async <T>(url: string) => {
			const a = await hole(url);
			if (a?.status !== 200) return undefined;
			try {
				return JSON.parse(a.text) as T;
			} catch {
				throw new NichtErreichbar(url, "kein JSON");
			}
		},
		anzahl: () => anzahl,
	};
};

export const zufall = (saat: number): (() => number) => {
	let a = saat >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
};

export const mische = <T>(xs: readonly T[], r: () => number): T[] => {
	const raus = [...xs];
	for (let i = raus.length - 1; i > 0; i--) {
		const j = Math.floor(r() * (i + 1));
		[raus[i], raus[j]] = [raus[j], raus[i]];
	}
	return raus;
};

export type Ziel = { kreis: Kreis; behoerde: Behoerde };

export const ziehe = (
	termin: Termin,
	umfang: number,
	r: () => number,
	filter: { kreise?: string[]; behoerden?: string[] } = {},
): Ziel[] => {
	const kreise = mische(
		KREISE.filter(
			(k) =>
				k.behoerden.length > 0 &&
				terminGiltIrgendwoImKreis(termin, k.slug) &&
				(!filter.kreise?.length || filter.kreise.includes(k.slug)),
		),
		r,
	);
	const vorrat = kreise.map((kreis) => ({
		kreis,
		behoerden: mische(
			kreis.behoerden.filter(
				(b) =>
					terminGiltFuerBehoerde(termin, kreis, b) &&
					(!filter.behoerden?.length ||
						filter.behoerden.includes(b.slug) ||
						filter.behoerden.includes(b.ags)),
			),
			r,
		),
	}));
	const raus: Ziel[] = [];
	for (let runde = 0; raus.length < umfang; runde++) {
		let gezogen = false;
		for (const v of vorrat) {
			if (raus.length >= umfang) break;
			const behoerde = v.behoerden[runde];
			if (!behoerde) continue;
			raus.push({ kreis: v.kreis, behoerde });
			gezogen = true;
		}
		if (!gezogen) break;
	}
	return raus;
};

export type Befundart =
	| "fehlt-bei-uns"
	| "fehlt-bei-uns-leer"
	| "fehlt-bei-uns-ungeprueft"
	| "fehlt-bei-der-quelle"
	| "fehlt-bei-der-quelle-ungeprueft"
	| "quelle-unverlinkt"
	| "abweichung"
	| "landesamt-verzug"
	| "quelle-leer"
	| "unerreichbar";

export const BEFUND_ZAEHLT: Record<Befundart, boolean> = {
	"fehlt-bei-uns": true,
	"fehlt-bei-uns-leer": false,
	"fehlt-bei-uns-ungeprueft": false,
	"fehlt-bei-der-quelle": true,
	"fehlt-bei-der-quelle-ungeprueft": false,
	"quelle-unverlinkt": false,
	abweichung: true,
	"landesamt-verzug": false,
	"quelle-leer": false,
	unerreichbar: false,
};

export const BEFUND_UEBERSCHRIFT: Record<Befundart, string> = {
	"fehlt-bei-uns": "Die Wahlleitung führt Zahlen, die uns fehlen",
	"fehlt-bei-uns-leer":
		"Die Wahlleitung führt das Gebiet noch ohne Zahlen, uns fehlt es",
	"fehlt-bei-uns-ungeprueft":
		"Die Wahlleitung führt es, uns fehlt es – nicht nachgeschlagen",
	"fehlt-bei-der-quelle": "Wir führen etwas, das die Wahlleitung nicht hat",
	"fehlt-bei-der-quelle-ungeprueft":
		"Wir führen es, die Wahlleitung verlinkt es nicht – nicht nachgeschlagen",
	"quelle-unverlinkt": "Wir führen es, die Wahlleitung verlinkt es nicht mehr",
	abweichung: "Dasselbe Gebiet, andere Zahlen",
	"landesamt-verzug":
		"Andere Zahlen als beim Landesamt, dessen Datei aber älter ist – vermutlich Meldeverzug",
	"quelle-leer": "Die Quelle hat dazu nichts",
	unerreichbar: "Nicht erreichbar",
};

export type Quellenart =
	| "wahlleitung"
	| "wahlleitung-open-data"
	| "landesamt"
	| "unsere-api";

export const QUELLENART_KURZ: Record<Quellenart, string> = {
	wahlleitung: "Wahlleitung",
	"wahlleitung-open-data": "Open Data",
	landesamt: "Landesamt",
	"unsere-api": "unsere API",
};

export const QUELLENART_TEXT: Record<Quellenart, string> = {
	wahlleitung: "Wahlleitung, dieselben JSON-Dateien, die der Poller liest",
	"wahlleitung-open-data":
		"Wahlleitung, Open-Data-CSV – andere Datei, aber dieselbe Stelle",
	landesamt: "Landesamt für Statistik – vom Poller unabhängige Stelle",
	"unsere-api": "unsere eigene API",
};

export type Befund = {
	art: Befundart;
	gegen: Quellenart;
	kreis: string;
	behoerde: string;
	wahl?: string;
	gebiet?: string;
	text: string;
	quelle?: string;
};

export type Ziehung = {
	kreis: string;
	behoerde: string;
	ags: string;
	basis: string;
	praesentation: string;
	wahlenQuelle: number;
	wahlenUns: number;
	gepruefteWahlen: string[];
	verglichen: number;
	befunde: Befund[];
	abgebrochen?: string;
};

export type Bericht = {
	termin: string;
	api: string;
	saat: number;
	umfang: number;
	anfragen: number;
	ziehungen: Ziehung[];
	landesamt: { basis?: string; abgeglichen: number };
	zusammenfassung: Record<Befundart, number> & {
		ziehungen: number;
		verglichen: number;
		befunde: number;
	};
};

export type Abweichung = {
	feld: string;
	unser: number | null;
	quelle: number | null;
};

const alsZahl = (v: number | null | undefined): number | null =>
	typeof v === "number" ? v : null;

export const vergleiche = (
	unser: ApiErgebnis,
	quelle: Ergebnis,
): Abweichung[] => {
	const raus: Abweichung[] = [];
	const pruefe = (
		feld: string,
		u: number | null | undefined,
		q: number | undefined,
	) => {
		if (q === undefined) return;
		const un = alsZahl(u);
		if (un !== q) raus.push({ feld, unser: un, quelle: q });
	};
	const k = quelle.kennzahlen;
	pruefe(
		"Wahlberechtigte",
		unser.kennzahlen.wahlberechtigte,
		k.wahlberechtigte,
	);
	pruefe("Wähler", unser.kennzahlen.waehler, k.waehler);
	pruefe("ungültig", unser.kennzahlen.ungueltig, k.ungueltig);
	pruefe(
		"gültige Stimmzettel",
		unser.kennzahlen.gueltigeStimmzettel,
		k.gueltig,
	);
	pruefe("gültige Stimmen", unser.kennzahlen.gueltigeStimmen, k.stimmen);
	pruefe(
		"Schnellmeldungen",
		unser.stand.schnellmeldungen.eingegangen,
		quelle.stand.anz,
	);
	pruefe(
		"erwartete Schnellmeldungen",
		unser.stand.schnellmeldungen.erwartet,
		quelle.stand.max,
	);
	const unsere = new Map(unser.parteien.map((p) => [p.key, p]));
	for (const p of quelle.parteien) {
		const u = unsere.get(p.key);
		if (!u) {
			raus.push({
				feld: `${p.kurz}: fehlt bei uns`,
				unser: null,
				quelle: p.stimmen,
			});
			continue;
		}
		pruefe(`${p.kurz} Stimmen`, u.stimmen, p.stimmen);
		pruefe(`${p.kurz} Listenstimmen`, u.listenstimmen, p.listenstimmen);
		pruefe(
			`${p.kurz} Kandidatenstimmen`,
			u.kandidatenstimmen,
			p.kandidatenstimmen,
		);
		const bewerber = new Map(
			(u.kandidaten ?? []).map((b) => [normName(b.name), b]),
		);
		for (const kandidat of p.kandidaten ?? []) {
			const b = bewerber.get(normName(kandidat.name));
			if (!b) {
				raus.push({
					feld: `${p.kurz} ${kandidat.name}: fehlt bei uns`,
					unser: null,
					quelle: kandidat.stimmen,
				});
				continue;
			}
			pruefe(`${p.kurz} ${kandidat.name}`, b.stimmen, kandidat.stimmen);
		}
	}
	if (!quelle.leer)
		for (const p of unser.parteien)
			if (!quelle.parteien.some((q) => q.key === p.key))
				raus.push({
					feld: `${p.kurz}: bei der Wahlleitung nicht geführt`,
					unser: p.stimmen,
					quelle: null,
				});
	return raus;
};

export const alsText = (a: Abweichung): string =>
	`${a.feld} ${a.unser ?? "–"} (wir) ≠ ${a.quelle ?? "–"} (Wahlleitung)`;

type QuellWahl = {
	wahlId: number;
	titel: string;
	gebietId: string;
	gebietTitel: string;
	slug: string;
	typ: Wahltyp;
	personenwahl: boolean;
	behoerdeName: string;
};

type RohOpenData = {
	csvs?: CsvEintrag[];
	dateifelder?: Array<{
		name: string;
		parteien?: Array<{ feld: string; wert: string }>;
	}>;
};

type Quelle = {
	basis: string;
	fundort: Fundort;
	wurzel: string;
	praesentation: string;
	wahlen: QuellWahl[];
};

type Umgebung = {
	h: Holer;
	termin: Termin;
	api: string;
	fehlendePruefen: number;
	mitOpenData: boolean;
	landesamt?: string;
	landesamtDaten: Map<string, Antwort | undefined>;
	landesamtTreffer: { anzahl: number };
	openData: Map<string, RohOpenData | undefined>;
	r: () => number;
};

const normTitel = (s: string): string =>
	s
		.toLowerCase()
		.replace(/[äöü]/g, (c) => ({ ä: "ae", ö: "oe", ü: "ue" })[c] ?? c)
		.replace(/ß/g, "ss")
		.replace(/[^a-z0-9]/g, "");

const ZUORDENBARE_EBENEN = new Set([
	"kreis",
	"gemeinde",
	"stadtbezirk",
	"ortsteil",
	"wahlbereich",
	"wahlbezirk",
]);

const csvZahl = (v: string | undefined): number | undefined => {
	if (v === undefined || v.trim() === "") return undefined;
	const n = Number(v.replace(/\./g, "").replace(",", "."));
	return Number.isFinite(n) ? n : undefined;
};

export const ordneOpenDataParteien = (
	parteien: Array<{ key: string; name: string }>,
	nummern: Map<number, string>,
): Map<number, string> => {
	const raus = new Map<number, string>();
	for (const [nummer, lang] of nummern) {
		const genau = parteien.filter((p) => p.name === lang);
		const endet = parteien.filter((p) => p.name.endsWith(`, ${lang}`));
		const gekuerzt = parteien.filter((p) =>
			p.name.startsWith(lang.slice(0, 25)),
		);
		const treffer =
			genau.length === 1
				? genau[0]
				: endet.length === 1
					? endet[0]
					: gekuerzt.length === 1
						? gekuerzt[0]
						: undefined;
		if (treffer) raus.set(nummer, treffer.key);
	}
	return raus;
};

export const vergleicheOpenData = (
	unser: ApiErgebnis,
	zeile: Record<string, string>,
	nummern: Map<number, string>,
): Abweichung[] => {
	const raus: Abweichung[] = [];
	const pruefe = (
		feld: string,
		u: number | null | undefined,
		q: number | undefined,
		nurWennBeide = false,
	) => {
		if (q === undefined) return;
		const un = alsZahl(u);
		if (un === null && (q === 0 || nurWennBeide)) return;
		if (un !== q) raus.push({ feld, unser: un, quelle: q });
	};
	pruefe("Wahlberechtigte", unser.kennzahlen.wahlberechtigte, csvZahl(zeile.A));
	pruefe("Wähler", unser.kennzahlen.waehler, csvZahl(zeile.B));
	pruefe("ungültig", unser.kennzahlen.ungueltig, csvZahl(zeile.C1 ?? zeile.C));
	pruefe(
		"gültige Stimmzettel",
		unser.kennzahlen.gueltigeStimmzettel,
		csvZahl(zeile.C2 ?? zeile.D),
	);
	pruefe("gültige Stimmen", unser.kennzahlen.gueltigeStimmen, csvZahl(zeile.D));
	pruefe(
		"Schnellmeldungen",
		unser.stand.schnellmeldungen.eingegangen,
		csvZahl(zeile["anz-schnellmeldungen"]),
		true,
	);
	pruefe(
		"erwartete Schnellmeldungen",
		unser.stand.schnellmeldungen.erwartet,
		csvZahl(zeile["max-schnellmeldungen"]),
		true,
	);
	const vonKey = new Map(unser.parteien.map((p) => [p.key, p]));
	for (const [nummer, key] of ordneOpenDataParteien(unser.parteien, nummern)) {
		const p = vonKey.get(key);
		if (!p) continue;
		pruefe(
			`${p.kurz} Stimmen`,
			p.stimmen,
			csvZahl(zeile[`D${nummer}_summe_liste_kandidaten`]) ??
				csvZahl(zeile[`D${nummer}`]),
		);
		pruefe(
			`${p.kurz} Listenstimmen`,
			p.listenstimmen,
			csvZahl(zeile[`D${nummer}_liste`]),
			true,
		);
		pruefe(
			`${p.kurz} Kandidatenstimmen`,
			p.kandidatenstimmen,
			csvZahl(zeile[`D${nummer}_summe_kandidaten`]),
			true,
		);
	}
	return raus;
};

const apiUrl = (u: Umgebung, kreis: Kreis, pfad: string, frage = ""): string =>
	`${u.api}/api/v1/${kreis.slug}/${u.termin.id}/${pfad}${frage}`;

const fundortFuer = async (
	u: Umgebung,
	kreis: Kreis,
	behoerde: Behoerde,
): Promise<{ fundort: Fundort; imIndex: boolean }> => {
	const wurzel = wurzelVon(kreis, behoerde);
	const vorgabe = vorgabeFundort(u.termin);
	const index = await u.h.json<RohTerminIndex>(
		terminIndexUrl(behoerde.ags, wurzel),
	);
	const ordner = index && findeOrdner(parseTerminIndex(index), u.termin);
	return ordner
		? { fundort: { ...vorgabe, ordner }, imIndex: true }
		: { fundort: vorgabe, imIndex: false };
};

const quellWahlen = async (
	u: Umgebung,
	kreis: Kreis,
	behoerde: Behoerde,
): Promise<Quelle> => {
	const wurzel = wurzelVon(kreis, behoerde);
	const { fundort, imIndex } = await fundortFuer(u, kreis, behoerde);
	let gilt = fundort;
	let roh = await u.h.json<RohTermin>(
		`${apiBasisVon(gilt, behoerde.ags, wurzel)}/termin.json`,
	);
	if (!roh && imIndex) {
		const anders: Fundort = {
			...gilt,
			layout: gilt.layout === "v22" ? "v26" : "v22",
		};
		roh = await u.h.json<RohTermin>(
			`${apiBasisVon(anders, behoerde.ags, wurzel)}/termin.json`,
		);
		if (roh) gilt = anders;
	}
	const basis = apiBasisVon(gilt, behoerde.ags, wurzel);
	const rahmen = {
		basis,
		fundort: gilt,
		wurzel,
		praesentation: praesentationUrlVon(gilt, behoerde.ags, wurzel),
	};
	if (!roh) return { ...rahmen, wahlen: [] };
	const eintraege = parseTermin(roh);
	const slugs = wahlSlugs(eintraege, behoerde.name);
	return {
		...rahmen,
		wahlen: eintraege.map((e, i) => ({
			wahlId: e.wahlId,
			titel: e.titel,
			gebietId: e.gebietId,
			gebietTitel: e.gebietTitel,
			slug: slugs[i].slug,
			typ: slugs[i].typ,
			personenwahl: istPersonenwahl(erkenneWahltyp(e.titel, behoerde.name)),
			behoerdeName: behoerde.name,
		})),
	};
};

const quellGebiete = async (
	u: Umgebung,
	wahlBasis: string,
	w: QuellWahl,
	geteilt: boolean,
): Promise<{ gebiete: Set<string>; gesamt?: Ergebnis }> => {
	const gebiete = new Set<string>([w.gebietId]);
	const ebenen = new Set<string>();
	const wahlJson = await u.h.json<RohWahl>(`${wahlBasis}/wahl.json`);
	if (wahlJson && !geteilt) {
		const info = parseWahl(wahlJson);
		for (const e of info.ergebnisse) if (istGebietId(e.id)) gebiete.add(e.id);
		for (const e of info.uebersichten) ebenen.add(e.ebene);
	}
	if (!geteilt) {
		const listing = await u.h.hole(`${wahlBasis}/`);
		for (const d of listing?.status === 200 ? parseListing(listing.text) : []) {
			const ebene = d.name.match(/^uebersicht_(ebene_-?\d+)_0\.json$/);
			if (ebene) ebenen.add(ebene[1]);
			const datei = parseErgebnisDateiname(d.name);
			if (datei?.stimmentyp === 0) gebiete.add(datei.gebietId);
		}
	}
	for (const ebene of ebenen) {
		const roh = await u.h.json<RohUebersicht>(
			`${wahlBasis}/uebersicht_${ebene}_0.json`,
		);
		if (!roh) continue;
		for (const z of parseUebersicht(roh).zeilen)
			if (istGebietId(z.gebietId)) gebiete.add(z.gebietId);
	}
	const gesamtRoh = await u.h.json<RohErgebnis>(
		`${wahlBasis}/ergebnis_${w.gebietId}_0.json`,
	);
	const gesamt = gesamtRoh
		? parseErgebnis(gesamtRoh, w.personenwahl, w.behoerdeName)
		: undefined;
	for (const gruppe of gesamt?.untergebiete ?? [])
		for (const g of gruppe.gebiete) if (istGebietId(g.id)) gebiete.add(g.id);
	return { gebiete, gesamt };
};

const holeQuellErgebnis = async (
	u: Umgebung,
	wahlBasis: string,
	w: QuellWahl,
	gebietId: string,
): Promise<Ergebnis | undefined> => {
	const roh = await u.h.json<RohErgebnis>(
		`${wahlBasis}/ergebnis_${gebietId}_0.json`,
	);
	return roh ? parseErgebnis(roh, w.personenwahl, w.behoerdeName) : undefined;
};

const pruefeWahlraeume = async (
	u: Umgebung,
	kreis: Kreis,
	behoerde: Behoerde,
	basis: string,
	befunde: Befund[],
): Promise<string[]> => {
	const roh = await u.h.json<RohWahlraeume>(
		`${basis}/wahlraeume_uebersicht.json`,
	);
	const quelle = roh ? parseWahlraeume(roh) : [];
	const unser = await u.h.json<{
		wahlraeume: Array<{ wahlbezirk: string; wahlbereich: string | null }>;
	}>(apiUrl(u, kreis, `${behoerde.slug}/wahlraeume`));
	const unsere = new Set((unser?.wahlraeume ?? []).map((w) => w.wahlbezirk));
	const fehlend = quelle.filter((w) => !unsere.has(w.bezirk));
	const gemeinsam = {
		gegen: "wahlleitung" as Quellenart,
		kreis: kreis.slug,
		behoerde: behoerde.slug,
	};
	if (fehlend.length)
		befunde.push({
			...gemeinsam,
			art: "fehlt-bei-uns",
			text: `${fehlend.length} von ${quelle.length} Wahlbezirken der Wahlraum-Übersicht fehlen bei uns: ${fehlend
				.slice(0, 5)
				.map((w) => w.bezirk)
				.join(", ")}`,
			quelle: `${basis}/wahlraeume_uebersicht.json`,
		});
	const quellBezirke = new Set(quelle.map((w) => w.bezirk));
	const zuviel = [...unsere].filter((b) => !quellBezirke.has(b));
	if (zuviel.length && quelle.length)
		befunde.push({
			...gemeinsam,
			art: "fehlt-bei-der-quelle",
			text: `${zuviel.length} Wahlbezirke führen wir, die Wahlraum-Übersicht nicht: ${zuviel.slice(0, 5).join(", ")}`,
		});
	const quellBereiche = new Set(
		quelle.map((w) => w.wahlbereich).filter((x): x is string => Boolean(x)),
	);
	const unsereBereiche = new Set(
		(unser?.wahlraeume ?? [])
			.map((w) => w.wahlbereich)
			.filter((x): x is string => Boolean(x)),
	);
	const fehlendeBereiche = [...quellBereiche].filter(
		(b) => !unsereBereiche.has(b),
	);
	if (fehlendeBereiche.length)
		befunde.push({
			...gemeinsam,
			art: "fehlt-bei-uns",
			text: `Wahlbereiche der Wahlleitung fehlen bei uns: ${fehlendeBereiche.join(", ")}`,
			quelle: `${basis}/wahlraeume_uebersicht.json`,
		});
	return quelle.map((w) => String(w.id));
};

const gebietsZeile = (e: Ergebnis): string => {
	const k = e.kennzahlen;
	const teile = [
		k.waehler !== undefined ? `${k.waehler} Wähler` : "",
		k.gueltig !== undefined ? `${k.gueltig} gültige Stimmzettel` : "",
		e.parteien.length ? `${e.parteien.length} Parteien` : "",
	].filter(Boolean);
	return teile.length ? teile.join(", ") : "ohne Zahlen";
};

const pruefeOpenData = async (
	u: Umgebung,
	kreis: Kreis,
	behoerde: Behoerde,
	q: Quelle,
	w: QuellWahl,
	unsere: Map<string, ApiErgebnis>,
	befunde: Befund[],
): Promise<number> => {
	const gemeinsam = {
		gegen: "wahlleitung-open-data" as Quellenart,
		kreis: kreis.slug,
		behoerde: behoerde.slug,
		wahl: w.slug,
	};
	if (!u.openData.has(behoerde.ags))
		u.openData.set(
			behoerde.ags,
			await u.h.json<RohOpenData>(
				openDataUrl(q.fundort, behoerde.ags, q.wurzel),
			),
		);
	const od = u.openData.get(behoerde.ags);
	if (!od?.csvs?.length) return 0;
	const zuordnung = ordneCsvsZuWahlen(
		od.csvs,
		q.wahlen.map((x) => ({
			schluessel: `${x.wahlId}|${x.gebietId}`,
			titel: x.titel,
			gebietTitel: x.gebietTitel,
		})),
	).get(`${w.wahlId}|${w.gebietId}`);
	if (!zuordnung?.csvs.length) return 0;
	const gewaehlt =
		zuordnung.csvs.find((c) => /wahlbezirk/i.test(c.ebene)) ??
		zuordnung.csvs[0];
	const url = `${opendataBasisVon(q.fundort, behoerde.ags, q.wurzel)}/${gewaehlt.url}`;
	const datei = await u.h.hole(url);
	if (datei?.status !== 200) return 0;
	const nummern = parteienAusOpenData(
		od.dateifelder ?? [],
		gewaehlt.wahl,
		zuordnung.ort,
	);
	const ebene = ebenenBezeichnung(gewaehlt.ebene).toLowerCase();
	if (!ZUORDENBARE_EBENEN.has(ebene)) return 0;
	const nachName = new Map(
		[...unsere.values()]
			.filter((g) => g.gebiet.ebene === ebene)
			.map((g) => [normTitel(g.gebiet.name), g]),
	);
	const ohneVorsatz = (name: string) =>
		name.replace(/^(Gemeinde|Stadt|Flecken|Samtgemeinde|Ortschaft)\s+/i, "");
	let verglichen = 0;
	const fremd: string[] = [];
	for (const zeile of parseCsv(datei.text)) {
		const name = zeile["gebiet-name"] ?? "";
		const treffer =
			name === ""
				? unsere.get(w.gebietId)
				: (nachName.get(normTitel(name)) ??
					nachName.get(normTitel(ohneVorsatz(name))));
		if (!treffer) {
			if ((csvZahl(zeile.B) ?? 0) > 0) fremd.push(name || "(ohne Namen)");
			continue;
		}
		verglichen++;
		for (const a of vergleicheOpenData(treffer, zeile, nummern))
			befunde.push({
				...gemeinsam,
				art: "abweichung",
				gebiet: treffer.gebiet.id,
				text: `Open Data (${gewaehlt.ebene}) ${treffer.gebiet.name}: ${alsText(a)}`,
				quelle: url,
			});
	}
	if (fremd.length)
		befunde.push({
			...gemeinsam,
			art: "fehlt-bei-uns",
			text: `Open Data (${gewaehlt.ebene}) führt ${fremd.length} Gebiete mit Zahlen, die wir nicht haben: ${fremd.slice(0, 5).join(", ")}`,
			quelle: url,
		});
	return verglichen;
};

export const LANDESAMT_BASIS =
	"https://wahlen.statistik.niedersachsen.de/KW2026/";

const LANDESAMT_DATEI: Partial<Record<string, string>> = {
	kreistag: "kreiswahlergebnis.csv",
	rat: "gemeindewahlergebnis.csv",
};

export const landesamtZeile = (
	zeilen: Array<Record<string, string>>,
	namen: string[],
): Record<string, string> | undefined => {
	const gesucht = new Set(namen.filter(Boolean).map(normTitel));
	const treffer = zeilen.filter((z) => {
		const wert = z.Wahlkreis ?? "";
		return (
			gesucht.has(normTitel(wert)) ||
			gesucht.has(normTitel(ohneRechtsform(wert)))
		);
	});
	return treffer.length === 1 ? treffer[0] : undefined;
};

const ohneRechtsform = (name: string): string =>
	name.replace(
		/^(Landkreis|Gemeinde|Stadt|Flecken|Samtgemeinde|Ortschaft|Region)\s+/i,
		"",
	);

export const vergleicheLandesamt = (
	unser: ApiErgebnis,
	zeile: Record<string, string>,
): Abweichung[] => {
	const raus: Abweichung[] = [];
	const pruefe = (
		feld: string,
		u: number | null | undefined,
		q: number | undefined,
	) => {
		if (q === undefined) return;
		const un = alsZahl(u);
		if (un === null && q === 0) return;
		if (un !== q) raus.push({ feld, unser: un, quelle: q });
	};
	pruefe(
		"Wahlberechtigte",
		unser.kennzahlen.wahlberechtigte,
		csvZahl(zeile.Wahlberechtigte),
	);
	pruefe("Wähler", unser.kennzahlen.waehler, csvZahl(zeile.Wähler));
	pruefe(
		"gültige Stimmzettel",
		unser.kennzahlen.gueltigeStimmzettel,
		csvZahl(zeile["Gültige Stimmzettel"]),
	);
	pruefe(
		"gültige Stimmen",
		unser.kennzahlen.gueltigeStimmen,
		csvZahl(zeile["Gültige Stimmen"]),
	);
	for (const [spalte, wert] of Object.entries(zeile)) {
		const m = spalte.match(/^(.*) Stimmen$/);
		if (!m || csvZahl(wert) === undefined) continue;
		const key = parteiKey(m[1]);
		const p = unser.parteien.find(
			(x) => x.key === key || parteiKey(x.name) === key,
		);
		if (!p) continue;
		pruefe(`${p.kurz} Stimmen`, p.stimmen, csvZahl(wert));
	}
	return raus;
};

const pruefeLandesamt = async (
	u: Umgebung,
	kreis: Kreis,
	behoerde: Behoerde,
	w: QuellWahl,
	gesamt: ApiErgebnis | undefined,
	befunde: Befund[],
): Promise<number> => {
	const datei = LANDESAMT_DATEI[w.slug];
	if (!u.landesamt || !datei || !gesamt) return 0;
	const url = `${u.landesamt}${datei}`;
	if (!u.landesamtDaten.has(url))
		u.landesamtDaten.set(url, await u.h.hole(url));
	const antwort = u.landesamtDaten.get(url);
	if (antwort?.status !== 200) return 0;
	const zeilen = parseCsv(antwort.text);
	const zeile = landesamtZeile(zeilen, [
		behoerde.name,
		behoerde.kurz,
		kreis.name,
		kreis.kurz,
		gesamt.gebiet.name,
	]);
	if (!zeile) return 0;
	u.landesamtTreffer.anzahl++;
	const verzug =
		antwort.stand &&
		gesamt.stand.datenstand &&
		Date.parse(antwort.stand) < Date.parse(gesamt.stand.datenstand);
	for (const a of vergleicheLandesamt(gesamt, zeile))
		befunde.push({
			gegen: "landesamt",
			kreis: kreis.slug,
			behoerde: behoerde.slug,
			wahl: w.slug,
			gebiet: gesamt.gebiet.id,
			art: verzug ? "landesamt-verzug" : "abweichung",
			text: `Landesamt (Stand ${antwort.stand ?? "unbekannt"}, wir ${gesamt.stand.datenstand ?? "unbekannt"}): ${alsText(a)}`,
			quelle: url,
		});
	return 1;
};

const pruefeWahl = async (
	u: Umgebung,
	kreis: Kreis,
	behoerde: Behoerde,
	q: Quelle,
	w: QuellWahl,
	raumIds: string[],
	befunde: Befund[],
): Promise<number> => {
	const geteilt = q.wahlen.filter((x) => x.wahlId === w.wahlId).length > 1;
	const gemeinsam = {
		gegen: "wahlleitung" as Quellenart,
		kreis: kreis.slug,
		behoerde: behoerde.slug,
		wahl: w.slug,
	};
	const basis = q.basis;
	const wahlBasis = `${basis}/wahl_${w.wahlId}`;
	const { gebiete, gesamt } = await quellGebiete(u, wahlBasis, w, geteilt);
	const unser = await u.h.json<{ gebiete: ApiErgebnis[] }>(
		apiUrl(u, kreis, `${behoerde.slug}/${w.slug}/gebiete`),
	);
	const unsere = new Map((unser?.gebiete ?? []).map((g) => [g.gebiet.id, g]));

	const fehlend = [...gebiete].filter((g) => !unsere.has(g));
	const offen: string[] = [];
	let gepruefte = 0;
	for (const g of fehlend) {
		if (gepruefte >= u.fehlendePruefen) {
			offen.push(g);
			continue;
		}
		gepruefte++;
		const e = await holeQuellErgebnis(u, wahlBasis, w, g);
		if (!e) {
			befunde.push({
				...gemeinsam,
				art: "quelle-leer",
				gebiet: g,
				text: "verlinkt, aber ohne Ergebnisdatei bei der Wahlleitung",
				quelle: `${wahlBasis}/ergebnis_${g}_0.json`,
			});
			continue;
		}
		if (erkenneWahltyp(e.titel, behoerde.name) !== w.typ) continue;
		befunde.push({
			...gemeinsam,
			art: e.leer ? "fehlt-bei-uns-leer" : "fehlt-bei-uns",
			gebiet: g,
			text: `${e.gebietKurz || e.titel}: ${gebietsZeile(e)}`,
			quelle: `${wahlBasis}/ergebnis_${g}_0.json`,
		});
	}
	if (offen.length)
		befunde.push({
			...gemeinsam,
			art: "fehlt-bei-uns-ungeprueft",
			text: `${offen.length} weitere Gebiete führt die Wahlleitung, wir nicht: ${offen.slice(0, 5).join(", ")}`,
			quelle: `${wahlBasis}/`,
		});

	const zuviel = [...unsere.keys()].filter((g) => !gebiete.has(g));
	const offenZuviel: string[] = [];
	let geprueftZuviel = 0;
	for (const g of zuviel) {
		if (geprueftZuviel >= u.fehlendePruefen) {
			offenZuviel.push(g);
			continue;
		}
		geprueftZuviel++;
		const e = await holeQuellErgebnis(u, wahlBasis, w, g);
		befunde.push({
			...gemeinsam,
			art: e ? "quelle-unverlinkt" : "fehlt-bei-der-quelle",
			gebiet: g,
			text: e
				? "die Wahlleitung hat die Datei, verlinkt sie aber nirgends"
				: "die Wahlleitung hat dazu keine Datei",
			quelle: `${wahlBasis}/ergebnis_${g}_0.json`,
		});
	}
	if (offenZuviel.length)
		befunde.push({
			...gemeinsam,
			art: "fehlt-bei-der-quelle-ungeprueft",
			text: `${offenZuviel.length} weitere Gebiete führen wir, die Wahlleitung verlinkt sie nicht: ${offenZuviel.slice(0, 5).join(", ")}`,
		});

	const unterhalb = (ids: Iterable<string>): string[] =>
		[...ids].filter((g) => g !== w.gebietId);
	if (
		!geteilt &&
		!unterhalb(unsere.keys()).length &&
		!unterhalb(gebiete).length &&
		raumIds.length
	) {
		let versuche = 0;
		for (const id of raumIds) {
			if (versuche >= u.fehlendePruefen) break;
			versuche++;
			const gebietId = `ebene_6_id_${id}`;
			const e = await holeQuellErgebnis(u, wahlBasis, w, gebietId);
			if (!e) continue;
			befunde.push({
				...gemeinsam,
				art: e.leer ? "fehlt-bei-uns-leer" : "fehlt-bei-uns",
				gebiet: gebietId,
				text: `nirgends verlinkt, aber veröffentlicht – ${e.gebietKurz || e.titel}: ${gebietsZeile(e)}`,
				quelle: `${wahlBasis}/ergebnis_${gebietId}_0.json`,
			});
		}
	}

	let verglichen = 0;
	const melde = (gebietId: string, q: Ergebnis, unserErgebnis: ApiErgebnis) => {
		verglichen++;
		for (const a of vergleiche(unserErgebnis, q))
			befunde.push({
				...gemeinsam,
				art: "abweichung",
				gebiet: gebietId,
				text: `${q.gebietKurz || q.titel}: ${alsText(a)}`,
				quelle: `${wahlBasis}/ergebnis_${gebietId}_0.json`,
			});
	};
	const unserGesamt = unsere.get(w.gebietId);
	if (gesamt && unserGesamt) melde(w.gebietId, gesamt, unserGesamt);
	else if (!gesamt && unserGesamt)
		befunde.push({
			...gemeinsam,
			art: "quelle-leer",
			gebiet: w.gebietId,
			text: "kein Gesamtergebnis bei der Wahlleitung",
			quelle: `${wahlBasis}/ergebnis_${w.gebietId}_0.json`,
		});

	const gemeinsame = [...gebiete].filter(
		(g) => g !== w.gebietId && unsere.has(g),
	);
	if (gemeinsame.length) {
		const gezogen = gemeinsame[Math.floor(u.r() * gemeinsame.length)];
		const gezogenesErgebnis = await holeQuellErgebnis(u, wahlBasis, w, gezogen);
		const unserGebiet = unsere.get(gezogen);
		if (gezogenesErgebnis && unserGebiet)
			melde(gezogen, gezogenesErgebnis, unserGebiet);
		else if (!gezogenesErgebnis)
			befunde.push({
				...gemeinsam,
				art: "quelle-leer",
				gebiet: gezogen,
				text: "verlinkt, aber ohne Ergebnisdatei bei der Wahlleitung",
				quelle: `${wahlBasis}/ergebnis_${gezogen}_0.json`,
			});
	}
	verglichen += await pruefeLandesamt(
		u,
		kreis,
		behoerde,
		w,
		unsere.get(w.gebietId),
		befunde,
	);
	if (u.mitOpenData)
		verglichen += await pruefeOpenData(
			u,
			kreis,
			behoerde,
			q,
			w,
			unsere,
			befunde,
		);
	return verglichen;
};

export const pruefeZiel = async (
	u: Umgebung,
	ziel: Ziel,
	wahlenJeLeitung: number,
): Promise<Ziehung> => {
	const { kreis, behoerde } = ziel;
	const befunde: Befund[] = [];
	const gemeinsam = {
		gegen: "wahlleitung" as Quellenart,
		kreis: kreis.slug,
		behoerde: behoerde.slug,
	};
	const ziehung: Ziehung = {
		kreis: kreis.slug,
		behoerde: behoerde.slug,
		ags: behoerde.ags,
		basis: "",
		praesentation: "",
		wahlenQuelle: 0,
		wahlenUns: 0,
		gepruefteWahlen: [],
		verglichen: 0,
		befunde,
	};
	try {
		const q = await quellWahlen(u, kreis, behoerde);
		const { basis, wahlen } = q;
		ziehung.basis = basis;
		ziehung.praesentation = q.praesentation;
		ziehung.wahlenQuelle = wahlen.length;
		const unser = await u.h.json<{ wahlen: ApiWahl[] }>(
			apiUrl(u, kreis, "wahlen", `?behoerde=${behoerde.slug}`),
		);
		const unsere = new Map((unser?.wahlen ?? []).map((w) => [w.slug, w]));
		ziehung.wahlenUns = unsere.size;
		if (!wahlen.length) {
			befunde.push({
				...gemeinsam,
				art: "quelle-leer",
				text: `kein termin.json unter ${basis} – diese Wahlleitung veröffentlicht hier nichts (mehr)`,
				quelle: `${basis}/termin.json`,
			});
			return ziehung;
		}
		for (const w of wahlen)
			if (!unsere.has(w.slug))
				befunde.push({
					...gemeinsam,
					art: "fehlt-bei-uns",
					wahl: w.slug,
					text: `die Wahlleitung führt „${w.titel}“, wir kennen die Wahl nicht`,
					quelle: `${basis}/termin.json`,
				});
		for (const slug of unsere.keys())
			if (!wahlen.some((w) => w.slug === slug))
				befunde.push({
					...gemeinsam,
					art: "fehlt-bei-der-quelle",
					wahl: slug,
					text: "wir führen diese Wahl, der Termin-Index der Wahlleitung nicht",
				});
		const raumIds = wahlen.length
			? await pruefeWahlraeume(u, kreis, behoerde, basis, befunde)
			: [];
		const gemeinsameWahlen = mische(
			wahlen.filter((w) => unsere.has(w.slug)),
			u.r,
		).slice(0, wahlenJeLeitung);
		for (const w of gemeinsameWahlen) {
			ziehung.gepruefteWahlen.push(w.slug);
			ziehung.verglichen += await pruefeWahl(
				u,
				kreis,
				behoerde,
				q,
				w,
				raumIds,
				befunde,
			);
		}
	} catch (err) {
		if (err instanceof NichtErreichbar)
			befunde.push({
				...gemeinsam,
				art: "unerreichbar",
				text: `${err.url}: ${err.grund}`,
			});
		else if (err instanceof BudgetErschoepft) ziehung.abgebrochen = err.message;
		else throw err;
	}
	return ziehung;
};

export type Optionen = {
	termin: Termin;
	api?: string;
	umfang?: number;
	saat?: number;
	kreise?: string[];
	behoerden?: string[];
	wahlenJeLeitung?: number;
	fehlendePruefen?: number;
	mitOpenData?: boolean;
	landesamt?: string;
	hoechstzahl?: number;
	holer?: Holer;
	log?: (zeile: string) => void;
};

const leereZusammenfassung = (): Bericht["zusammenfassung"] => ({
	"fehlt-bei-uns": 0,
	"fehlt-bei-uns-leer": 0,
	"fehlt-bei-uns-ungeprueft": 0,
	"fehlt-bei-der-quelle": 0,
	"fehlt-bei-der-quelle-ungeprueft": 0,
	"quelle-unverlinkt": 0,
	abweichung: 0,
	"landesamt-verzug": 0,
	"quelle-leer": 0,
	unerreichbar: 0,
	ziehungen: 0,
	verglichen: 0,
	befunde: 0,
});

export const zeileFuer = (z: Ziehung): string => {
	const zaehler = new Map<Befundart, number>();
	for (const b of z.befunde) zaehler.set(b.art, (zaehler.get(b.art) ?? 0) + 1);
	const teile = [
		`${z.kreis}/${z.behoerde}`,
		`Wahlen ${z.wahlenQuelle} Quelle / ${z.wahlenUns} wir`,
		z.gepruefteWahlen.length
			? `geprüft: ${z.gepruefteWahlen.join(", ")} (${z.verglichen} ${z.verglichen === 1 ? "Gebiet" : "Gebiete"} verglichen)`
			: "keine gemeinsame Wahl geprüft",
		z.abgebrochen
			? z.abgebrochen
			: zaehler.size
				? [...zaehler].map(([art, n]) => `${n}× ${art}`).join(", ")
				: "ohne Befund",
	];
	return teile.join(" · ");
};

export const laufe = async (o: Optionen): Promise<Bericht> => {
	const saat = o.saat ?? Math.floor(Math.random() * 2 ** 31);
	const umfang = o.umfang ?? 8;
	const api = (o.api ?? STANDARD_API).replace(/\/$/, "");
	const r = zufall(saat);
	const h = o.holer ?? holer({ hoechstzahl: o.hoechstzahl });
	const u: Umgebung = {
		h,
		termin: o.termin,
		api,
		fehlendePruefen: o.fehlendePruefen ?? 5,
		mitOpenData: o.mitOpenData ?? true,
		landesamt:
			o.termin.id === "2026" ? (o.landesamt ?? LANDESAMT_BASIS) : undefined,
		landesamtDaten: new Map(),
		landesamtTreffer: { anzahl: 0 },
		openData: new Map(),
		r,
	};
	const ziele = ziehe(o.termin, umfang, r, {
		kreise: o.kreise,
		behoerden: o.behoerden,
	});
	const ziehungen: Ziehung[] = [];
	for (const ziel of ziele) {
		const z = await pruefeZiel(u, ziel, o.wahlenJeLeitung ?? 1);
		ziehungen.push(z);
		o.log?.(zeileFuer(z));
		if (z.abgebrochen) break;
	}
	const zusammenfassung = leereZusammenfassung();
	zusammenfassung.ziehungen = ziehungen.length;
	for (const z of ziehungen) {
		zusammenfassung.verglichen += z.verglichen;
		for (const b of z.befunde) {
			zusammenfassung[b.art]++;
			if (BEFUND_ZAEHLT[b.art]) zusammenfassung.befunde++;
		}
	}
	return {
		termin: o.termin.id,
		api,
		saat,
		umfang,
		anfragen: h.anzahl(),
		ziehungen,
		landesamt: { basis: u.landesamt, abgeglichen: u.landesamtTreffer.anzahl },
		zusammenfassung,
	};
};

export const rueckgabewert = (b: Bericht): number => {
	if (b.zusammenfassung.unerreichbar > 0) return 2;
	return b.zusammenfassung.befunde > 0 ? 1 : 0;
};
