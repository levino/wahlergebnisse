/**
 * Der Demo-Wahlabend am Datenbestand: Wahllokale tröpfeln herein.
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
 * Die Auswahl macht SQLite; die Vorlage trägt nur Ids, Namen und
 * Meldungszahlen. Die Ergebnisse holt `spieleStand` je Quellwahl frisch.
 *
 * **Simuliert wird eine einzige Größe: wann welches Wahllokal einträgt.** Die
 * Vorlage sagt zu jeder Zeile einer Wahlleitung, aus welchen Wahllokalen sie
 * besteht – über die Grenze der Wahlleitung hinweg, denn beim Kreistag zählt
 * die Gemeinde aus und die Kreisbehörde sieht nur zu. Jede Zeile ist die
 * Summe ihrer Wahllokale; einen zweiten Ort, an dem „wie weit ist gezählt"
 * entschieden wird, gibt es nicht.
 */
import { type Behoerde, behoerdeByName } from "../data/behoerden.ts";
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
import { gebietsname } from "./wahltyp.ts";
import type { Ergebnis } from "./votemanager.ts";
import { wahlSlugs } from "./wahltyp.ts";

/**
 * Ebenen, aus denen die Bausteine kommen – von fein nach grob, wie bei der
 * Hochrechnung (siehe seite.ts). Eine Gemeinde zählt Wahlbezirke aus, der
 * Landkreis bekommt seine Zahlen von den Gemeinden.
 */
const BAUSTEIN_EBENEN = [6, 3];

/** Die Ebene, auf der Wahllokale stehen. */
const LOKAL_EBENE = BAUSTEIN_EBENEN[0];

/**
 * Ein Wahllokal – die einzige Größe, die die Generalprobe simuliert.
 *
 * `schluessel` kennt die betrachtende Wahlleitung nicht, nur die Wahl und das
 * Wahllokal selbst. Deshalb geht dasselbe Wahllokal in jeder Sicht im selben
 * Augenblick ein und liefert überall dieselben Stimmen; `ags`, `wahlId` und
 * `gebietId` sagen, wo seine Zahlen stehen – beim Kreistag ist das die
 * Gemeinde, die auszählt, und nicht die Kreisbehörde, die zusieht.
 */
export type DemoLokal = {
	schluessel: string;
	ags: string;
	wahlId: number;
	gebietId: string;
	/** Seine Zahl der Schnellmeldungen – fast immer eine. */
	meldungen: number;
};

/**
 * Eine Zeile, die diese Wahlleitung zu dieser Wahl führt: die Summe genau der
 * Wahllokale in ihrem Abschluss. Wahlbezirk, Ortschaft, Gemeinde,
 * Kreiswahlbereich und Kreis unterscheiden sich nur darin, wie viele es sind.
 */
export type DemoZeile = {
	gebietId: string;
	titel: string;
	lokale: DemoLokal[];
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
	/** Termin, aus dem die Zahlen kommen */
	quellTermin: string;
	/** Kennung dieses Amtes damals – unter ihr stehen die Zeilen in der Datenbank */
	quellWahlId: number;
	/** Alle Wahllokale dieser Wahl bei dieser Wahlleitung, ohne Dubletten */
	lokale: DemoLokal[];
	/** Jede Zeile, die geschrieben wird – vom Wahlbezirk bis zum Kreis */
	zeilen: DemoZeile[];
};

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

/** Eine Zeile der feinsten Ebene, die diese Wahlleitung führt. */
type Einheit = {
	gebietId: string;
	titel: string;
	meldungen: number;
};

