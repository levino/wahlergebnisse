import { parseProzent, parseZahl } from "./zahlen.ts";

type RohLabel = { labelKurz: string; labelLang?: string };
type RohZeile = {
	color?: string;
	label: RohLabel;
	zahl: string;
	prozent: string;
	sub_zeilen?: RohZeile[];
};
type RohBalken = {
	bezeichnung: string;
	color: string;
	bezeichnungAusfuehrlich?: string;
	wert: number;
	prozentGerundet: number;
};
type RohLink = { id?: string; type: string; title: string; url?: string };

export type RohErgebnis = {
	zeitstempel?: string;
	seitentitel?: string;
	Komponente?: {
		tabelle?: { zeilen: RohZeile[] };
		gebietsverlinkung?: Array<{ titel: string; gebietslinks: RohLink[] }>;
		info?: {
			titel: string;
			hinweis: string[];
			tabelle?: { zeilen: RohZeile[] };
		};
		sitze?: {
			hinweis?: string;
			tortenDiagramm?: {
				entries: Array<{
					sitze: number;
					color: string;
					label: string;
					tooltip?: string;
				}>;
			};
			tabelle?: { ueberschriften: string[]; zeilen: string[][] };
		};
		grafik?: {
			balken: RohBalken[];
			sonstige?: RohBalken;
			sonstigeBalken?: RohBalken[];
			footer?: string;
		};
		wahlbeteiligung?: { text?: { prozent?: number } };
	};
};

export type RohUebersicht = {
	zeitstempel?: string;
	seitentitel?: string;
	tabelle?: {
		header: RohLabel[];
		zeilen: Array<{
			label: string;
			link?: RohLink;
			statusString?: string;
			statusProzent?: number;
			stimmbezirk?: boolean;
			felder: Array<{ absolut: string; prozent: string; tip?: string }>;
		}>;
	};
};

export type RohTermin = {
	datum_string?: string;
	seitentitel?: string;
	wahleintraege: Array<{
		wahl: { id: number; titel: string };
		stimmentyp: { id: number; titel: string };
		gebiet_link: RohLink;
		leer?: boolean;
	}>;
};

export type RohWahl = {
	titel: string;
	datum: string;
	ergebnisstatus?: Array<{ status: string; gebiet_ids: string[] }>;
	menu_links?: RohLink[];
	hasHochrechnung?: boolean;
};

export type RohWahlraeume = {
	headers: string[];
	wahlraeume: Array<{
		titel: string;
		id: number;
		barrierefrei?: string;
		bezirke: string[];
	}>;
};

export type Kandidat = {
	name: string;
	stimmen: number;
	prozentInPartei?: number;
	/** Platz auf dem Wahlvorschlag; wird aus der Open-Data-CSV ergänzt. */
	platz?: number;
};

export type Partei = {
	/** Stabiler Schlüssel (Kurzname, normalisiert) */
	key: string;
	kurz: string;
	lang: string;
	farbe: string;
	/** Summe aller Stimmen (bei Verhältniswahl: Listen- + Kandidatenstimmen) */
	stimmen: number;
	prozent: number;
	listenstimmen?: number;
	kandidatenstimmen?: number;
	kandidaten?: Kandidat[];
	/** Nur Personenwahl: Name und Partei des Kandidaten getrennt */
	kandidat?: { name: string; partei: string };
};

export type Stand = {
	/** eingegangene Schnellmeldungen */
	anz?: number;
	/** erwartete Schnellmeldungen */
	max?: number;
	hinweis: string[];
	/** "Amtliches Endergebnis" o. ä. aus wahl.json, falls bekannt */
	status?: string;
};

export type Kennzahlen = {
	wahlberechtigte?: number;
	waehler?: number;
	wahlbeteiligung?: number;
	ungueltig?: number;
	gueltig?: number;
	/** gültige Stimmen (bei 3 Stimmen pro Person > gültige Stimmzettel) */
	stimmen?: number;
};

export type Sitzverteilung = {
	gesamt: number;
	hinweis: string;
	verteilung: Array<{
		key: string;
		kurz: string;
		lang: string;
		farbe: string;
		sitze: number;
	}>;
	gewaehlte: Array<{
		partei: string;
		name: string;
		mandat: string;
		stimmen?: number;
	}>;
};

export type GebietLink = { id: string; titel: string };

