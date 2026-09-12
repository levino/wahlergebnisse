import type {
	Ergebnis,
	Kennzahlen,
	Partei,
	Sitzverteilung,
} from "./votemanager.ts";
import { parteiKey } from "./votemanager.ts";
import { parseProzent, parseZahl } from "./zahlen.ts";

export type IvuTyp =
	| "kreis"
	| "wahlbereich"
	| "gemeinde"
	| "samtgemeinde"
	| "ortschaft"
	| "stimmbezirk"
	| "briefwahlbezirk";

export type IvuGebiet = {
	typ: IvuTyp;
	schluessel: string;
	name: string;
	datei: string;
};

const TYPEN: IvuTyp[] = [
	"kreis",
	"wahlbereich",
	"gemeinde",
	"samtgemeinde",
	"ortschaft",
	"stimmbezirk",
	"briefwahlbezirk",
];

const EBENE: Record<IvuTyp, number> = {
	kreis: 1,
	gemeinde: 3,
	samtgemeinde: 3,
	wahlbereich: 5,
	stimmbezirk: 6,
	briefwahlbezirk: 6,
	ortschaft: 8,
};

export const EBENEN_TITEL: Record<number, string> = {
	1: "Kreis",
	3: "Gemeinden",
	5: "Wahlbereiche",
	6: "Wahlbezirke",
	8: "Ortschaften",
};

/** "ergebnisse_briefwahlbezirk_03360025b_46.html" → Typ und Schlüssel. */
export const gebietAusDatei = (
	datei: string,
): { typ: IvuTyp; schluessel: string } | undefined => {
	const m = datei.match(/(?:^|\/)ergebnisse_([a-z]+)_([A-Za-z0-9_.-]+)\.html$/);
	if (!m) return undefined;
	const typ = TYPEN.find((t) => t === m[1]);
	return typ ? { typ, schluessel: m[2] } : undefined;
};

/** Gebiets-Id im Format dieser Anwendung: "ebene_6_id_03360025b_46". */
export const ivuGebietId = (typ: IvuTyp, schluessel: string): string =>
	`ebene_${EBENE[typ]}_id_${schluessel}`;

export const ivuEbene = (typ: IvuTyp): number => EBENE[typ];

type RohIndex = { suchindex?: Array<{ text?: string; url?: string }> };

/** Der Gebietsindex der Suche: jedes Gebiet der Präsentation, einmal. */
export const parseGebietsindex = (roh: unknown): IvuGebiet[] => {
	const out: IvuGebiet[] = [];
	for (const e of (roh as RohIndex)?.suchindex ?? []) {
		const datei = e.url ?? "";
		const g = gebietAusDatei(datei);
		if (!g) continue;
		const text = entschaerft(e.text ?? "");
		out.push({ ...g, name: ohneSchluessel(text), datei });
	}
	return out;
};

/** "03360004 - Gemeinde Bienenbüttel" → "Gemeinde Bienenbüttel" */
export const ohneSchluessel = (text: string): string => {
	const m = text.match(/^[0-9][0-9A-Za-z.-]*(?:\s+[0-9A-Za-z]+)? - (.+)$/);
	return (m ? m[1] : text).trim();
};

const ENTITAETEN: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
	shy: "",
	szlig: "\u00df",
	aelig: "\u00e6",
	AElig: "\u00c6",
	oslash: "\u00f8",
	Oslash: "\u00d8",
	eth: "\u00f0",
	thorn: "\u00fe",
};

/** `&ouml;` ist o mit Trema: Grundbuchstabe und Zeichen, danach zusammengezogen. */
const ZEICHEN: Record<string, string> = {
	uml: "\u0308",
	acute: "\u0301",
	grave: "\u0300",
	circ: "\u0302",
	tilde: "\u0303",
	ring: "\u030a",
	cedil: "\u0327",
	slash: "\u0338",
};

