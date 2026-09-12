import type {
	Amt,
	AmtEintrag,
	Beleg,
	Wahlbezeichnung,
	Wahlgliederung,
	Wahlleitung,
} from "../data/wahlgliederung.ts";
import { belegVon } from "../data/wahlgliederung.ts";
import type { Db } from "./db.ts";

/**
 * Wem eine Lücke gehört.
 *
 * `anwendung` – die Wahlleitung hat es veröffentlicht, wir zeigen es nicht. Unser Fehler.
 * `wahlleitung` – die Wahlleitung hat nichts veröffentlicht. Keine Lücke bei uns,
 *   aber sie muss sichtbar sein statt stillschweigend zu fehlen.
 * `verzeichnis` – das Verzeichnis behauptet etwas, das die Anwendung anders führt.
 *   Dann ist das Verzeichnis zu korrigieren, nicht die Anwendung.
 * `messung` – die Probe kann nichts entscheiden, weil ihr Maßstab selbst Lücken
 *   hat. Keine Aussage über eine Lücke, aber sie darf nicht als „geht auf"
 *   durchgehen.
 */
export type Fall = "anwendung" | "wahlleitung" | "verzeichnis" | "messung";

export type Ebene =
	| "wahlleitung"
	| Amt
	| "kreiswahlbereich"
	| "wahlbezirk"
	| "kreisgebiet";

export type Befund = {
	fall: Fall;
	ebene: Ebene;
	kreis: string;
	/** Gebietsschlüssel der Wahlleitung; bei Kreisbefunden der des Kreises */
	behoerde: string;
	name: string;
	gegenstand: string;
	/** Worauf sich die Erwartung stützt */
	quelle: string;
	text: string;
};

/** Was die Anwendung für einen Termin tatsächlich führt. */
export type Bestand = {
	/** Wahl-Slugs je Gebietsschlüssel */
	wahlen: ReadonlyMap<string, ReadonlySet<string>>;
	/** Gebiets-Ids je `${ags}/${slug}` */
	gebiete: ReadonlyMap<string, ReadonlySet<string>>;
	/** Zahl der Wahlbezirke je Gebietsschlüssel */
	wahlbezirke: ReadonlyMap<string, number>;
};

export const LEERER_BESTAND: Bestand = {
	wahlen: new Map(),
	gebiete: new Map(),
	wahlbezirke: new Map(),
};

export const bestandAus = (db: Db, termin: string): Bestand => {
	const wahlen = new Map<string, Set<string>>();
	const gebiete = new Map<string, Set<string>>();
	for (const z of db
		.prepare(
			"SELECT behoerde, slug, gebiet_id FROM wahleintraege WHERE termin = ?",
		)
		.all(termin) as Array<{
		behoerde: string;
		slug: string;
		gebiet_id: string;
	}>) {
		const s = wahlen.get(z.behoerde) ?? new Set<string>();
		s.add(z.slug);
		wahlen.set(z.behoerde, s);
		const k = `${z.behoerde}/${z.slug}`;
		const g = gebiete.get(k) ?? new Set<string>();
		g.add(z.gebiet_id);
		gebiete.set(k, g);
	}
	for (const z of db
		.prepare(
			`SELECT e.behoerde, w.slug, e.gebiet_id FROM ergebnisse e
			 JOIN wahleintraege w ON w.termin = e.termin AND w.behoerde = e.behoerde AND w.wahl_id = e.wahl_id
			 WHERE e.termin = ?`,
		)
		.all(termin) as Array<{
		behoerde: string;
		slug: string;
		gebiet_id: string;
	}>) {
		const k = `${z.behoerde}/${z.slug}`;
		const g = gebiete.get(k) ?? new Set<string>();
		g.add(z.gebiet_id);
		gebiete.set(k, g);
	}
	const wahlbezirke = new Map<string, number>();
	for (const z of db
		.prepare(
			"SELECT behoerde, COUNT(DISTINCT bezirk) AS n FROM wahlraeume WHERE termin = ? GROUP BY behoerde",
		)
		.all(termin) as Array<{ behoerde: string; n: number }>)
		wahlbezirke.set(z.behoerde, Number(z.n));
	return { wahlen, gebiete, wahlbezirke };
};