export type Ergebnis = {
	titel: string;
	/** Voller Gebietsname inkl. übergeordneter Ebene ("Gemeinde Nordstemmen - 09 - Rössing - DGH") */
	gebietTitel: string;
	/** Gebietsname ohne den Behördenpräfix ("09 - Rössing - DGH") */
	gebietKurz: string;
	zeitstempel: string;
	/** true, solange noch keine Zahlen vorliegen (vor der Wahl / vor der ersten Schnellmeldung) */
	leer: boolean;
	personenwahl: boolean;
	stand: Stand;
	kennzahlen: Kennzahlen;
	parteien: Partei[];
	sitze?: Sitzverteilung;
	untergebiete: Array<{ titel: string; gebiete: GebietLink[] }>;
};

export type UebersichtZeile = {
	label: string;
	gebietId?: string;
	externeUrl?: string;
	status: string;
	statusProzent?: number;
	stimmbezirk: boolean;
	wahlberechtigte?: number;
	wahlbeteiligung?: number;
	werte: Array<{ kurz: string; absolut?: number; prozent?: number }>;
};

export type Uebersicht = {
	titel: string;
	zeitstempel: string;
	spalten: Array<{ kurz: string; lang?: string }>;
	zeilen: UebersichtZeile[];
};

export type Wahleintrag = {
	wahlId: number;
	titel: string;
	gebietId: string;
	gebietTitel: string;
	leer: boolean;
};

export type WahlInfo = {
	titel: string;
	datum: string;
	status?: string;
	/** Ebenen mit Übersichtstabellen, z. B. "ebene_6" → "Wahlbezirke" */
	uebersichten: Array<{ ebene: string; titel: string }>;
	/** Direkt verlinkte Ergebnis-Gebiete (in der Regel das Gesamtgebiet) */
	ergebnisse: GebietLink[];
};

export type Wahlraum = {
	id: number;
	titel: string;
	barrierefrei: boolean;
	/** Spalten laut headers: Wahlbezirk, Ortsteil, Wahlbereich, Kreiswahlbereich (je nach Termin) */
	bezirk: string;
	ortsteil?: string;
	wahlbereich?: string;
	kreiswahlbereich?: string;
};

export const parteiKey = (kurz: string): string =>
	kurz
		.trim()
		.toLowerCase()
		.replace(/[\s./-]+/g, "");

export const passtGekuerzt = (gekuerzt: string, voll: string): boolean => {
	const teile = gekuerzt.split(/\.{3}|…/);
	if (teile.length !== 2) return false;
	const [anfang, ende] = teile;
	return (
		voll.length >= anfang.length + ende.length &&
		voll.startsWith(anfang) &&
		voll.endsWith(ende)
	);
};

export const parteiZuSitzeintrag = (
	parteien: Partei[],
	label: string,
	tooltip?: string,
): Partei | undefined => {
	const voll = tooltip?.trim();
	if (voll) {
		const nachLang = parteien.filter((p) => p.lang.trim() === voll);
		if (nachLang.length === 1) return nachLang[0];
		const nachKurz = parteien.filter((p) => p.kurz.trim() === voll);
		if (nachKurz.length === 1) return nachKurz[0];
	}
	const nachKey = parteien.filter((p) => p.key === parteiKey(label));
	if (nachKey.length === 1) return nachKey[0];
	const nachKuerzung = parteien.filter(
		(p) => passtGekuerzt(label, p.kurz) || passtGekuerzt(label, p.lang),
	);
	return nachKuerzung.length === 1 ? nachKuerzung[0] : undefined;
};

/** "Bernd Lynack, Sozialdemokratische Partei Deutschlands" + "Lynack, SPD" → Kandidat/Partei */
const splitKandidat = (
	kurz: string,
	lang: string,
): { name: string; partei: string } => {
	const i = kurz.lastIndexOf(", ");
	const partei = i >= 0 ? kurz.slice(i + 2).trim() : "";
	const j = lang.lastIndexOf(", ");
	const name = j >= 0 ? lang.slice(0, j).trim() : lang || kurz;
	return { name, partei };
};

