/**
 * Der Demo-Wahlabend am Datenbestand: Wahlbezirke tröpfeln herein.
 *
 * `demo.ts` rechnet, dieses Modul liest und schreibt. Die Trennung ist
 * dieselbe wie überall im Projekt: Der Kern lässt sich ohne SQLite prüfen, und
 * hier steht nur, woher die Zahlen kommen und wohin sie gehen.
 *
 * **Der Weg ist der des Pollers.** `speichereErgebnis` legt die Zeile an und
 * schreibt den Ticker-Eintrag; alles Weitere – Hochrechnung, Datenstand,
 * Zustellung an offene Seiten – liest die Anwendung daraus. Deshalb prüft die
 * Demo den echten Weg und nicht einen nachgebauten.
 */
import type { Behoerde } from "../data/behoerden.ts";
import type { Kreis } from "../data/kreise.ts";
import {
	TERMINE,
	type Termin,
	terminGiltFuerBehoerde,
} from "../data/termine.ts";
import type { Db } from "./db.ts";
import { jetzt } from "./db.ts";
import { type Zyklus, mische, rauschFaktor, zaehleZusammen } from "./demo.ts";
import { speichereErgebnis } from "./poll.ts";
import type { Ergebnis } from "./votemanager.ts";
import { wahlSlugs } from "./wahltyp.ts";

/**
 * Ebenen, aus denen die Bausteine kommen – von fein nach grob, wie bei der
 * Hochrechnung (siehe seite.ts). Eine Gemeinde zählt Wahlbezirke aus, der
 * Landkreis bekommt seine Zahlen von den Gemeinden.
 */
const BAUSTEIN_EBENEN = [6, 3];

type Zeile = {
	wahlId: number;
	gebietId: string;
	ebene: number;
	titel: string;
	ergebnis: Ergebnis;
};

const leseErgebnisse = (db: Db, termin: string, ags: string): Zeile[] =>
	(
		db
			.prepare(
				"SELECT wahl_id, gebiet_id, ebene, titel, json FROM ergebnisse WHERE termin = ? AND behoerde = ? AND leer = 0",
			)
			.all(termin, ags) as Array<Record<string, unknown>>
	).map((r) => ({
		wahlId: r.wahl_id as number,
		gebietId: r.gebiet_id as string,
		ebene: r.ebene as number,
		titel: r.titel as string,
		ergebnis: JSON.parse(r.json as string) as Ergebnis,
	}));

/** Eine Wahl der Vorlage mit allem, was die Simulation daraus braucht. */
export type DemoWahl = {
	wahlId: number;
	titel: string;
	gebietId: string;
	gebietTitel: string;
	/** Die Auszähleinheiten dieser Wahl */
	bausteine: Zeile[];
	/** Alle übrigen Gebiete – sie bekommen die Summe ihrer Bausteine */
	gebiete: Array<Zeile & { bausteinIds: Set<string> }>;
};

/**
 * Welcher frühere Termin die Zahlen für eine Behörde liefert.
 *
 * Der jüngste, den diese Wahlleitung selbst geführt hat und zu dem Ergebnisse
 * in der Datenbank stehen. Für die meisten ist das die Kommunalwahl 2021; wo
 * eine Bürgermeisterwahl dazwischen lag (Nordstemmen 2020), kommen deren
 * Zahlen für dieses eine Amt von dort – dieselbe Zuordnung, nach der die
 * Wahlseiten ihre Veränderungswerte suchen.
 */
export const vorwertTermine = (
	kreis: Kreis,
	ziel: Termin,
	behoerde: Behoerde,
): Termin[] =>
	TERMINE.filter(
		(t) => t.datum < ziel.datum && terminGiltFuerBehoerde(t, kreis, behoerde),
	).sort((a, b) => b.datum.localeCompare(a.datum));

/**
 * Die Vorlage einer Behörde: je Amt die jüngste frühere Wahl, mit ihren
 * Bausteinen und Gebieten.
 *
 * Ein Amt kommt genau einmal vor. Läuft die Suche über mehrere Termine (2021
 * für den Rat, 2020 für den Bürgermeister), gewinnt der jüngste, der es führt
 * – so wie auf den Wahlseiten auch.
 */