export const entschaerft = (s: string): string =>
	s
		.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
		.replace(/&#x([0-9a-f]+);/gi, (_, n) =>
			String.fromCodePoint(Number.parseInt(n, 16)),
		)
		.replace(/&([A-Za-z]+);/g, (ganz, name: string) => {
			const einfach = ENTITAETEN[name];
			if (einfach !== undefined) return einfach;
			const m = name.match(/^([A-Za-z])([a-z]+)$/);
			const zeichen = m && ZEICHEN[m[2]];
			return zeichen ? `${m[1]}${zeichen}`.normalize("NFC") : ganz;
		});

const text = (html: string): string =>
	entschaerft(html.replace(/<[^>]*>/g, " "))
		.replace(/\s+/g, " ")
		.trim();

type Zelle = { attr: string; inhalt: string };
type Zeile = Zelle[];

const zeilen = (abschnitt: string): Zeile[] => {
	const out: Zeile[] = [];
	for (const tr of abschnitt.split(/<tr\b/).slice(1)) {
		const zelle: Zeile = [];
		for (const m of tr.matchAll(/<(th|td)\b([^>]*)>([\s\S]*?)<\/\1>/g))
			zelle.push({ attr: m[2], inhalt: m[3] });
		if (zelle.length) out.push(zelle);
	}
	return out;
};

const attrWert = (attr: string, name: string): string | undefined =>
	attr.match(new RegExp(`${name}="([^"]*)"`))?.[1];

const sortWert = (z: Zelle): string =>
	entschaerft(attrWert(z.attr, "data-sort") ?? "");

const abschnitt = (tabelle: string, name: string): string =>
	tabelle.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1] ?? "";

/**
 * Die Spaltenbeschriftungen einer Tabelle.
 *
 * Der Kopf ist mehrzeilig und arbeitet mit `colspan` („Stimmen“ über Anzahl,
 * Anteil und Gewinn/Verlust). Aufgelöst gilt je Spalte die unterste
 * Beschriftung, die etwas sagt.
 */
export const spaltenTitel = (tabelle: string): string[] => {
	const out: string[] = [];
	for (const zeile of zeilen(abschnitt(tabelle, "thead"))) {
		let i = 0;
		for (const z of zeile) {
			const breite = Number(attrWert(z.attr, "colspan") ?? 1) || 1;
			const titel = sortWert(z) || text(z.inhalt);
			for (let n = 0; n < breite; n++, i++) if (titel) out[i] = titel;
		}
	}
	return [...out].map((s) => s ?? "");
};

type Spalten = {
	partei: number;
	kandidat: number;
	anzahl: number;
	anteil: number;
};

const spalten = (titel: string[]): Spalten => {
	const finde = (re: RegExp, ab = 0) =>
		titel.findIndex((t, i) => i >= ab && re.test(t));
	const anzahl = (() => {
		const genau = finde(/^\s*Anzahl\s*$/i);
		return genau >= 0 ? genau : finde(/^\s*Stimmen\s*$/i);
	})();
	return {
		partei: finde(/^\s*Partei\s*$/i),
		kandidat: finde(/Direktkandidat|Kandidat|Name|Gewählte/i),
		anzahl,
		anteil: finde(/^\s*Anteil\s*$/i),
	};
};

type Parteiangabe = { kurz: string; lang: string; farbe: string };

