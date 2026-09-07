/**
 * Der Poller: holt die votemanager-Dateien eines Wahltermins und schreibt sie
 * normalisiert in die Datenbank.
 *
 * **Wie er die Dateien findet.** Früher las er das Apache-Verzeichnislisting
 * des Wahl-Ordners. Das geht nicht mehr: Von 38 geprüften Instanzen in
 * Niedersachsen liefert keine eines, inzwischen auch Hildesheim nicht mehr
 * (403). Gefunden wird jetzt so, wie die Präsentation selbst navigiert:
 *
 *   termin.json          → die Gesamtgebiete je Wahl
 *   wahl_<id>/wahl.json  → die Übersichts-Ebenen und verlinkten Gesamtgebiete
 *   uebersicht_<ebene>   → die Untergebiete (Gemeinden, Wahlbezirke, Ortsteile)
 *   opendata/open_data.json → die CSV-Dateien und die Parteinamen zu D1, D2, …
 *
 * Die Übersicht ersetzt dabei auch die Sparsamkeit des Listings: Ihre Zeile zu
 * einem Gebiet enthält dessen Zahlen. Ist die Zeile unverändert, ist die
 * Ergebnisdatei es auch – dann wird sie gar nicht erst angefragt. Eine Anfrage
 * je Ebene deckt so alle ihre Gebiete ab.
 *
 * Ein offenes Verzeichnislisting wird weiter genutzt, wenn ein Host eines
 * hergibt: Es findet zusätzlich Gebiete, auf die keine Übersicht verlinkt
 * (beim Kreis die Gemeinde-Teilergebnisse seiner Kreiswahl). Antwortet ein
 * Host einmal mit 403, wird es dort nicht wieder versucht.
 *
 * Sparsam gegenüber fremden Servern: Strukturdateien werden nur alle paar
 * Stunden neu geholt, alles andere bedingt per ETag (If-None-Match), sodass
 * unveränderte Dateien ein 304 ohne Inhalt kosten.
 */
import type { Behoerde } from "../data/behoerden.ts";
import { KREISE, type Kreis, wurzelVon } from "../data/kreise.ts";
import {
	type Termin,
	apiBasis,
	opendataBasis,
	terminGiltFuer,
} from "../data/termine.ts";
import { type Db, jetzt, metaGet, metaSet, transaktion } from "./db.ts";
import { grenzenAusUmgebung, hostDrossel } from "./drossel.ts";
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
	wahlSlug,
} from "./wahltyp.ts";

type RohOpenData = {
	csvs?: Array<{ wahl: string; ebene: string; url: string }>;
	dateifelder?: Array<{
		name: string;
		parteien?: Array<{ feld: string; wert: string }>;
	}>;
};

// Der Name steht in den Zugriffsprotokollen von 45 Wahlleitungen. Er sagt,
// wer da anfragt, wofür und an wen man sich wenden kann.
const UA =
	"wahlergebnisse-niedersachsen/2.0 (+https://wahlergebnisse.levinkeller.de; post@levinkeller.de)";
const TIMEOUT_MS = 20_000;
/** Gleichzeitige Anfragen innerhalb einer Wahl. */
const PARALLEL = 4;
/**
 * Gleichzeitig bearbeitete Behörden.
 *
 * Früher stand hier eine kleine Zahl, weil sie zugleich die Bremse war. Das
 * ist sie nicht mehr: Wie schnell ein fremder Server angefragt wird, regelt
 * jetzt das Konto je Host (drossel.ts). Die Gleichzeitigkeit darf deshalb so
 * hoch sein, dass sie den Durchsatz nicht unter die Grenze drückt – sonst
 * dauert ein Durchgang durch 372 Behörden länger als der Takt erlaubt.
 */
const BEHOERDEN_PARALLEL = Number(process.env.POLL_PARALLEL ?? 16);

/**
 * Das Anfragenkonto je Host. Ein Modul-weiter Wert, weil auch mehrere
 * gleichzeitige `pollTermin`-Läufe auf dieselben Server treffen – zwei
 * getrennte Konten würden die Grenze verdoppeln.
 */
const drossel = hostDrossel({
	grenzen: grenzenAusUmgebung(process.env.POLL_HOST_GRENZEN),
});

/**
 * Wie alt eine Strukturdatei (termin.json, wahl.json, wahlraeume, open_data)
 * werden darf, bevor sie neu geholt wird. Sie beschreibt den Aufbau der Wahl,
 * nicht ihr Ergebnis, und ändert sich nach dem Anlegen praktisch nicht mehr.
 * Bei 412 Behörden sind das je Lauf mehrere tausend Anfragen, die nichts
 * einbringen – deshalb nur ein paar Mal am Tag.
 */
const STRUKTUR_MAX_ALTER_S = Number(
	process.env.POLL_STRUKTUR_MAX_ALTER_SEKUNDEN ?? 6 * 3600,
);

