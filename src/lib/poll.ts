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
	type Fundort,
	type RohTerminIndex,
	type Termin,
	apiBasisVon,
	findeOrdner,
	openDataUrl,
	opendataBasisVon,
	parseTerminIndex,
	terminGiltFuer,
	terminGiltFuerBehoerde,
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

/**
 * Gleichzeitig bearbeitete Behörden im Archivlauf – bewusst klein.
 *
 * Der Archivlauf zieht die Kommunalwahl 2021 für 41 Kreise ein, einmal, über
 * Stunden. Er ist Beiwerk: Was er kostet, soll man am laufenden Betrieb nicht
 * merken. Zwei Behörden gleichzeitig reichen dafür völlig – die Grenze setzt
 * ohnehin das eigene Konto unten.
 */
const ARCHIV_PARALLEL = Number(process.env.POLL_ARCHIV_PARALLEL ?? 2);

/**
 * Anfragen je Sekunde und Host, die ein Archivlauf höchstens verbraucht.
 *
 * Das Konto in drossel.ts deckelt, was ein Host insgesamt abbekommt; hier
 * steht, wie viel davon das Archiv nehmen darf. Vier je Sekunde sind ein
 * Fünfzehntel dessen, was beim KDO erlaubt ist, und knapp die Hälfte dessen,
 * was der laufende Betrieb dort am Wahlabend braucht – das Archiv kann den
 * Betrieb damit nicht ausbremsen, auch wenn beide gleichzeitig laufen.
 */
const ARCHIV_PRO_SEKUNDE = Number(process.env.POLL_ARCHIV_PRO_SEKUNDE ?? 4);

/**
 * Wie oft bei einem Kreis ohne Daten nachgesehen wird.
 *
 * Sieben Kreise hatten den 13.09.2026 beim Abzug nicht angelegt; die Region
 * Hannover kündigt ihn in ihrem Index an und liefert die Präsentation
 * erkennbar erst kurz vor der Wahl. Am Wahlabend soll deshalb niemand
 * ausrollen müssen, damit ein Kreis auftaucht. Eine Anfrage je Kreis und
 * Viertelstunde kostet das – bei sieben Kreisen sind das 28 Anfragen in der
 * Stunde, verteilt auf drei Hosts.
 */
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

/**
 * Der laufende Durchgang: was er bisher getan hat und womit er sich selbst
 * bremst.
 *
 * `bremse` setzt nur der Archivlauf. Sie kommt **zusätzlich** zum Konto je
 * Host: Erst muss das Archiv seine eigene, kleine Marke bekommen, dann die des
 * Hosts. So nimmt es dem laufenden Termin nichts weg.
 */
type Lauf = Statistik & { bremse?: Drossel };

/**
 * Wie viele Läufe für einen Live-Termin gerade unterwegs sind.
 *
 * Der Archivlauf dauert Stunden und läuft neben dem Betrieb her. Damit er dem
 * laufenden Termin nicht in die Quere kommt, tritt er zurück, solange ein
 * Live-Lauf unterwegs ist, und arbeitet in dessen Lücken weiter. Am Wahlabend,
 * wo im Minutentakt gepollt wird, heißt das: Das Archiv ruht praktisch.
 */
let liveLaeufe = 0;

const schlaf = (ms: number) => new Promise((r) => setTimeout(r, ms));

const warteAufLuecke = async (): Promise<void> => {
	while (liveLaeufe > 0) await schlaf(1_000);
};

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
	// hier den Poller – nicht die fremde Wahlleitung. Der Archivlauf muss
	// zusätzlich seine eigene, viel kleinere Marke bekommen.
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

