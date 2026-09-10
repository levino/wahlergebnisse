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
import {
	type Zyklus,
	eingangsZeit,
	mische,
	rauschFaktor,
	zaehleZusammen,
} from "./demo.ts";
import { speichereErgebnis } from "./poll.ts";
import {
	gemeindenImWahlbereich,
	kreisWahlbereiche,
	wahlbereichKuerzel,
} from "./wahlbereiche.ts";
import { gebietsname } from "./wahltyp.ts";
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
	/**
	 * Die Kennung, unter der die Wahlleitung dieses Amt **am Zieltermin**
	 * führt – nicht die des Vorwerts. Damit spielt die Probe in die echten
	 * Wahlen von 2026 hinein und legt keine zweiten daneben; Namen und Zahlen
	 * kommen weiter von damals.
	 */
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
 *
 * **Ein Amt heißt Wahlart *und* Gebiet.** Eine Gemeinde wählt einen Rat, aber
 * neun Ortsräte, und die sind neun Ämter und nicht eins: Nach der Wahlart
 * allein unterschieden, blieb von Nordstemmen ein einziger Ortsrat übrig
 * (Adensen, weil er als erster in der Liste steht) – und ausgerechnet der Ort,
 * in dem der Beamer steht, fehlte.
 *
 * **Nur Ämter, die es am Zieltermin wirklich gibt.** Welche Wahlen 2026
 * stattfinden, ist keine Frage und keine Schätzung: Die Wahlleitungen haben
 * ihre Präsentationen längst angelegt, und sie stehen in der Datenbank – im
 * Landkreis Hildesheim 146 Wahlen, davon 13 Bürgermeisterwahlen; Alfeld und
 * die Stadt Hildesheim wählen diesmal keinen. Die Generalprobe nimmt deshalb
 * **die Ämter von 2026** und sucht dazu die Zahlen von damals, nicht
 * umgekehrt. Andersherum stünde in Alfeld eine Bürgermeisterwahl auf der
 * Leinwand, die es nicht gibt – und ein Ortsrat, den es neu gibt, fehlte.
 *
 * Ein Amt ohne Vorwert bleibt stehen und bleibt leer. Das ist die Wahrheit
 * über es: Es wird gewählt, und es liegt nichts vor.
 *
 * **Ohne Stichwahlen.** Sie stehen am Zieltermin ohnehin nicht angelegt da –
 * ob es dazu kommt, entscheidet sich am Wahltag.
 */
/** Wahlart und Gebiet zusammen – so heißt ein Amt. */
const amtsSchluessel = (typ: string, gebiet: string, gebietTitel: string) =>
	`${typ}|${(gebiet || gebietTitel || "").trim().toLowerCase()}`;

const eintraegeVon = (db: Db, termin: string, ags: string) =>
	db
		.prepare(
			"SELECT wahl_id, gebiet_id, titel, gebiet_titel, gebiet, typ FROM wahleintraege WHERE termin = ? AND behoerde = ? ORDER BY reihenfolge",
		)
		.all(termin, ags) as Array<Record<string, unknown>>;

/**
 * Die Ämter, die diese Wahlleitung am Zieltermin führt – und die Wahl-Ids, mit
 * denen sie das tut.
 *
 * Daran hängt zweierlei: welche Ämter die Probe überhaupt nachspielt, und
 * welche Zeilen sie dafür aus dem Weg räumen darf (siehe `raeumeDemoTermin`).
 */
export const aemterAmZiel = (
	db: Db,
	ziel: Termin,
	behoerde: Behoerde,
): Map<string, number> =>
	new Map(
		eintraegeVon(db, ziel.id, behoerde.ags)
			.filter((e) => !String(e.typ).endsWith("-stichwahl"))
			.map((e) => [
				amtsSchluessel(
					e.typ as string,
					(e.gebiet as string | null) ?? "",
					e.gebiet_titel as string,
				),
				e.wahl_id as number,
			]),
	);

