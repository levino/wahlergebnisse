import { type Behoerde, behoerdeByName } from "../data/behoerden.ts";
import type { Kreis } from "../data/kreise.ts";
import type { Termin } from "../data/termine.ts";
import type { Db } from "./db.ts";
import { transaktion } from "./db.ts";
import { QUELLE_SCHEMA } from "./demo-bestand.ts";
import {
	type Zyklus,
	eingangsAnteil,
	eingangsZeit,
	rauschFaktor,
	verrausche,
	zaehleZusammen,
} from "./demo.ts";
import { speichereErgebnis } from "./poll.ts";
import {
	type Wahlbereiche,
	gemeindenImWahlbereich,
	kreisWahlbereiche,
	wahlbereichKuerzel,
} from "./wahlbereiche.ts";
import type { Ergebnis } from "./votemanager.ts";
import { type Wahltyp, istKreiswahl } from "./wahltyp.ts";

const BAUSTEIN_EBENEN = [6, 3];

/**
 * Die Rechtsformen, die den Gemeinden vorangestellt werden – „Gemeinde Söhlde"
 * und „Söhlde" meinen dieselbe Gemeinde. Aufgezählt, nicht geraten.
 */
const KOERPERSCHAFTEN = [
	"Samtgemeinde",
	"Inselgemeinde",
	"Mitgliedsgemeinde",
	"Gemeinde",
	"Landeshauptstadt",
	"Münchhausenstadt",
	"Universitätsstadt",
	"Hansestadt",
	"Bergstadt",
	"Stadt",
	"Flecken",
	"Ortschaft",
	"Landkreis",
];

const gemeindeName = (name: string): string => {
	const worte = name.trim().split(/\s+/);
	return (
		KOERPERSCHAFTEN.includes(worte[0] ?? "") ? worte.slice(1) : worte
	).join(" ");
};

/** Die Ebene, auf der Wahllokale stehen. */
const LOKAL_EBENE = BAUSTEIN_EBENEN[0];

export type DemoLokal = {
	schluessel: string;
	ags: string;
	wahlId: number;
	gebietId: string;
	/** Seine Zahl der Schnellmeldungen – fast immer eine. */
	meldungen: number;
};

export type DemoZeile = {
	gebietId: string;
	titel: string;
	lokale: DemoLokal[];
	meldungen: number;
};

/** Eine Wahl des Probentermins mit allem, was die Simulation daraus braucht. */
export type DemoWahl = {
	wahlId: number;
	/** Wahlart aus der Zuordnung, wie sie im Bestand steht. */
	typ: Wahltyp;
	titel: string;
	gebietId: string;
	gebietTitel: string;
	/** Alle Wahllokale dieser Wahl bei dieser Wahlleitung, ohne Dubletten */
	lokale: DemoLokal[];
	/** Jede Zeile, die geschrieben wird – vom Wahlbezirk bis zum Kreis */
	zeilen: DemoZeile[];
};

const mitSchema = new WeakSet<Db>();

const sicherSchema = (db: Db): void => {
	if (mitSchema.has(db)) return;
	db.exec(QUELLE_SCHEMA);
	mitSchema.add(db);
};

const gesichert = new WeakMap<Db, Set<string>>();

/**
 * Die echten Zahlen einer Wahlleitung beiseitelegen, bevor die Probe schreibt.
 *
 * Idempotent: Was schon liegt, bleibt liegen. Eine Wahlleitung, deren Zeilen
 * die Probe längst überschrieben hat, bringt darum nichts Simuliertes nach.
 */
export const sicherQuelle = (db: Db, termin: string, ags: string): void => {
	sicherSchema(db);
	const marken = gesichert.get(db) ?? new Set<string>();
	gesichert.set(db, marken);
	const marke = `${termin}|${ags}`;
	if (marken.has(marke)) return;
	marken.add(marke);
	if (
		db
			.prepare("SELECT 1 FROM demo_quelle WHERE termin = ? AND behoerde = ?")
			.get(termin, ags)
	)
		return;
	db.prepare(
		`INSERT OR IGNORE INTO demo_quelle (termin, behoerde, wahl_id, gebiet_id, ebene, titel, stand_max, json)
		 SELECT termin, behoerde, wahl_id, gebiet_id, ebene, titel, stand_max, json
		 FROM ergebnisse WHERE termin = ? AND behoerde = ? AND leer = 0`,
	).run(termin, ags);
};