/** Ergebnis speichern und bei neuem Stand ein Ticker-Ereignis anlegen. */
const speichereErgebnis = (
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
 *
 * Eine Wahl-Id kann für mehrere Wahlen stehen: Nordstemmens neun
 * Ortsratswahlen laufen 2021 alle unter wahl_29 und unterscheiden sich nur im
 * Gesamtgebiet. Deshalb wird hier über alle Einträge dieser Id gelaufen und
 * nicht bloß über den ersten – sonst bekäme nur Adensen Listenplätze.
 */
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

	// Zuordnung über alle Wahlen der Behörde, nicht nur die dieser Id: Auch
	// gleichnamige Wahlen mit eigener Id (Samtgemeinden mit mehreren
	// Gemeinderatswahlen) müssen sich gegenseitig ausschließen können.
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
		/**
		 * Gehört zu dieser Wahl genau eine Datei, stehen hier deren Zeilen –
		 * Rohstoff für die Summe am Ende der Schleife.
		 */
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

		// Ortsratswahlen bekommen nur eine Datei mit den Wahlbezirken der
		// Ortschaft – eine Zeile für die Ortschaft selbst steht nicht darin.
		// Gerade die ist aber die Seite, die Leute ansehen. Zusammenzählen darf
		// man die Zeilen nur, wenn die Datei genau das Gebiet dieser Wahl
		// abdeckt (also über den Ort zugeordnet wurde und die einzige ist) und
		// sie keine Wahlbereiche aufführt: Innerhalb eines Wahlbereichs steht
		// D1_1 für dieselbe Person, über Wahlbereiche hinweg nicht.
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
	stat: Lauf,
	opts: PollOptionen,
): Promise<ListingEintrag[]> => {
	const schluessel = `listing:${host}`;
	if (!opts.force && metaGet(db, schluessel) === "nein") return [];
	if (stat.bremse) await stat.bremse.nimm(host);
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

// --- Wo liegt dieser Termin bei dieser Behörde? ---
//
// Aus dem Datum lässt sich das nicht ableiten. Der Ordner ist meist das
// Wahldatum (`20260913`), bei der Landeshauptstadt Hannover aber
// `Wahl-2026-09-13`; und das Pfadschema gehört zur Behörde, nicht zum Jahr –
// die Region Hannover hat ihre 2021er Präsentation mit neuer Programmversion
// neu erzeugt und liefert sie unter `daten/api/` aus, während sie sonst
// überall unter `api/praesentation/` steht. Wer das rät, verliert die
// Landeshauptstadt am Wahlabend und die Region im Archiv.
//
// Gefragt wird deshalb der Termin-Index der Behörde
// (`<wurzel>/<ags>/api/termine.json`) – dieselbe Datei, aus der die
// Präsentation ihr eigenes Menü baut. Das Ergebnis steht in `meta` und gilt
// so lange wie eine Strukturdatei: Ein Ordner, der einmal feststeht, ändert
// sich nicht mehr.

/**
 * Der gemerkte Fundort. `imIndex` sagt, ob der Termin-Index diese Behörde
 * überhaupt mit diesem Wahltag führt – nur dann lohnt es, bei einem 404 auch
 * das andere Pfadschema zu probieren. Steht der Tag gar nicht im Index, gibt
 * es hier keine Präsentation, und ein zweiter Versuch wäre eine Anfrage, die
 * sicher ins Leere geht.
 */
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

/**
 * Fundort einer Behörde für einen Termin – aus dem Gedächtnis, sonst aus dem
 * Termin-Index, sonst die Vorgabe des Termins.
 *
 * Der Index nennt den Ordner, nicht das Pfadschema. Das findet `pollBehoerde`
 * heraus, indem es das andere probiert – aber nur, wenn der Index diese
 * Behörde für diesen Wahltag überhaupt kennt.
 */
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
	} catch {
		// Kein Index, keine Antwort, kein JSON: Die Vorgabe des Termins muss
		// reichen. Sie stimmt für die allermeisten Behörden.
	}
	merkeFundort(db, termin, behoerde.ags, fundort, imIndex);
	return { ...fundort, imIndex, stand: jetzt() };
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
	stat: Lauf,
	opts: PollOptionen,
): Promise<void> => {
	const log = opts.log ?? (() => {});
	const ags = behoerde.ags;
	const wurzel = wurzelVon(kreis, behoerde);
	const host = new URL(wurzel).host;
	// Aufbau der Wahl, nicht ihr Ergebnis: darf altern.
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
		// Der Index kennt diesen Wahltag, unter dem erwarteten Pfad steht aber
		// nichts: Dann ist es das Pfadschema. Es gehört zur Behörde, nicht zum
		// Jahr – die Region Hannover hat ihre 2021er Präsentation mit neuer
		// Programmversion neu erzeugt und liefert sie als einzige unter
		// `daten/api/` aus.
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
		// Slugs entstehen für alle Wahlen einer Behörde gemeinsam – einzeln
		// betrachtet ließe sich nicht feststellen, ob einer doppelt vorkommt.
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
		// Mit Behördenname: Titel wie "Kommunalwahl 2026" oder "Direktwahl 2026"
		// sagen nicht, ob Kreistag oder Rat gemeint ist – das weiß nur, wer die
		// Behörde kennt (wahltyp.ts). Ohne ihn liefe eine so benannte Kreiswahl
		// als Ratswahl in die Datenbank.
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

/**
 * Die Behörden, die für einen Termin abgefragt werden – Kreis und Behörde
 * zusammen, weil die Wurzel aus beidem folgt.
 *
 * Ein Kreis fällt heraus, wenn es diesen Termin bei ihm nicht gibt:
 * `terminGiltFuer` entscheidet das, für die Archivtermine aus dem Katalog –
 * dort ist je Kreis erhoben, welche Wahltage seine Wahlleitung führt.
 *
 * Und **je Behörde** fällt heraus, wer den Termin selbst nicht führt. Die
 * Kommunalwahl 2021 gilt für jede Behörde ihres Kreises; die Vorwerte der
 * Direktwahlen tun das nicht. Am 26.05.2019 hat der Landkreis Emsland seinen
 * Landrat gewählt und acht seiner Gemeinden zusätzlich ihren Bürgermeister –
 * die übrigen an dem Tag nichts. Ohne diese zweite Frage fragte der Archivlauf
 * für jeden dieser Termine den ganzen Kreis ab, sammelte für zwei Drittel der
 * Behörden ein 404 ein und hielte den Kreis wegen der Fehler nie für
 * vollständig.
 *
 * Beim **laufenden** Termin kommt eine zweite Frage dazu: Liefert dieser Kreis
 * gerade überhaupt? Die Archivtermine kennen sie nicht, und das mit Absicht –
 * Region Hannover, Heidekreis und Harburg haben den 13.09.2026 noch nicht
 * angelegt, ihre Kommunalwahl 2021 aber sehr wohl. Gerade dort ist das Archiv
 * das Einzige, was es zu zeigen gibt.
 */
export const behoerdenFuer = (
	db: Db,
	termin: Termin,
	opts: PollOptionen = {},
): Array<{ kreis: Kreis; behoerde: Behoerde }> =>
	KREISE.filter(
		(k) =>
			k.behoerden.length > 0 &&
			terminGiltFuer(termin, k.slug) &&
			(!termin.live || kreisLiefert(db, k)) &&
			(!opts.nurKreise || opts.nurKreise.includes(k.slug)),
	).flatMap((kreis) =>
		kreis.behoerden
			.filter(
				(b) =>
					terminGiltFuerBehoerde(termin, kreis, b) &&
					(!opts.nurBehoerden || opts.nurBehoerden.includes(b.ags)),
			)
			.map((behoerde) => ({ kreis, behoerde })),
	);

// --- Liefert dieser Kreis? ---
//
// Im Katalog steht dazu `vorhanden`, erhoben am 07.09.2026. Das ist eine
// Ausgangsannahme und keine Wahrheit: Die Region Hannover kündigt den
// 13.09.2026 in ihrem Termin-Index an und liefert die Präsentation dazu noch
// mit 404 – sie schaltet offensichtlich erst kurz vor der Wahl frei, und das
// betrifft 22 Behörden einschließlich der Landeshauptstadt. Am Wahlabend soll
// deshalb niemand ausrollen müssen, damit ein Kreis auftaucht.
//
// Maßgeblich ist ab jetzt eine Marke in der Datenbank. Sie wird gesetzt, sobald
// ein Kreis zum ersten Mal etwas geliefert hat, und danach nicht wieder
// gelöscht: Wer einmal Daten hatte, gilt weiter als vorhanden, auch wenn sein
// Server eine Weile schweigt. Ein Aussetzer ist kein „liegt nicht vor“.

const liefertSchluessel = (kreis: Kreis): string =>
	`kreis:${kreis.slug}:liefert`;

/** Wird dieser Kreis vollständig abgefragt? */
export const kreisLiefert = (db: Db, kreis: Kreis): boolean =>
	kreis.behoerden.length > 0 &&
	(kreis.vorhanden || metaGet(db, liefertSchluessel(kreis)) === "ja");

/**
 * Nachschau bei den Kreisen, von denen gerade nichts kommt.
 *
 * Eine Anfrage je Kreis: die `termin.json` seiner Kreisbehörde. Kommt sie
 * durch, ist die Präsentation da – der Kreis wird ab sofort normal geführt und
 * gleich in diesem Lauf mitgenommen. Kommt sie nicht durch, wird nur der
 * Zeitpunkt vermerkt, damit die nächste Nachschau eine Viertelstunde wartet.
 *
 * Kreise ohne jede Behörde (Celle, Uelzen: kein votemanager) kommen hier gar
 * nicht vor – bei ihnen gibt es nichts, wo man nachsehen könnte.
 */
const nachschau = async (
	db: Db,
	termin: Termin,
	stat: Lauf,
	opts: PollOptionen,
): Promise<Kreis[]> => {
	const neu: Kreis[] = [];
	for (const kreis of KREISE) {
		if (kreis.behoerden.length === 0 || kreisLiefert(db, kreis)) continue;
		if (!terminGiltFuer(termin, kreis.slug)) continue;
		if (opts.nurKreise && !opts.nurKreise.includes(kreis.slug)) continue;
		const schluessel = `kreis:${kreis.slug}:geprueft`;
		const zuletzt = metaGet(db, schluessel);
		if (
			!opts.force &&
			zuletzt &&
			Date.now() - Date.parse(zuletzt) < NACHSCHAU_S * 1000
		)
			continue;
		metaSet(db, schluessel, jetzt());
		// Die Kreisbehörde steht für den Kreis; hat ein Kreis ausnahmsweise
		// keine (Harburg vor dem Nachtrag), tut es die erste Gemeinde.
		const behoerde =
			kreis.behoerden.find((b) => b.ags === kreis.ags) ?? kreis.behoerden[0];
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
			metaSet(db, liefertSchluessel(kreis), "ja");
			neu.push(kreis);
			opts.log?.(
				`${termin.id}/${kreis.slug}: Präsentation ist jetzt da – der Kreis wird ab sofort abgefragt`,
			);
		} catch (err) {
			// Ein stummer oder kaputter Server ist hier kein Fehler des Laufs:
			// Wir haben nur nachgesehen, ob etwas da ist.
			opts.log?.(
				`${termin.id}/${kreis.slug}: Nachschau ohne Erfolg (${(err as Error).message})`,
			);
		}
	}
	return neu;
};