export const baueVorlage = (
	db: Db,
	kreis: Kreis,
	ziel: Termin,
	behoerde: Behoerde,
): DemoWahl[] => {
	const gefunden = new Map<string, DemoWahl>();
	for (const termin of vorwertTermine(kreis, ziel, behoerde)) {
		const zeilen = leseErgebnisse(db, termin.id, behoerde.ags);
		if (zeilen.length === 0) continue;
		const eintraege = db
			.prepare(
				"SELECT wahl_id, gebiet_id, titel, gebiet_titel, typ FROM wahleintraege WHERE termin = ? AND behoerde = ? ORDER BY reihenfolge",
			)
			.all(termin.id, behoerde.ags) as Array<Record<string, unknown>>;
		for (const e of eintraege) {
			const typ = e.typ as string;
			if (gefunden.has(typ)) continue;
			const wahlId = e.wahl_id as number;
			const gebietId = e.gebiet_id as string;
			const eigene = zeilen.filter((z) => z.wahlId === wahlId);
			const gesamt = eigene.find((z) => z.gebietId === gebietId);
			if (!gesamt) continue;
			const ebene = BAUSTEIN_EBENEN.find(
				(x) => eigene.filter((z) => z.ebene === x).length >= 2,
			);
			if (!ebene) continue;
			const bausteine = eigene.filter((z) => z.ebene === ebene);
			const bausteinIds = new Set(bausteine.map((z) => z.gebietId));
			const gebiete = eigene
				.filter((z) => !bausteinIds.has(z.gebietId))
				.map((z) => ({
					...z,
					bausteinIds: new Set(
						z.ergebnis.untergebiete
							.flatMap((u) => u.gebiete.map((g) => g.id))
							.filter((id) => bausteinIds.has(id)),
					),
				}))
				// Ein Gebiet ohne eigene Bausteine ließe sich nicht auszählen; das
				// Gesamtgebiet bekommt notfalls alle.
				.map((z) =>
					z.bausteinIds.size > 0
						? z
						: { ...z, bausteinIds: new Set(bausteinIds) },
				);
			gefunden.set(typ, {
				wahlId,
				titel: e.titel as string,
				gebietId,
				gebietTitel: e.gebiet_titel as string,
				bausteine,
				gebiete,
			});
		}
	}
	return [...gefunden.values()];
};

/**
 * Legt Wahlen und Wahleinträge des Demo-Termins an – einmal beim Start.
 *
 * Ids und Zuschnitt kommen unverändert aus der Vorlage; nur der Termin ist ein
 * anderer. Das erspart jede Zuordnung zwischen zwei Wahljahren und ist für
 * eine Demo-Datenbank, die niemand sonst benutzt, das ehrlichste Verfahren.
 */
/**
 * Räumt den Demo-Termin leer, bevor die Vorlage einzieht.
 *
 * Der Ausgangsbestand bringt den Termin 2026 mit, wie ihn die Wahlleitungen
 * heute führen: angelegte Wahlen ohne Zahlen, mit ihren eigenen Gebiets-Ids.
 * Die Simulation arbeitet mit den Ids der Vorlage – ohne dieses Aufräumen
 * stünden beide nebeneinander, und die Seite zeigte jede Wahl doppelt, einmal
 * mit und einmal ohne Zahlen.
 */
export const raeumeDemoTermin = (
	db: Db,
	termin: Termin,
	behoerde: Behoerde,
): void => {
	for (const tabelle of [
		"ergebnisse",
		"uebersichten",
		"ereignisse",
		"wahleintraege",
		"wahlen",
	])
		db.prepare(`DELETE FROM ${tabelle} WHERE termin = ? AND behoerde = ?`).run(
			termin.id,
			behoerde.ags,
		);
};