/**
 * Der leere Saal: alle Zahlen des Probentermins beiseite, alle Zeilen weg.
 *
 * Landesweit und in einem Zug, damit keine Wahlleitung ihre amtlichen
 * Endergebnisse zeigt, solange noch niemand hingesehen hat. Läuft bei jedem
 * Start; der gemerkte Nullpunkt sagt danach, wo im Abend die Uhr steht.
 */
export const bereiteProbeVor = (
	db: Db,
	termin: Termin,
): { gesichert: number; geleert: number } =>
	transaktion(db, () => {
		sicherSchema(db);
		const n = (sql: string): number =>
			Number(db.prepare(sql).run(termin.id).changes);
		const bewahrt = n(
			`INSERT OR IGNORE INTO demo_quelle (termin, behoerde, wahl_id, gebiet_id, ebene, titel, stand_max, json)
			 SELECT termin, behoerde, wahl_id, gebiet_id, ebene, titel, stand_max, json
			 FROM ergebnisse WHERE termin = ? AND leer = 0`,
		);
		const geleert = n("DELETE FROM ergebnisse WHERE termin = ?");
		n("DELETE FROM ereignisse WHERE termin = ?");
		n("DELETE FROM uebersichten WHERE termin = ?");
		return { gesichert: bewahrt, geleert };
	});

/** Die feinste Ebene, von der es mindestens zwei Zeilen gibt. */
const bausteinEbene = (
	db: Db,
	termin: string,
	ags: string,
	wahlId: number,
): number | undefined => {
	const platzhalter = BAUSTEIN_EBENEN.map(() => "?").join(",");
	const vorhanden = new Set(
		(
			db
				.prepare(
					`SELECT ebene FROM demo_quelle
					 WHERE termin = ? AND behoerde = ? AND wahl_id = ?
					   AND ebene IN (${platzhalter})
					 GROUP BY ebene HAVING COUNT(*) >= 2`,
				)
				.all(termin, ags, wahlId, ...BAUSTEIN_EBENEN) as Array<{
				ebene: number;
			}>
		).map((r) => r.ebene),
	);
	return BAUSTEIN_EBENEN.find((e) => vorhanden.has(e));
};

/** Eine Zeile der feinsten Ebene, die diese Wahlleitung führt. */
type Einheit = {
	gebietId: string;
	titel: string;
	meldungen: number;
};

/** Alles, was die Vorlage über eine Wahl wissen muss – ohne eine einzige Ergebniszahl. */
type Quellwahl = {
	ebene: number;
	bausteine: Einheit[];
	gebiete: Array<{ gebietId: string; titel: string }>;
	/** Gebiets-Id → seine Einheiten, aus den Untergebieten der Quelle */
	zuordnung: Map<string, Set<string>>;
	/** Wie viele Ämter sich diese Wahl teilen */
	aemter: number;
};