/**
 * Ein Archivtermin, Kreis für Kreis.
 *
 * Die Kommunalwahl 2021 für 41 Kreise einzulesen sind rund 45 × mehrere
 * tausend Anfragen an fremde Server. Das darf Stunden dauern – ein Ansturm
 * darf es nicht sein. Drei Dinge sorgen dafür:
 *
 *   - ein eigenes Anfragenkonto je Host (`ARCHIV_PRO_SEKUNDE`), zusätzlich zu
 *     dem, das für alle gilt,
 *   - zwei Behörden gleichzeitig statt sechzehn,
 *   - und ein Rückzug, solange ein Live-Lauf unterwegs ist.
 *
 * Fertige Kreise werden vermerkt. Ein Neustart mitten im Lauf beginnt deshalb
 * nicht von vorn, sondern beim nächsten offenen Kreis.
 */
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
	// Die Marken je Kreis sind ein Lesezeichen für **diesen einen** Durchlauf
	// durch alles. Ein eingeschränkter Lauf (einzelne Kreise oder Behörden,
	// etwa in einer Vorschau-Umgebung) darf sie weder setzen – er hat den
	// Kreis ja nicht vollständig geholt – noch sich von ihnen abhalten
	// lassen: Wer bestimmte Behörden nennt, will sie abgeglichen haben.
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
			// Erst nachsehen, wer inzwischen liefert – wer dazukommt, ist gleich
			// in diesem Lauf dabei und nicht erst in drei Minuten.
			await nachschau(db, termin, stat, opts);
			const ziele = behoerdenFuer(db, termin, opts);
			// Mehrere Behörden gleichzeitig – bei 413 wäre nacheinander am
			// Wahlabend nicht durchzuhalten. Zusammen mit PARALLEL je Wahl sind
			// das höchstens BEHOERDEN_PARALLEL * PARALLEL offene Verbindungen.
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
	// Nur ein fehlerfreier Lauf über ALLE Behörden zählt als vollständig; eine
	// eingeschränkte Auswahl (POLL_BEHOERDEN, Vorschau-Umgebungen) lädt beim
	// nächsten Start erneut – dort ist das Volume ohnehin leer.
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

/**
 * Nicht-live Termine (Archiv) nur einmal vollständig laden.
 *
 * „Vollständig“ heißt: über alle Behörden, die **heute** dazugehören. Der
 * Katalog wächst – die Kommunalwahl 2021 galt einmal nur für Hildesheim und
 * gilt jetzt für 41 Kreise mit 411 Behörden. Ohne diesen Vergleich bliebe ein
 * Bestand, der einmal als fertig vermerkt wurde, für immer fertig, und die
 * neu dazugekommenen Kreise blieben leer – auf jedem Volume, das schon läuft.
 * Deshalb steht neben der Marke die Zahl der Behörden, die sie abdeckt.
 */
export const terminVollstaendig = (db: Db, termin: Termin): boolean => {
	if (!metaGet(db, `termin:${termin.id}:vollstaendig`)) return false;
	const abgedeckt = Number(metaGet(db, `termin:${termin.id}:behoerden`) ?? 0);
	return abgedeckt >= behoerdenFuer(db, termin).length;
};
