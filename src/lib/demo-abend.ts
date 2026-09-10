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
 *
 * **Die Auswahl macht SQLite, das Rechnen macht `demo.ts`.** Welche Zeilen zu
 * einem Amt gehören, welche Ebene die Auszähleinheiten stellt, aus welchen
 * Einheiten ein Gebiet besteht und wie viele Schnellmeldungen dahinterstehen –
 * das sind Fragen an die Datenbank, und sie werden dort beantwortet
 * (`WHERE`, `GROUP BY`, `SUM`, `json_each` über die Untergebiete). In
 * JavaScript bleibt, was sich nicht als Abfrage schreiben lässt: das Rauschen,
 * die Reihenfolge des Eingangs und das Zusammenzählen der Stimmen je Partei
 * mit ihren Kandidatenlisten (`zaehleZusammen` in `demo.ts`).
 *
 * **Die Vorlage trägt keine Zahlen.** Sie ist ein Verzeichnis: Ids, Namen und
 * Meldungszahlen, sonst nichts. Die Ergebnisse selbst holt `spieleStand` je
 * Quellwahl frisch aus der Datenbank und lässt sie danach wieder fallen. So
 * hängt der Speicherbedarf an der größten *einzelnen* Wahl und nicht an der
 * Zahl der Wahlleitungen – siehe `scripts/demo-messung.ts`.
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
	eingangsAnteil,
	eingangsZeit,
	rauschFaktor,
	zaehleZusammen,
} from "./demo.ts";
import { speichereErgebnis } from "./poll.ts";
import {
	type Wahlbereiche,
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

/**
 * Eine Auszähleinheit der Vorlage – ohne ihre Zahlen.
 *
 * `meldungen` ist die Zahl der Schnellmeldungen, die diese Einheit mitbringt:
 * ein Wahlbezirk eine, eine Gemeinde beim Kreistag ihre 23. Sie steht als
 * Spalte `stand_max` in der Datenbank und muss dafür nicht durch `JSON.parse`.
 */
export type DemoBaustein = {
	gebietId: string;
	titel: string;
	meldungen: number;
};

/** Ein Gebiet der Vorlage: woraus es besteht und wie viel das zusammen ist. */
export type DemoGebiet = {
	gebietId: string;
	titel: string;
	/** Die Auszähleinheiten, aus denen dieses Gebiet besteht */
	bausteinIds: Set<string>;
	/** Schnellmeldungen aller seiner Einheiten, von SQLite summiert */
	meldungen: number;
};

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
	/** Termin, aus dem die Zahlen kommen (2021, für Nordstemmens Bürgermeister 2020) */
	quellTermin: string;
	/** Kennung dieses Amtes **damals** – unter ihr stehen die Zeilen in der Datenbank */
	quellWahlId: number;
	/** Die Auszähleinheiten dieser Wahl */
	bausteine: DemoBaustein[];
	/** Alle übrigen Gebiete – sie bekommen die Summe ihrer Bausteine */
	gebiete: DemoGebiet[];
};