const liesQuellwahl = (
	db: Db,
	termin: string,
	ags: string,
	wahlId: number,
): Quellwahl | undefined => {
	const ebene = bausteinEbene(db, termin, ags, wahlId);
	if (ebene === undefined) return undefined;
	const bausteine = db
		.prepare(
			`SELECT gebiet_id, titel, COALESCE(stand_max, 1) AS meldungen
			 FROM demo_quelle
			 WHERE termin = ? AND behoerde = ? AND wahl_id = ? AND ebene = ?
			 ORDER BY gebiet_id`,
		)
		.all(termin, ags, wahlId, ebene) as Array<{
		gebiet_id: string;
		titel: string;
		meldungen: number;
	}>;
	const gebiete = db
		.prepare(
			`SELECT gebiet_id, titel
			 FROM demo_quelle
			 WHERE termin = ? AND behoerde = ? AND wahl_id = ? AND ebene <> ?
			 ORDER BY gebiet_id`,
		)
		.all(termin, ags, wahlId, ebene) as Array<{
		gebiet_id: string;
		titel: string;
	}>;
	const zuordnung = new Map<string, Set<string>>();
	for (const r of db
		.prepare(
			`WITH untergebiete AS MATERIALIZED (
			   SELECT e.gebiet_id AS gebiet, json_extract(g.value, '$.id') AS baustein
			   FROM demo_quelle e,
			        json_each(e.json, '$.untergebiete') u,
			        json_each(u.value, '$.gebiete') g
			   WHERE e.termin = ? AND e.behoerde = ? AND e.wahl_id = ?
			     AND e.ebene <> ?
			 )
			 SELECT DISTINCT u.gebiet AS gebiet, b.gebiet_id AS baustein
			 FROM untergebiete u
			 JOIN demo_quelle b ON b.termin = ? AND b.behoerde = ? AND b.wahl_id = ?
			   AND b.gebiet_id = u.baustein AND b.ebene = ?
			 ORDER BY gebiet, baustein`,
		)
		.all(termin, ags, wahlId, ebene, termin, ags, wahlId, ebene) as Array<{
		gebiet: string;
		baustein: string;
	}>) {
		const ids = zuordnung.get(r.gebiet) ?? new Set<string>();
		ids.add(r.baustein);
		zuordnung.set(r.gebiet, ids);
	}
	return {
		ebene,
		bausteine: bausteine.map((b) => ({
			gebietId: b.gebiet_id,
			titel: b.titel,
			meldungen: b.meldungen,
		})),
		gebiete: gebiete.map((g) => ({ gebietId: g.gebiet_id, titel: g.titel })),
		zuordnung,
		aemter: (
			db
				.prepare(
					`SELECT COUNT(*) AS n FROM wahleintraege
					 WHERE termin = ? AND behoerde = ? AND wahl_id = ?`,
				)
				.get(termin, ags, wahlId) as { n: number }
		).n,
	};
};

/** Die Wahllokal-Zeilen einer Wahl bei einer Wahlleitung – ohne das JSON. */
const lokalZeilen = (
	db: Db,
	termin: string,
	ags: string,
	wahlId: number,
): Einheit[] =>
	(
		db
			.prepare(
				`SELECT gebiet_id, titel, COALESCE(stand_max, 1) AS meldungen
				 FROM demo_quelle
				 WHERE termin = ? AND behoerde = ? AND wahl_id = ? AND ebene = ?
				 ORDER BY gebiet_id`,
			)
			.all(termin, ags, wahlId, LOKAL_EBENE) as Array<{
			gebiet_id: string;
			titel: string;
			meldungen: number;
		}>
	).map((r) => ({
		gebietId: r.gebiet_id,
		titel: r.titel,
		meldungen: r.meldungen,
	}));

const gemeindeWahllokale = (
	db: Db,
	kreis: Kreis,
	termin: string,
	typ: string,
	titel: string,
	eintraege: Map<string, Array<Record<string, unknown>>>,
): { ags: string; wahlId: number; zeilen: Einheit[] } | undefined => {
	const unter = behoerdeByName(
		titel,
		kreis.behoerden.filter((b) => b.art !== "kreis"),
	);
	if (!unter) return undefined;
	let ihre = eintraege.get(unter.ags);
	if (!ihre) {
		sicherQuelle(db, termin, unter.ags);
		ihre = eintraegeVon(db, termin, unter.ags);
		eintraege.set(unter.ags, ihre);
	}
	const eintrag = ihre.find((e) => e.typ === typ);
	if (!eintrag) return undefined;
	const wahlId = eintrag.wahl_id as number;
	const zeilen = lokalZeilen(db, termin, unter.ags, wahlId);
	return zeilen.length > 0 ? { ags: unter.ags, wahlId, zeilen } : undefined;
};

const eigeneZeile = (
	db: Db,
	termin: string,
	ags: string,
	wahlId: number,
	gebietId: string,
): Einheit | undefined => {
	const r = db
		.prepare(
			`SELECT gebiet_id, titel, COALESCE(stand_max, 1) AS meldungen
			 FROM demo_quelle
			 WHERE termin = ? AND behoerde = ? AND wahl_id = ? AND gebiet_id = ?`,
		)
		.get(termin, ags, wahlId, gebietId) as
		| { gebiet_id: string; titel: string; meldungen: number }
		| undefined;
	return r
		? { gebietId: r.gebiet_id, titel: r.titel, meldungen: r.meldungen }
		: undefined;
};

