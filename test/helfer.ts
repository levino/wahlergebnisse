/** Gemeinsame Test-Infrastruktur: Fixture-Pfade, Wahlabend-Simulation, temporäre Verzeichnisse. */
import {
	cpSync,
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { kreisBySlug } from "../src/data/kreise.ts";

export const FIXTURES = new URL("./fixtures/votemanager/", import.meta.url)
	.pathname;

export const tempVerzeichnis = (prefix = "wahlen-test-"): string =>
	mkdtempSync(join(tmpdir(), prefix));
export const aufraeumen = (dir: string): void =>
	rmSync(dir, { recursive: true, force: true });

/**
 * Baut aus den 2026-Fixtures (vor der Wahl: leere Ergebnisdateien) einen
 * Datenstand „Wahlabend, erste Schnellmeldungen“: Die Gemeindewahl
 * Nordstemmen (wahl_52) bekommt die echten 2021-Zahlen der Gemeindewahl
 * (wahl_27), zwei Wahlbezirke ausgezählt, Gesamtergebnis ohne Sitze
 * (→ Hochrechnung) und mit „2 von 23“.
 */
export const wahlabendFixtures = (ziel: string): string => {
	cpSync(FIXTURES, ziel, { recursive: true });
	wahlabendFuerBehoerde(ziel, "03254026");
	return ziel;
};

/**
 * Die 2021er Wahlbezirks-IDs der Nordstemmener Gemeindewahl, in der
 * Reihenfolge der Wahlbezirksnummern: erst die 15 Urnen-, dann die 8
 * Briefwahlbezirke. 2026 tragen dieselben Bezirke die um 2895 erhöhte ID.
 */
const BEZIRKE_2021 = [
	3111, 3112, 3113, 3114, 3115, 3116, 3117, 3118, 3119, 3120, 3121, 3122, 3123,
	3124, 3125, 4084, 4085, 4086, 4087, 4088, 4089, 4090, 4091,
];
const ID_VERSATZ = 2895;

/**
 * Wie `wahlabendFuerBehoerde`, aber mit frei wählbarem Auszählstand.
 * `ausgezaehlt` nennt die 2021er Bezirks-IDs, deren Ergebnis schon vorliegt;
 * alle übrigen bleiben in der Übersicht leer.
 */
export const wahlabendMitBezirken = (
	wurzel: string,
	ags: string,
	ausgezaehlt: number[],
): void => {
	const alt = join(FIXTURES, "20210912/03254026/api/praesentation/wahl_27");
	const neu = join(wurzel, `20260913/${ags}/daten/api/wahl_52`);
	const lies = (p: string) => JSON.parse(readFileSync(p, "utf-8"));
	const schreib = (p: string, d: unknown) =>
		writeFileSync(p, JSON.stringify(d));
	const fertig = new Set(ausgezaehlt);
	const ohneDatum = (titel: string) =>
		titel.replace("Gemeindewahl 12.09.2021", "Gemeindewahl");

	type Balken = { bezeichnung: string; wert: number; prozentGerundet: number };
	type Zeile = { label: { labelKurz: string }; zahl: string; prozent: string };
	const zahl = (s: string) =>
		Number(s.replace(/\./g, "").replace(",", ".")) || 0;
	const teile = ausgezaehlt.map((id) =>
		lies(join(alt, `ergebnis_ebene_6_id_${id}_0.json`)),
	);

	// Gesamtergebnis: die Summe der ausgezählten Wahlbezirke, mit Auszählstand
	// und ohne Sitzverteilung – so sieht es am Wahlabend wirklich aus.
	// (`Komponente.tabelle` mit Listen- und Kandidatenstimmen bleibt auf den
	// Endzahlen; für Stimmenanteile und Sitze wird sie nicht gelesen.)
	const gesamt = lies(join(alt, "ergebnis_ebene_3_id_14_0.json"));
	gesamt.seitentitel =
		"Gemeindewahl - Gemeinde Nordstemmen - Gemeinde Nordstemmen";
	gesamt.Komponente.info.hinweis = [
		`${ausgezaehlt.length} von ${BEZIRKE_2021.length} Ergebnissen`,
	];
	gesamt.Komponente.sitze = undefined;

	const summeJe = new Map<string, number>();
	for (const t of teile)
		for (const b of [
			...(t.Komponente.grafik.balken ?? []),
			...(t.Komponente.grafik.sonstigeBalken ?? []),
		] as Balken[])
			summeJe.set(b.bezeichnung, (summeJe.get(b.bezeichnung) ?? 0) + b.wert);
	const gueltig = [...summeJe.values()].reduce((a, b) => a + b, 0);
	const setze = (b: Balken) => {
		b.wert = summeJe.get(b.bezeichnung) ?? 0;
		b.prozentGerundet =
			gueltig > 0 ? Math.round((b.wert / gueltig) * 10000) / 100 : 0;
		return b;
	};
	for (const b of gesamt.Komponente.grafik.balken as Balken[]) setze(b);
	for (const b of (gesamt.Komponente.grafik.sonstigeBalken ?? []) as Balken[])
		setze(b);
	const sonst = gesamt.Komponente.grafik.sonstige as Balken | undefined;
	if (sonst) {
		sonst.wert = (
			(gesamt.Komponente.grafik.sonstigeBalken ?? []) as Balken[]
		).reduce((a, b) => a + b.wert, 0);
		sonst.prozentGerundet =
			gueltig > 0 ? Math.round((sonst.wert / gueltig) * 10000) / 100 : 0;
	}

	// Kennzahlen: Wahlberechtigte, Wähler und Stimmen der ausgezählten Bezirke
	for (const z of gesamt.Komponente.info.tabelle.zeilen as Zeile[]) {
		const s = teile.reduce(
			(a, t) =>
				a +
				zahl(
					(t.Komponente.info.tabelle.zeilen as Zeile[]).find(
						(x) => x.label.labelKurz === z.label.labelKurz,
					)?.zahl ?? "0",
				),
			0,
		);
		z.zahl = s.toLocaleString("de-DE");
		z.prozent = "";
	}
	gesamt.Komponente.wahlbeteiligung = { text: { prozent: undefined } };
	gesamt.Komponente.gebietsverlinkung = [
		{
			titel: "Wahlbezirke",
			gebietslinks: ausgezaehlt.map((id) => ({
				id: `ebene_6_id_${id + ID_VERSATZ}`,
				type: "ergebnis",
				title: ohneDatum(
					lies(join(alt, `ergebnis_ebene_6_id_${id}_0.json`)).seitentitel,
				).replace("Gemeindewahl - Gemeinde Nordstemmen - ", ""),
			})),
		},
	];
	schreib(join(neu, "ergebnis_ebene_-141_id_130_0.json"), gesamt);

	// Ausgezählte Wahlbezirke mit den 2021er Zahlen
	for (const id of ausgezaehlt) {
		const e = lies(join(alt, `ergebnis_ebene_6_id_${id}_0.json`));
		e.seitentitel = ohneDatum(e.seitentitel);
		schreib(join(neu, `ergebnis_ebene_6_id_${id + ID_VERSATZ}_0.json`), e);
	}

	// Übersicht der Wahlbezirke: nur die ausgezählten mit Werten, Rest leer
	const ue = lies(join(alt, "uebersicht_ebene_6_0.json"));
	ue.tabelle.zeilen = ue.tabelle.zeilen
		.filter(
			(z: { link?: { id?: string } }) =>
				z.link?.id && !z.link.id.includes("ebene_3"),
		)
		.map(
			(z: {
				link: { id: string };
				statusString: string;
				felder: Array<{ absolut: string; prozent: string }>;
			}) => {
				const nr = Number.parseInt(z.link.id.replace("ebene_6_id_", ""), 10);
				const neuId = { ...z.link, id: `ebene_6_id_${nr + ID_VERSATZ}` };
				return fertig.has(nr)
					? { ...z, link: neuId }
					: {
							...z,
							link: neuId,
							statusString: "",
							felder: z.felder.map(() => ({ absolut: "", prozent: "" })),
						};
			},
		);
	schreib(join(neu, "uebersicht_ebene_6_0.json"), ue);
};

/**
 * Dieselbe Umschaltung für eine beliebige Behörde in einem schon gebauten
 * Fixture-Baum, auf dem Stand „2 von 23“. Gedacht für die Probe mit mehreren
 * Kreisen: Dort tragen mehrere Behörden dieselben Nordstemmener Dateien (siehe
 * `vieleKreiseFixtures`), und sie sollen alle gleichzeitig melden.
 */
export const wahlabendFuerBehoerde = (wurzel: string, ags: string): void =>
	// 01 Nordstemmen-Gemeindejugendring und 09 Rössing-DGH
	wahlabendMitBezirken(wurzel, ags, [3111, 3119]);

/**
 * Spiegelt die Hildesheimer Fixtures in weitere Kreise.
 *
 * Fixtures gibt es nur für den Landkreis Hildesheim. Für die Probe auf den
 * Wahlabend braucht es aber mehrere Kreise, in denen gleichzeitig etwas
 * passiert. Deshalb bekommt jeder genannte Kreis zwei Behörden mit Inhalt:
 * seine Kreisbehörde die Dateien des Landkreises (03254000), seine erste
 * Gemeinde die von Nordstemmen (03254026). Alle weiteren Behörden dieser
 * Kreise bleiben leer – der Poller muss auch das aushalten, denn so sieht es
 * in Niedersachsen tatsächlich aus.
 *
 * Zurück kommt die Wurzel und je Kreis der Schlüssel der Behörde, die am
 * Wahlabend meldet.
 */
export const vieleKreiseFixtures = (
	ziel: string,
	kreisSlugs: string[],
): { wurzel: string; melder: Map<string, string> } => {
	cpSync(FIXTURES, ziel, { recursive: true });
	const melder = new Map<string, string>();
	for (const slug of kreisSlugs) {
		const kreis = kreisBySlug(slug);
		if (!kreis) throw new Error(`Unbekannter Kreis: ${slug}`);
		const gemeinde = kreis.behoerden.find((b) => b.art !== "kreis");
		if (!gemeinde) throw new Error(`Kreis ohne Gemeinde: ${slug}`);
		for (const [von, nach] of [
			[kreis.ags, "03254000"],
			[gemeinde.ags, "03254026"],
		] as const)
			cpSync(
				join(FIXTURES, `20260913/${nach}`),
				join(ziel, `20260913/${von}`),
				{ recursive: true },
			);
		melder.set(slug, gemeinde.ags);
	}
	return { wurzel: ziel, melder };
};

/**
 * Ordner der Termine, aus denen die Generalprobe schöpft: der Zieltermin und
 * die beiden Vorwerte.
 */
const DEMO_ORDNER = ["20260913", "20210912", "20200913"];

/**
 * Fixtures für die Generalprobe in beliebigen Kreisen.
 *
 * Anders als {@link vieleKreiseFixtures} werden auch die **Vorwert**-Termine
 * gespiegelt – ohne sie hätte die Probe keine Zahlen – und jede Gemeinde des
 * Kreises bekommt welche, nicht nur die erste. Damit lässt sich prüfen, was
 * der Betreiber verlangt: dass die Demo in jedem Kreis läuft und nicht nur in
 * dem, für den es echte Fixtures gibt.
 *
 * `nurGemeinden` begrenzt, wie viele Gemeinden je Kreis Zahlen bekommen –
 * ein voller Kreis kostet im Poller-Lauf mehrere Sekunden.
 */
export const demoKreisFixtures = (
	ziel: string,
	kreisSlugs: string[],
	nurGemeinden = Number.POSITIVE_INFINITY,
): string => {
	cpSync(FIXTURES, ziel, { recursive: true });
	for (const slug of kreisSlugs) {
		const kreis = kreisBySlug(slug);
		if (!kreis) throw new Error(`Unbekannter Kreis: ${slug}`);
		const gemeinden = kreis.behoerden
			.filter((b) => b.art !== "kreis")
			.slice(0, nurGemeinden);
		const paare: Array<[string, string]> = [
			[kreis.ags, "03254000"],
			...gemeinden.map((g): [string, string] => [g.ags, "03254026"]),
		];
		for (const ordner of DEMO_ORDNER)
			for (const [von, nach] of paare) {
				const quelle = join(FIXTURES, ordner, nach);
				if (!existsSync(quelle)) continue;
				cpSync(quelle, join(ziel, ordner, von), { recursive: true });
			}
	}
	return ziel;
};