/**
 * Welche Ebene die Auszähleinheiten stellt: die feinste der beiden, von der es
 * mindestens zwei Zeilen gibt. Gezählt wird in SQLite – eine Zeile Antwort
 * statt aller Ergebniszeilen der Wahl.
 */
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
					`SELECT ebene FROM ergebnisse
					 WHERE termin = ? AND behoerde = ? AND wahl_id = ? AND leer = 0
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

/**
 * Alles, was die Vorlage über eine Quellwahl wissen muss – in vier Abfragen
 * und ohne eine einzige Ergebniszahl.
 *
 * `ORDER BY gebiet_id` ist kein Schmuck: Die Reihenfolge der Einheiten
 * entscheidet über die Reihenfolge des Eingangs (`mische` in demo.ts). Ohne
 * ausdrückliche Sortierung hinge sie am Abfrageplan, und ein neuer Index würde
 * den nachgespielten Abend umstellen.
 */
type Quellwahl = {
	ebene: number;
	bausteine: DemoBaustein[];
	/** Schnellmeldungen aller Einheiten zusammen – das Wahlgebiet selbst ist ihre Summe */
	meldungenGesamt: number;
	gebiete: Array<{ gebietId: string; titel: string; standMax: number | null }>;
	/** Gebiets-Id → seine Einheiten, aus den Untergebieten der Quelle */
	zuordnung: Map<string, { ids: Set<string>; meldungen: number }>;
	/** Wie viele Ämter sich diese Wahl teilen – 2021 alle neun Ortsräte Nordstemmens eine */
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
			 FROM ergebnisse
			 WHERE termin = ? AND behoerde = ? AND wahl_id = ? AND leer = 0 AND ebene = ?
			 ORDER BY gebiet_id`,
		)
		.all(termin, ags, wahlId, ebene) as Array<{
		gebiet_id: string;
		titel: string;
		meldungen: number;
	}>;
	const gesamt = db
		.prepare(
			`SELECT SUM(COALESCE(stand_max, 1)) AS n
			 FROM ergebnisse
			 WHERE termin = ? AND behoerde = ? AND wahl_id = ? AND leer = 0 AND ebene = ?`,
		)
		.get(termin, ags, wahlId, ebene) as { n: number | null };
	const gebiete = db
		.prepare(
			`SELECT gebiet_id, titel, stand_max
			 FROM ergebnisse
			 WHERE termin = ? AND behoerde = ? AND wahl_id = ? AND leer = 0 AND ebene <> ?
			 ORDER BY gebiet_id`,
		)
		.all(termin, ags, wahlId, ebene) as Array<{
		gebiet_id: string;
		titel: string;
		stand_max: number | null;
	}>;
	// Woraus ein Gebiet besteht, steht in seinen Untergebieten – einer Liste
	// von Listen im gespeicherten JSON. `json_each` geht sie in SQLite durch,
	// der Verbund wirft weg, was keine Auszähleinheit dieser Wahl ist, und das
	// Fenster summiert die Schnellmeldungen je Gebiet.
	//
	// **`AS MATERIALIZED` ist hier kein Feinschliff, sondern der Unterschied
	// zwischen 1,6 und 15 Millisekunden.** Ohne die Anweisung zieht SQLite die
	// Untergebiete in den Verbund hinein und parst das JSON einer Ergebniszeile
	// – mit allen Parteien und Kandidatenlisten, ein paar Dutzend Kilobyte –
	// für jeden einzelnen Verbundversuch neu. Materialisiert wird es einmal
	// gelesen (siehe scripts/demo-messung.ts).
	const zuordnung = new Map<string, { ids: Set<string>; meldungen: number }>();
	for (const r of db
		.prepare(
			`WITH untergebiete AS MATERIALIZED (
			   SELECT e.gebiet_id AS gebiet, json_extract(g.value, '$.id') AS baustein
			   FROM ergebnisse e,
			        json_each(e.json, '$.untergebiete') u,
			        json_each(u.value, '$.gebiete') g
			   WHERE e.termin = ? AND e.behoerde = ? AND e.wahl_id = ? AND e.leer = 0
			     AND e.ebene <> ?
			 ), paare AS (
			   SELECT DISTINCT u.gebiet AS gebiet, b.gebiet_id AS baustein,
			          COALESCE(b.stand_max, 1) AS meldungen
			   FROM untergebiete u
			   JOIN ergebnisse b ON b.termin = ? AND b.behoerde = ? AND b.wahl_id = ?
			     AND b.gebiet_id = u.baustein AND b.ebene = ? AND b.leer = 0
			 )
			 SELECT gebiet, baustein, SUM(meldungen) OVER (PARTITION BY gebiet) AS summe
			 FROM paare ORDER BY gebiet, baustein`,
		)
		.all(termin, ags, wahlId, ebene, termin, ags, wahlId, ebene) as Array<{
		gebiet: string;
		baustein: string;
		summe: number;
	}>) {
		const eintrag = zuordnung.get(r.gebiet) ?? {
			ids: new Set<string>(),
			meldungen: 0,
		};
		eintrag.ids.add(r.baustein);
		eintrag.meldungen = r.summe;
		zuordnung.set(r.gebiet, eintrag);
	}
	return {
		ebene,
		bausteine: bausteine.map((b) => ({
			gebietId: b.gebiet_id,
			titel: b.titel,
			meldungen: b.meldungen,
		})),
		meldungenGesamt: gesamt.n ?? 0,
		gebiete: gebiete.map((g) => ({
			gebietId: g.gebiet_id,
			titel: g.titel,
			standMax: g.stand_max,
		})),
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

/**
 * Die Wahleinträge einer Wahlleitung – ohne Stichwahlen.
 *
 * Die Stichwahlen fallen in SQLite weg und nicht danach in JavaScript: Sie
 * stehen am Zieltermin ohnehin nicht angelegt da, und was nicht gebraucht wird,
 * muss auch nicht geliefert werden.
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
		eintraegeVon(db, ziel.id, behoerde.ags).map((e) => [
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
		// Mehrere Ämter teilen sich eine Quellwahl – 2021 lagen alle neun
		// Ortsräte Nordstemmens unter einer Kennung. Die Abfragen dazu laufen
		// deshalb einmal je Quellwahl und nicht einmal je Amt. Der Merkzettel
		// lebt nur für diesen Aufruf; über Aufrufe hinweg merkt sich die Probe
		// nichts.
		const gelesen = new Map<number, Quellwahl | undefined>();
		// Die zweite Quelle für Kreiswahlbereiche wird erst geholt, wenn sie
		// gebraucht wird: Sie liest die Wahlräume **aller** Gemeinden des
		// Kreises, und für eine Gemeindewahlleitung ist sie nie nötig.
		let bereiche: Wahlbereiche | undefined;
		for (const e of eintraegeVon(db, termin.id, behoerde.ags)) {
			// Wahlart **und** Gebiet: neun Ortsräte sind neun Ämter, ein Rat ist
			// einer. Der Gebietsname dedupliziert weiter über die Termine hinweg
			// – derselbe Ortsrat heißt 2021 wie 2016.
			const amt = amtsSchluessel(
				e.typ as string,
				(e.gebiet as string | null) ?? "",
				e.gebiet_titel as string,
			);
			// Was am Zieltermin nicht gewählt wird, wird auch nicht nachgespielt.
			if (!gesucht.has(amt)) continue;
			if (gefunden.has(amt)) continue;
			const quellWahlId = e.wahl_id as number;
			const gebietId = e.gebiet_id as string;
			if (!gelesen.has(quellWahlId))
				gelesen.set(
					quellWahlId,
					liesQuellwahl(db, termin.id, behoerde.ags, quellWahlId),
				);
			const quelle = gelesen.get(quellWahlId);
			if (!quelle) continue;
			const bausteinIds = new Set(quelle.bausteine.map((b) => b.gebietId));
			// Ohne eigene Zeile gibt es dieses Amt in der Quelle nicht.
			const gesamt =
				bausteinIds.has(gebietId) ||
				quelle.gebiete.some((g) => g.gebietId === gebietId);
			if (!gesamt) continue;
			// Wo die Quelle die Untergebiete nicht führt, greift für
			// Kreiswahlbereiche die zweite Quelle: Ein Wahlbereich ist die Summe
			// seiner Gemeinden (wahlbereiche.ts). Das ist Namensarbeit an
			// Gebietsbezeichnungen und bleibt deshalb hier.
			const ausWahlbereich = (titel: string): Set<string> => {
				const kuerzel = wahlbereichKuerzel(titel);
				if (!kuerzel) return new Set();
				// Die Gemeinden **dieses** Kreises, nicht die des Standard-Kreises:
				// Die Probe läuft in jedem betrachteten Kreis, und die Region
				// Hannover hat andere Gemeinden als der Landkreis Hildesheim.
				bereiche ??= kreisWahlbereiche(
					termin.id,
					kreis.behoerden.filter((b) => b.art !== "kreis"),
				);
				const gemeinden = gemeindenImWahlbereich(kuerzel, bereiche).map((g) =>
					gebietsname(g).toLowerCase(),
				);
				if (gemeinden.length === 0) return new Set();
				return new Set(
					quelle.bausteine
						.filter((b) =>
							gemeinden.includes(gebietsname(b.titel).toLowerCase()),
						)
						.map((b) => b.gebietId),
				);
			};
			// Teilen sich mehrere Ämter eine Quellwahl – 2021 lagen alle neun
			// Ortsräte Nordstemmens unter einer Kennung –, gehört diesem Amt nur
			// ein Teil ihrer Einheiten. Steht in der Quelle nicht, welcher, wird
			// das Amt übersprungen und nicht geraten.
			const eigeneEinheiten =
				quelle.aemter > 1 ? quelle.zuordnung.get(gebietId)?.ids : undefined;
			if (quelle.aemter > 1 && !eigeneEinheiten) continue;
			const gebiete = quelle.gebiete
				.map((g): DemoGebiet => {
					const eigen = quelle.zuordnung.get(g.gebietId);
					if (eigen)
						return {
							gebietId: g.gebietId,
							titel: g.titel,
							bausteinIds: eigen.ids,
							meldungen: eigen.meldungen || (g.standMax ?? eigen.ids.size),
						};
					// „Alle Einheiten" nur, wo das Amt die ganze Wahl ist. Teilen
					// sich mehrere Ämter eine Quellwahl – 2021 alle neun Ortsräte
					// Nordstemmens –, ist jedes nur ein Teil davon, und Rössing
					// bekäme sonst die 22 Wahlbezirke der Gemeinde statt seiner drei.
					if (g.gebietId === gebietId && quelle.aemter <= 1)
						return {
							gebietId: g.gebietId,
							titel: g.titel,
							bausteinIds: new Set(bausteinIds),
							meldungen:
								quelle.meldungenGesamt || (g.standMax ?? bausteinIds.size),
						};
					const ersatz = ausWahlbereich(g.titel);
					const meldungen = quelle.bausteine
						.filter((b) => ersatz.has(b.gebietId))
						.reduce((n, b) => n + b.meldungen, 0);
					return {
						gebietId: g.gebietId,
						titel: g.titel,
						bausteinIds: ersatz,
						meldungen: meldungen || (g.standMax ?? ersatz.size),
					};
				})
				// **Ein Gebiet ohne eigene Einheiten gibt es nicht.** Vorher fiel
				// so eines auf „alle Einheiten" zurück – und der Kreiswahlbereich
				// B zeigte damit die Bewerber und Stimmen des *ganzen Kreises*:
				// plausibel aussehend und komplett falsch. Wer nicht weiß, woraus
				// ein Gebiet besteht, darf es nicht nachspielen.
				.filter((g) => g.bausteinIds.size > 0)
				// Fremde Gebiete gehören nicht auf die Folie dieses Amtes: Auf der
				// Ortsratswahl Rössing haben die Wahlbezirke von Adensen nichts zu
				// suchen.
				.filter(
					(g) =>
						!eigeneEinheiten ||
						[...g.bausteinIds].every((id) => eigeneEinheiten.has(id)),
				);
			gefunden.set(amt, {
				// Die Wahl des Zieltermins, nicht die von damals.
				wahlId: gesucht.get(amt) ?? quellWahlId,
				titel: e.titel as string,
				gebietId,
				gebietTitel: e.gebiet_titel as string,
				quellTermin: termin.id,
				quellWahlId,
				bausteine: eigeneEinheiten
					? quelle.bausteine.filter((b) => eigeneEinheiten.has(b.gebietId))
					: quelle.bausteine,
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
 * Die Zahlen einer Quellwahl – erst hier, und nur für diese eine Wahl.
 *
 * Die Vorlage kennt Ids und Meldungszahlen; die Stimmen holt der Takt. Gelesen
 * wird je Quellwahl einmal: Mehrere Ämter teilen sich eine (2021 alle neun
 * Ortsräte Nordstemmens), und sie stehen in der Vorlage hintereinander.
 */
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
					`SELECT gebiet_id, json FROM ergebnisse
					 WHERE termin = ? AND behoerde = ? AND wahl_id = ? AND leer = 0`,
				)
				.all(termin, ags, wahlId) as Array<{ gebiet_id: string; json: string }>
		).map((r) => [r.gebiet_id, JSON.parse(r.json) as Ergebnis]),
	);