/** Was eine Wahlleitung zur Kreistagswahl für ihr eigenes Gebiet meldet. */
export type Kreistagszahlen = {
	wahlberechtigte: number;
	/** eingegangene Schnellmeldungen */
	anz: number;
	/** erwartete Schnellmeldungen */
	max: number;
};

/**
 * Die Kreistagszahlen aller Wahlleitungen eines Termins – je Gebietsschlüssel
 * das Gesamtgebiet der Wahlleitung, also die gröbste geführte Ebene.
 */
export const kreistagszahlenAus = (
	db: Db,
	termin: string,
): Map<string, Kreistagszahlen> => {
	const zahlen = new Map<string, Kreistagszahlen>();
	const grobste = new Map<string, number>();
	for (const z of db
		.prepare(
			`SELECT e.behoerde, e.ebene, e.stand_anz, e.stand_max, e.json FROM ergebnisse e
			 JOIN wahleintraege w ON w.termin = e.termin AND w.behoerde = e.behoerde AND w.wahl_id = e.wahl_id
			 WHERE e.termin = ? AND w.slug = 'kreistag'`,
		)
		.all(termin) as Array<{
		behoerde: string;
		ebene: number;
		stand_anz: number | null;
		stand_max: number | null;
		json: string;
	}>) {
		const bisher = grobste.get(z.behoerde);
		if (bisher !== undefined && bisher <= z.ebene) continue;
		grobste.set(z.behoerde, z.ebene);
		const gelesen = JSON.parse(z.json) as {
			kennzahlen?: { wahlberechtigte?: number };
		};
		zahlen.set(z.behoerde, {
			wahlberechtigte: gelesen.kennzahlen?.wahlberechtigte ?? 0,
			anz: z.stand_anz ?? 0,
			max: z.stand_max ?? 0,
		});
	}
	return zahlen;
};

/** Ein Kreis und die Wahlleitungen, die der Katalog unter ihm führt. */
export type Katalogkreis = {
	slug: string;
	ags: string;
	name: string;
	behoerden: ReadonlyArray<{ ags: string; name: string }>;
};

/** Der Maßstab, an dem die Vollständigkeit des Katalogs gemessen wird. */
export type Messung = {
	/** Termin, dessen amtliche Zahlen den Maßstab bilden – nie eine Datenquelle für später. */
	termin: string;
	zahlen: ReadonlyMap<string, Kreistagszahlen>;
};

const zahl = (n: number): string => n.toLocaleString("de-DE");

/**
 * Führt der Katalog jede Wahlleitung eines Kreises?
 *
 * Die Kreisbehörde meldet die Kreistagswahl für das ganze Kreisgebiet. Zählt
 * man dieselbe Wahl über alle Gemeinden des Katalogs zusammen, muss dieselbe
 * Zahl herauskommen. Tut sie das nicht, fehlt eine Wahlleitung – der Poller
 * läuft über `kreis.behoerden`, eine Behörde ohne Eintrag wird nie abgefragt.
 *
 * Eine Differenz beweist das nur, wenn jede geführte Wahlleitung zum
 * Messtermin auch eine Kreistagswahl gemeldet hat. Sonst kann sie ebenso gut
 * daher rühren, dass eine Behörde anders meldet (die Landeshauptstadt Hannover
 * führt die Regionswahl nicht selbst) oder 2021 anders zugeschnitten war.
 */
