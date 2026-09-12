import type { Behoerde } from "../data/behoerden.ts";
import {
	KREISE,
	type Kreis,
	kreisbehoerdeVon,
	wurzelVon,
} from "../data/kreise.ts";
import {
	type Fundort,
	type RohTerminIndex,
	type Termin,
	apiBasisVon,
	findeOrdner,
	openDataUrl,
	opendataBasisVon,
	parseTerminIndex,
	terminGiltFuerBehoerde,
	terminGiltIrgendwoImKreis,
	terminIndexUrl,
	vorgabeFundort,
} from "../data/termine.ts";
import { type Db, jetzt, metaGet, metaSet, transaktion } from "./db.ts";
import { type Drossel, grenzenAusUmgebung, hostDrossel } from "./drossel.ts";
import { hash } from "./hash.ts";
import {
	type Wahlvorschlag,
	ordneCsvsZuWahlen,
	ordneListenplaetze,
	parseCsv,
	parteienAusOpenData,
	summiereKandidatenspalten,
} from "./liste.ts";
import {
	type Ergebnis,
	type ListingEintrag,
	type RohErgebnis,
	type RohTermin,
	type RohUebersicht,
	type RohWahl,
	type RohWahlraeume,
	type Uebersicht,
	type Wahleintrag,
	ebeneVonGebietId,
	parseErgebnis,
	parseErgebnisDateiname,
	parseListing,
	parseTermin,
	parseUebersicht,
	parseWahl,
	parseWahlraeume,
} from "./votemanager.ts";
import {
	WAHLTYP_REIHENFOLGE,
	erkenneWahltyp,
	istPersonenwahl,
	wahlSlugs,
} from "./wahltyp.ts";

type RohOpenData = {
	csvs?: Array<{ wahl: string; ebene: string; url: string }>;
	dateifelder?: Array<{
		name: string;
		parteien?: Array<{ feld: string; wert: string }>;
	}>;
};

const UA =
	"wahlergebnisse-niedersachsen/2.0 (+https://wahlergebnisse.levinkeller.de; post@levinkeller.de)";
const TIMEOUT_MS = 20_000;
/** Gleichzeitige Anfragen innerhalb einer Wahl. */
const PARALLEL = 4;
const BEHOERDEN_PARALLEL = Number(process.env.POLL_PARALLEL ?? 16);

const drossel = hostDrossel({
	grenzen: grenzenAusUmgebung(process.env.POLL_HOST_GRENZEN),
});

const STRUKTUR_MAX_ALTER_S = Number(
	process.env.POLL_STRUKTUR_MAX_ALTER_SEKUNDEN ?? 6 * 3600,
);

const LISTING_MAX_ALTER_S = Number(
	process.env.POLL_LISTING_MAX_ALTER_SEKUNDEN ?? 6 * 3600,
);

const ARCHIV_PARALLEL = Number(process.env.POLL_ARCHIV_PARALLEL ?? 2);

const ARCHIV_PRO_SEKUNDE = Number(process.env.POLL_ARCHIV_PRO_SEKUNDE ?? 4);

const NACHSCHAU_S = Number(process.env.POLL_NACHSCHAU_SEKUNDEN ?? 900);

export type PollOptionen = {
	/** Alle Dateien neu holen, auch wenn Stand/ETag unverändert */
	force?: boolean;
	/** Nur diese Behörden (AGS) abfragen */
	nurBehoerden?: string[];
	/** Nur diese Kreise (Slug) abfragen */
	nurKreise?: string[];
	log?: (msg: string) => void;
};

export type Statistik = {
	anfragen: number;
	geaendert: number;
	fehler: string[];
};

export type Lauf = Statistik & { bremse?: Drossel };

let liveLaeufe = 0;

const schlaf = (ms: number) => new Promise((r) => setTimeout(r, ms));

const warteAufLuecke = async (): Promise<void> => {
	while (liveLaeufe > 0) await schlaf(1_000);
};

type Geholt = { body: string; geaendert: boolean };