export const legeWahlenAn = (
	db: Db,
	termin: Termin,
	behoerde: Behoerde,
	wahlen: DemoWahl[],
): void => {
	const slugs = wahlSlugs(
		wahlen.map((w) => ({
			wahlId: w.wahlId,
			titel: w.titel,
			gebietTitel: w.gebietTitel,
			gebietId: w.gebietId,
		})),
		behoerde.name,
	);
	const ein = db.prepare(
		"INSERT INTO wahleintraege (termin, behoerde, wahl_id, gebiet_id, titel, gebiet_titel, gebiet, typ, slug, reihenfolge) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
	);
	const wahl = db.prepare(
		`INSERT INTO wahlen (termin, behoerde, wahl_id, titel, typ, datum, status, json, aktualisiert) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(termin, behoerde, wahl_id) DO UPDATE SET titel = excluded.titel, typ = excluded.typ, status = excluded.status, aktualisiert = excluded.aktualisiert`,
	);
	wahlen.forEach((w, i) => {
		ein.run(
			termin.id,
			behoerde.ags,
			w.wahlId,
			w.gebietId,
			w.titel,
			w.gebietTitel,
			slugs[i].gebiet,
			slugs[i].typ,
			slugs[i].slug,
			i,
		);
		wahl.run(
			termin.id,
			behoerde.ags,
			w.wahlId,
			w.titel,
			slugs[i].typ,
			termin.datum,
			// Kein Status: Ein „amtliches Endergebnis“ wäre in einer Simulation
			// eine Behauptung, die nichts deckt.
			null,
			JSON.stringify({ titel: w.titel, datum: termin.datum }),
			jetzt(),
		);
	});
};

/**
 * Schreibt den Stand, der zu diesem Augenblick des Zyklus gehört.
 *
 * Zustandslos: Was schon eingegangen ist, ergibt sich allein aus `zyklus`.
 * Zweimal derselbe Aufruf schreibt dasselbe – und `speichereErgebnis`
 * erkennt am Hash, dass sich nichts geändert hat, und legt keinen zweiten
 * Ticker-Eintrag an.
 */
export const spieleStand = (
	db: Db,
	termin: Termin,
	behoerde: Behoerde,
	wahlen: DemoWahl[],
	zyklus: Zyklus,
): number => {
	const stat = { anfragen: 0, geaendert: 0, fehler: [] as string[] };
	for (const w of wahlen) {
		const reihenfolge = mische(
			w.bausteine,
			`${zyklus.nummer}|${behoerde.ags}|${w.wahlId}`,
		);
		const wieViele = Math.round(zyklus.fortschritt * reihenfolge.length);
		const da = new Set(reihenfolge.slice(0, wieViele).map((z) => z.gebietId));
		const faktor = (key: string) => rauschFaktor(zyklus.nummer, key);

		// Die Bausteine selbst: entweder ganz da oder noch gar nicht.
		for (const b of w.bausteine) {
			const drin = da.has(b.gebietId);
			const e = drin
				? zaehleZusammen(b.ergebnis, [b.ergebnis], 1, 1, faktor)
				: {
						...b.ergebnis,
						leer: true,
						parteien: [],
						stand: { ...b.ergebnis.stand, anz: 0, max: 1, hinweis: [] },
					};
			speichereErgebnis(
				db,
				termin,
				behoerde.ags,
				w.wahlId,
				w.titel,
				b.gebietId,
				e,
				stat,
			);
		}

		// Und die Gebiete darüber: die Summe dessen, was von ihnen da ist.
		for (const g of w.gebiete) {
			const meine = w.bausteine.filter((b) => g.bausteinIds.has(b.gebietId));
			const eingegangen = meine.filter((b) => da.has(b.gebietId));
			speichereErgebnis(
				db,
				termin,
				behoerde.ags,
				w.wahlId,
				w.titel,
				g.gebietId,
				zaehleZusammen(
					g.ergebnis,
					eingegangen.map((b) => b.ergebnis),
					eingegangen.length,
					meine.length,
					faktor,
				),
				stat,
			);
		}
	}
	return stat.geaendert;
};