/** Alles, was die Vorlage über eine Quellwahl wissen muss – ohne eine einzige Ergebniszahl. */
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
			 FROM ergebnisse
			 WHERE termin = ? AND behoerde = ? AND wahl_id = ? AND leer = 0 AND ebene = ?
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
			 FROM ergebnisse
			 WHERE termin = ? AND behoerde = ? AND wahl_id = ? AND leer = 0 AND ebene <> ?
			 ORDER BY gebiet_id`,
		)
		.all(termin, ags, wahlId, ebene) as Array<{
		gebiet_id: string;
		titel: string;
	}>;
	// `AS MATERIALIZED` spart den Faktor zehn: Ohne die Anweisung parst SQLite
	// das JSON einer Ergebniszeile für jeden Verbundversuch neu.
	const zuordnung = new Map<string, Set<string>>();
	for (const r of db
		.prepare(
			`WITH untergebiete AS MATERIALIZED (
			   SELECT e.gebiet_id AS gebiet, json_extract(g.value, '$.id') AS baustein
			   FROM ergebnisse e,
			        json_each(e.json, '$.untergebiete') u,
			        json_each(u.value, '$.gebiete') g
			   WHERE e.termin = ? AND e.behoerde = ? AND e.wahl_id = ? AND e.leer = 0
			     AND e.ebene <> ?
			 )
			 SELECT DISTINCT u.gebiet AS gebiet, b.gebiet_id AS baustein
			 FROM untergebiete u
			 JOIN ergebnisse b ON b.termin = ? AND b.behoerde = ? AND b.wahl_id = ?
			   AND b.gebiet_id = u.baustein AND b.ebene = ? AND b.leer = 0
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
				 FROM ergebnisse
				 WHERE termin = ? AND behoerde = ? AND wahl_id = ? AND leer = 0 AND ebene = ?
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

/**
 * Die Wahllokale hinter einer Gemeindezeile der Kreisbehörde.
 *
 * Beim Kreistag führt die Kreisbehörde keine Wahlbezirke: Ihre feinsten
 * Zeilen sind die 18 Gemeinden. Ausgezählt wird trotzdem in Wahllokalen, und
 * dieselbe Wahl liegt bei der Gemeinde mit ihren Wahlbezirken vor. Die Zeile
 * löst sich deshalb über den Behördennamen auf den AGS und von dort auf die
 * Wahllokale derselben Gemeinde auf – erst damit zeigen Kreiszeile und
 * Gemeindeseite denselben Stand, und erst damit springt der Kreistag im
 * Minutentakt statt achtzehnmal am Abend.
 *
 * Liegt von einer Gemeinde kein Vorwert vor, bleibt ihre Zeile ihre eigene
 * Einheit. Zwei Sichten können dann nicht auseinanderlaufen, weil es nur eine
 * gibt.
 */