const nachgeordneteLokale = (
	db: Db,
	kreis: Kreis,
	termin: string,
	typ: Wahltyp,
	eintraege: Map<string, Array<Record<string, unknown>>>,
): DemoLokal[] => {
	const raus: DemoLokal[] = [];
	for (const b of kreis.behoerden) {
		if (b.art === "kreis") continue;
		let ihre = eintraege.get(b.ags);
		if (!ihre) {
			sicherQuelle(db, termin, b.ags);
			ihre = eintraegeVon(db, termin, b.ags);
			eintraege.set(b.ags, ihre);
		}
		const eintrag = ihre.find((e) => e.typ === typ);
		if (!eintrag) continue;
		const wahlId = eintrag.wahl_id as number;
		const bezirke = lokalZeilen(db, termin, b.ags, wahlId);
		const eigen = eigeneZeile(
			db,
			termin,
			b.ags,
			wahlId,
			eintrag.gebiet_id as string,
		);
		const bausteine = bezirke.length ? bezirke : eigen ? [eigen] : [];
		for (const z of bausteine)
			raus.push({
				schluessel: `${typ}|${b.ags}|${z.gebietId}`,
				ags: b.ags,
				wahlId,
				gebietId: z.gebietId,
				meldungen: z.meldungen,
			});
	}
	return raus;
};

const ausNachgeordneten = (
	db: Db,
	kreis: Kreis,
	termin: Termin,
	behoerde: Behoerde,
	eintrag: Record<string, unknown>,
	eintraege: Map<string, Array<Record<string, unknown>>>,
): DemoWahl | undefined => {
	if (behoerde.art !== "kreis") return undefined;
	const typ = eintrag.typ as Wahltyp;
	if (!istKreiswahl(typ)) return undefined;
	const wahlId = eintrag.wahl_id as number;
	const gebietId = eintrag.gebiet_id as string;
	const eigen = eigeneZeile(db, termin.id, behoerde.ags, wahlId, gebietId);
	if (!eigen) return undefined;
	const lokale = nachgeordneteLokale(db, kreis, termin.id, typ, eintraege);
	if (lokale.length === 0) return undefined;
	return {
		wahlId,
		typ: eintrag.typ as Wahltyp,
		titel: eintrag.titel as string,
		gebietId,
		gebietTitel: eintrag.gebiet_titel as string,
		lokale,
		zeilen: [
			{
				gebietId,
				titel: eigen.titel,
				lokale,
				meldungen: lokale.reduce((n, l) => n + l.meldungen, 0),
			},
		],
	};
};

/**
 * Die Wahlen einer Wahlleitung an diesem Termin – ohne die Stichwahlen.
 *
 * Nachgespielt wird der erste Wahlabend. Die Stichwahl war zwei Wochen
 * später; an diesem Abend stand sie noch aus.
 */
const eintraegeVon = (db: Db, termin: string, ags: string) =>
	db
		.prepare(
			`SELECT wahl_id, gebiet_id, titel, gebiet_titel, gebiet, typ
			 FROM wahleintraege
			 WHERE termin = ? AND behoerde = ? AND typ NOT LIKE '%-stichwahl'
			 ORDER BY reihenfolge`,
		)
		.all(termin, ags) as Array<Record<string, unknown>>;