/**
 * Was zu dieser Wahl **am Zieltermin** schon dasteht – Auszählstand und
 * Schreibzeit, ohne das JSON.
 *
 * Damit lässt sich vor dem Rechnen entscheiden, ob eine Zeile überhaupt neu
 * geschrieben werden muss. `speichereErgebnis` merkt das zwar auch, aber erst
 * am Hash – und bis dahin sind das Ergebnis gerechnet, in JSON gefasst und
 * gehasht. Über einen ganzen Kreis sind das 7251 Zeilen alle fünf Sekunden,
 * fast alle unverändert.
 *
 * `frisch` heißt: in diesem Durchlauf geschrieben. Das ist die Bedingung, ohne
 * die der Vergleich nicht trägt – das Rauschen hängt an der Nummer des
 * Durchlaufs, und derselbe Auszählstand bedeutet in der nächsten Runde andere
 * Zahlen. Innerhalb eines Durchlaufs dagegen wächst der Eingang nur
 * (`eingangsAnteil` ist fest, `fortschritt` steigt), und gleicher Stand heißt
 * dieselben Einheiten und damit dieselben Zahlen.
 */
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

/**
 * Schreibt den Stand, der zu diesem Augenblick des Zyklus gehört.
 *
 * Zustandslos: Was schon eingegangen ist, ergibt sich allein aus `zyklus`.
 * Zweimal derselbe Aufruf schreibt dasselbe – und `speichereErgebnis`
 * erkennt am Hash, dass sich nichts geändert hat, und legt keinen zweiten
 * Ticker-Eintrag an.
 *
 * **Jede Einheit hat ihre eigene Eingangszeit.** Vorher wurden die Einheiten
 * gemischt und dann bei `fortschritt · Anzahl` abgeschnitten: Alle Wahlen einer
 * Wahlleitung rückten im Gleichschritt vor, und weil der Takt die
 * Wahlleitungen reihum bedient, sprang eine beim Drankommen gleich um mehrere
 * Einheiten. Auf der Leinwand hieß das: lange nichts, dann ein Schwall. Jetzt
 * bekommt jede Einheit einen eigenen Zeitpunkt in der Zählphase
 * (`eingangsAnteil` in demo.ts) – der Abend tröpfelt, mit Klumpen und Lücken,
 * und bleibt dabei zustandslos.
 *
 * **Erst nachsehen, dann rechnen.** Zwischen zwei Takten ändert sich fast
 * nichts: Von 7251 Zeilen eines Kreises wechseln je Takt rund 380. Welche das
 * sind, weiß die Datenbank aus Auszählstand und Schreibzeit, ohne dass eine
 * einzige Zahl gerechnet werden muss (`liesZielStand`). Erst wenn wirklich
 * etwas zu schreiben ist, werden die Zahlen der Quellwahl gelesen.
 *
 * Dafür gilt eine Bedingung an den Aufruf: **`zyklus.beginn` muss der Anfang
 * des Durchlaufs `zyklus.nummer` sein** – so, wie `zyklusVon` beides liefert.
 * Daran erkennt die Abkürzung, ob eine vorhandene Zeile aus diesem Durchlauf
 * stammt und ihr Rauschen deshalb dasselbe ist. Ein von Hand gebauter Zyklus,
 * der die Nummer ändert und den Beginn stehen lässt, wäre in sich widersprüchlich
 * und bekäme veraltete Zahlen zu sehen.
 */
