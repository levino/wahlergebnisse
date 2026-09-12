import type {
	Amt,
	Beleg,
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
 */
export type Fall = "anwendung" | "wahlleitung" | "verzeichnis";

export type Ebene = "wahlleitung" | Amt | "kreiswahlbereich" | "wahlbezirk";

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
};

export const pruefeAbdeckung = ({
	verzeichnis,
	vergleich,
	bestand,
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
				if (eigen?.stand === "belegt" || eigen?.stand === "entfaellt") continue;
				if (!veroeffentlicht) continue;
				melde({
					fall: "wahlleitung",
					ebene: amt,
					kreis: k.slug,
					behoerde: w.ags,
					name: w.name,
					gegenstand: AMT_LABEL[amt],
					quelle: belegVon(altEintrag, alt as Wahlleitung).quelle,
					text: `${w.name}: keine ${AMT_LABEL[amt]} für ${verzeichnis.termin} veröffentlicht, zum Termin ${vergleich?.termin} gab es sie.`,
				});
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
	return befunde;
};

const kenntSlug = (w: Wahlleitung, slug: string): boolean =>
	Object.values(w.aemter).some((a) => a.wahlen.some((x) => x.slug === slug));

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