const gemeindeWahllokale = (
	db: Db,
	kreis: Kreis,
	quellTermin: string,
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
		ihre = eintraegeVon(db, quellTermin, unter.ags);
		eintraege.set(unter.ags, ihre);
	}
	const eintrag = ihre.find((e) => e.typ === typ);
	if (!eintrag) return undefined;
	const wahlId = eintrag.wahl_id as number;
	const zeilen = lokalZeilen(db, quellTermin, unter.ags, wahlId);
	return zeilen.length > 0 ? { ags: unter.ags, wahlId, zeilen } : undefined;
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
	// Wahlleitung dort kein einziges, spielt die Probe die ihres Vorwerts –
	// sonst fiele sie ganz aus. Führt sie welche, bleibt es strikt bei denen.
	const gesucht = aemterAmZiel(db, ziel, behoerde);
	const nurVorwert = gesucht.size === 0;
	const gefunden = new Map<string, DemoWahl>();
	// Zwei Ämter dürfen nicht auf dieselbe Zeile am Zieltermin zeigen – im
	// Rückfall kommen die Kennungen aus verschiedenen Terminen und könnten sich
	// überschneiden.
	const belegt = new Set<string>();
	for (const termin of vorwertTermine(kreis, ziel, behoerde)) {
		// Merkzettel nur für diesen Aufruf: Mehrere Ämter teilen sich eine
		// Quellwahl.
		const gelesen = new Map<number, Quellwahl | undefined>();
		// Die Wahleinträge der Gemeinden – für die Kreiszeilen, die sich dorthin
		// auflösen.
		const untere = new Map<string, Array<Record<string, unknown>>>();
		// Erst holen, wenn gebraucht: liest die Wahlräume aller Gemeinden.
		let bereiche: Wahlbereiche | undefined;
		for (const e of eintraegeVon(db, termin.id, behoerde.ags)) {
			// Wahlart **und** Gebiet: neun Ortsräte sind neun Ämter, ein Rat ist
			// einer. Der Gebietsname dedupliziert weiter über die Termine hinweg
			// – derselbe Ortsrat heißt 2021 wie 2016.
			const typ = e.typ as string;
			const amt = amtsSchluessel(
				typ,
				(e.gebiet as string | null) ?? "",
				e.gebiet_titel as string,
			);
			// Was am Zieltermin nicht gewählt wird, wird auch nicht nachgespielt.
			if (!nurVorwert && !gesucht.has(amt)) continue;
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
			// Welche Einheiten zu einem Gebiet gehören, steht in seinen
			// Untergebieten. Wo die Quelle sie nicht führt, greift für
			// Kreiswahlbereiche die zweite Quelle: Ein Wahlbereich ist die Summe
			// seiner Gemeinden (wahlbereiche.ts).
			const ausWahlbereich = (titel: string): Set<string> => {
				const kuerzel = wahlbereichKuerzel(titel);
				if (!kuerzel) return new Set();
				// Die Gemeinden dieses Kreises, nicht die des Standard-Kreises.
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
			// Teilen sich mehrere Ämter eine Quellwahl, gehört diesem Amt nur ein
			// Teil ihrer Einheiten – steht das nicht in der Quelle, wird nicht
			// geraten.
			const eigeneEinheiten =
				quelle.aemter > 1 ? quelle.zuordnung.get(gebietId) : undefined;
			if (quelle.aemter > 1 && !eigeneEinheiten) continue;
			const roheGebiete = quelle.gebiete
				.map((g) => {
					const eigen = quelle.zuordnung.get(g.gebietId);
					if (eigen) return { ...g, bausteinIds: eigen };
					// „Alle Einheiten" nur, wo das Amt die ganze Wahl ist.
					if (g.gebietId === gebietId && quelle.aemter <= 1)
						return { ...g, bausteinIds: new Set(bausteinIds) };
					return { ...g, bausteinIds: ausWahlbereich(g.titel) };
				})
				// **Ein Gebiet ohne eigene Einheiten gibt es nicht.** Vorher fiel
				// so eines auf „alle Einheiten" zurück – und der Kreiswahlbereich
				// B zeigte damit die Bewerber und Stimmen des *ganzen Kreises*:
				// plausibel aussehend und komplett falsch. Wer nicht weiß, woraus
				// ein Gebiet besteht, darf es nicht nachspielen.
				.filter((g) => g.bausteinIds.size > 0)
				// Und keine fremden: Auf der Ortsratswahl Rössing haben die
				// Wahlbezirke von Adensen nichts zu suchen.
				.filter(
					(g) =>
						!eigeneEinheiten ||
						[...g.bausteinIds].every((id) => eigeneEinheiten.has(id)),
				);
			const zielWahlId = gesucht.get(amt) ?? quellWahlId;
			if (belegt.has(`${zielWahlId}|${gebietId}`)) continue;
			belegt.add(`${zielWahlId}|${gebietId}`);
			const einheiten = eigeneEinheiten
				? quelle.bausteine.filter((b) => eigeneEinheiten.has(b.gebietId))
				: quelle.bausteine;
			const alsLokal = (
				ags: string,
				wahlId: number,
				zeile: Einheit,
			): DemoLokal => ({
				schluessel: `${typ}|${ags}|${zeile.gebietId}`,
				ags,
				wahlId,
				gebietId: zeile.gebietId,
				meldungen: zeile.meldungen,
			});
			// Von der feinsten Zeile, die diese Wahlleitung führt, hinunter zu den
			// Wahllokalen: bei einer Gemeinde ein Schritt auf der Stelle, bei der
			// Kreisbehörde einer über die Grenze der Wahlleitung.
			const jeEinheit = new Map<string, DemoLokal[]>(
				einheiten.map((b): [string, DemoLokal[]] => {
					if (quelle.ebene === LOKAL_EBENE)
						return [b.gebietId, [alsLokal(behoerde.ags, quellWahlId, b)]];
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
							: [alsLokal(behoerde.ags, quellWahlId, b)],
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
			gefunden.set(amt, {
				// Die Wahl des Zieltermins, nicht die von damals.
				wahlId: zielWahlId,
				titel: e.titel as string,
				gebietId,
				gebietTitel: e.gebiet_titel as string,
				quellTermin: termin.id,
				quellWahlId,
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
 * Die Zahlen einer Wahl bei einer Wahlleitung – erst hier, und nur für die
 * eine, die gerade gebraucht wird.
 *
 * `nurEbene` grenzt auf die Wahllokale ein: Von einer fremden Wahlleitung
 * braucht die Kreissicht nichts als sie, und ein Kreis liest 18 davon je Takt.
 */
const liesZahlen = (
	db: Db,
	termin: string,
	ags: string,
	wahlId: number,
	nurEbene?: number,
): Map<string, Ergebnis> =>
	new Map(
		(
			db
				.prepare(
					`SELECT gebiet_id, json FROM ergebnisse
					 WHERE termin = ? AND behoerde = ? AND wahl_id = ? AND leer = 0
					   AND (? IS NULL OR ebene = ?)`,
				)
				.all(termin, ags, wahlId, nurEbene ?? null, nurEbene ?? null) as Array<{
				gebiet_id: string;
				json: string;
			}>
		).map((r) => [r.gebiet_id, JSON.parse(r.json) as Ergebnis]),
	);

/**
 * Was zu dieser Wahl am Zieltermin schon dasteht – Auszählstand und
 * Schreibzeit, ohne das JSON. `frisch` heißt: in diesem Durchlauf geschrieben,
 * also schon mit dessen Zeitstempeln.
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
 * Schreibt den Stand, der zu diesem Augenblick des Zyklus gehört. Zustandslos:
 * Was schon eingegangen ist, ergibt sich allein aus `zyklus`; jedes Wahllokal
 * hat seine eigene Eingangszeit (`eingangsAnteil` in demo.ts).
 *
 * Jede Zeile ist die Summe genau der Wahllokale in ihrem Abschluss – die
 * Gemeindezeile der Kreisbehörde ebenso wie die eigene Wahl der Gemeinde.
 * Beide rechnen über dieselben Wahllokale mit demselben Rauschen und können
 * sich deshalb nicht widersprechen.
 *
 * Bedingung an den Aufruf: `zyklus.beginn` muss der Anfang des Durchlaufs
 * `zyklus.nummer` sein, so wie `zyklusVon` beides liefert – daran erkennt
 * `liesZielStand`, ob eine vorhandene Zeile schon die Zeitstempel dieses
 * Durchlaufs trägt.
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
				// **Der Auszählstand zählt Schnellmeldungen, nicht Zeilen.** Beim
				// Kreistag führt die Kreisbehörde keine Wahlbezirke; ihre Zeilen
				// sind 18 Gemeinden, und „4 von 18" wäre für einen Kreis mit 426
				// Schnellmeldungen eine sinnlose Zahl. Gerechnet wird nicht hoch,
				// sondern addiert – exakt, nicht geschätzt.
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

		// Jetzt erst die Zahlen. Die eigenen Zeilen sind die Vorlage; die
		// Stimmen kommen von den Wahllokalen, beim Kreistag also aus den
		// Gemeinden.
		const quellen = new Map<string, Map<string, Ergebnis>>();
		const roh = (ags: string, wahlId: number): Map<string, Ergebnis> => {
			const k = `${ags}|${wahlId}`;
			let m = quellen.get(k);
			if (!m) {
				m = liesZahlen(
					db,
					w.quellTermin,
					ags,
					wahlId,
					ags === behoerde.ags ? undefined : LOKAL_EBENE,
				);
				quellen.set(k, m);
			}
			return m;
		};
		// Das Rauschen einmal je Wahllokal, danach ist jede Zeile eine Summe.
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
			const vorlage = roh(behoerde.ags, w.quellWahlId).get(z.gebietId);
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
					// Der Stand einer Zeile trägt die Zeit ihres zuletzt
					// eingegangenen Wahllokals, nicht den Augenblick des Schreibens.
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