export const baueVorlage = (
	db: Db,
	kreis: Kreis,
	termin: Termin,
	behoerde: Behoerde,
): DemoWahl[] => {
	sicherQuelle(db, termin.id, behoerde.ags);
	const gefunden: DemoWahl[] = [];
	const belegt = new Set<string>();
	const gelesen = new Map<number, Quellwahl | undefined>();
	const untere = new Map<string, Array<Record<string, unknown>>>();
	let bereiche: Wahlbereiche | undefined;
	for (const e of eintraegeVon(db, termin.id, behoerde.ags)) {
		const typ = e.typ as string;
		const wahlId = e.wahl_id as number;
		const gebietId = e.gebiet_id as string;
		if (belegt.has(`${wahlId}|${gebietId}`)) continue;
		if (!gelesen.has(wahlId))
			gelesen.set(wahlId, liesQuellwahl(db, termin.id, behoerde.ags, wahlId));
		const quelle = gelesen.get(wahlId);
		if (!quelle) {
			const fremd = ausNachgeordneten(db, kreis, termin, behoerde, e, untere);
			if (fremd) {
				belegt.add(`${wahlId}|${gebietId}`);
				gefunden.push(fremd);
			}
			continue;
		}
		const bausteinIds = new Set(quelle.bausteine.map((b) => b.gebietId));
		const gesamt =
			bausteinIds.has(gebietId) ||
			quelle.gebiete.some((g) => g.gebietId === gebietId);
		if (!gesamt) continue;
		const ausWahlbereich = (zeilenTitel: string): Set<string> => {
			const kuerzel = wahlbereichKuerzel(zeilenTitel);
			if (!kuerzel) return new Set();
			bereiche ??= kreisWahlbereiche(
				termin.id,
				kreis.behoerden.filter((b) => b.art !== "kreis"),
			);
			const gemeinden = gemeindenImWahlbereich(kuerzel, bereiche).map((g) =>
				gemeindeName(g).toLowerCase(),
			);
			if (gemeinden.length === 0) return new Set();
			return new Set(
				quelle.bausteine
					.filter((b) =>
						gemeinden.includes(gemeindeName(b.titel).toLowerCase()),
					)
					.map((b) => b.gebietId),
			);
		};
		const eigeneEinheiten =
			quelle.aemter > 1 ? quelle.zuordnung.get(gebietId) : undefined;
		if (quelle.aemter > 1 && !eigeneEinheiten) continue;
		const roheGebiete = quelle.gebiete
			.map((g) => {
				const eigen = quelle.zuordnung.get(g.gebietId);
				if (eigen) return { ...g, bausteinIds: eigen };
				if (g.gebietId === gebietId && quelle.aemter <= 1)
					return { ...g, bausteinIds: new Set(bausteinIds) };
				return { ...g, bausteinIds: ausWahlbereich(g.titel) };
			})
			.filter((g) => g.bausteinIds.size > 0)
			.filter(
				(g) =>
					!eigeneEinheiten ||
					[...g.bausteinIds].every((id) => eigeneEinheiten.has(id)),
			);
		belegt.add(`${wahlId}|${gebietId}`);
		const einheiten = eigeneEinheiten
			? quelle.bausteine.filter((b) => eigeneEinheiten.has(b.gebietId))
			: quelle.bausteine;
		const alsLokal = (
			ags: string,
			lokalWahlId: number,
			zeile: Einheit,
		): DemoLokal => ({
			schluessel: `${typ}|${ags}|${zeile.gebietId}`,
			ags,
			wahlId: lokalWahlId,
			gebietId: zeile.gebietId,
			meldungen: zeile.meldungen,
		});
		const jeEinheit = new Map<string, DemoLokal[]>(
			einheiten.map((b): [string, DemoLokal[]] => {
				if (quelle.ebene === LOKAL_EBENE)
					return [b.gebietId, [alsLokal(behoerde.ags, wahlId, b)]];
				const unten = gemeindeWahllokale(
					db,
					kreis,
					termin.id,
					typ,
					b.titel,
					untere,
				);
				return [
					b.gebietId,
					unten
						? unten.zeilen.map((z) => alsLokal(unten.ags, unten.wahlId, z))
						: [alsLokal(behoerde.ags, wahlId, b)],
				];
			}),
		);
		const zeile = (
			id: string,
			zeilenTitel: string,
			lokale: DemoLokal[],
		): DemoZeile => ({
			gebietId: id,
			titel: zeilenTitel,
			lokale,
			meldungen: lokale.reduce((n, l) => n + l.meldungen, 0),
		});
		gefunden.push({
			wahlId,
			typ: typ as Wahltyp,
			titel: e.titel as string,
			gebietId,
			gebietTitel: e.gebiet_titel as string,
			lokale: einheiten.flatMap((b) => jeEinheit.get(b.gebietId) ?? []),
			zeilen: [
				...einheiten.map((b) =>
					zeile(b.gebietId, b.titel, jeEinheit.get(b.gebietId) ?? []),
				),
				...roheGebiete.map((g) =>
					zeile(
						g.gebietId,
						g.titel,
						[...g.bausteinIds].flatMap((id) => jeEinheit.get(id) ?? []),
					),
				),
			].filter((z) => z.lokale.length > 0),
		});
	}
	return gefunden;
};

