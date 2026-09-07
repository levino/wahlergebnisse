/**
 * Der Poller: holt die votemanager-Dateien eines Wahltermins und schreibt sie
 * normalisiert in die Datenbank.
 *
 * Sparsam gegenüber dem Server des Landkreises: Pro Wahl wird zuerst das
 * Apache-Verzeichnislisting gelesen (eine Anfrage), und nur Dateien, deren
 * Änderungszeit/Größe sich geändert hat, werden geholt – zusätzlich per ETag
 * (If-None-Match), sodass unveränderte Dateien ein 304 kosten. Am Wahlabend
 * kommen so pro Lauf ungefähr so viele Anfragen zusammen wie neue Schnellmeldungen.
 */
import { BEHOERDEN, behoerdeByAgs } from "../data/behoerden.ts";
import { type Termin, apiBasis, opendataBasis } from "../data/termine.ts";
import { type Db, jetzt, metaGet, metaSet, transaktion } from "./db.ts";
import { hash } from "./hash.ts";
import {
	type Wahlvorschlag,
	ordneListenplaetze,
	parseCsv,
	parteienAusOpenData,
	summiereKandidatenspalten,
} from "./liste.ts";
import {
	type Ergebnis,
	type RohErgebnis,
	type RohTermin,
	type RohUebersicht,
	type RohWahl,
	type RohWahlraeume,
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
	wahlSlug,
} from "./wahltyp.ts";

type RohOpenData = {
	csvs?: Array<{ wahl: string; ebene: string; url: string }>;
	dateifelder?: Array<{
		name: string;
		parteien?: Array<{ feld: string; wert: string }>;
	}>;
};

const UA =
	"wahlergebnisse-hildesheim/1.0 (+https://wahlergebnisse.levinkeller.de; post@levinkeller.de)";
const TIMEOUT_MS = 20_000;
const PARALLEL = 4;

export type PollOptionen = {
	/** Alle Dateien neu holen, auch wenn Listing/ETag unverändert */
	force?: boolean;
	/** Nur diese Behörden (AGS) abfragen */
	nurBehoerden?: string[];
	log?: (msg: string) => void;
};

type Statistik = { anfragen: number; geaendert: number; fehler: string[] };

type Geholt = { body: string; geaendert: boolean };

/**
 * Holt eine Datei mit ETag-Cache. `listingStand` (Änderungszeit+Größe aus dem
 * Verzeichnislisting) erspart die Anfrage ganz, wenn es unverändert ist.
 */
const holeDatei = async (
	db: Db,
	url: string,
	stat: Statistik,
	opts: { force?: boolean; listingStand?: string; behalten?: boolean },
): Promise<Geholt | undefined> => {
	const alt = db
		.prepare(
			"SELECT etag, listing_stand, hash, body FROM dateien WHERE url = ?",
		)
		.get(url) as
		| {
				etag: string | null;
				listing_stand: string | null;
				hash: string | null;
				body: string | null;
		  }
		| undefined;
	// Unverändertes Listing (Änderungszeit + Größe) → gar nicht erst anfragen.
	if (
		!opts.force &&
		alt &&
		opts.listingStand &&
		alt.listing_stand === opts.listingStand
	) {
		return alt.body ? { body: alt.body, geaendert: false } : undefined;
	}
	const headers: Record<string, string> = {
		"User-Agent": UA,
		Accept: "application/json, text/html;q=0.5, */*;q=0.1",
	};
	if (alt?.etag && !opts.force) headers["If-None-Match"] = alt.etag;
	stat.anfragen++;
	const res = await fetch(url, {
		headers,
		signal: AbortSignal.timeout(TIMEOUT_MS),
	});
	const now = jetzt();
	if (res.status === 304) {
		db.prepare(
			"UPDATE dateien SET geholt_am = ?, listing_stand = ? WHERE url = ?",
		).run(now, opts.listingStand ?? alt?.listing_stand ?? null, url);
		// Unverändert: der gespeicherte Datensatz ist aktuell, es gibt nichts zu tun.
		// (Für die wenigen Strukturdateien liegt der Text vor, s. `behalten`.)
		return alt?.body ? { body: alt.body, geaendert: false } : undefined;
	}
	if (res.status === 404) return undefined;
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
		opts.listingStand ?? null,
		h,
		now,
		now,
		// Der Text bleibt nur bei den wenigen Strukturdateien (termin.json,
		// wahl.json, Wahlräume) liegen: die braucht jeder Lauf, auch wenn sie
		// sich nicht geändert haben. Ergebnis- und Übersichtsdateien – die
		// Masse – werden geparst gespeichert; ihr Rohtext wäre nur eine zweite
		// Kopie derselben Zahlen.
		opts.behalten ? body : null,
	);
	if (geaendert) stat.geaendert++;
	return { body, geaendert };
};