export type PollOptionen = {
	/** Alle Dateien neu holen, auch wenn Stand/ETag unverändert */
	force?: boolean;
	/** Nur diese Behörden (AGS) abfragen */
	nurBehoerden?: string[];
	/** Nur diese Kreise (Slug) abfragen */
	nurKreise?: string[];
	log?: (msg: string) => void;
};

type Statistik = { anfragen: number; geaendert: number; fehler: string[] };

type Geholt = { body: string; geaendert: boolean };

/**
 * Holt eine Datei mit ETag-Cache.
 *
 * Zwei Wege sparen die Anfrage ganz: `stand` – ein Kürzel des Zustands, den
 * eine andere Datei über diese hier aussagt (die Zeile in der Übersicht, sonst
 * Änderungszeit und Größe aus einem Verzeichnislisting) – und `maxAlter` für
 * Dateien, die sich kaum ändern.
 */
const holeDatei = async (
	db: Db,
	url: string,
	stat: Statistik,
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
	// Unveränderter Stand → gar nicht erst anfragen.
	if (!opts.force && alt && opts.stand && alt.listing_stand === opts.stand) {
		return alt.body ? { body: alt.body, geaendert: false } : undefined;
	}
	// Junge Strukturdatei → der gespeicherte Text gilt weiter.
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
	// Erst das Konto des Hosts fragen, dann anfragen. Ein Rückstand bremst
	// hier den Poller – nicht die fremde Wahlleitung.
	await drossel.nimm(new URL(url).host);
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
		// Unverändert: der gespeicherte Datensatz ist aktuell, es gibt nichts zu tun.
		// (Für die wenigen Strukturdateien liegt der Text vor, s. `behalten`.)
		return alt?.body ? { body: alt.body, geaendert: false } : undefined;
	}
	if (res.status === 404) {
		// Manche Gebiete stehen in einer Übersicht, haben aber keine eigene
		// Ergebnisdatei. Den Stand trotzdem merken, sonst wird dieselbe fehlende
		// Datei bei jedem Lauf erneut angefragt.
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
	wurzel: string,
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
			`${opendataBasis(termin, ags, wurzel)}/${csv.url}`,
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

/**
 * Verzeichnislisting eines Wahl-Ordners – wenn der Host eines hergibt.
 *
 * Es ist nur noch eine Zugabe: Es findet Gebiete, auf die keine Übersicht
 * verlinkt. Da praktisch alle Instanzen mit 403 antworten, wird das Ergebnis
 * je Host gemerkt und dort nicht wieder versucht. Ein 404 sagt dagegen nur,
 * dass dieser eine Ordner fehlt (etwa eine Stichwahl, die es nicht gab), und
 * zählt nicht als Absage des Hosts.
 */
const holeListing = async (
	db: Db,
	wahlBasis: string,
	host: string,
	stat: Statistik,
	opts: PollOptionen,
): Promise<ListingEintrag[]> => {
	const schluessel = `listing:${host}`;
	if (!opts.force && metaGet(db, schluessel) === "nein") return [];
	await drossel.nimm(host);
	stat.anfragen++;
	try {
		const res = await fetch(`${wahlBasis}/`, {
			headers: { "User-Agent": UA, Accept: "text/html" },
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
		if (res.status === 403 || res.status === 401) {
			metaSet(db, schluessel, "nein");
			return [];
		}
		if (!res.ok) return [];
		const eintraege = parseListing(await res.text());
		metaSet(db, schluessel, eintraege.length ? "ja" : "nein");
		return eintraege;
	} catch {
		// Zeitüberschreitung oder abgewiesene Verbindung: nichts merken, der
		// Weg über die Übersichten trägt ohnehin.
		return [];
	}
};

/** Nur echte Gebiets-Ids ("ebene_6_id_3111"), keine externen Verweise. */
const istGebietId = (id: string | undefined): id is string =>
	Boolean(id && /^ebene_-?\d+_id_\d+$/.test(id));

/** Eine Behörde eines Termins vollständig abgleichen. */
const pollBehoerde = async (
	db: Db,
	termin: Termin,
	kreis: Kreis,
	behoerde: Behoerde,
	stat: Statistik,
	opts: PollOptionen,
): Promise<void> => {
	const log = opts.log ?? (() => {});
	const ags = behoerde.ags;
	const wurzel = wurzelVon(kreis, behoerde);
	const host = new URL(wurzel).host;
	const basis = apiBasis(termin, ags, wurzel);
	// Aufbau der Wahl, nicht ihr Ergebnis: darf altern.
	const struktur = {
		force: opts.force,
		behalten: true,
		maxAlter: STRUKTUR_MAX_ALTER_S,
	};

	const terminJson = await holeJson<RohTermin>(
		db,
		`${basis}/termin.json`,
		stat,
		struktur,
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

	// Open-Data-Beschreibung: nennt die CSVs je Wahl und die Parteinamen zu den
	// Spaltencodes (D1, D2, …), die in den CSVs selbst nur als Kürzel stehen.
	// Daraus kommen weiter unten die Listenplätze der Bewerber.
	const openData = await holeJson<RohOpenData>(
		db,
		`${basis}/open_data.json`,
		stat,
		struktur,
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

			// --- Welche Dateien gibt es, und was hat sich geändert? ---
			//
			// `gebiete` sammelt jede Gebiets-Id, zu der es eine Ergebnisdatei
			// geben kann; `stands` merkt sich je Gebiet ein Kürzel seines
			// Zustands. Stimmt das Kürzel mit dem gespeicherten überein, wird
			// die Datei gar nicht angefragt.
			const gebiete = new Set<string>();
			const stands = new Map<string, string>();
			const gesamtGebiete = new Set(
				eintraege.filter((e) => e.wahlId === wahlId).map((e) => e.gebietId),
			);
			for (const g of gesamtGebiete) gebiete.add(g);
			for (const g of info?.ergebnisse ?? []) gebiete.add(g.id);

			// Die Ebenen, zu denen es eine Übersicht gibt. wahl.json nennt nur
			// die, die im Menü stehen; ein Verzeichnislisting kennt mehr, und
			// einmal gefundene bleiben über die Datenbank bekannt.
			const ebenen = new Set(info?.uebersichten.map((u) => u.ebene) ?? []);
			for (const r of db
				.prepare(
					"SELECT ebene FROM uebersichten WHERE termin = ? AND behoerde = ? AND wahl_id = ?",
				)
				.all(termin.id, ags, wahlId) as Array<{ ebene: string }>)
				ebenen.add(r.ebene);

			// Zugabe, falls der Host ein Verzeichnislisting hergibt.
			for (const d of await holeListing(db, wahlBasis, host, stat, opts)) {
				const ebene = d.name.match(/^uebersicht_(ebene_-?\d+)_0\.json$/);
				if (ebene) ebenen.add(ebene[1]);
				const datei = parseErgebnisDateiname(d.name);
				if (datei?.stimmentyp !== 0) continue;
				gebiete.add(datei.gebietId);
				if (d.geaendert)
					stands.set(datei.gebietId, `${d.geaendert} ${d.groesse}`);
			}

			// Übersichten: eine Anfrage je Ebene. Sie liefert die Untergebiete
			// und – über ihre Zeilen – zugleich deren Stand.
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
					// 304 oder gar nicht gefragt: der gespeicherte Stand gilt weiter
					// und nennt dieselben Gebiete wie beim letzten Mal.
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

			// Die Gesamtgebiete stehen in keiner Übersicht über sich selbst und
			// ändern sich am Wahlabend laufend – sie werden immer bedingt geholt.
			for (const g of gesamtGebiete) stands.delete(g);

			await parallel([...gebiete], async (gebietId) => {
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
			});

			// Listenplätze: Ergebnis (nach Stimmen sortiert) + CSV (Listenreihenfolge)
			await speichereListenplaetze(
				db,
				termin,
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

/**
 * Die Behörden, die für einen Termin abgefragt werden – Kreis und Behörde
 * zusammen, weil die Wurzel aus beidem folgt.
 *
 * Kreise ohne benutzbare Präsentation bleiben außen vor: Sie werden angezeigt,
 * aber nicht angefragt, sonst liefe der Poller bei sieben von 45 Kreisen in
 * eine Dauerschleife aus 404ern.
 */
export const behoerdenFuer = (
	termin: Termin,
	opts: PollOptionen = {},
): Array<{ kreis: Kreis; behoerde: Behoerde }> =>
	KREISE.filter(
		(k) =>
			k.vorhanden &&
			terminGiltFuer(termin, k.slug) &&
			(!opts.nurKreise || opts.nurKreise.includes(k.slug)),
	).flatMap((kreis) =>
		kreis.behoerden
			.filter((b) => !opts.nurBehoerden || opts.nurBehoerden.includes(b.ags))
			.map((behoerde) => ({ kreis, behoerde })),
	);

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
	const ziele = behoerdenFuer(termin, opts);
	// Mehrere Behörden gleichzeitig – bei 412 wäre nacheinander am Wahlabend
	// nicht durchzuhalten. Zusammen mit PARALLEL je Wahl sind das höchstens
	// BEHOERDEN_PARALLEL * PARALLEL offene Verbindungen.
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
		ziele.length === behoerdenFuer(termin).length
	)
		metaSet(db, `termin:${termin.id}:vollstaendig`, jetzt());
	return stat;
};

/** Nicht-live Termine (Archiv) nur einmal vollständig laden. */
export const terminVollstaendig = (db: Db, termin: Termin): boolean =>
	Boolean(metaGet(db, `termin:${termin.id}:vollstaendig`));