export const pruefeKreisvollstaendigkeit = (
	kreise: readonly Katalogkreis[],
	messung: Messung,
): Befund[] => {
	const befunde: Befund[] = [];
	for (const k of kreise) {
		const kreiszahl = messung.zahlen.get(k.ags);
		const teile = k.behoerden.filter((b) => b.ags !== k.ags);
		if (teile.length === 0) continue;
		if (!kreiszahl) {
			befunde.push({
				fall: "messung",
				ebene: "kreisgebiet",
				kreis: k.slug,
				behoerde: k.ags,
				name: k.name,
				gegenstand: "Kreistagswahl",
				quelle: `Kreistagswahl ${messung.termin}`,
				text: `${k.name}: zum Messtermin ${messung.termin} liegt keine Kreistagswahl der Kreisbehörde vor – die Vollständigkeit der ${teile.length} Wahlleitungen ist nicht nachgerechnet.`,
			});
			continue;
		}
		const ohneKreistagswahl = teile.filter((b) => !messung.zahlen.get(b.ags));
		let wahlberechtigte = 0;
		let max = 0;
		for (const b of teile) {
			const z = messung.zahlen.get(b.ags);
			if (!z) continue;
			wahlberechtigte += z.wahlberechtigte;
			max += z.max;
		}
		const fehlendeWahlberechtigte = kreiszahl.wahlberechtigte - wahlberechtigte;
		const fehlendeMeldungen = kreiszahl.max - max;
		if (fehlendeWahlberechtigte === 0 && fehlendeMeldungen === 0) continue;
		const differenz = `${zahl(fehlendeWahlberechtigte)} Wahlberechtigte und ${zahl(fehlendeMeldungen)} Schnellmeldungen`;
		befunde.push(
			ohneKreistagswahl.length
				? {
						fall: "messung",
						ebene: "kreisgebiet",
						kreis: k.slug,
						behoerde: k.ags,
						name: k.name,
						gegenstand: "Kreistagswahl",
						quelle: `Kreistagswahl ${messung.termin}`,
						text: `${k.name}: ${differenz} bleiben zum Messtermin ${messung.termin} unerklärt; zu ${ohneKreistagswahl.map((b) => b.name).join(", ")} liegt zu diesem Termin keine Kreistagswahl vor – die Probe entscheidet nicht.`,
					}
				: {
						fall: "anwendung",
						ebene: "kreisgebiet",
						kreis: k.slug,
						behoerde: k.ags,
						name: k.name,
						gegenstand: `${teile.length} Wahlleitungen im Katalog`,
						quelle: `Kreistagswahl ${messung.termin}`,
						text: `${k.name}: die Kreistagswahl ${messung.termin} zählt ${differenz} mehr als die ${teile.length} Wahlleitungen des Katalogs zusammen – dem Katalog fehlt eine Wahlleitung, der Poller fragt sie nie ab.`,
					},
		);
	}
	return befunde;
};

/**
 * Wahlleitungen, die der Katalog führt und das Verzeichnis des Termins nicht.
 *
 * Ohne das verschwindet eine neu eingetragene Behörde lautlos: Die
 * Abdeckungsprüfung läuft über das Verzeichnis, und was dort fehlt, wird nie
 * vermisst.
 */
export const pruefeKatalogGegenVerzeichnis = (
	kreise: readonly Katalogkreis[],
	verzeichnis: Wahlgliederung,
	bestand: Bestand,
): Befund[] => {
	const gefuehrt = new Set(
		verzeichnis.kreise.flatMap((k) => k.wahlleitungen.map((w) => w.ags)),
	);
	const befunde: Befund[] = [];
	for (const k of kreise)
		for (const b of k.behoerden) {
			if (gefuehrt.has(b.ags)) continue;
			const eigene = bestand.wahlen.get(b.ags);
			befunde.push(
				eigene?.size
					? {
							fall: "verzeichnis",
							ebene: "wahlleitung",
							kreis: k.slug,
							behoerde: b.ags,
							name: b.name,
							gegenstand: b.ags,
							quelle: "src/data/kreis-katalog.ts",
							text: `${b.name} steht im Katalog und führt für ${verzeichnis.termin} ${eigene.size} Wahlen, das Verzeichnis kennt sie nicht – Verzeichnis nachziehen.`,
						}
					: {
							fall: "wahlleitung",
							ebene: "wahlleitung",
							kreis: k.slug,
							behoerde: b.ags,
							name: b.name,
							gegenstand: b.ags,
							quelle: "src/data/kreis-katalog.ts",
							text: `${b.name} steht im Katalog, hat für ${verzeichnis.termin} aber nichts veröffentlicht.`,
						},
			);
		}
	return befunde;
};