export const baueVorlage = (
	db: Db,
	kreis: Kreis,
	ziel: Termin,
	behoerde: Behoerde,
): DemoWahl[] => {
	// Die Ämter des Zieltermins geben vor, was gespielt wird. Führt die
	// Wahlleitung dort nichts (eine Gemeinde ohne eigene Präsentation), gibt es
	// auch nichts nachzuspielen.
	const gesucht = aemterAmZiel(db, ziel, behoerde);
	if (gesucht.size === 0) return [];
	const gefunden = new Map<string, DemoWahl>();
	for (const termin of vorwertTermine(kreis, ziel, behoerde)) {
		const zeilen = leseErgebnisse(db, termin.id, behoerde.ags);
		if (zeilen.length === 0) continue;
		for (const e of eintraegeVon(db, termin.id, behoerde.ags)) {
			const typ = e.typ as string;
			if (typ.endsWith("-stichwahl")) continue;
			// Wahlart **und** Gebiet: neun Ortsräte sind neun Ämter, ein Rat ist
			// einer. Der Gebietsname dedupliziert weiter über die Termine hinweg
			// – derselbe Ortsrat heißt 2021 wie 2016.
			const amt = amtsSchluessel(
				typ,
				(e.gebiet as string | null) ?? "",
				e.gebiet_titel as string,
			);
			// Was am Zieltermin nicht gewählt wird, wird auch nicht nachgespielt.
			if (!gesucht.has(amt)) continue;
			if (gefunden.has(amt)) continue;
			const quellWahlId = e.wahl_id as number;
			const wahlId = quellWahlId;
			const gebietId = e.gebiet_id as string;
			const eigene = zeilen.filter((z) => z.wahlId === quellWahlId);
			const gesamt = eigene.find((z) => z.gebietId === gebietId);
			if (!gesamt) continue;
			const ebene = BAUSTEIN_EBENEN.find(
				(x) => eigene.filter((z) => z.ebene === x).length >= 2,
			);
			if (!ebene) continue;
			const bausteine = eigene.filter((z) => z.ebene === ebene);
			const bausteinIds = new Set(bausteine.map((z) => z.gebietId));
			// Welche Einheiten zu einem Gebiet gehören, steht in seinen
			// Untergebieten. Wo die Quelle sie nicht führt, greift für
			// Kreiswahlbereiche die zweite Quelle: Ein Wahlbereich ist die
			// Summe seiner Gemeinden (wahlbereiche.ts).
			const bereiche = kreisWahlbereiche(termin.id);
			const ausUntergebieten = (z: Zeile): Set<string> =>
				new Set(
					z.ergebnis.untergebiete
						.flatMap((u) => u.gebiete.map((g) => g.id))
						.filter((id) => bausteinIds.has(id)),
				);
			const ausWahlbereich = (z: Zeile): Set<string> => {
				const kuerzel = wahlbereichKuerzel(z.titel);
				if (!kuerzel) return new Set();
				const gemeinden = gemeindenImWahlbereich(kuerzel, bereiche).map((g) =>
					gebietsname(g).toLowerCase(),
				);
				if (gemeinden.length === 0) return new Set();
				return new Set(
					bausteine
						.filter((b) =>
							gemeinden.includes(gebietsname(b.titel).toLowerCase()),
						)
						.map((b) => b.gebietId),
				);
			};
			const gebiete = eigene
				.filter((z) => !bausteinIds.has(z.gebietId))
				.map((z) => {
					// Das Wahlgebiet selbst *ist* die Summe aller Einheiten – das
					// ist keine Annahme, sondern seine Bedeutung.
					if (z.gebietId === gebietId)
						return { ...z, bausteinIds: new Set(bausteinIds) };
					const eigen = ausUntergebieten(z);
					return {
						...z,
						bausteinIds: eigen.size > 0 ? eigen : ausWahlbereich(z),
					};
				})
				// **Ein Gebiet ohne eigene Einheiten gibt es nicht.** Vorher fiel
				// so eines auf „alle Einheiten" zurück – und der Kreiswahlbereich
				// B zeigte damit die Bewerber und Stimmen des *ganzen Kreises*:
				// plausibel aussehend und komplett falsch. Wer nicht weiß, woraus
				// ein Gebiet besteht, darf es nicht nachspielen.
				.filter((z) => z.bausteinIds.size > 0);
			gefunden.set(amt, {
				// Die Wahl des Zieltermins, nicht die von damals.
				wahlId: gesucht.get(amt) ?? wahlId,
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
 * Räumt die Ämter frei, die die Probe nachspielt – und **nur** die.
 *
 * Der Ausgangsbestand bringt den Zieltermin mit, wie ihn die Wahlleitungen
 * heute führen: angelegte Wahlen ohne Zahlen, mit ihren eigenen Gebiets-Ids.
 * Die Simulation arbeitet mit den Gebieten des Vorwerts – ohne dieses
 * Aufräumen stünde jede Wahl doppelt da, einmal mit und einmal ohne Zahlen.
 *
 * Was die Probe *nicht* nachspielt (ein Amt ohne Vorwert), bleibt unangetastet
 * stehen und bleibt leer. Das ist die Wahrheit über dieses Amt: Es wird
 * gewählt, und es liegt nichts vor – genau so sieht es um 18 Uhr aus.
 */
export const raeumeDemoTermin = (
	db: Db,
	termin: Termin,
	behoerde: Behoerde,
	wahlen: readonly DemoWahl[],
): void => {
	const ids = [...new Set(wahlen.map((w) => w.wahlId))];
	if (ids.length === 0) return;
	const platzhalter = ids.map(() => "?").join(",");
	for (const tabelle of [
		"ergebnisse",
		"uebersichten",
		"ereignisse",
		"wahleintraege",
		"wahlen",
	])
		db.prepare(
			`DELETE FROM ${tabelle} WHERE termin = ? AND behoerde = ? AND wahl_id IN (${platzhalter})`,
		).run(termin.id, behoerde.ags, ...ids);
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
		// Der Zeitstempel gehört zur letzten eingegangenen Schnellmeldung, nicht
		// zum Augenblick des Schreibens: „Stand 20:14“ steht dann still, bis der
		// nächste Wahlbezirk kommt – wie am echten Abend, und ohne dass sich
		// jede Zeile alle fünf Sekunden ändert (siehe eingangsZeit in demo.ts).
		const stempel = new Date(
			eingangsZeit(zyklus, wieViele, reihenfolge.length),
		).toISOString();

		// Die Bausteine selbst: entweder ganz da oder noch gar nicht.
		for (const b of w.bausteine) {
			const drin = da.has(b.gebietId);
			// Eine Einheit ist ganz da oder gar nicht – aber auch sie führt ihre
			// eigene Zahl von Schnellmeldungen (eine Gemeinde beim Kreistag
			// bringt 23 mit, ein Wahlbezirk eine).
			const seine = b.ergebnis.stand.max ?? 1;
			const e = drin
				? zaehleZusammen(
						b.ergebnis,
						[b.ergebnis],
						seine,
						seine,
						faktor,
						stempel,
					)
				: {
						...b.ergebnis,
						leer: true,
						parteien: [],
						zeitstempel: new Date(zyklus.beginn).toISOString(),
						stand: { ...b.ergebnis.stand, anz: 0, max: seine, hinweis: [] },
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
			// **Der Auszählstand zählt Schnellmeldungen, nicht Gebietszeilen.**
			// Beim Kreistag führt die Kreisbehörde keine Wahlbezirke: Ihre
			// Auszähleinheiten sind die 18 Gemeinden, und die Simulation schrieb
			// deshalb „4 von 18" – für einen Kreis mit 426 Schnellmeldungen eine
			// sinnlose Zahl, und für den Wahlbereich B (Elze und Nordstemmen,
			// zusammen 37) genauso.
			//
			// Gerechnet wird nicht hoch, sondern addiert: Jede Einheit bringt
			// ihre eigene Zahl mit (Nordstemmen 23, Elze 14). Was eingegangen
			// ist, ist die Summe dieser Zahlen – exakt, nicht geschätzt. Ein
			// Dreisatz („22 % von 426") stünde daneben und wäre erfunden.
			const meldungen = (z: Zeile) => z.ergebnis.stand.max ?? 1;
			const summe = (zs: Zeile[]) => zs.reduce((n, z) => n + meldungen(z), 0);
			const max = summe(meine) || (g.ergebnis.stand.max ?? meine.length);
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
					summe(eingegangen),
					max,
					faktor,
					stempel,
				),
				stat,
			);
		}
	}
	return stat.geaendert;
};