export const spieleStand = (
	db: Db,
	termin: Termin,
	behoerde: Behoerde,
	wahlen: DemoWahl[],
	zyklus: Zyklus,
): number => {
	const stat = { anfragen: 0, geaendert: 0, fehler: [] as string[] };
	const zyklusBeginn = new Date(zyklus.beginn).toISOString();
	let gelesen:
		| { schluessel: string; zahlen: Map<string, Ergebnis> }
		| undefined;
	for (const w of wahlen) {
		const faktor = (key: string) => rauschFaktor(zyklus.nummer, key);
		// Der Zeitpunkt hängt an der Wahl mit: Ein Wahlbezirk zählt erst die
		// Gemeindewahl aus, dann den Ortsrat, dann den Kreistag – seine drei
		// Schnellmeldungen gehen nicht gleichzeitig ein.
		const anteile = new Map(
			w.bausteine.map((b) => [
				b.gebietId,
				eingangsAnteil(
					zyklus.nummer,
					`${behoerde.ags}|${w.wahlId}|${b.gebietId}`,
				),
			]),
		);
		const da = (gebietId: string): boolean =>
			(anteile.get(gebietId) ?? 1) <= zyklus.fortschritt;

		// Was schon dasteht – und was davon bleiben darf.
		const steht = liesZielStand(
			db,
			termin.id,
			behoerde.ags,
			w.wahlId,
			zyklusBeginn,
		);
		const unveraendert = (
			gebietId: string,
			leer: boolean,
			anz: number,
			max: number,
		): boolean => {
			const v = steht.get(gebietId);
			return (
				v !== undefined &&
				v.frisch === 1 &&
				v.leer === (leer ? 1 : 0) &&
				v.anz === anz &&
				v.max === max
			);
		};

		// Die Bausteine selbst: entweder ganz da oder noch gar nicht.
		const bausteinArbeit = w.bausteine
			.map((b) => ({ b, drin: da(b.gebietId) }))
			.filter(
				({ b, drin }) =>
					!unveraendert(b.gebietId, !drin, drin ? b.meldungen : 0, b.meldungen),
			);
		// Und die Gebiete darüber: die Summe dessen, was von ihnen da ist.
		const gebietArbeit = w.gebiete
			.map((g) => {
				const eingegangen = w.bausteine.filter(
					(b) => g.bausteinIds.has(b.gebietId) && da(b.gebietId),
				);
				// **Der Auszählstand zählt Schnellmeldungen, nicht Gebietszeilen.**
				// Beim Kreistag führt die Kreisbehörde keine Wahlbezirke: Ihre
				// Auszähleinheiten sind die 18 Gemeinden, und die Simulation
				// schrieb deshalb „4 von 18" – für einen Kreis mit 426
				// Schnellmeldungen eine sinnlose Zahl, und für den Wahlbereich B
				// (Elze und Nordstemmen, zusammen 37) genauso.
				//
				// Gerechnet wird nicht hoch, sondern addiert: Jede Einheit bringt
				// ihre eigene Zahl mit (Nordstemmen 23, Elze 14). Die Summe über
				// *alle* Einheiten hat SQLite schon gebildet (`g.meldungen`); hier
				// bleibt die über die eingegangenen, und die hängt am Augenblick.
				return {
					g,
					eingegangen,
					summe: eingegangen.reduce((n, b) => n + b.meldungen, 0),
				};
			})
			.filter(
				({ g, eingegangen, summe }) =>
					!unveraendert(
						g.gebietId,
						eingegangen.length === 0,
						summe,
						g.meldungen,
					),
			);
		if (bausteinArbeit.length === 0 && gebietArbeit.length === 0) continue;

		// Jetzt erst die Zahlen. Gelesen wird je Quellwahl einmal: Mehrere Ämter
		// teilen sich eine (2021 alle neun Ortsräte Nordstemmens), und sie stehen
		// in der Vorlage hintereinander.
		const schluessel = `${w.quellTermin}|${w.quellWahlId}`;
		if (gelesen?.schluessel !== schluessel)
			gelesen = {
				schluessel,
				zahlen: liesZahlen(db, w.quellTermin, behoerde.ags, w.quellWahlId),
			};
		const zahlen = gelesen.zahlen;

		for (const { b, drin } of bausteinArbeit) {
			const vorlage = zahlen.get(b.gebietId);
			if (!vorlage) continue;
			// Eine Einheit ist ganz da oder gar nicht – aber auch sie führt ihre
			// eigene Zahl von Schnellmeldungen (eine Gemeinde beim Kreistag
			// bringt 23 mit, ein Wahlbezirk eine).
			const seine = b.meldungen;
			const e = drin
				? zaehleZusammen(
						vorlage,
						[vorlage],
						seine,
						seine,
						faktor,
						// Der Zeitstempel ist der ihres eigenen Eingangs und nicht
						// der Augenblick des Schreibens: „Stand 20:14" steht still,
						// bis wirklich etwas dazukommt (siehe demo.ts).
						new Date(
							eingangsZeit(zyklus, [anteile.get(b.gebietId) ?? 0]),
						).toISOString(),
					)
				: {
						...vorlage,
						leer: true,
						parteien: [],
						zeitstempel: new Date(zyklus.beginn).toISOString(),
						stand: { ...vorlage.stand, anz: 0, max: seine, hinweis: [] },
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

		for (const { g, eingegangen, summe } of gebietArbeit) {
			const vorlage = zahlen.get(g.gebietId);
			if (!vorlage) continue;
			speichereErgebnis(
				db,
				termin,
				behoerde.ags,
				w.wahlId,
				w.titel,
				g.gebietId,
				zaehleZusammen(
					vorlage,
					eingegangen
						.map((b) => zahlen.get(b.gebietId))
						.filter((e): e is Ergebnis => e !== undefined),
					summe,
					g.meldungen,
					faktor,
					// Der Stand eines Gebiets trägt die Zeit seiner zuletzt
					// eingegangenen Einheit.
					new Date(
						eingangsZeit(
							zyklus,
							eingegangen.map((b) => anteile.get(b.gebietId) ?? 0),
						),
					).toISOString(),
				),
				stat,
			);
		}
	}
	return stat.geaendert;
};