const AMT_LABEL: Record<Amt, string> = {
	kreistag: "Kreistagswahl",
	landrat: "Landratswahl",
	"landrat-stichwahl": "Stichwahl Landrat",
	rat: "Ratswahl",
	buergermeister: "Bürgermeisterwahl",
	"buergermeister-stichwahl": "Stichwahl Bürgermeister",
	ortsrat: "Ortsratswahl",
};

/** Ämter, die es nur gibt, wenn der erste Wahlgang sie auslöst. */
const BEDINGT: ReadonlySet<Amt> = new Set([
	"landrat-stichwahl",
	"buergermeister-stichwahl",
]);

const fuehrt = (bestand: Bestand, ags: string, slug: string): boolean =>
	Boolean(bestand.wahlen.get(ags)?.has(slug));

type Pruefung = {
	verzeichnis: Wahlgliederung;
	/** Gliederung eines früheren Termins – nur als Maßstab, nie als Ersatz. */
	vergleich?: Wahlgliederung;
	bestand: Bestand;
	/** Der Katalog, dessen Vollständigkeit nachgerechnet wird. */
	katalog?: readonly Katalogkreis[];
	/** Amtliche Zahlen eines früheren Termins als Maßstab für den Katalog. */
	messung?: Messung;
};

export const pruefeAbdeckung = ({
	verzeichnis,
	vergleich,
	bestand,
	katalog,
	messung,
}: Pruefung): Befund[] => {
	const befunde: Befund[] = [];
	const vergleichsleitungen = new Map<string, Wahlleitung>();
	for (const k of vergleich?.kreise ?? [])
		for (const w of k.wahlleitungen) vergleichsleitungen.set(w.ags, w);

	const melde = (b: Befund) => befunde.push(b);

	for (const k of verzeichnis.kreise) {
		for (const w of k.wahlleitungen) {
			const gefuehrt = bestand.wahlen.get(w.ags);
			const veroeffentlicht = w.beleg.herkunft === "wahlleitung";

			if (veroeffentlicht && !gefuehrt?.size)
				melde({
					fall: "anwendung",
					ebene: "wahlleitung",
					kreis: k.slug,
					behoerde: w.ags,
					name: w.name,
					gegenstand: w.name,
					quelle: w.beleg.quelle,
					text: `${w.name} veröffentlicht für ${verzeichnis.termin}, die Anwendung führt dazu nichts.`,
				});
			if (
				!veroeffentlicht &&
				vergleichsleitungen.get(w.ags)?.beleg.herkunft === "wahlleitung"
			)
				melde({
					fall: "wahlleitung",
					ebene: "wahlleitung",
					kreis: k.slug,
					behoerde: w.ags,
					name: w.name,
					gegenstand: w.name,
					quelle: w.beleg.quelle,
					text: `${w.name} hat für ${verzeichnis.termin} nichts veröffentlicht (${w.beleg.grund ?? "ohne Angabe"}); zum Termin ${vergleich?.termin} gab es dort Wahlen.`,
				});

			for (const [amt, eintrag] of Object.entries(w.aemter) as Array<
				[Amt, NonNullable<Wahlleitung["aemter"][Amt]>]
			>) {
				if (eintrag.stand !== "belegt") continue;
				for (const wahl of eintrag.wahlen) {
					if (fuehrt(bestand, w.ags, wahl.slug)) continue;
					melde({
						fall: "anwendung",
						ebene: amt,
						kreis: k.slug,
						behoerde: w.ags,
						name: w.name,
						gegenstand: wahl.gebiet
							? `${wahl.titel} – ${wahl.gebiet}`
							: wahl.titel,
						quelle: belegVon(eintrag, w).quelle,
						text: `${w.name}: ${AMT_LABEL[amt]}${wahl.gebiet ? ` ${wahl.gebiet}` : ""} ist veröffentlicht, die Anwendung führt sie nicht.`,
					});
				}
			}

			const alt = vergleichsleitungen.get(w.ags);
			for (const [amt, altEintrag] of Object.entries(
				alt?.aemter ?? {},
			) as Array<[Amt, NonNullable<Wahlleitung["aemter"][Amt]>]>) {
				if (altEintrag.stand !== "belegt" || BEDINGT.has(amt)) continue;
				const eigen = w.aemter[amt];
				if (eigen?.stand === "entfaellt") continue;
				if (!veroeffentlicht) continue;
				for (const altWahl of altEintrag.wahlen) {
					if (eigen && kenntWahl(eigen, altWahl)) continue;
					melde({
						fall: "wahlleitung",
						ebene: amt,
						kreis: k.slug,
						behoerde: w.ags,
						name: w.name,
						gegenstand: altWahl.gebiet
							? `${AMT_LABEL[amt]} ${altWahl.gebiet}`
							: AMT_LABEL[amt],
						quelle: belegVon(altEintrag, alt as Wahlleitung).quelle,
						text: `${w.name}: keine ${AMT_LABEL[amt]}${altWahl.gebiet ? ` ${altWahl.gebiet}` : ""} für ${verzeichnis.termin} veröffentlicht, zum Termin ${vergleich?.termin} gab es sie.`,
					});
				}
			}

			const bezirkeSoll = w.wahlbezirke.eintraege.length;
			const bezirkeIst = bestand.wahlbezirke.get(w.ags) ?? 0;
			if (bezirkeSoll > 0 && bezirkeIst < bezirkeSoll)
				melde({
					fall: "anwendung",
					ebene: "wahlbezirk",
					kreis: k.slug,
					behoerde: w.ags,
					name: w.name,
					gegenstand: `${bezirkeSoll} Wahlbezirke`,
					quelle: w.wahlbezirke.beleg.quelle,
					text: `${w.name}: ${bezirkeSoll} Wahlbezirke sind veröffentlicht, die Anwendung führt ${bezirkeIst}.`,
				});
			if (bezirkeSoll === 0 && (alt?.wahlbezirke.eintraege.length ?? 0) > 0)
				melde({
					fall: "wahlleitung",
					ebene: "wahlbezirk",
					kreis: k.slug,
					behoerde: w.ags,
					name: w.name,
					gegenstand: "Wahlbezirke",
					quelle: alt?.wahlbezirke.beleg.quelle ?? "-",
					text: `${w.name}: keine Wahlbezirke für ${verzeichnis.termin} veröffentlicht, zum Termin ${vergleich?.termin} waren es ${alt?.wahlbezirke.eintraege.length}.`,
				});

			for (const slug of gefuehrt ?? [])
				if (!kenntSlug(w, slug))
					melde({
						fall: "verzeichnis",
						ebene: "wahlleitung",
						kreis: k.slug,
						behoerde: w.ags,
						name: w.name,
						gegenstand: slug,
						quelle: w.beleg.quelle,
						text: `${w.name}: die Anwendung führt „${slug}", das Verzeichnis kennt es nicht.`,
					});
		}

		const kreisbehoerde = k.wahlleitungen.find((w) => w.ags === k.ags);
		const gefuehrteGebiete = new Set<string>();
		for (const wahl of kreisbehoerde?.aemter.kreistag?.wahlen ?? [])
			for (const g of bestand.gebiete.get(`${k.ags}/${wahl.slug}`) ?? [])
				gefuehrteGebiete.add(g);
		for (const b of k.kreiswahlbereiche.eintraege) {
			if (b.gebietId && !gefuehrteGebiete.has(b.gebietId))
				melde({
					fall: "anwendung",
					ebene: "kreiswahlbereich",
					kreis: k.slug,
					behoerde: k.ags,
					name: k.name,
					gegenstand: b.name,
					quelle: k.kreiswahlbereiche.beleg.quelle,
					text: `${k.name}: Kreiswahlbereich ${b.name} ist veröffentlicht, die Anwendung führt ihn nicht.`,
				});
		}
		const altKreis = vergleich?.kreise.find((x) => x.slug === k.slug);
		const altAnzahl = altKreis?.kreiswahlbereiche.eintraege.length ?? 0;
		if (k.kreiswahlbereiche.eintraege.length === 0 && altAnzahl > 0)
			melde({
				fall: "wahlleitung",
				ebene: "kreiswahlbereich",
				kreis: k.slug,
				behoerde: k.ags,
				name: k.name,
				gegenstand: "Kreiswahlbereiche",
				quelle: k.kreiswahlbereiche.beleg.quelle,
				text: `${k.name}: keine Kreiswahlbereiche für ${verzeichnis.termin} abrufbar (${k.kreiswahlbereiche.beleg.grund ?? "ohne Angabe"}); zum Termin ${vergleich?.termin} waren es ${altAnzahl}.`,
			});
	}
	if (katalog) {
		befunde.push(
			...pruefeKatalogGegenVerzeichnis(katalog, verzeichnis, bestand),
		);
		if (messung) befunde.push(...pruefeKreisvollstaendigkeit(katalog, messung));
	}
	return befunde;
};