const liesZahlen = (
	db: Db,
	termin: string,
	ags: string,
	wahlId: number,
): Map<string, Ergebnis> =>
	new Map(
		(
			db
				.prepare(
					`SELECT gebiet_id, json FROM demo_quelle
					 WHERE termin = ? AND behoerde = ? AND wahl_id = ?`,
				)
				.all(termin, ags, wahlId) as Array<{
				gebiet_id: string;
				json: string;
			}>
		).map((r) => [r.gebiet_id, JSON.parse(r.json) as Ergebnis]),
	);

const liesZielStand = (
	db: Db,
	termin: string,
	ags: string,
	wahlId: number,
	seit: string,
): Map<
	string,
	{ leer: number; anz: number | null; max: number | null; frisch: number }
> =>
	new Map(
		(
			db
				.prepare(
					`SELECT gebiet_id, leer, stand_anz, stand_max,
					        (aktualisiert >= ?) AS frisch
					 FROM ergebnisse
					 WHERE termin = ? AND behoerde = ? AND wahl_id = ?`,
				)
				.all(seit, termin, ags, wahlId) as Array<{
				gebiet_id: string;
				leer: number;
				stand_anz: number | null;
				stand_max: number | null;
				frisch: number;
			}>
		).map((r) => [
			r.gebiet_id,
			{
				leer: r.leer,
				anz: r.stand_anz,
				max: r.stand_max,
				frisch: r.frisch,
			},
		]),
	);

export const spieleStand = (
	db: Db,
	termin: Termin,
	behoerde: Behoerde,
	wahlen: DemoWahl[],
	zyklus: Zyklus,
): number => {
	const stat = { anfragen: 0, geaendert: 0, fehler: [] as string[] };
	const zyklusBeginn = new Date(zyklus.beginn).toISOString();
	for (const w of wahlen) {
		const anteile = new Map(
			w.lokale.map((l) => [l.schluessel, eingangsAnteil(l.schluessel)]),
		);
		const da = (l: DemoLokal): boolean =>
			(anteile.get(l.schluessel) ?? 1) <= zyklus.fortschritt;

		const steht = liesZielStand(
			db,
			termin.id,
			behoerde.ags,
			w.wahlId,
			zyklusBeginn,
		);
		const arbeit = w.zeilen
			.map((z) => {
				const ein = z.lokale.filter(da);
				return {
					z,
					ein,
					summe: ein.reduce((n, l) => n + l.meldungen, 0),
				};
			})
			.filter(({ z, ein, summe }) => {
				const v = steht.get(z.gebietId);
				return !(
					v !== undefined &&
					v.frisch === 1 &&
					v.leer === (ein.length === 0 ? 1 : 0) &&
					v.anz === summe &&
					v.max === z.meldungen
				);
			});
		if (arbeit.length === 0) continue;

		const quellen = new Map<string, Map<string, Ergebnis>>();
		const roh = (ags: string, wahlId: number): Map<string, Ergebnis> => {
			const k = `${ags}|${wahlId}`;
			let m = quellen.get(k);
			if (!m) {
				m = liesZahlen(db, termin.id, ags, wahlId);
				quellen.set(k, m);
			}
			return m;
		};
		const verrauscht = new Map<string, Ergebnis | undefined>();
		const stimmen = (l: DemoLokal): Ergebnis | undefined => {
			let e = verrauscht.get(l.schluessel);
			if (e === undefined && !verrauscht.has(l.schluessel)) {
				const vorlage = roh(l.ags, l.wahlId).get(l.gebietId);
				e = vorlage
					? verrausche(vorlage, (key) => rauschFaktor(l.schluessel, key))
					: undefined;
				verrauscht.set(l.schluessel, e);
			}
			return e;
		};

		for (const { z, ein, summe } of arbeit) {
			const vorlage = roh(behoerde.ags, w.wahlId).get(z.gebietId);
			if (!vorlage) continue;
			speichereErgebnis(
				db,
				termin,
				behoerde.ags,
				w.wahlId,
				w.titel,
				z.gebietId,
				zaehleZusammen(
					vorlage,
					ein.map(stimmen).filter((e): e is Ergebnis => e !== undefined),
					summe,
					z.meldungen,
					new Date(
						eingangsZeit(
							zyklus,
							ein.map((l) => anteile.get(l.schluessel) ?? 0),
						),
					).toISOString(),
				),
				stat,
			);
		}
	}
	return stat.geaendert;
};