const holeJson = async <T>(
	db: Db,
	url: string,
	stat: Statistik,
	opts: { force?: boolean; listingStand?: string; behalten?: boolean },
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

/**
 * Alle Open-Data-CSVs, die zu einer Wahl gehören – je Ebene eine.
 * Beide Programmversionen benennen sie unterschiedlich („Gemeindewahl“ mit
 * Ebene „Gemeinde-Ergebnis“ 2021, „Gemeindewahl - Gemeinde Nordstemmen“ mit
 * Ebene „Gemeinde“ 2026), und bei Ortsratswahlen steht der Ort mal im Wahl-,
 * mal im Ebenen-Feld.
 */
export const csvsFuerWahl = (
	csvs: Array<{ wahl: string; ebene: string; url: string }>,
	wahlTitel: string,
	gebietTitel: string,
): Array<{ url: string; wahl: string; ebene: string }> => {
	const kern = normTitel(wahlTitel.split(" - ")[0]);
	const ort = normTitel(
		gebietTitel.replace(
			/^(Ortschaft|Gemeinde|Stadt|Flecken|Samtgemeinde)\s+/i,
			"",
		),
	);
	const passend = csvs.filter(
		(c) =>
			normTitel(c.wahl).startsWith(kern) || kern.startsWith(normTitel(c.wahl)),
	);
	if (passend.length === 0) return [];
	// Mehrere gleichnamige Wahlen (Ortsräte): über den Ortsnamen unterscheiden
	const mitOrt = passend.filter((c) =>
		normTitel(`${c.wahl}${c.ebene}`).includes(ort),
	);
	return mitOrt.length > 0 ? mitOrt : passend;
};

const standText = (e: Ergebnis): string => {
	const { anz, max } = e.stand;
	if (anz === undefined || max === undefined) return "";
	if (max <= 1) return anz >= 1 ? "ausgezählt" : "offen";
	return `${anz} von ${max}`;
};

/** Ergebnis speichern und bei neuem Stand ein Ticker-Ereignis anlegen. */
const speichereErgebnis = (
	db: Db,
	termin: Termin,
	behoerde: string,
	wahlId: number,
	wahlTitel: string,
	gebietId: string,
	e: Ergebnis,
	stat: Statistik,
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

	// Ticker: nur für Live-Termine und nur echte Fortschritte (mehr Schnellmeldungen als vorher), nicht jede Korrektur.
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

/**
 * Bestimmt die Listenplätze der Bewerber und legt sie je Gebiet ab.
 *
 * Grundlage sind die Ergebnisdateien (Namen, nach Stimmen sortiert) und die
 * Open-Data-CSVs desselben Gebiets (dieselben Zahlen in Listenreihenfolge).
 * Je Ebene gibt es eine eigene CSV; wichtig ist das vor allem bei der
 * Kreistagswahl, wo jede Partei pro Wahlbereich eine eigene Liste aufstellt.
 */
const speichereListenplaetze = async (
	db: Db,
	termin: Termin,
	ags: string,
	wahlId: number,
	eintraege: Wahleintrag[],
	openData: RohOpenData | undefined,
	stat: Statistik,
	opts: PollOptionen,
	/** Hat sich in dieser Wahl gerade etwas geändert? */
	geaendert: boolean,
): Promise<void> => {
	const eintrag = eintraege.find((e) => e.wahlId === wahlId);
	if (!eintrag || !openData?.csvs?.length) return;

	// Die Listenplätze stehen fest, sobald das Ergebnis steht. Ohne Änderung an
	// den Ergebnissen dieser Wahl müssen die CSVs nicht erneut geholt werden –
	// das sind je Wahl mehrere Dateien auf einem fremden Server.
	const schonDa = db
		.prepare(
			"SELECT 1 FROM wahlvorschlaege WHERE termin = ? AND behoerde = ? AND wahl_id = ? LIMIT 1",
		)
		.get(termin.id, ags, wahlId);
	if (schonDa && !geaendert && !opts.force) return;

	// Alle bereits gespeicherten Ergebnisse dieser Wahl, nach Gebietsnamen greifbar
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

	// Personenwahlen (Landrat, Bürgermeister) haben keine Listen – dort gibt es
	// nichts zuzuordnen, und die CSVs braucht niemand.
	const gesamt = ergebnisse.find((e) => e.gebiet_id === eintrag.gebietId);
	const gesamtErgebnis = gesamt
		? (JSON.parse(gesamt.json) as Ergebnis)
		: undefined;
	if (!gesamtErgebnis?.parteien.some((p) => p.kandidaten?.length)) return;

	const nachName = new Map(ergebnisse.map((e) => [normTitel(e.titel), e]));

	const vorschlaege: Array<Wahlvorschlag & { gebietId: string }> = [];
	for (const csv of csvsFuerWahl(
		openData.csvs,
		eintrag.titel,
		eintrag.gebietTitel,
	)) {
		const datei = await holeDatei(
			db,
			`${opendataBasis(termin, ags)}/${csv.url}`,
			stat,
			{ force: opts.force, behalten: true },
		);
		if (!datei) continue;
		const nummern = parteienAusOpenData(openData.dateifelder ?? [], csv.wahl);
		for (const zeile of parseCsv(datei.body)) {
			// Gesamtgebiet: die CSV lässt den Gebietsnamen der Behörde stehen
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

/** Eine Behörde eines Termins vollständig abgleichen. */
const pollBehoerde = async (
	db: Db,
	termin: Termin,
	ags: string,
	stat: Statistik,
	opts: PollOptionen,
): Promise<void> => {
	const log = opts.log ?? (() => {});
	const basis = apiBasis(termin, ags);
	const terminJson = await holeJson<RohTermin>(
		db,
		`${basis}/termin.json`,
		stat,
		{ force: opts.force, behalten: true },
	);
	if (!terminJson) {
		log(`${termin.id}/${ags}: kein termin.json (404)`);
		return;
	}
	const eintraege = parseTermin(terminJson.data);

	transaktion(db, () => {
		db.prepare(
			"DELETE FROM wahleintraege WHERE termin = ? AND behoerde = ?",
		).run(termin.id, ags);
		const ins = db.prepare(
			"INSERT INTO wahleintraege (termin, behoerde, wahl_id, gebiet_id, titel, gebiet_titel, typ, slug, reihenfolge) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
		);
		eintraege.forEach((e, i) => {
			const typ = erkenneWahltyp(e.titel);
			ins.run(
				termin.id,
				ags,
				e.wahlId,
				e.gebietId,
				e.titel,
				e.gebietTitel,
				typ,
				wahlSlug(typ, e.titel, e.gebietTitel),
				WAHLTYP_REIHENFOLGE.indexOf(typ) * 1000 + i,
			);
		});
	});

	// Wahlräume (für Karten: Wahlbezirk → Ortsteil/Wahlbereich)
	const wr = await holeJson<RohWahlraeume>(
		db,
		`${basis}/wahlraeume_uebersicht.json`,
		stat,
		{ force: opts.force, behalten: true },
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

	// Open-Data-Beschreibung: nennt die CSVs je Wahl und die Partei-Nummern.
	// Daraus kommen weiter unten die Listenplätze der Bewerber.
	const openData = await holeJson<RohOpenData>(
		db,
		`${basis}/open_data.json`,
		stat,
		{
			force: opts.force,
			behalten: true,
		},
	);

	const wahlIds = [...new Set(eintraege.map((e) => e.wahlId))];
	for (const wahlId of wahlIds) {
		const wahlBasis = `${basis}/wahl_${wahlId}`;
		const geaendertVorWahl = stat.geaendert;
		const titelEintrag =
			eintraege.find((e) => e.wahlId === wahlId)?.titel ?? String(wahlId);
		const typ = erkenneWahltyp(titelEintrag);
		const personenwahl = istPersonenwahl(typ);
		let wahlTitel = titelEintrag.split(" - ")[0];

		try {
			const wahlJson = await holeJson<RohWahl>(
				db,
				`${wahlBasis}/wahl.json`,
				stat,
				{ force: opts.force, behalten: true },
			);
			if (wahlJson) {
				const info = parseWahl(wahlJson.data);
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

			// Verzeichnislisting → welche Dateien gibt es, was hat sich geändert?
			const listingRes = await holeDatei(db, `${wahlBasis}/`, stat, {
				force: true,
			});
			const listing = listingRes ? parseListing(listingRes.body) : [];
			const dateien = listing.length
				? listing
				: // Kein Listing: wenigstens die aus termin.json bekannten Gesamtgebiete
					eintraege
						.filter((e) => e.wahlId === wahlId)
						.map((e) => ({
							name: `ergebnis_${e.gebietId}_0.json`,
							geaendert: "",
							groesse: "",
						}));

			const ergebnisDateien = dateien
				.map((d) => ({ ...d, info: parseErgebnisDateiname(d.name) }))
				.filter((d) => d.info && d.info.stimmentyp === 0);
			const uebersichtDateien = dateien.filter((d) =>
				/^uebersicht_ebene_-?\d+_0\.json$/.test(d.name),
			);

			// Gesamtgebiete (aus termin.json) ändern sich am Wahlabend laufend, oft innerhalb
			// derselben Minute bei gleicher Größe – die holen wir immer bedingt (ETag).
			// Untergebiete (Wahlbezirke, Ortsteile, …) springen von „leer“ auf „voll“ und
			// werden über Änderungszeit + Größe im Listing erkannt.
			const gesamtGebiete = new Set(
				eintraege.filter((e) => e.wahlId === wahlId).map((e) => e.gebietId),
			);
			await parallel(ergebnisDateien, async (d) => {
				const stand =
					d.geaendert && !gesamtGebiete.has(d.info!.gebietId)
						? `${d.geaendert} ${d.groesse}`
						: undefined;
				const r = await holeJson<RohErgebnis>(
					db,
					`${wahlBasis}/${d.name}`,
					stat,
					{ force: opts.force, listingStand: stand },
				);
				if (!r || (!r.geaendert && !opts.force)) return;
				const e = parseErgebnis(r.data, personenwahl, behoerdeByAgs(ags)?.name);
				speichereErgebnis(
					db,
					termin,
					ags,
					wahlId,
					wahlTitel,
					d.info!.gebietId,
					e,
					stat,
				);
			});

			await parallel(uebersichtDateien, async (d) => {
				// Übersichten fassen alle Untergebiete zusammen → immer bedingt per ETag.
				// Ausnahme: Ebenen, die bisher leer waren (z. B. "ebene_2" ohne Zeilen) – die
				// bleiben leer und werden nur bei geändertem Listing-Stand erneut geholt.
				const ebeneName =
					d.name.match(/^uebersicht_(ebene_-?\d+)_0\.json$/)?.[1] ?? "";
				const bisher = db
					.prepare(
						"SELECT json FROM uebersichten WHERE termin = ? AND behoerde = ? AND wahl_id = ? AND ebene = ?",
					)
					.get(termin.id, ags, wahlId, ebeneName) as
					| { json: string }
					| undefined;
				const warLeer = bisher
					? (JSON.parse(bisher.json) as { zeilen: unknown[] }).zeilen.length ===
						0
					: false;
				const stand =
					warLeer && d.geaendert ? `${d.geaendert} ${d.groesse}` : undefined;
				const r = await holeJson<RohUebersicht>(
					db,
					`${wahlBasis}/${d.name}`,
					stat,
					{ force: opts.force, listingStand: stand },
				);
				if (!r || (!r.geaendert && !opts.force)) return;
				const u = parseUebersicht(r.data);
				const ebene = d.name.match(/^uebersicht_(ebene_-?\d+)_0\.json$/)![1];
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
			});
			// Listenplätze: Ergebnis (nach Stimmen sortiert) + CSV (Listenreihenfolge)
			await speichereListenplaetze(
				db,
				termin,
				ags,
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

/** Einen Termin über alle Behörden abgleichen. */
export const pollTermin = async (
	db: Db,
	termin: Termin,
	opts: PollOptionen = {},
): Promise<Statistik> => {
	const stat: Statistik = { anfragen: 0, geaendert: 0, fehler: [] };
	const gestartet = jetzt();
	const lauf = db
		.prepare("INSERT INTO laeufe (termin, gestartet) VALUES (?, ?)")
		.run(termin.id, gestartet);
	const behoerden = BEHOERDEN.map((b) => b.ags).filter(
		(a) => !opts.nurBehoerden || opts.nurBehoerden.includes(a),
	);
	for (const ags of behoerden) {
		try {
			await pollBehoerde(db, termin, ags, stat, opts);
		} catch (err) {
			const msg = `${termin.id}/${ags}: ${(err as Error).message}`;
			stat.fehler.push(msg);
			opts.log?.(msg);
		}
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
	// Nur ein fehlerfreier Lauf über ALLE Behörden zählt als vollständig; eine
	// eingeschränkte Auswahl (POLL_BEHOERDEN, Vorschau-Umgebungen) lädt beim
	// nächsten Start erneut – dort ist das Volume ohnehin leer.
	if (
		!termin.live &&
		stat.fehler.length === 0 &&
		behoerden.length === BEHOERDEN.length
	)
		metaSet(db, `termin:${termin.id}:vollstaendig`, jetzt());
	return stat;
};

/** Nicht-live Termine (Archiv) nur einmal vollständig laden. */
export const terminVollstaendig = (db: Db, termin: Termin): boolean =>
	Boolean(metaGet(db, `termin:${termin.id}:vollstaendig`));