const kenntSlug = (w: Wahlleitung, slug: string): boolean =>
	Object.values(w.aemter).some((a) => a.wahlen.some((x) => x.slug === slug));

/**
 * Führt dieses Amt die Wahl eines anderen Termins?
 *
 * Ein Amt kann viele Wahlen tragen – die Räte der Mitgliedsgemeinden einer
 * Samtgemeinde und daneben den Samtgemeinderat selbst. Wer nur prüft, ob das
 * Amt überhaupt belegt ist, übersieht die eine fehlende Wahl unter zehn
 * vorhandenen. Verglichen wird deshalb das Gebiet, für das gewählt wird; der
 * Slug fängt Umbenennungen des Gebiets ab.
 */
const kenntWahl = (eintrag: AmtEintrag, wahl: Wahlbezeichnung): boolean =>
	eintrag.wahlen.some(
		(x) => (x.gebiet ?? "") === (wahl.gebiet ?? "") || x.slug === wahl.slug,
	);

export type Abdeckungsbericht = {
	termin: string;
	gesamt: number;
	jeFall: Record<Fall, number>;
	befunde: Befund[];
};

export const bericht = (
	termin: string,
	befunde: Befund[],
): Abdeckungsbericht => ({
	termin,
	gesamt: befunde.length,
	jeFall: {
		anwendung: befunde.filter((b) => b.fall === "anwendung").length,
		wahlleitung: befunde.filter((b) => b.fall === "wahlleitung").length,
		verzeichnis: befunde.filter((b) => b.fall === "verzeichnis").length,
		messung: befunde.filter((b) => b.fall === "messung").length,
	},
	befunde,
});