/** "426 von 426 Ergebnissen" / "23 von 23" → { anz, max } */
export const parseStand = (
	texte: Array<string | null>,
): { anz?: number; max?: number } => {
	for (const t of texte) {
		if (typeof t !== "string") continue;
		const m = t.match(/(\d[\d.]*)\s+von\s+(\d[\d.]*)/);
		if (m) return { anz: parseZahl(m[1]), max: parseZahl(m[2]) };
		if (/^eingegangen$/i.test(t.trim())) return { anz: 1, max: 1 };
	}
	return {};
};

/** votemanager-Zeitstempel "08.04.2022 12:45" → ISO-String (Europe/Berlin, ohne Sommerzeit-Genauigkeit) */
export const parseZeitstempel = (s: string | undefined): string => {
	if (!s) return "";
	const m = s.match(/(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})/);
	if (!m) return s;
	const [, d, mo, y, h, mi] = m;
	const monat = Number(mo);
	const offset = monat >= 4 && monat <= 10 ? "+02:00" : "+01:00";
	return `${y}-${mo}-${d}T${h}:${mi}:00${offset}`;
};

const KENNZAHL_LABELS: Array<[RegExp, keyof Kennzahlen]> = [
	[/wahlberechtigte/i, "wahlberechtigte"],
	[/wähler/i, "waehler"],
	[/ungültige stimm/i, "ungueltig"],
	[/gültige stimmzettel/i, "gueltig"],
	[/gültige stimmen/i, "stimmen"],
];

const parseKennzahlen = (
	zeilen: RohZeile[] | undefined,
	wahlbeteiligung?: number,
): Kennzahlen => {
	const k: Kennzahlen = {};
	for (const z of zeilen ?? []) {
		const label = z.label.labelKurz;
		for (const [re, feld] of KENNZAHL_LABELS) {
			if (re.test(label) && k[feld] === undefined) {
				k[feld] = parseZahl(z.zahl);
				if (feld === "waehler") k.wahlbeteiligung = parseProzent(z.prozent);
				break;
			}
		}
	}
	if (k.gueltig === undefined && k.stimmen !== undefined) k.gueltig = k.stimmen;
	if (wahlbeteiligung !== undefined) k.wahlbeteiligung = wahlbeteiligung;
	return k;
};

const VERHAELTNIS_RE =
	/^(.*?) - (Summe Partei- und Kandidaten-Stimmen|Stimmen für die Partei|Summe Kandidaten-Stimmen)$/;

const parteienAusTabelle = (zeilen: RohZeile[]): Map<string, Partei> => {
	const out = new Map<string, Partei>();
	for (const z of zeilen) {
		const m = z.label.labelKurz.match(VERHAELTNIS_RE);
		if (!m || m[2] !== "Summe Partei- und Kandidaten-Stimmen") continue;
		const kurz = m[1];
		const key = parteiKey(kurz);
		if (out.has(key)) continue;
		out.set(key, {
			key,
			kurz,
			lang: z.label.labelLang?.match(VERHAELTNIS_RE)?.[1] ?? kurz,
			farbe: z.color ?? "",
			stimmen: parseZahl(z.zahl) ?? 0,
			prozent: parseProzent(z.prozent) ?? 0,
		});
	}
	return out;
};

export const gebietsnamen = (
	seitentitel: string,
	behoerdeName?: string,
): { gebietTitel: string; gebietKurz: string } => {
	const teile = seitentitel.split(" - ");
	const gebietTitel = (teile.length > 1 ? teile.slice(1) : teile)
		.join(" - ")
		.trim();
	let kurz = gebietTitel;
	if (behoerdeName && kurz.startsWith(`${behoerdeName} - `))
		kurz = kurz.slice(behoerdeName.length + 3);
	const m = kurz.match(/^(.+) - (Ortschaft \1)$/);
	if (m) kurz = m[2];
	return { gebietTitel, gebietKurz: kurz || gebietTitel };
};

