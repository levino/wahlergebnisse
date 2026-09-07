/** Gemeinsame Test-Infrastruktur: Fixture-Pfade, Wahlabend-Simulation, temporäre Verzeichnisse. */
import {
	cpSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
	const alt = join(FIXTURES, "20210912/03254026/api/praesentation/wahl_27");
	const neu = join(ziel, "20260913/03254026/daten/api/wahl_52");
	const lies = (p: string) => JSON.parse(readFileSync(p, "utf-8"));
	const schreib = (p: string, d: unknown) =>
		writeFileSync(p, JSON.stringify(d));

	// Gesamtergebnis: 2021er Zahlen, aber Stand "2 von 23" und ohne Sitzverteilung
	const gesamt = lies(join(alt, "ergebnis_ebene_3_id_14_0.json"));
	gesamt.seitentitel =
		"Gemeindewahl - Gemeinde Nordstemmen - Gemeinde Nordstemmen";
	gesamt.Komponente.info.hinweis = ["2 von 23 Ergebnissen"];
	gesamt.Komponente.sitze = undefined;
	gesamt.Komponente.gebietsverlinkung = [
		{
			titel: "Wahlbezirke",
			gebietslinks: [
				{
					id: "ebene_6_id_6006",
					type: "ergebnis",
					title: "01 - Nordstemmen - Gemeindejugendring",
				},
				{
					id: "ebene_6_id_6014",
					type: "ergebnis",
					title: "09 - Rössing - DGH",
				},
			],
		},
	];
	schreib(join(neu, "ergebnis_ebene_-141_id_130_0.json"), gesamt);

	// Zwei Wahlbezirke ausgezählt (2021: 3111 → 2026: 6006, 3119 → 6014)
	for (const [von, nach] of [
		["ergebnis_ebene_6_id_3111_0.json", "ergebnis_ebene_6_id_6006_0.json"],
		["ergebnis_ebene_6_id_3119_0.json", "ergebnis_ebene_6_id_6014_0.json"],
	]) {
		const e = lies(join(alt, von));
		e.seitentitel = e.seitentitel.replace(
			"Gemeindewahl 12.09.2021",
			"Gemeindewahl",
		);
		schreib(join(neu, nach), e);
	}

	// Übersicht der Wahlbezirke: nur die beiden mit Werten, Rest leer
	const ue = lies(join(alt, "uebersicht_ebene_6_0.json"));
	const idMap: Record<string, string> = {
		ebene_6_id_3111: "ebene_6_id_6006",
		ebene_6_id_3119: "ebene_6_id_6014",
	};
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
				const neuId = idMap[z.link.id];
				if (neuId) return { ...z, link: { ...z.link, id: neuId } };
				const nr = Number.parseInt(z.link.id.replace("ebene_6_id_", ""), 10);
				return {
					...z,
					link: { ...z.link, id: `ebene_6_id_${nr + 2895}` },
					statusString: "",
					felder: z.felder.map(() => ({ absolut: "", prozent: "" })),
				};
			},
		);
	schreib(join(neu, "uebersicht_ebene_6_0.json"), ue);
	return ziel;
};