/** Alle Belege einer Gliederung – für die Prüfung, dass nichts unbelegt bleibt. */
export const belege = (
	g: Wahlgliederung,
): Array<{ wo: string; beleg: Beleg }> => {
	const alle: Array<{ wo: string; beleg: Beleg }> = [];
	for (const k of g.kreise) {
		alle.push({
			wo: `${k.slug}/kreiswahlbereiche`,
			beleg: k.kreiswahlbereiche.beleg,
		});
		alle.push({
			wo: `${k.slug}/wahlbereichszuordnung`,
			beleg: k.wahlbereichszuordnung.beleg,
		});
		for (const w of k.wahlleitungen) {
			alle.push({ wo: `${k.slug}/${w.slug}`, beleg: w.beleg });
			for (const [amt, e] of Object.entries(w.aemter))
				alle.push({ wo: `${k.slug}/${w.slug}/${amt}`, beleg: belegVon(e, w) });
			if (w.mitgliedsgemeinden)
				alle.push({
					wo: `${k.slug}/${w.slug}/mitgliedsgemeinden`,
					beleg: w.mitgliedsgemeinden.beleg,
				});
			alle.push({
				wo: `${k.slug}/${w.slug}/ortschaften`,
				beleg: w.ortschaften.beleg,
			});
			alle.push({
				wo: `${k.slug}/${w.slug}/wahlbezirke`,
				beleg: w.wahlbezirke.beleg,
			});
		}
	}
	return alle;
};