export const parseErgebnis = (
	roh: RohErgebnis,
	personenwahl: boolean,
	behoerdeName?: string,
): Ergebnis => {
	const K = roh.Komponente;
	const titel = roh.seitentitel ?? "";
	const base: Ergebnis = {
		titel,
		...gebietsnamen(titel, behoerdeName),
		zeitstempel: parseZeitstempel(roh.zeitstempel),
		leer: true,
		personenwahl,
		stand: { hinweis: [] },
		kennzahlen: {},
		parteien: [],
		untergebiete: [],
	};
	if (!K) return base;

	const hinweis = (K.info?.hinweis ?? []).filter(
		(h): h is string => typeof h === "string" && h.trim() !== "",
	);
	base.stand = { ...parseStand(hinweis), hinweis };
	base.kennzahlen = parseKennzahlen(
		K.info?.tabelle?.zeilen,
		K.wahlbeteiligung?.text?.prozent,
	);
	base.untergebiete = (K.gebietsverlinkung ?? []).map((g) => ({
		titel: g.titel,
		gebiete: g.gebietslinks
			.filter((l) => l.id)
			.map((l) => ({ id: l.id as string, titel: l.title })),
	}));

	const balken = [
		...(K.grafik?.balken ?? []),
		...(K.grafik?.sonstigeBalken ?? []),
	];
	let parteien: Partei[] = balken.map((b) => {
		const lang = b.bezeichnungAusfuehrlich ?? b.bezeichnung;
		const p: Partei = {
			key: parteiKey(b.bezeichnung),
			kurz: b.bezeichnung,
			lang,
			farbe: b.color,
			stimmen: b.wert,
			prozent: b.prozentGerundet,
		};
		if (personenwahl) p.kandidat = splitKandidat(b.bezeichnung, lang);
		return p;
	});

	if (!personenwahl) {
		const ausTabelle = parteienAusTabelle(K.tabelle?.zeilen ?? []);
		if (ausTabelle.size > 0 && !parteien.some((p) => ausTabelle.has(p.key)))
			parteien = [...ausTabelle.values()];
		const byKey = new Map(parteien.map((p) => [p.key, p]));
		for (const z of K.tabelle?.zeilen ?? []) {
			const m = z.label.labelKurz.match(VERHAELTNIS_RE);
			if (!m) continue;
			const p = byKey.get(parteiKey(m[1]));
			if (!p) continue;
			if (m[2] === "Stimmen für die Partei")
				p.listenstimmen = parseZahl(z.zahl);
			if (m[2] === "Summe Kandidaten-Stimmen") {
				p.kandidatenstimmen = parseZahl(z.zahl);
				p.kandidaten = (z.sub_zeilen ?? []).map((s) => ({
					name: s.label.labelKurz,
					stimmen: parseZahl(s.zahl) ?? 0,
					prozentInPartei: parseProzent(s.prozent),
				}));
			}
		}
	}

	const S = K.sitze;
	if (S?.tortenDiagramm?.entries?.length) {
		const verteilung = S.tortenDiagramm.entries.map((e) => {
			const p = parteiZuSitzeintrag(parteien, e.label, e.tooltip);
			return {
				key: p?.key ?? parteiKey(e.label),
				kurz: p?.kurz ?? e.label,
				lang: p?.lang ?? e.tooltip ?? e.label,
				farbe: e.color,
				sitze: e.sitze,
			};
		});
		const gesamt = verteilung.reduce((a, e) => a + e.sitze, 0);
		const gewaehlte = (S.tabelle?.zeilen ?? []).map((r) => ({
			partei: r[0] ?? "",
			name: r[1] ?? "",
			mandat: r[2] ?? "",
			stimmen: parseZahl(r[3]),
		}));
		base.sitze = { gesamt, hinweis: S.hinweis ?? "", verteilung, gewaehlte };
	}

	base.parteien = parteien;
	base.leer =
		parteien.length === 0 && base.kennzahlen.wahlberechtigte === undefined;
	if (
		!base.leer &&
		base.stand.anz === undefined &&
		base.kennzahlen.waehler !== undefined
	)
		base.stand = { ...base.stand, anz: 1, max: 1 };
	return base;
};

export const parseUebersicht = (roh: RohUebersicht): Uebersicht => {
	const t = roh.tabelle;
	const header = t?.header ?? [];
	const spalten = header
		.slice(4)
		.map((h) => ({ kurz: h.labelKurz, lang: h.labelLang }));
	const zeilen: UebersichtZeile[] = (t?.zeilen ?? []).map((z) => {
		const felder = z.felder ?? [];
		const status = (z.statusString ?? "").trim();
		return {
			label: z.label,
			gebietId: z.link?.id,
			externeUrl: z.link?.type === "external" ? z.link.url : undefined,
			status,
			statusProzent: z.statusProzent,
			stimmbezirk: Boolean(z.stimmbezirk),
			wahlberechtigte: parseZahl(felder[0]?.absolut),
			wahlbeteiligung: parseProzent(felder[1]?.prozent),
			werte: spalten.map((s, i) => ({
				kurz: s.kurz,
				absolut: parseZahl(felder[i + 2]?.absolut),
				prozent: parseProzent(felder[i + 2]?.prozent),
			})),
		};
	});
	return {
		titel: roh.seitentitel ?? "",
		zeitstempel: parseZeitstempel(roh.zeitstempel),
		spalten,
		zeilen,
	};
};