const parteiAus = (inhalt: string): Parteiangabe | undefined => {
	if (!/class="partei"/.test(inhalt)) return undefined;
	const farbe =
		inhalt.match(/partei__farbe"\s+style="color:([^";]+)/)?.[1] ?? "";
	const name =
		inhalt.match(/<span class="partei__name">([\s\S]*?)<\/span>/)?.[1] ?? "";
	const abbr = name.match(/<abbr\s+title="([^"]*)"\s*>([\s\S]*?)<\/abbr>/);
	const kurz = text(abbr ? abbr[2] : name);
	return {
		kurz,
		lang: abbr ? entschaerft(abbr[1]) : kurz,
		farbe: farbe.trim(),
	};
};

export type IvuPartei = Parteiangabe & {
	stimmen?: number;
	prozent?: number;
	kandidat?: string;
};

export type IvuListe = {
	kurz: string;
	lang: string;
	farbe: string;
	plaetze: Array<{ platz: number; name: string }>;
};

export type IvuGewaehlt = { partei: string; name: string; stimmen?: number };

export type IvuSeite = {
	/** Titel der Wahl, wie die Wahlleitung ihn schreibt: „Kreistagswahl 2026“ */
	wahl: string;
	/** Gebietsname mit Schlüssel: „03360004 - Gemeinde Bienenbüttel“ */
	gebiet: string;
	/** Wahltag und Gebiet aus dem Seitenkopf */
	kopf: string;
	/** Status-Text der Quelle: „Kein Eingang“, „Endergebnis“ */
	status: string;
	personenwahl: boolean;
	parteien: IvuPartei[];
	kennzahlen: Kennzahlen;
	untergebiete: IvuGebiet[];
	listen: IvuListe[];
	gewaehlte: IvuGewaehlt[];
};

const KENNZAHL: Array<[RegExp, keyof Kennzahlen]> = [
	[/^(wahl|stimm)berechtigte/i, "wahlberechtigte"],
	[/^wähler/i, "waehler"],
	[/^ungültige/i, "ungueltig"],
	[/^gültige stimmzettel/i, "gueltig"],
	[/^gültige stimmen/i, "stimmen"],
];

const stimmenTabelle = (html: string): string =>
	html.match(/<table class="[^"]*table-stimmen"[\s\S]*?<\/table>/)?.[0] ?? "";

const tabellen = (html: string): string[] =>
	[...html.matchAll(/<table\b[\s\S]*?<\/table>/g)].map((m) => m[0]);

/** Die Tabelle, deren Beschriftung so heißt („Gewählte“, „Sitzverteilung“). */
const tabelleMitTitel = (html: string, re: RegExp): string =>
	tabellen(html).find((t) => {
		const titel = t.match(/<caption>[\s\S]*?<h3>([\s\S]*?)<\/h3>/)?.[1];
		return titel !== undefined && re.test(entschaerft(titel).trim());
	}) ?? "";

/**
 * Wo die Liste der Untergebiete anfängt.
 *
 * Die meisten Seiten führen sie als eigene Karte; wo die fehlt, steht
 * dieselbe Liste im Aufklapper der Gebietsauswahl.
 */
const untergebieteStelle = (html: string): number => {
	const karte = html.lastIndexOf("Untergeordnete Gebiete");
	return karte >= 0 ? karte : html.lastIndexOf(">Untergeordnet<");
};

const untergebiete = (html: string): IvuGebiet[] => {
	const i = untergebieteStelle(html);
	if (i < 0) return [];
	const liste = html
		.slice(i)
		.match(/<ul class="linklist">([\s\S]*?)<\/ul>/)?.[1];
	if (!liste) return [];
	const out: IvuGebiet[] = [];
	for (const m of liste.matchAll(/<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
		const g = gebietAusDatei(m[1]);
		if (g) out.push({ ...g, name: text(m[2]), datei: m[1] });
	}
	return out;
};

/**
 * Die Wahlvorschläge, Partei für Partei.
 *
 * Jede Liste steckt in einem eigenen Aufklapper; die Tabelle darin führt nur
 * Nummer und Namen. Stimmen je Bewerber veröffentlicht IVU nicht.
 */
const listen = (html: string): IvuListe[] => {
	const out: IvuListe[] = [];
	for (const artikel of html.split(/<article\b/).slice(1)) {
		const partei = parteiAus(artikel);
		if (!partei) continue;
		const tabelle = artikel.match(/<table\b[\s\S]*?<\/table>/)?.[0] ?? "";
		const plaetze: Array<{ platz: number; name: string }> = [];
		for (const zeile of zeilen(abschnitt(tabelle, "tbody"))) {
			const platz = parseZahl(sortWert(zeile[0]));
			const name = sortWert(zeile[1]) || text(zeile[1]?.inhalt ?? "");
			if (platz !== undefined && name) plaetze.push({ platz, name });
		}
		if (plaetze.length) out.push({ ...partei, plaetze });
	}
	return out;
};

const gewaehlte = (html: string): IvuGewaehlt[] => {
	const tabelle = tabelleMitTitel(html, /^Gewählte/);
	if (!tabelle) return [];
	const s = spalten(spaltenTitel(tabelle));
	const out: IvuGewaehlt[] = [];
	for (const zeile of zeilen(abschnitt(tabelle, "tbody"))) {
		const partei = zeile.map((z) => parteiAus(z.inhalt)).find(Boolean);
		const name = s.kandidat >= 0 ? sortWert(zeile[s.kandidat]) : "";
		if (!name) continue;
		out.push({
			partei: partei?.kurz ?? "",
			name,
			stimmen: s.anzahl >= 0 ? parseZahl(sortWert(zeile[s.anzahl])) : undefined,
		});
	}
	return out;
};

/** Eine Ergebnisseite von IVU.elect, so wie sie ausgeliefert wird. */
export const parseSeite = (html: string): IvuSeite => {
	const roh = html.replace(/<(script|style)[\s\S]*?<\/\1>/g, "");
	const tabelle = stimmenTabelle(roh);
	const titel = spaltenTitel(tabelle);
	const s = spalten(titel);
	const personenwahl = s.kandidat >= 0;

	const parteien: IvuPartei[] = [];
	for (const zeile of zeilen(abschnitt(tabelle, "tbody"))) {
		const partei = zeile.map((z) => parteiAus(z.inhalt)).find(Boolean);
		if (!partei) continue;
		parteien.push({
			...partei,
			stimmen: s.anzahl >= 0 ? parseZahl(sortWert(zeile[s.anzahl])) : undefined,
			prozent:
				s.anteil >= 0 ? parseProzent(sortWert(zeile[s.anteil])) : undefined,
			kandidat: personenwahl ? sortWert(zeile[s.kandidat]) : undefined,
		});
	}

	const kennzahlen: Kennzahlen = {};
	for (const zeile of zeilen(abschnitt(tabelle, "tfoot"))) {
		const label = sortWert(zeile[0]) || text(zeile[0]?.inhalt ?? "");
		const feld = KENNZAHL.find(([re]) => re.test(label))?.[1];
		if (!feld || kennzahlen[feld] !== undefined) continue;
		kennzahlen[feld] =
			s.anzahl >= 0 ? parseZahl(sortWert(zeile[s.anzahl])) : undefined;
		if (feld === "waehler" && s.anteil >= 0)
			kennzahlen.wahlbeteiligung = parseProzent(sortWert(zeile[s.anteil]));
	}
	if (kennzahlen.gueltig === undefined && kennzahlen.stimmen !== undefined)
		kennzahlen.gueltig = kennzahlen.stimmen;

	const kopfBlock =
		roh.match(/<div class="header-wahl-sub">([\s\S]*?)<\/div>/)?.[1] ?? "";
	const staende = [
		...kopfBlock.matchAll(/<p class="stand">([\s\S]*?)<\/p>/g),
	].map((m) => text(m[1]));

	return {
		wahl: entschaerft(roh.match(/<h1[^>]*aria-label="([^"]*)"/)?.[1] ?? ""),
		gebiet: text(
			roh.match(/class="header-gebiet__name"[^>]*>([\s\S]*?)<\/h2>/)?.[1] ?? "",
		),
		kopf: staende[0] ?? "",
		status: staende[1] ?? "",
		personenwahl,
		parteien,
		kennzahlen,
		untergebiete: untergebiete(roh),
		listen: listen(roh),
		gewaehlte: gewaehlte(roh),
	};
};

/**
 * Hat dieses Gebiet schon etwas gemeldet?
 *
 * Vor dem ersten Eingang schreibt IVU in jede Zelle eine 0 – auch bei den
 * Stimmberechtigten. Das ist keine Null, sondern eine fehlende Meldung.
 */
export const hatGemeldet = (seite: IvuSeite): boolean =>
	(seite.kennzahlen.wahlberechtigte ?? 0) > 0 ||
	(seite.kennzahlen.waehler ?? 0) > 0 ||
	seite.parteien.some((p) => (p.stimmen ?? 0) > 0);

const sitzeAusGewaehlten = (
	gewaehlte: IvuGewaehlt[],
	parteien: Partei[],
): Sitzverteilung | undefined => {
	if (gewaehlte.length === 0) return undefined;
	const zahl = new Map<string, number>();
	for (const g of gewaehlte) {
		const key = parteiKey(g.partei);
		zahl.set(key, (zahl.get(key) ?? 0) + 1);
	}
	const verteilung = [...zahl.entries()].map(([key, sitze]) => {
		const p = parteien.find((x) => x.key === key);
		return {
			key,
			kurz: p?.kurz ?? key,
			lang: p?.lang ?? p?.kurz ?? key,
			farbe: p?.farbe ?? "",
			sitze,
		};
	});
	return {
		gesamt: gewaehlte.length,
		hinweis: "Sitze aus der Liste der Gewählten gezählt",
		verteilung: verteilung.sort((a, b) => b.sitze - a.sitze),
		gewaehlte: gewaehlte.map((g) => ({
			partei: g.partei,
			name: g.name,
			mandat: "",
			stimmen: g.stimmen,
		})),
	};
};

export type ErgebnisRahmen = {
	/** Wie viele Untergebiete schon gemeldet haben */
	anz?: number;
	/** Wie viele Untergebiete melden werden */
	max?: number;
	zeitstempel: string;
	untergebieteTitel: string;
};

/**
 * Eine gelesene Seite als Ergebnis dieser Anwendung.
 *
 * Ohne Meldung bleiben Parteien und Kennzahlen leer: Die Nullen der Quelle
 * sind kein Ergebnis. Stimmen je Bewerber führt IVU nicht; die Namen und
 * Listenplätze stehen trotzdem, mit unbekannter Stimmenzahl.
 */
export const zuErgebnis = (
	seite: IvuSeite,
	rahmen: ErgebnisRahmen,
): Ergebnis => {
	const gemeldet = hatGemeldet(seite);
	const listenNachKey = new Map(
		seite.listen.map((l) => [parteiKey(l.kurz), l]),
	);
	const parteien: Partei[] = gemeldet
		? seite.parteien.map((p) => {
				const key = parteiKey(p.kurz);
				const liste = listenNachKey.get(key);
				const partei: Partei = {
					key,
					kurz: p.kurz,
					lang: p.lang,
					farbe: p.farbe,
					stimmen: p.stimmen ?? 0,
					prozent: p.prozent ?? 0,
				};
				if (seite.personenwahl && p.kandidat)
					partei.kandidat = { name: p.kandidat, partei: p.kurz };
				if (liste)
					partei.kandidaten = liste.plaetze.map((k) => ({
						name: k.name,
						platz: k.platz,
					}));
				return partei;
			})
		: [];
	const gebietKurz = ohneSchluessel(seite.gebiet);
	return {
		titel: `${seite.wahl} - ${seite.gebiet}`,
		gebietTitel: seite.gebiet,
		gebietKurz,
		zeitstempel: rahmen.zeitstempel,
		leer: !gemeldet,
		personenwahl: seite.personenwahl,
		stand: {
			...(rahmen.anz === undefined ? {} : { anz: rahmen.anz }),
			...(rahmen.max === undefined ? {} : { max: rahmen.max }),
			hinweis: seite.status ? [seite.status] : [],
			status: seite.status,
		},
		kennzahlen: gemeldet ? seite.kennzahlen : {},
		parteien,
		...(gemeldet
			? { sitze: sitzeAusGewaehlten(seite.gewaehlte, parteien) }
			: {}),
		untergebiete: seite.untergebiete.length
			? [
					{
						titel: rahmen.untergebieteTitel,
						gebiete: seite.untergebiete.map((g) => ({
							id: ivuGebietId(g.typ, g.schluessel),
							titel: g.name,
						})),
					},
				]
			: [],
	};
};