const holeDatei = async (
	db: Db,
	url: string,
	stat: Lauf,
	opts: {
		force?: boolean;
		stand?: string;
		behalten?: boolean;
		/** Sekunden, die der gespeicherte Inhalt ohne Nachfrage gilt */
		maxAlter?: number;
	},
): Promise<Geholt | undefined> => {
	const alt = db
		.prepare(
			"SELECT etag, listing_stand, hash, body, geholt_am FROM dateien WHERE url = ?",
		)
		.get(url) as
		| {
				etag: string | null;
				listing_stand: string | null;
				hash: string | null;
				body: string | null;
				geholt_am: string;
		  }
		| undefined;
	if (!opts.force && alt && opts.stand && alt.listing_stand === opts.stand) {
		return alt.body ? { body: alt.body, geaendert: false } : undefined;
	}
	if (
		!opts.force &&
		alt?.body &&
		opts.maxAlter &&
		Date.now() - Date.parse(alt.geholt_am) < opts.maxAlter * 1000
	) {
		return { body: alt.body, geaendert: false };
	}
	const headers: Record<string, string> = {
		"User-Agent": UA,
		Accept: "application/json, text/html;q=0.5, */*;q=0.1",
	};
	if (alt?.etag && !opts.force) headers["If-None-Match"] = alt.etag;
	const host = new URL(url).host;
	if (stat.bremse) await stat.bremse.nimm(host);
	await drossel.nimm(host);
	stat.anfragen++;
	const res = await fetch(url, {
		headers,
		signal: AbortSignal.timeout(TIMEOUT_MS),
	});
	const now = jetzt();
	if (res.status === 304) {
		db.prepare(
			"UPDATE dateien SET geholt_am = ?, listing_stand = ? WHERE url = ?",
		).run(now, opts.stand ?? alt?.listing_stand ?? null, url);
		return alt?.body ? { body: alt.body, geaendert: false } : undefined;
	}
	if (res.status === 404) {
		if (opts.stand)
			db.prepare(
				`INSERT INTO dateien (url, etag, listing_stand, hash, geholt_am, geaendert_am, body) VALUES (?, NULL, ?, NULL, ?, ?, NULL)
				 ON CONFLICT(url) DO UPDATE SET listing_stand = excluded.listing_stand, geholt_am = excluded.geholt_am`,
			).run(url, opts.stand, now, now);
		return undefined;
	}
	if (!res.ok) throw new Error(`${res.status} ${res.statusText} für ${url}`);
	const body = await res.text();
	const h = hash(body);
	const geaendert = alt?.hash !== h;
	db.prepare(
		`INSERT INTO dateien (url, etag, listing_stand, hash, geholt_am, geaendert_am, body) VALUES (?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(url) DO UPDATE SET etag = excluded.etag, listing_stand = excluded.listing_stand, hash = excluded.hash,
		   geholt_am = excluded.geholt_am, geaendert_am = CASE WHEN dateien.hash = excluded.hash THEN dateien.geaendert_am ELSE excluded.geaendert_am END,
		   body = excluded.body`,
	).run(
		url,
		res.headers.get("etag"),
		opts.stand ?? null,
		h,
		now,
		now,
		opts.behalten ? body : null,
	);
	if (geaendert) stat.geaendert++;
	return { body, geaendert };
};

const holeJson = async <T>(
	db: Db,
	url: string,
	stat: Lauf,
	opts: {
		force?: boolean;
		stand?: string;
		behalten?: boolean;
		maxAlter?: number;
	},
) => {
	const g = await holeDatei(db, url, stat, opts);
	if (!g) return undefined;
	try {
		return { data: JSON.parse(g.body) as T, geaendert: g.geaendert };
	} catch {
		throw new Error(`Kein JSON: ${url}`);
	}
};

/** Läuft `fn` über alle Elemente mit begrenzter Parallelität. */
const parallel = async <T>(
	items: T[],
	fn: (t: T) => Promise<void>,
	n = PARALLEL,
): Promise<void> => {
	let i = 0;
	const worker = async () => {
		while (i < items.length) {
			const item = items[i++];
			await fn(item);
		}
	};
	await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
};

const normTitel = (s: string): string =>
	s
		.toLowerCase()
		.replace(/[äöü]/g, (c) => ({ ä: "ae", ö: "oe", ü: "ue" })[c] ?? c)
		.replace(/ß/g, "ss")
		.replace(/[^a-z0-9]/g, "");

const standText = (e: Ergebnis): string => {
	const { anz, max } = e.stand;
	if (anz === undefined || max === undefined) return "";
	if (max <= 1) return anz >= 1 ? "ausgezählt" : "offen";
	return `${anz} von ${max}`;
};

export const speichereErgebnis = (
	db: Db,
	termin: Termin,
	behoerde: string,
	wahlId: number,
	wahlTitel: string,
	gebietId: string,
	e: Ergebnis,
	stat: Lauf,
): void => {
	const json = JSON.stringify(e);
	const h = hash(json);
	const alt = db
		.prepare(
			"SELECT hash, stand_anz, stand_max, leer FROM ergebnisse WHERE termin = ? AND behoerde = ? AND wahl_id = ? AND gebiet_id = ?",
		)
		.get(termin.id, behoerde, wahlId, gebietId) as
		| {
				hash: string;
				stand_anz: number | null;
				stand_max: number | null;
				leer: number;
		  }
		| undefined;
	if (alt && alt.hash === h) return;
	const now = jetzt();
	const anz = e.stand.anz ?? null;
	const max = e.stand.max ?? null;
	const fertig = anz !== null && max !== null && max > 0 && anz >= max;
	const warFertig =
		alt &&
		alt.stand_anz !== null &&
		alt.stand_max !== null &&
		alt.stand_max > 0 &&
		alt.stand_anz >= alt.stand_max;
	db.prepare(
		`INSERT INTO ergebnisse (termin, behoerde, wahl_id, gebiet_id, ebene, titel, leer, stand_anz, stand_max, json, hash, aktualisiert, eingegangen_am)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(termin, behoerde, wahl_id, gebiet_id) DO UPDATE SET ebene = excluded.ebene, titel = excluded.titel, leer = excluded.leer,
		   stand_anz = excluded.stand_anz, stand_max = excluded.stand_max, json = excluded.json, hash = excluded.hash, aktualisiert = excluded.aktualisiert,
		   eingegangen_am = COALESCE(ergebnisse.eingegangen_am, excluded.eingegangen_am)`,
	).run(
		termin.id,
		behoerde,
		wahlId,
		gebietId,
		ebeneVonGebietId(gebietId),
		e.gebietKurz,
		e.leer ? 1 : 0,
		anz,
		max,
		json,
		h,
		now,
		fertig ? now : null,
	);
	stat.geaendert++;

	if (
		termin.live &&
		!e.leer &&
		anz !== null &&
		(alt === undefined || alt.leer === 1 || (alt.stand_anz ?? 0) < anz)
	) {
		const art = fertig && !warFertig ? "fertig" : "fortschritt";
		const text = fertig
			? `${e.gebietKurz}: ${wahlTitel} ${max && max > 1 ? "vollständig" : "ausgezählt"}`
			: `${e.gebietKurz}: ${wahlTitel} ${standText(e)}`;
		const spitze = e.parteien
			.slice(0, 3)
			.map((p) => ({ kurz: p.kurz, prozent: p.prozent, farbe: p.farbe }));
		db.prepare(
			"INSERT INTO ereignisse (termin, zeit, behoerde, wahl_id, gebiet_id, art, text, json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
		).run(
			termin.id,
			now,
			behoerde,
			wahlId,
			gebietId,
			art,
			text,
			JSON.stringify({
				anz,
				max,
				spitze,
				wahlbeteiligung: e.kennzahlen.wahlbeteiligung,
			}),
		);
	}
};