export const parseTermin = (roh: RohTermin): Wahleintrag[] =>
	(roh.wahleintraege ?? [])
		.filter((e) => e.gebiet_link?.id)
		.map((e) => ({
			wahlId: e.wahl.id,
			titel: e.wahl.titel,
			gebietId: e.gebiet_link.id as string,
			gebietTitel: e.gebiet_link.title,
			leer: Boolean(e.leer),
		}));

export const parseWahl = (roh: RohWahl): WahlInfo => ({
	titel: roh.titel,
	datum: roh.datum,
	status: roh.ergebnisstatus?.[0]?.status,
	uebersichten: (roh.menu_links ?? [])
		.filter((l) => l.type === "uebersicht" && l.id)
		.map((l) => ({ ebene: l.id as string, titel: l.title })),
	ergebnisse: (roh.menu_links ?? [])
		.filter((l) => l.type === "ergebnis" && l.id)
		.map((l) => ({ id: l.id as string, titel: l.title })),
});

export const parseWahlraeume = (roh: RohWahlraeume): Wahlraum[] => {
	const idx = (name: string) =>
		roh.headers.findIndex((h) => h.toLowerCase() === name);
	const iOrt = idx("ortsteil");
	const iWb = idx("wahlbereich");
	const iKwb = idx("kreiswahlbereich");
	return (roh.wahlraeume ?? []).map((w) => ({
		id: w.id,
		titel: w.titel,
		barrierefrei: /barrierefrei/i.test(w.barrierefrei ?? ""),
		bezirk: w.bezirke[0] ?? "",
		ortsteil: iOrt >= 0 ? w.bezirke[iOrt] || undefined : undefined,
		wahlbereich: iWb >= 0 ? w.bezirke[iWb] || undefined : undefined,
		kreiswahlbereich: iKwb >= 0 ? w.bezirke[iKwb] || undefined : undefined,
	}));
};

export type ListingEintrag = {
	name: string;
	geaendert: string;
	groesse: string;
};

export const parseListing = (html: string): ListingEintrag[] => {
	const out: ListingEintrag[] = [];
	const re =
		/<a href="([^"?/][^"]*)">[^<]*<\/a><\/td><td[^>]*>\s*([^<]*?)\s*<\/td><td[^>]*>\s*([^<]*?)\s*<\/td>/g;
	for (const m of html.matchAll(re))
		out.push({ name: m[1], geaendert: m[2], groesse: m[3] });
	if (out.length === 0) {
		for (const m of html.matchAll(
			/<a href="((?:ergebnis|uebersicht|gesamtansicht|wahl)[^"]*\.json)"/g,
		))
			out.push({ name: m[1], geaendert: "", groesse: "" });
	}
	return out;
};

/** "ergebnis_ebene_6_id_3111_0.json" → { gebietId: "ebene_6_id_3111", stimmentyp: 0 } */
export const parseErgebnisDateiname = (
	name: string,
): { gebietId: string; stimmentyp: number } | undefined => {
	const m = name.match(/^ergebnis_(ebene_-?\d+_id_\d+)_(\d+)\.json$/);
	return m ? { gebietId: m[1], stimmentyp: Number(m[2]) } : undefined;
};

export const agsAusPraesentationsUrl = (
	url: string | undefined,
): string | undefined => url?.match(/(?:^|\/)(\d{8,9})(?:\/|$)/)?.[1];

/** "ebene_6_id_3111" → 6 */
export const ebeneVonGebietId = (id: string): number => {
	const m = id.match(/^ebene_(-?\d+)_id_/);
	return m ? Number(m[1]) : Number.NaN;
};

/** Nur echte Gebiets-Ids ("ebene_6_id_3111"), keine externen Verweise. */
export const istGebietId = (id: string | undefined): id is string =>
	Boolean(id && /^ebene_-?\d+_id_\d+$/.test(id));
