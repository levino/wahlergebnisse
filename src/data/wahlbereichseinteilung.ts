import type {
	Beleg,
	Gebietsmenge,
	Wahlbereichszuordnung,
} from "./wahlgliederung.ts";

/**
 * Welche Gemeinden in welchem Wahlbereich liegen, erhoben aus amtlichen
 * Veröffentlichungen.
 *
 * Die Wahlpräsentationen führen diese Zuordnung zum Termin 2026 nicht: ihre
 * Wahlraum-Übersichten haben keine Spalte Kreiswahlbereich mehr. Sie steht
 * stattdessen in Wahlbekanntmachungen, Hauptsatzungen und Beschlüssen der
 * Kreise und Städte. Was hier steht, ist von Hand aus genau einem solchen
 * Dokument abgeschrieben – nie aus einem anderen Termin übernommen und nie
 * aus Namen oder Geografie erschlossen.
 */
export type Einteilungsbereich = {
	/** Kürzel, wie das Dokument es schreibt */
	kuerzel: string;
	/** Gemeinden, wortwörtlich wie im Dokument */
	gemeinden: string[];
	/** Ortsteile, wenn das Dokument eine Gemeinde auf mehrere Bereiche aufteilt */
	ortsteile?: string[];
};

export type Einteilung = {
	termin: string;
	/** Kreis-Slug aus src/data/kreis-katalog.ts */
	kreis: string;
	/** Vollständige Adresse des Dokuments */
	quelle: string;
	/** Art des Dokuments und wo es verlinkt ist */
	dokument: string;
	/** ISO-Zeitpunkt der Erhebung */
	erhoben: string;
	bereiche: Einteilungsbereich[];
};

export const EINTEILUNGEN: Einteilung[] = [
	{
		termin: "2026",
		kreis: "hildesheim",
		quelle:
			"https://www.landkreishildesheim.de/loadDocument.phtml?FID=3711.1824.1&Ext=PDF",
		dokument:
			"„Einteilung der Wahlbereiche für die Kommunalwahlen am 13.09.2026“, PDF der Wahlleitung, verlinkt unter https://www.landkreishildesheim.de/Politik/Wahlen/Kommunalwahl-2026/",
		erhoben: "2026-09-12T11:45:00.000Z",
		bereiche: [
			{ kuerzel: "A", gemeinden: ["Algermissen", "Sarstedt"] },
			{ kuerzel: "B", gemeinden: ["Elze", "Nordstemmen"] },
			{ kuerzel: "C", gemeinden: ["SG Leinebergland", "Sibbesse"] },
			{ kuerzel: "D", gemeinden: ["Alfeld", "Freden"] },
			{
				kuerzel: "E",
				gemeinden: ["Bad Salzdetfurth", "Diekholzen", "Lamspringe"],
			},
			{
				kuerzel: "F",
				gemeinden: ["Hildesheim"],
				ortsteile: ["Stadtmitte/Neustadt", "Nordstadt"],
			},
			{
				kuerzel: "G",
				gemeinden: ["Hildesheim"],
				ortsteile: [
					"Achtum-Uppen",
					"Bavenstedt",
					"Drispenstedt",
					"Einum",
					"Oststadt/Stadtfeld",
				],
			},
			{
				kuerzel: "H",
				gemeinden: ["Hildesheim"],
				ortsteile: [
					"Itzum-Marienburg",
					"Marienburger Höhe/Galgenberg",
					"Ochtersum",
				],
			},
			{
				kuerzel: "I",
				gemeinden: ["Hildesheim"],
				ortsteile: [
					"Himmelsthür",
					"Moritzberg/Bockfeld",
					"Neuhof/Hildesheimer Wald/Marienrode",
					"Sorsum",
				],
			},
			{ kuerzel: "K", gemeinden: ["Bockenem", "Holle", "Söhlde"] },
			{ kuerzel: "L", gemeinden: ["Giesen", "Harsum", "Schellerten"] },
		],
	},
];

const alsGebietsmenge = (
	e: Einteilung,
): Gebietsmenge<Wahlbereichszuordnung> => {
	const beleg: Beleg = {
		herkunft: "bekanntmachung",
		quelle: e.quelle,
		terminBeleg: e.termin,
		erhoben: e.erhoben,
		grund: e.dokument,
	};
	return {
		stand: "belegt",
		eintraege: e.bereiche.map(({ kuerzel, gemeinden, ortsteile }) => ({
			kuerzel,
			gemeinden: [...gemeinden].sort((a, b) => a.localeCompare(b, "de")),
			...(ortsteile ? { ortsteile } : {}),
		})),
		beleg,
	};
};

/** Die erhobene Einteilung eines Kreises, wenn eine vorliegt. */
export const einteilungFuer = (
	termin: string,
	kreis: string,
): Gebietsmenge<Wahlbereichszuordnung> | undefined => {
	const e = EINTEILUNGEN.find((x) => x.termin === termin && x.kreis === kreis);
	return e && alsGebietsmenge(e);
};