const speichereListenplaetze = async (
	db: Db,
	termin: Termin,
	fundort: Fundort,
	ags: string,
	wurzel: string,
	wahlId: number,
	eintraege: Wahleintrag[],
	openData: RohOpenData | undefined,
	stat: Lauf,
	opts: PollOptionen,
	/** Hat sich in dieser Wahl gerade etwas geändert? */
	geaendert: boolean,
): Promise<void> => {
	const meineWahlen = eintraege.filter((e) => e.wahlId === wahlId);
	if (meineWahlen.length === 0 || !openData?.csvs?.length) return;

	const schonDa = db
		.prepare(
			"SELECT 1 FROM wahlvorschlaege WHERE termin = ? AND behoerde = ? AND wahl_id = ? LIMIT 1",
		)
		.get(termin.id, ags, wahlId);
	if (schonDa && !geaendert && !opts.force) return;

	const ergebnisse = db
		.prepare(
			"SELECT gebiet_id, titel, json FROM ergebnisse WHERE termin = ? AND behoerde = ? AND wahl_id = ?",
		)
		.all(termin.id, ags, wahlId) as Array<{
		gebiet_id: string;
		titel: string;
		json: string;
	}>;
	if (ergebnisse.length === 0) return;

	const gesamtErgebnisse = new Map<string, Ergebnis>();
	for (const e of meineWahlen) {
		const g = ergebnisse.find((x) => x.gebiet_id === e.gebietId);
		if (g) gesamtErgebnisse.set(e.gebietId, JSON.parse(g.json) as Ergebnis);
	}
	if (
		![...gesamtErgebnisse.values()].some((e) =>
			e.parteien.some((p) => p.kandidaten?.length),
		)
	)
		return;

	const nachName = new Map(ergebnisse.map((e) => [normTitel(e.titel), e]));

	const zuordnungen = ordneCsvsZuWahlen(
		openData.csvs,
		eintraege.map((e) => ({
			schluessel: `${e.wahlId}|${e.gebietId}`,
			titel: e.titel,
			gebietTitel: e.gebietTitel,
		})),
	);

	const vorschlaege: Array<Wahlvorschlag & { gebietId: string }> = [];
	for (const eintrag of meineWahlen) {
		const zuordnung = zuordnungen.get(`${eintrag.wahlId}|${eintrag.gebietId}`);
		if (!zuordnung) continue;
		/** Hat das Gesamtgebiet dieser Wahl eine eigene CSV-Zeile bekommen? */
		let gesamtGetroffen = false;
		let einzige:
			| { zeilen: Array<Record<string, string>>; nummern: Map<number, string> }
			| undefined;
		for (const csv of zuordnung.csvs) {
			const datei = await holeDatei(
				db,
				`${opendataBasisVon(fundort, ags, wurzel)}/${csv.url}`,
				stat,
				{ force: opts.force, behalten: true },
			);
			if (!datei) continue;
			const nummern = parteienAusOpenData(
				openData.dateifelder ?? [],
				csv.wahl,
				zuordnung.ort,
			);
			const zeilen = parseCsv(datei.body);
			if (zuordnung.csvs.length === 1) einzige = { zeilen, nummern };
			for (const zeile of zeilen) {
				const name = zeile["gebiet-name"] ?? "";
				const treffer =
					nachName.get(normTitel(name)) ??
					(name === ""
						? ergebnisse.find((e) => e.gebiet_id === eintrag.gebietId)
						: undefined) ??
					nachName.get(
						normTitel(
							name.replace(
								/^(Gemeinde|Stadt|Flecken|Samtgemeinde|Ortschaft)\s+/i,
								"",
							),
						),
					);
				if (!treffer) continue;
				if (treffer.gebiet_id === eintrag.gebietId) gesamtGetroffen = true;
				const ergebnis = JSON.parse(treffer.json) as Ergebnis;
				if (!ergebnis.parteien.some((p) => p.kandidaten?.length)) continue;
				for (const v of ordneListenplaetze(
					ergebnis.parteien,
					summiereKandidatenspalten([zeile]),
					nummern,
				)) {
					vorschlaege.push({ ...v, gebietId: treffer.gebiet_id });
				}
			}
		}

		const gesamtErgebnis = gesamtErgebnisse.get(eintrag.gebietId);
		if (
			!gesamtGetroffen &&
			einzige &&
			gesamtErgebnis &&
			zuordnung.ort &&
			!/wahlbereich/i.test(zuordnung.csvs[0].ebene) &&
			gesamtErgebnis.parteien.some((p) => p.kandidaten?.length)
		) {
			for (const v of ordneListenplaetze(
				gesamtErgebnis.parteien,
				summiereKandidatenspalten(einzige.zeilen),
				einzige.nummern,
			))
				vorschlaege.push({ ...v, gebietId: eintrag.gebietId });
		}
	}
	if (vorschlaege.length === 0) return;
	transaktion(db, () => {
		db.prepare(
			"DELETE FROM wahlvorschlaege WHERE termin = ? AND behoerde = ? AND wahl_id = ?",
		).run(termin.id, ags, wahlId);
		const ins = db.prepare(
			"INSERT OR REPLACE INTO wahlvorschlaege (termin, behoerde, wahl_id, gebiet_id, partei_key, platz, name, stimmen) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
		);
		for (const v of vorschlaege)
			ins.run(
				termin.id,
				ags,
				wahlId,
				v.gebietId,
				v.parteiKey,
				v.platz,
				v.name,
				v.stimmen,
			);
	});
};

type ListingMarke = { status: number; stand: string };

const listingMarke = (db: Db, schluessel: string): ListingMarke | undefined => {
	const roh = metaGet(db, schluessel);
	if (!roh) return undefined;
	try {
		const m = JSON.parse(roh) as ListingMarke;
		return typeof m?.status === "number" && typeof m?.stand === "string"
			? m
			: undefined;
	} catch {
		return undefined;
	}
};

const listingVerweigert = (db: Db, schluessel: string): boolean => {
	const m = listingMarke(db, schluessel);
	return Boolean(
		m &&
			m.status >= 400 &&
			Date.now() - Date.parse(m.stand) < LISTING_MAX_ALTER_S * 1000,
	);
};

const merkeListing = (db: Db, schluessel: string, status: number): void =>
	metaSet(
		db,
		schluessel,
		JSON.stringify({ status, stand: jetzt() } satisfies ListingMarke),
	);

const holeListing = async (
	db: Db,
	wahlBasis: string,
	host: string,
	stat: Lauf,
	opts: PollOptionen,
): Promise<ListingEintrag[]> => {
	const schluessel = `listing:${host}`;
	if (!opts.force && listingVerweigert(db, schluessel)) return [];
	if (stat.bremse) await stat.bremse.nimm(host);
	await drossel.nimm(host);
	stat.anfragen++;
	try {
		const res = await fetch(`${wahlBasis}/`, {
			headers: { "User-Agent": UA, Accept: "text/html" },
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
		if (res.status === 403 || res.status === 401) {
			merkeListing(db, schluessel, res.status);
			return [];
		}
		if (!res.ok) return [];
		const eintraege = parseListing(await res.text());
		merkeListing(db, schluessel, res.status);
		return eintraege;
	} catch {
		return [];
	}
};

type GespeicherterFundort = Fundort & { stand: string; imIndex: boolean };

const fundortSchluessel = (termin: Termin, ags: string): string =>
	`fundort:${termin.id}:${ags}`;

const merkeFundort = (
	db: Db,
	termin: Termin,
	ags: string,
	f: Fundort,
	imIndex: boolean,
): void =>
	metaSet(
		db,
		fundortSchluessel(termin, ags),
		JSON.stringify({
			...f,
			imIndex,
			stand: jetzt(),
		} satisfies GespeicherterFundort),
	);

const gemerkterFundort = (
	db: Db,
	termin: Termin,
	ags: string,
): GespeicherterFundort | undefined => {
	const roh = metaGet(db, fundortSchluessel(termin, ags));
	if (!roh) return undefined;
	try {
		const g = JSON.parse(roh) as GespeicherterFundort;
		if (Date.now() - Date.parse(g.stand) > STRUKTUR_MAX_ALTER_S * 1000)
			return undefined;
		return g;
	} catch {
		return undefined;
	}
};

const fundortFuer = async (
	db: Db,
	termin: Termin,
	kreis: Kreis,
	behoerde: Behoerde,
	stat: Lauf,
	opts: PollOptionen,
): Promise<GespeicherterFundort> => {
	if (!opts.force) {
		const gemerkt = gemerkterFundort(db, termin, behoerde.ags);
		if (gemerkt) return gemerkt;
	}
	const vorgabe = vorgabeFundort(termin);
	let fundort = vorgabe;
	let imIndex = false;
	try {
		const index = await holeJson<RohTerminIndex>(
			db,
			terminIndexUrl(behoerde.ags, wurzelVon(kreis, behoerde)),
			stat,
			{ behalten: true, maxAlter: STRUKTUR_MAX_ALTER_S },
		);
		const ordner = index && findeOrdner(parseTerminIndex(index.data), termin);
		if (ordner) {
			fundort = { ...vorgabe, ordner };
			imIndex = true;
		}
	} catch {}
	merkeFundort(db, termin, behoerde.ags, fundort, imIndex);
	return { ...fundort, imIndex, stand: jetzt() };
};

/** Nur echte Gebiets-Ids ("ebene_6_id_3111"), keine externen Verweise. */
const istGebietId = (id: string | undefined): id is string =>
	Boolean(id && /^ebene_-?\d+_id_\d+$/.test(id));

const EBENE_WAHLBEZIRK = 6;

const wahlraumGebiete = (db: Db, termin: Termin, ags: string): string[] =>
	(
		db
			.prepare(
				"SELECT id FROM wahlraeume WHERE termin = ? AND behoerde = ? ORDER BY id",
			)
			.all(termin.id, ags) as Array<{ id: number }>
	).map((r) => `ebene_${EBENE_WAHLBEZIRK}_id_${r.id}`);

/** Gebiete, für die diese Wahl schon einmal ein Ergebnis geschrieben hat. */
const gemerkteGebiete = (
	db: Db,
	termin: Termin,
	ags: string,
	wahlId: number,
): string[] =>
	(
		db
			.prepare(
				"SELECT gebiet_id FROM ergebnisse WHERE termin = ? AND behoerde = ? AND wahl_id = ?",
			)
			.all(termin.id, ags, wahlId) as Array<{ gebiet_id: string }>
	).map((r) => r.gebiet_id);

/**
 * Kennung der Veröffentlichung: der Inhalt der Gesamtgebiete dieser Wahl. Eine
 * Wahlleitung schreibt ihre Präsentation in einem Zug – ändert sich das
 * Gesamtgebiet, sind auch die Untergebiete neu.
 */
const veroeffentlichung = (
	db: Db,
	wahlBasis: string,
	gesamtGebiete: Set<string>,
): string | undefined => {
	if (gesamtGebiete.size === 0) return undefined;
	const teile = [...gesamtGebiete].map(
		(g) =>
			(
				db
					.prepare("SELECT hash FROM dateien WHERE url = ?")
					.get(`${wahlBasis}/ergebnis_${g}_0.json`) as
					| { hash: string | null }
					| undefined
			)?.hash,
	);
	return teile.every((h) => h) ? `gesamt ${teile.join("|")}` : undefined;
};

/** Eine Behörde eines Termins vollständig abgleichen. */
const pollBehoerde = async (
	db: Db,
	termin: Termin,
	kreis: Kreis,
	behoerde: Behoerde,
	stat: Lauf,
	opts: PollOptionen,
): Promise<void> => {
	const log = opts.log ?? (() => {});
	const ags = behoerde.ags;
	const wurzel = wurzelVon(kreis, behoerde);
	const host = new URL(wurzel).host;
	const struktur = {
		force: opts.force,
		behalten: true,
		maxAlter: STRUKTUR_MAX_ALTER_S,
	};

	let fundort: Fundort = await fundortFuer(
		db,
		termin,
		kreis,
		behoerde,
		stat,
		opts,
	);
	const imIndex = (fundort as GespeicherterFundort).imIndex;
	let terminJson = await holeJson<RohTermin>(
		db,
		`${apiBasisVon(fundort, ags, wurzel)}/termin.json`,
		stat,
		struktur,
	);
	if (!terminJson && imIndex) {
		const anders: Fundort = {
			...fundort,
			layout: fundort.layout === "v22" ? "v26" : "v22",
		};
		terminJson = await holeJson<RohTermin>(
			db,
			`${apiBasisVon(anders, ags, wurzel)}/termin.json`,
			stat,
			struktur,
		);
		if (terminJson) {
			fundort = anders;
			merkeFundort(db, termin, ags, fundort, true);
		}
	}
	if (!terminJson) {
		log(`${termin.id}/${ags}: kein termin.json (404)`);
		return;
	}
	const basis = apiBasisVon(fundort, ags, wurzel);
	const eintraege = parseTermin(terminJson.data);

	transaktion(db, () => {
		db.prepare(
			"DELETE FROM wahleintraege WHERE termin = ? AND behoerde = ?",
		).run(termin.id, ags);
		const ins = db.prepare(
			"INSERT INTO wahleintraege (termin, behoerde, wahl_id, gebiet_id, titel, gebiet_titel, gebiet, typ, slug, reihenfolge) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
		);
		const slugs = wahlSlugs(eintraege, behoerde.name);
		eintraege.forEach((e, i) => {
			ins.run(
				termin.id,
				ags,
				e.wahlId,
				e.gebietId,
				e.titel,
				e.gebietTitel,
				slugs[i].gebiet,
				slugs[i].typ,
				slugs[i].slug,
				WAHLTYP_REIHENFOLGE.indexOf(slugs[i].typ) * 1000 + i,
			);
		});
	});

	const wr = await holeJson<RohWahlraeume>(
		db,
		`${basis}/wahlraeume_uebersicht.json`,
		stat,
		struktur,
	);
	if (wr?.geaendert || opts.force) {
		const raeume = parseWahlraeume(wr?.data ?? { headers: [], wahlraeume: [] });
		transaktion(db, () => {
			db.prepare(
				"DELETE FROM wahlraeume WHERE termin = ? AND behoerde = ?",
			).run(termin.id, ags);
			const ins = db.prepare(
				"INSERT INTO wahlraeume (termin, behoerde, id, titel, bezirk, ortsteil, wahlbereich, kreiswahlbereich, barrierefrei) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
			);
			for (const r of raeume)
				ins.run(
					termin.id,
					ags,
					r.id,
					r.titel,
					r.bezirk,
					r.ortsteil ?? null,
					r.wahlbereich ?? null,
					r.kreiswahlbereich ?? null,
					r.barrierefrei ? 1 : 0,
				);
		});
	}

	const wahlraumIds = wahlraumGebiete(db, termin, ags);
	const wahlraumStand = wahlraumIds.length
		? `wahlraeume ${hash(wahlraumIds.join(","))}`
		: undefined;

	const openData = await holeJson<RohOpenData>(
		db,
		openDataUrl(fundort, ags, wurzel),
		stat,
		struktur,
	);

	const wahlIds = [...new Set(eintraege.map((e) => e.wahlId))];
	for (const wahlId of wahlIds) {
		const wahlBasis = `${basis}/wahl_${wahlId}`;
		const geaendertVorWahl = stat.geaendert;
		const titelEintrag =
			eintraege.find((e) => e.wahlId === wahlId)?.titel ?? String(wahlId);
		const typ = erkenneWahltyp(titelEintrag, behoerde.name);
		const personenwahl = istPersonenwahl(typ);
		let wahlTitel = titelEintrag.split(" - ")[0];

		try {
			const wahlJson = await holeJson<RohWahl>(
				db,
				`${wahlBasis}/wahl.json`,
				stat,
				struktur,
			);
			const info = wahlJson ? parseWahl(wahlJson.data) : undefined;
			if (info) {
				wahlTitel = info.titel.split(" - ")[0] || wahlTitel;
				db.prepare(
					`INSERT INTO wahlen (termin, behoerde, wahl_id, titel, typ, datum, status, json, aktualisiert) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
					 ON CONFLICT(termin, behoerde, wahl_id) DO UPDATE SET titel = excluded.titel, typ = excluded.typ, datum = excluded.datum, status = excluded.status, json = excluded.json, aktualisiert = excluded.aktualisiert`,
				).run(
					termin.id,
					ags,
					wahlId,
					info.titel,
					typ,
					info.datum,
					info.status ?? null,
					JSON.stringify(info),
					jetzt(),
				);
			}

			const gebiete = new Set<string>();
			const stands = new Map<string, string>();
			const gesamtGebiete = new Set(
				eintraege.filter((e) => e.wahlId === wahlId).map((e) => e.gebietId),
			);
			for (const g of gesamtGebiete) gebiete.add(g);
			for (const g of info?.ergebnisse ?? []) gebiete.add(g.id);

			const ebenen = new Set(info?.uebersichten.map((u) => u.ebene) ?? []);
			for (const r of db
				.prepare(
					"SELECT ebene FROM uebersichten WHERE termin = ? AND behoerde = ? AND wahl_id = ?",
				)
				.all(termin.id, ags, wahlId) as Array<{ ebene: string }>)
				ebenen.add(r.ebene);

			for (const d of await holeListing(db, wahlBasis, host, stat, opts)) {
				const ebene = d.name.match(/^uebersicht_(ebene_-?\d+)_0\.json$/);
				if (ebene) ebenen.add(ebene[1]);
				const datei = parseErgebnisDateiname(d.name);
				if (datei?.stimmentyp !== 0) continue;
				gebiete.add(datei.gebietId);
				if (d.geaendert)
					stands.set(datei.gebietId, `${d.geaendert} ${d.groesse}`);
			}

			await parallel([...ebenen], async (ebene) => {
				const r = await holeJson<RohUebersicht>(
					db,
					`${wahlBasis}/uebersicht_${ebene}_0.json`,
					stat,
					{ force: opts.force },
				);
				let u: Uebersicht | undefined;
				if (r && (r.geaendert || opts.force)) {
					u = parseUebersicht(r.data);
					const json = JSON.stringify(u);
					db.prepare(
						`INSERT INTO uebersichten (termin, behoerde, wahl_id, ebene, titel, json, hash, aktualisiert) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
						 ON CONFLICT(termin, behoerde, wahl_id, ebene) DO UPDATE SET titel = excluded.titel, json = excluded.json, hash = excluded.hash, aktualisiert = excluded.aktualisiert`,
					).run(
						termin.id,
						ags,
						wahlId,
						ebene,
						u.titel,
						json,
						hash(json),
						jetzt(),
					);
				} else {
					const alt = db
						.prepare(
							"SELECT json FROM uebersichten WHERE termin = ? AND behoerde = ? AND wahl_id = ? AND ebene = ?",
						)
						.get(termin.id, ags, wahlId, ebene) as { json: string } | undefined;
					if (alt) u = JSON.parse(alt.json) as Uebersicht;
				}
				for (const z of u?.zeilen ?? []) {
					if (!istGebietId(z.gebietId)) continue;
					gebiete.add(z.gebietId);
					stands.set(z.gebietId, hash(JSON.stringify(z)));
				}
			});

			for (const g of gesamtGebiete) stands.delete(g);

			const holeGebiet = async (gebietId: string) => {
				const r = await holeJson<RohErgebnis>(
					db,
					`${wahlBasis}/ergebnis_${gebietId}_0.json`,
					stat,
					{ force: opts.force, stand: stands.get(gebietId) },
				);
				if (!r || (!r.geaendert && !opts.force)) return;
				const e = parseErgebnis(r.data, personenwahl, behoerde.name);
				speichereErgebnis(
					db,
					termin,
					ags,
					wahlId,
					wahlTitel,
					gebietId,
					e,
					stat,
				);
			};

			await parallel([...gesamtGebiete], holeGebiet);

			const marke = veroeffentlichung(db, wahlBasis, gesamtGebiete);
			for (const g of gemerkteGebiete(db, termin, ags, wahlId)) {
				if (gebiete.has(g)) continue;
				gebiete.add(g);
				if (marke) stands.set(g, marke);
			}

			await parallel(
				[...gebiete].filter((g) => !gesamtGebiete.has(g)),
				holeGebiet,
			);

			const ausWahlraeumen = wahlraumIds.filter(
				(g) => !gebiete.has(g) && !gesamtGebiete.has(g),
			);
			const wahlraumMarke = marke ?? wahlraumStand;
			if (wahlraumMarke)
				for (const g of ausWahlraeumen) stands.set(g, wahlraumMarke);
			await parallel(ausWahlraeumen, holeGebiet);

			await speichereListenplaetze(
				db,
				termin,
				fundort,
				ags,
				wurzel,
				wahlId,
				eintraege,
				openData?.data,
				stat,
				opts,
				stat.geaendert > geaendertVorWahl,
			);
		} catch (err) {
			const msg = `${termin.id}/${ags}/wahl_${wahlId}: ${(err as Error).message}${process.env.DEBUG ? `\n${(err as Error).stack}` : ""}`;
			stat.fehler.push(msg);
			log(msg);
		}
	}
	log(
		`${termin.id}/${ags}: ${wahlIds.length} Wahlen, bisher ${stat.anfragen} Anfragen, ${stat.geaendert} Änderungen`,
	);
};

export const behoerdenFuer = (
	db: Db,
	termin: Termin,
	opts: PollOptionen = {},
): Array<{ kreis: Kreis; behoerde: Behoerde }> =>
	KREISE.filter(
		(k) =>
			k.behoerden.length > 0 &&
			terminGiltIrgendwoImKreis(termin, k.slug) &&
			(!opts.nurKreise || opts.nurKreise.includes(k.slug)),
	).flatMap((kreis) =>
		kreis.behoerden
			.filter(
				(b) =>
					terminGiltFuerBehoerde(termin, kreis, b) &&
					(!termin.live || behoerdeLiefert(db, kreis, b)) &&
					(!opts.nurBehoerden || opts.nurBehoerden.includes(b.ags)),
			)
			.map((behoerde) => ({ kreis, behoerde })),
	);

const kreisMarke = (kreis: Kreis): string => `kreis:${kreis.slug}`;

const behoerdenMarke = (behoerde: Behoerde): string =>
	`behoerde:${behoerde.ags}`;

const markeGesetzt = (db: Db, marke: string): boolean =>
	metaGet(db, `${marke}:liefert`) === "ja";

/** Wird dieser Kreis als Ganzes abgefragt? */
export const kreisLiefert = (db: Db, kreis: Kreis): boolean =>
	kreis.behoerden.length > 0 &&
	(kreis.vorhanden || markeGesetzt(db, kreisMarke(kreis)));

export const behoerdeLiefert = (
	db: Db,
	kreis: Kreis,
	behoerde: Behoerde,
): boolean =>
	kreisLiefert(db, kreis) || markeGesetzt(db, behoerdenMarke(behoerde));

type Nachschauziel = { kreis: Kreis; behoerde: Behoerde; marke: string };

const nachschauZiele = (termin: Termin, opts: PollOptionen): Nachschauziel[] =>
	KREISE.flatMap((kreis) => {
		if (kreis.behoerden.length === 0) return [];
		if (!terminGiltIrgendwoImKreis(termin, kreis.slug)) return [];
		if (opts.nurKreise && !opts.nurKreise.includes(kreis.slug)) return [];
		const fuerKreis = kreisbehoerdeVon(kreis) ?? kreis.behoerden[0];
		return [
			{ kreis, behoerde: fuerKreis, marke: kreisMarke(kreis) },
			...kreis.behoerden
				.filter((b) => b.ags !== fuerKreis.ags)
				.map((behoerde) => ({
					kreis,
					behoerde,
					marke: behoerdenMarke(behoerde),
				})),
		];
	});

const nachschau = async (
	db: Db,
	termin: Termin,
	stat: Lauf,
	opts: PollOptionen,
): Promise<void> => {
	for (const { kreis, behoerde, marke } of nachschauZiele(termin, opts)) {
		if (kreisLiefert(db, kreis) || markeGesetzt(db, marke)) continue;
		const geprueft = `${marke}:geprueft`;
		const zuletzt = metaGet(db, geprueft);
		if (
			!opts.force &&
			zuletzt &&
			Date.now() - Date.parse(zuletzt) < NACHSCHAU_S * 1000
		)
			continue;
		metaSet(db, geprueft, jetzt());
		try {
			const fundort = await fundortFuer(
				db,
				termin,
				kreis,
				behoerde,
				stat,
				opts,
			);
			const da = await holeJson<RohTermin>(
				db,
				`${apiBasisVon(fundort, behoerde.ags, wurzelVon(kreis, behoerde))}/termin.json`,
				stat,
				{ force: opts.force, behalten: true },
			);
			if (!da) continue;
			metaSet(db, `${marke}:liefert`, "ja");
			opts.log?.(
				marke === kreisMarke(kreis)
					? `${termin.id}/${kreis.slug}: Präsentation ist jetzt da – der Kreis wird ab sofort abgefragt`
					: `${termin.id}/${kreis.slug}/${behoerde.slug}: die Wahlleitung liefert selbst – sie wird ab sofort abgefragt`,
			);
		} catch (err) {
			opts.log?.(
				`${termin.id}/${kreis.slug}/${behoerde.ags}: Nachschau ohne Erfolg (${(err as Error).message})`,
			);
		}
	}
};

const pollArchiv = async (
	db: Db,
	termin: Termin,
	stat: Lauf,
	opts: PollOptionen,
): Promise<void> => {
	const ziele = behoerdenFuer(db, termin, opts);
	const kreise = [
		...new Map(ziele.map((z) => [z.kreis.slug, z.kreis])).values(),
	];
	const vollerDurchlauf = !opts.nurKreise && !opts.nurBehoerden;
	for (const kreis of kreise) {
		const fertig = `termin:${termin.id}:kreis:${kreis.slug}:vollstaendig`;
		if (vollerDurchlauf && !opts.force && metaGet(db, fertig)) continue;
		const fehlerVorher = stat.fehler.length;
		const anfragenVorher = stat.anfragen;
		const begonnen = Date.now();
		await parallel(
			ziele.filter((z) => z.kreis.slug === kreis.slug),
			async ({ behoerde }) => {
				await warteAufLuecke();
				try {
					await pollBehoerde(db, termin, kreis, behoerde, stat, opts);
				} catch (err) {
					const msg = `${termin.id}/${behoerde.ags}: ${(err as Error).message}`;
					stat.fehler.push(msg);
					opts.log?.(msg);
				}
			},
			ARCHIV_PARALLEL,
		);
		if (vollerDurchlauf && stat.fehler.length === fehlerVorher)
			metaSet(db, fertig, jetzt());
		opts.log?.(
			`Archiv ${termin.id}/${kreis.slug}: ${stat.anfragen - anfragenVorher} Anfragen, ${((Date.now() - begonnen) / 1000).toFixed(1)}s, ${stat.fehler.length - fehlerVorher} Fehler`,
		);
	}
};

/** Einen Termin über alle Behörden abgleichen. */
export const pollTermin = async (
	db: Db,
	termin: Termin,
	opts: PollOptionen = {},
): Promise<Statistik> => {
	const stat: Lauf = { anfragen: 0, geaendert: 0, fehler: [] };
	const gestartet = jetzt();
	const lauf = db
		.prepare("INSERT INTO laeufe (termin, gestartet) VALUES (?, ?)")
		.run(termin.id, gestartet);
	if (termin.live) liveLaeufe++;
	try {
		if (termin.live) {
			await nachschau(db, termin, stat, opts);
			const ziele = behoerdenFuer(db, termin, opts);
			await parallel(
				ziele,
				async ({ kreis, behoerde }) => {
					try {
						await pollBehoerde(db, termin, kreis, behoerde, stat, opts);
					} catch (err) {
						const msg = `${termin.id}/${behoerde.ags}: ${(err as Error).message}`;
						stat.fehler.push(msg);
						opts.log?.(msg);
					}
				},
				BEHOERDEN_PARALLEL,
			);
		} else {
			stat.bremse = hostDrossel({
				grenzen: {},
				standard: {
					proSekunde: ARCHIV_PRO_SEKUNDE,
					spitze: ARCHIV_PRO_SEKUNDE * 2,
				},
			});
			await pollArchiv(db, termin, stat, opts);
		}
	} finally {
		if (termin.live) liveLaeufe--;
	}
	db.prepare(
		"UPDATE laeufe SET beendet = ?, anfragen = ?, geaendert = ?, fehler = ? WHERE id = ?",
	).run(
		jetzt(),
		stat.anfragen,
		stat.geaendert,
		stat.fehler.length ? stat.fehler.join("\n") : null,
		lauf.lastInsertRowid,
	);
	metaSet(db, `termin:${termin.id}:zuletzt`, jetzt());
	if (stat.geaendert > 0) metaSet(db, `termin:${termin.id}:version`, jetzt());
	const alle = behoerdenFuer(db, termin).length;
	if (
		!termin.live &&
		stat.fehler.length === 0 &&
		behoerdenFuer(db, termin, opts).length === alle
	) {
		metaSet(db, `termin:${termin.id}:vollstaendig`, jetzt());
		metaSet(db, `termin:${termin.id}:behoerden`, String(alle));
	}
	return {
		anfragen: stat.anfragen,
		geaendert: stat.geaendert,
		fehler: stat.fehler,
	};
};

export const terminVollstaendig = (db: Db, termin: Termin): boolean => {
	if (!metaGet(db, `termin:${termin.id}:vollstaendig`)) return false;
	const abgedeckt = Number(metaGet(db, `termin:${termin.id}:behoerden`) ?? 0);
	return abgedeckt >= behoerdenFuer(db, termin).length;
};
