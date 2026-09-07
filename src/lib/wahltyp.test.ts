import { describe, expect, it } from "vitest";
import {
	erkenneWahltyp,
	gebietsname,
	gremiumName,
	istTestwahl,
	kurzBezeichnung,
	slugify,
	wahlGebiet,
	wahlSlug,
	ebenenUeberschriften,
	wahltypLabel,
	wahlSlugs,
} from "./wahltyp.ts";

describe("erkenneWahltyp", () => {
	it("erkennt die votemanager-Titel beider Termine", () => {
		expect(erkenneWahltyp("Landratswahl - Landkreis Hildesheim")).toBe(
			"landrat",
		);
		expect(
			erkenneWahltyp("Stichwahl des Landrats - Stadt Alfeld (Leine)"),
		).toBe("landrat-stichwahl");
		expect(erkenneWahltyp("Kreiswahl - Landkreis Hildesheim")).toBe("kreistag");
		expect(erkenneWahltyp("Kreistagswahl - Gemeinde Nordstemmen")).toBe(
			"kreistag",
		);
		expect(
			erkenneWahltyp(
				"Wahl des/der Bürgermeisters/in - Gemeinde Nordstemmen - Gemeinde Nordstemmen",
			),
		).toBe("buergermeister");
		expect(
			erkenneWahltyp("Wahl des/der Oberbürgermeisters/in - Stadt Hildesheim"),
		).toBe("buergermeister");
		expect(
			erkenneWahltyp(
				"Stichwahl des/der Bürgermeisters/in - Stadt Alfeld (Leine)",
			),
		).toBe("buergermeister-stichwahl");
		expect(
			erkenneWahltyp(
				"Samtgemeindebürgermeister(-innen)wahl - Samtgemeinde Leinebergland",
			),
		).toBe("buergermeister");
		expect(erkenneWahltyp("Gemeindewahl - Gemeinde Nordstemmen")).toBe("rat");
		expect(erkenneWahltyp("Stadtratswahl - Stadt Hildesheim")).toBe("rat");
		expect(
			erkenneWahltyp("Wahl des Rates der Stadt Sarstedt - Stadt Sarstedt"),
		).toBe("rat");
		expect(
			erkenneWahltyp("Samtgemeindewahl - Samtgemeinde Leinebergland"),
		).toBe("rat");
		expect(erkenneWahltyp("Ortsratswahl - Adensen - Ortschaft Adensen")).toBe(
			"ortsrat",
		);
	});

	it("erkennt auch die Schreibweisen der übrigen 44 Kreise", () => {
		// Beim Ausbau auf ganz Niedersachsen kamen Titel dazu, die nichts von
		// „…wahl“ wissen. Ohne sie landeten die Wahlen unter „sonstige“ und
		// teilten sich dort eine Adresse.
		expect(erkenneWahltyp("Wahl des Gemeinderates - Gemeinde Barver")).toBe(
			"rat",
		);
		expect(erkenneWahltyp("Samtgemeinderat Herzlake - Dohren")).toBe("rat");
		expect(erkenneWahltyp("Wahl zum Rat der Stadt Leer - Stadt Leer")).toBe(
			"rat",
		);
		expect(erkenneWahltyp("Stadtrat - Stadt Hann. Münden")).toBe("rat");
		expect(erkenneWahltyp("Wahl des Kreistages - Samtgemeinde Elm-Asse")).toBe(
			"kreistag",
		);
		expect(erkenneWahltyp("Kreiswahl Landkreis Emsland - …")).toBe("kreistag");
		expect(
			erkenneWahltyp(
				"Wahl der Landrätin oder des Landrats des Landkreises Wolfenbüttel - …",
			),
		).toBe("landrat");
		expect(erkenneWahltyp("Wahl des Ortsrates Riepe - Riepe")).toBe("ortsrat");
		// Tippfehler der Wahlleitungen: fehlendes r, überzähliges t.
		expect(
			erkenneWahltyp("Wahl der Samtgemeindebürgemeisterin - Samtgemeinde"),
		).toBe("buergermeister");
		expect(erkenneWahltyp("Ortstratswahl Sehlem - Ortschaft Sehlem")).toBe(
			"ortsrat",
		);
	});

	it("liest die Region Hannover als Kreis", () => {
		// Der größte Kreis des Landes hat eine eigene Verfassung: statt
		// Kreistag und Landrat wählt er Regionsversammlung und
		// Regionspräsidentin. Wahlrechtlich ist es dasselbe, deshalb dieselben
		// Typen – sonst gäbe es weder Sitzverteilung noch Hochrechnung noch
		// den Vergleich mit dem Vortermin. Titel wörtlich aus
		// wahlergebnisse.region-hannover.de/20210912/03241000/daten/api/.
		expect(
			erkenneWahltyp(
				"Wahl der Regionsversammlung - Region Hannover",
				"Region Hannover",
			),
		).toBe("kreistag");
		expect(
			erkenneWahltyp(
				"Wahl der Regionspräsidentin/des Regionspräsidenten - Region Hannover",
				"Region Hannover",
			),
		).toBe("landrat");
		expect(
			erkenneWahltyp(
				"Stichwahl der Regionspräsidentin/des Regionspräsidenten 2021 - Region Hannover",
				"Region Hannover",
			),
		).toBe("landrat-stichwahl");
		// Dieselben drei Wahlen führt jede der 20 Kommunen in ihrer eigenen
		// Präsentation mit – dort ohne Kreisbehörde als Absender.
		expect(
			erkenneWahltyp(
				"Wahl der Regionsversammlung - Region Hannover",
				"Stadt Garbsen",
			),
		).toBe("kreistag");
		expect(
			erkenneWahltyp(
				"Stichwahl der Regionspräsidentin/des Regionspräsidenten - Region Hannover",
				"Stadt Garbsen",
			),
		).toBe("landrat-stichwahl");
		// „Region“ hinter dem Gedankenstrich ist der Behördenname und deutet
		// gar nichts – die Kommunalwahlen der 20 Kommunen bleiben, was sie sind.
		expect(erkenneWahltyp("Ortsratswahl Ahlten - Region Hannover")).toBe(
			"ortsrat",
		);
		expect(erkenneWahltyp("Stadtratswahl - Region Hannover")).toBe("rat");
	});

	it("fängt die vier Vertipper der Wahlleitungen ab", () => {
		// Wolfenbüttel 2021: „Samtgemeindrat“ ohne e. Ohne Nachsicht fällt der
		// Rat einer ganzen Samtgemeinde in die Rubrik „sonstige“.
		expect(erkenneWahltyp("Wahl des Samtgemeindrates")).toBe("rat");
		// Rotenburg 2026: ein „de“ zu viel. Oldenburg-Land 2026: ein e zu wenig.
		expect(erkenneWahltyp("Gemeindedewahl Bothel")).toBe("rat");
		expect(erkenneWahltyp("Gemeindwahl Groß Ippener")).toBe("rat");
		// Und die gewohnten Schreibweisen bleiben, wie sie waren.
		expect(erkenneWahltyp("Gemeindewahl - Gemeinde Nordstemmen")).toBe("rat");
		expect(erkenneWahltyp("Samtgemeindewahl - Samtgemeinde Elm-Asse")).toBe(
			"rat",
		);
	});

	it("deutet die nackte „Stichwahl“ nach der Behörde", () => {
		// Delmenhorst nennt seinen zweiten Wahlgang 2026 nur „Stichwahl“. Eine
		// Stichwahl gibt es nach dem NKWG ausschließlich bei Direktwahlen –
		// wer antritt, sagt allein die Behörde.
		expect(erkenneWahltyp("Stichwahl", "Stadt Delmenhorst")).toBe(
			"buergermeister-stichwahl",
		);
		expect(erkenneWahltyp("Stichwahl", "Landkreis Hildesheim")).toBe(
			"landrat-stichwahl",
		);
		// Ohne Behördennamen gilt die Gemeinde – Personenwahl bleibt es so oder so.
		expect(erkenneWahltyp("Stichwahl")).toBe("buergermeister-stichwahl");
		// Steht das Amt im Titel, entscheidet weiter der Titel.
		expect(
			erkenneWahltyp("Stichwahl des Landrats", "Gemeinde Nordstemmen"),
		).toBe("landrat-stichwahl");
	});
});

describe("kurzBezeichnung", () => {
	it("kürzt die sperrigen amtlichen Titel", () => {
		expect(
			kurzBezeichnung(
				"Wahl des/der Bürgermeisters/in - Gemeinde Nordstemmen",
				"buergermeister",
			),
		).toBe("Bürgermeisterwahl");
		expect(
			kurzBezeichnung(
				"Wahl des/der Oberbürgermeisters/in - Stadt Hildesheim",
				"buergermeister",
			),
		).toBe("Oberbürgermeisterwahl");
		expect(
			kurzBezeichnung(
				"Samtgemeindebürgermeister(-innen)wahl - Samtgemeinde Leinebergland",
				"buergermeister",
			),
		).toBe("Samtgemeindebürgermeisterwahl");
		expect(
			kurzBezeichnung("Landratswahl - Landkreis Hildesheim", "landrat"),
		).toBe("Landratswahl");
		expect(
			kurzBezeichnung(
				"Stichwahl des Landrats - Landkreis Hildesheim",
				"landrat-stichwahl",
			),
		).toBe("Stichwahl Landrat");
		expect(
			kurzBezeichnung("Kreiswahl - Landkreis Hildesheim", "kreistag"),
		).toBe("Kreistagswahl");
	});

	it("ergibt bei der Stichwahl nicht 'StichBürgermeisterwahl'", () => {
		expect(
			kurzBezeichnung(
				"Stichwahl des/der Bürgermeisters/in - Stadt Alfeld (Leine)",
				"buergermeister-stichwahl",
			),
		).toBe("Stichwahl Bürgermeister");
	});

	it("lässt Rats- und Ortsratswahlen bei ihrem amtlichen Namen", () => {
		expect(
			kurzBezeichnung(
				"Wahl des Rates der Stadt Sarstedt - Stadt Sarstedt",
				"rat",
			),
		).toBe("Wahl des Rates der Stadt Sarstedt");
		expect(
			kurzBezeichnung("Ortsratswahl - Adensen - Ortschaft Adensen", "ortsrat"),
		).toBe("Ortsratswahl");
	});

	it("sagt in der Region Hannover nicht 'Kreistag'", () => {
		// Die drei Wahlen laufen intern als kreistag/landrat, damit
		// Sitzverteilung, Hochrechnung und Vergleich greifen. Auf der Seite
		// steht trotzdem, wie das Gremium heißt: einen Kreistag und einen
		// Landrat gibt es in Hannover nicht.
		expect(
			kurzBezeichnung(
				"Wahl der Regionsversammlung - Region Hannover",
				"kreistag",
			),
		).toBe("Regionsversammlungswahl");
		expect(
			kurzBezeichnung(
				"Wahl der Regionspräsidentin/des Regionspräsidenten - Region Hannover",
				"landrat",
			),
		).toBe("Regionspräsidentenwahl");
		expect(
			kurzBezeichnung(
				"Stichwahl der Regionspräsidentin/des Regionspräsidenten 2021 - Region Hannover",
				"landrat-stichwahl",
			),
		).toBe("Stichwahl Regionspräsident");
		// „Region“ im Behördenteil des Titels reicht dafür nicht: Die Ortsräte
		// und Räte der 20 Kommunen heißen weiter, wie sie heißen.
		expect(kurzBezeichnung("Kreistagswahl - Region Hannover", "kreistag")).toBe(
			"Kreistagswahl",
		);
	});
});

describe("Adressen der Region Hannover", () => {
	// Die drei kreisweiten Wahlen führt die Region selbst und jede ihrer 20
	// Kommunen mit. Sie tragen keinen Gebietszusatz – wie Landrat und
	// Kreistag überall sonst gibt es sie je Behörde genau einmal.
	const eintraege = [
		{
			wahlId: 2,
			titel:
				"Wahl der Regionspräsidentin/des Regionspräsidenten - Region Hannover",
			gebietTitel: "Region Hannover",
			gebietId: "ebene_1_id_11",
		},
		{
			wahlId: 3,
			titel:
				"Stichwahl der Regionspräsidentin/des Regionspräsidenten 2021 - Region Hannover",
			gebietTitel: "Region Hannover",
			gebietId: "ebene_1_id_11",
		},
		{
			wahlId: 1,
			titel: "Wahl der Regionsversammlung - Region Hannover",
			gebietTitel: "Region Hannover",
			gebietId: "ebene_1_id_11",
		},
	];

	it("überschreibt die obere Ebene mit 'Region', nicht mit 'Kreis'", () => {
		expect(ebenenUeberschriften(eintraege.map((e) => e.titel))).toEqual({
			eigen: "Regionsebene",
			kreisweit: "Regionsweite Wahlen in",
		});
		expect(ebenenUeberschriften(["Kreiswahl - Landkreis Hildesheim"])).toEqual({
			eigen: "Kreisebene",
			kreisweit: "Kreisweite Wahlen in",
		});
		// Ohne kreisweite Wahl bleibt es beim Kreis – die Gruppe ist dann leer.
		expect(ebenenUeberschriften([]).eigen).toBe("Kreisebene");
	});

	it("beschriftet auch in der Schnittstelle nicht mit 'Kreistagswahl'", () => {
		// `typ` bleibt maschinenlesbar „kreistag“ – das dazu ausgelieferte
		// Label würde sonst behaupten, die Region habe einen Kreistag.
		expect(wahltypLabel("kreistag", eintraege[2].titel)).toBe(
			"Regionsversammlungswahl",
		);
		expect(wahltypLabel("landrat", eintraege[0].titel)).toBe(
			"Regionspräsidentenwahl",
		);
		// Überall sonst unverändert das Label der Wahlart.
		expect(wahltypLabel("kreistag", "Kreiswahl - Landkreis Hildesheim")).toBe(
			"Kreistagswahl",
		);
		expect(wahltypLabel("rat", "Stadtratswahl - Stadt Hildesheim")).toBe(
			"Ratswahl",
		);
		expect(wahltypLabel("ortsrat")).toBe("Ortsratswahl");
	});

	it("liefert die gewohnten Kreis-Slugs statt 'sonstige-…'", () => {
		expect(wahlSlugs(eintraege, "Region Hannover").map((w) => w.slug)).toEqual([
			"landrat",
			"landrat-stichwahl",
			"kreistag",
		]);
		// Dieselben Adressen in der Präsentation einer Kommune – nur so findet
		// `kreiswahlInGemeinde` die Wahl beim Durchklicken wieder.
		expect(wahlSlugs(eintraege, "Stadt Garbsen").map((w) => w.slug)).toEqual([
			"landrat",
			"landrat-stichwahl",
			"kreistag",
		]);
	});
});

describe("wahlSlug", () => {
	it("hängt bei Ortsräten den Ort an", () => {
		expect(
			wahlSlug(
				"ortsrat",
				"Ortsratswahl - Groß Escherde",
				"Groß Escherde",
				"Gemeinde Nordstemmen",
			),
		).toBe("ortsrat-gross-escherde");
		expect(
			wahlSlug(
				"ortsrat",
				"Ortsratswahl - Adensen - Ortschaft Adensen",
				"Ortschaft Adensen",
				"Gemeinde Nordstemmen",
			),
		).toBe("ortsrat-adensen");
		// Heißt die Ortschaft wie die Gemeinde, steht der Name trotzdem im Slug:
		// der Ortsrat ist nicht der Gemeinderat.
		expect(
			wahlSlug(
				"ortsrat",
				"Ortsratswahl - Nordstemmen - Ortschaft Nordstemmen",
				"Ortschaft Nordstemmen",
				"Gemeinde Nordstemmen",
			),
		).toBe("ortsrat-nordstemmen");
	});

	it("nennt bei Räten nur das abweichende Gebiet", () => {
		expect(
			wahlSlug(
				"rat",
				"Gemeindewahl - Duingen",
				"Duingen",
				"Samtgemeinde Leinebergland",
			),
		).toBe("rat-duingen");
		expect(
			wahlSlug(
				"rat",
				"Samtgemeindewahl - Samtgemeinde Leinebergland",
				"Samtgemeinde Leinebergland",
				"Samtgemeinde Leinebergland",
			),
		).toBe("rat");
		expect(
			wahlSlug(
				"rat",
				"Gemeindewahl - Gemeinde Nordstemmen",
				"Gemeinde Nordstemmen",
				"Gemeinde Nordstemmen",
			),
		).toBe("rat");
	});

	it("lässt Landrat, Kreistag und Bürgermeister ohne Zusatz", () => {
		expect(
			wahlSlug(
				"landrat",
				"Landratswahl - Landkreis Hildesheim",
				"Landkreis Hildesheim",
				"Landkreis Hildesheim",
			),
		).toBe("landrat");
		// Auch wenn der Titel den Kreis nennt und die Behörde eine Gemeinde ist.
		expect(
			wahlSlug(
				"kreistag",
				"Kreistagswahl Landkreis Aurich - Gemeinde Dornum",
				"Gemeinde Dornum",
				"Gemeinde Dornum",
			),
		).toBe("kreistag");
	});

	it("slugify", () => {
		expect(slugify("Rössing")).toBe("roessing");
		expect(slugify("Stadt Alfeld (Leine)")).toBe("stadt-alfeld-leine");
	});
});

describe("gebietsname", () => {
	it("schält den Ortsnamen aus den Bezeichnungen der Wahlleitungen", () => {
		expect(gebietsname("Wahl des Rates der Gemeinde Dahlum")).toBe("Dahlum");
		expect(gebietsname("der Gemeinde Dahlum")).toBe("Dahlum");
		expect(gebietsname("Ortsratswahl Amelsen")).toBe("Amelsen");
		expect(gebietsname("Wahl des Gemeinderates Flecken Lemförde")).toBe(
			"Lemförde",
		);
		expect(gebietsname("Stadtbezirksratswahl 111")).toBe("111");
		expect(gebietsname("Stadtratswahl Hemmoor 2026")).toBe("Hemmoor");
		expect(
			gebietsname(
				"Wahl des Landrates im Landkreis Wesermarsch am 13. September 2026",
			),
		).toBe("Wesermarsch");
		expect(gebietsname("Mitgliedsgemeinde Hattorf am Harz")).toBe(
			"Hattorf am Harz",
		);
	});

	it("liefert leer, wo nur die Wahl benannt ist", () => {
		expect(gebietsname("Samtgemeinderatswahl")).toBe("");
		expect(gebietsname("Ergebnis")).toBe("");
		expect(gebietsname("Wahl des Kreistages")).toBe("");
		expect(gebietsname("Wahl des/der Bürgermeisters/in")).toBe("");
		expect(gebietsname("Samtgemeindebürgermeister(-innen)wahl")).toBe("");
		expect(gebietsname("Kommunalwahl 2026")).toBe("");
	});

	it("frisst keine Ortsnamen an, die wie Vokabeln aussehen", () => {
		// „Wahle“ ist eine Ortschaft in Vechelde, „Land Hadeln“ eine
		// Samtgemeinde, „Stadtoldendorf“ eine Stadt.
		expect(gebietsname("Ortsratswahl Wahle")).toBe("Wahle");
		expect(gebietsname("Samtgemeinde Land Hadeln")).toBe("Land Hadeln");
		expect(gebietsname("Stadt Stadtoldendorf")).toBe("Stadtoldendorf");
		expect(gebietsname("Ortsratswahl Neuhaus (Oste)")).toBe("Neuhaus (Oste)");
	});
});

describe("wahlGebiet", () => {
	it("nimmt den Wahltitel, wo der Gebietsname unbrauchbar ist", () => {
		// Northeim schreibt in alle vierzehn Ortsratswahlen der Stadt Dassel
		// denselben Gebietsnamen „Ergebnis“.
		expect(
			wahlGebiet("Ortsratswahl Amelsen - Ergebnis", "Ergebnis", "Stadt Dassel"),
		).toBe("Amelsen");
		// Braunschweig schreibt in alle dreizehn Stadtbezirksräte „Stadt
		// Braunschweig“ – nur die Nummer im Wahltitel unterscheidet sie.
		expect(
			wahlGebiet(
				"Stadtbezirksratswahl 111 - Stadt Braunschweig",
				"Stadt Braunschweig",
				"Stadt Braunschweig",
			),
		).toBe("111");
	});

	it("nimmt den Gebietsnamen, wo der Wahltitel keinen nennt", () => {
		expect(
			wahlGebiet(
				"Ortsratswahl - Adensen - Ortschaft Adensen",
				"Ortschaft Adensen",
				"Gemeinde Nordstemmen",
			),
		).toBe("Adensen");
	});

	it("ist leer, wenn die Behörde für sich selbst wählt", () => {
		expect(
			wahlGebiet(
				"Gemeindewahl - Gemeinde Nordstemmen - Gemeinde Nordstemmen",
				"Gemeinde Nordstemmen",
				"Gemeinde Nordstemmen",
			),
		).toBe("");
		expect(
			wahlGebiet(
				"Samtgemeinderatswahl - Samtgemeinderatswahl",
				"Samtgemeinderatswahl",
				"Samtgemeinde Brookmerland",
			),
		).toBe("");
	});
});

describe("wahlSlugs", () => {
	/** Kurzschreibweise für die Einträge eines Termin-Index. */
	const eintraege = (...zeilen: Array<[number, string, string]>) =>
		zeilen.map(([wahlId, titel, gebietTitel]) => ({
			wahlId,
			titel,
			gebietTitel,
		}));

	it("trennt die dreizehn Gemeinderäte der Samtgemeinde Elm-Asse", () => {
		const erg = wahlSlugs(
			eintraege(
				[
					1184,
					"Wahl des Kreistages des Landkreis Wolfenbüttel - Samtgemeinde Elm-Asse",
					"Samtgemeinde Elm-Asse",
				],
				[
					1420,
					"Wahl der Samtgemeindebürgermeisterin/des Samtgemeindebürgermeisters - Samtgemeinde Elm-Asse",
					"Samtgemeinde Elm-Asse",
				],
				[
					1419,
					"Wahl des Rates der Gemeinde Dahlum - der Gemeinde Dahlum",
					"der Gemeinde Dahlum",
				],
				[
					1446,
					"Wahl des Rates der Gemeinde Denkte - Gemeinde Denkte",
					"Gemeinde Denkte",
				],
			),
			"Samtgemeinde Elm-Asse",
		);
		expect(erg.map((e) => e.slug)).toEqual([
			"kreistag",
			"buergermeister",
			"rat-dahlum",
			"rat-denkte",
		]);
		expect(erg.map((e) => e.gebiet)).toEqual(["", "", "Dahlum", "Denkte"]);
	});

	it("trennt Rat und Stadtbezirksräte in Braunschweig", () => {
		const erg = wahlSlugs(
			eintraege(
				[
					1,
					"Wahl des Rates der Stadt Braunschweig - Stadt Braunschweig",
					"Stadt Braunschweig",
				],
				[
					2,
					"Stadtbezirksratswahl 111 - Stadt Braunschweig",
					"Stadt Braunschweig",
				],
				[
					3,
					"Stadtbezirksratswahl 112 - Stadt Braunschweig",
					"Stadt Braunschweig",
				],
			),
			"Stadt Braunschweig",
		);
		expect(erg.map((e) => e.slug)).toEqual(["rat", "rat-111", "rat-112"]);
	});

	it("trennt die Ortsräte in Dassel trotz gleichen Gebietsnamens", () => {
		const erg = wahlSlugs(
			eintraege(
				[1, "Ortsratswahl Amelsen - Ergebnis", "Ergebnis"],
				[2, "Ortsratswahl Dassel - Ergebnis", "Ergebnis"],
				[3, "Ortsratswahl Hoppensen/Wellersen - Ergebnis", "Ergebnis"],
			),
			"Stadt Dassel",
		);
		expect(erg.map((e) => e.slug)).toEqual([
			"ortsrat-amelsen",
			"ortsrat-dassel",
			"ortsrat-hoppensen-wellersen",
		]);
	});

	it("erkennt den Ortsrat auch beim Tippfehler der Lamspringer Wahlleitung", () => {
		const erg = wahlSlugs(
			eintraege(
				[1, "Gemeinderatswahl - Gemeinde Lamspringe", "Gemeinde Lamspringe"],
				[
					2,
					"Ortsratswahl Lamspringe - Ortschaft Lamspringe",
					"Ortschaft Lamspringe",
				],
				[3, "Ortstratswahl Sehlem - Ortschaft Sehlem", "Ortschaft Sehlem"],
			),
			"Gemeinde Lamspringe",
		);
		expect(erg.map((e) => e.slug)).toEqual([
			"rat",
			"ortsrat-lamspringe",
			"ortsrat-sehlem",
		]);
	});

	it("greift zur Wahl-Id, wo zwei Wahlen wirklich gleich heißen", () => {
		// Lemwerder führt seine Landratswahl doppelt – die kleinere Wahl-Id
		// behält die gewachsene Adresse.
		const erg = wahlSlugs(
			eintraege(
				[2780, "Landratswahl - Gemeinde Lemwerder", "Gemeinde Lemwerder"],
				[
					2781,
					"Wahl des Landrates im Landkreis Wesermarsch am 13. September 2026 - Gemeinde Lemwerder",
					"Gemeinde Lemwerder",
				],
			),
			"Gemeinde Lemwerder",
		);
		expect(erg.map((e) => e.slug)).toEqual(["landrat", "landrat-2781"]);
	});

	it("lässt den Gemeinderat vor dem Samtgemeinderat den Vortritt", () => {
		// Herzlake listet seine Samtgemeinderatswahl einmal je Mitgliedsgemeinde,
		// neben deren eigenen Gemeinderatswahlen. Den schlichten Slug behält,
		// wessen Titel das Gebiet selbst nennt.
		const erg = wahlSlugs(
			eintraege(
				[1177, "Samtgemeinderat Herzlake - Dohren", "Dohren"],
				[1178, "Gemeinderat Dohren - Dohren", "Dohren"],
			),
			"Samtgemeinde Herzlake",
		);
		expect(erg.map((e) => e.slug)).toEqual(["rat-dohren-1177", "rat-dohren"]);
	});

	it("vergibt auch bei geteilter Wahl-Id eindeutige Slugs", () => {
		const erg = wahlSlugs(
			[
				{
					wahlId: 9,
					titel: "Wahl - X",
					gebietTitel: "X",
					gebietId: "ebene_1_id_1",
				},
				{
					wahlId: 9,
					titel: "Wahl - X",
					gebietTitel: "X",
					gebietId: "ebene_1_id_2",
				},
				{
					wahlId: 9,
					titel: "Wahl - X",
					gebietTitel: "X",
					gebietId: "ebene_1_id_3",
				},
			],
			"Gemeinde Y",
		);
		expect(new Set(erg.map((e) => e.slug)).size).toBe(3);
	});
});

describe("istTestwahl", () => {
	it("erkennt die Testdatensätze der Wahlleitungen", () => {
		// So steht es in der Präsentation von Stadland zum 13.09.2026
		expect(istTestwahl("Direktwahl TEST")).toBe(true);
		expect(istTestwahl("Direktwahl TEST - Gemeinde Stadland")).toBe(true);
		expect(istTestwahl("MUSTER Ratswahl")).toBe(true);
		expect(istTestwahl("Testwahl 2026")).toBe(true);
		expect(istTestwahl("Probewahl des Rates")).toBe(true);
	});

	it("hält echte Wahlen für echt, auch wenn der Name so klingt", () => {
		// Ortsteile und Kommunen, die ein Merkwort im Namen tragen
		expect(istTestwahl("Ortsratswahl Testorf-Steinfort")).toBe(false);
		expect(istTestwahl("Wahl des Rates der Gemeinde Probsteierhagen")).toBe(
			false,
		);
		expect(istTestwahl("Ortsratswahl Musterhausen")).toBe(false);
		// Kleingeschrieben allein reicht nicht: „Probe“ kann Namensbestandteil
		// sein, der Versalien-Marker ist die Absicht der Wahlleitung.
		expect(istTestwahl("Ortsratswahl Probe")).toBe(false);
		expect(istTestwahl("Kreistagswahl - Landkreis Hildesheim")).toBe(false);
	});
});

describe("Titel, die die Wahlart offenlassen", () => {
	it("deutet Kommunal- und Direktwahl nach der Behörde", () => {
		// Emden führt beide Wahlen so – ohne Deutung landeten sie unter
		// „sonstige“, und die Direktwahl des Oberbürgermeisters wäre als
		// Verhältniswahl mit Sitzverteilung gelesen worden.
		expect(erkenneWahltyp("Kommunalwahl 2026", "Stadt Emden")).toBe("rat");
		expect(erkenneWahltyp("Direktwahl 2026", "Stadt Emden")).toBe(
			"buergermeister",
		);
		expect(erkenneWahltyp("Kommunalwahl 2026", "Landkreis Hildesheim")).toBe(
			"kreistag",
		);
		expect(erkenneWahltyp("Direktwahl 2026", "Landkreis Hildesheim")).toBe(
			"landrat",
		);
		expect(erkenneWahltyp("Stichwahl der Direktwahl 2026", "Stadt Emden")).toBe(
			"buergermeister-stichwahl",
		);
		// Ohne Behördennamen gilt die Gemeinde. Die Wahlart stimmt dann immer
		// noch – Personenwahl bleibt Personenwahl.
		expect(erkenneWahltyp("Direktwahl 2026")).toBe("buergermeister");
	});

	it("lässt eindeutige Titel unberührt", () => {
		expect(
			erkenneWahltyp("Kreistagswahl - Landkreis Hildesheim", "Stadt Emden"),
		).toBe("kreistag");
		expect(erkenneWahltyp("Ortsratswahl - Adensen", "Landkreis X")).toBe(
			"ortsrat",
		);
	});

	it("nennt das Gremium so wie die Wahlleitung", () => {
		// Braunschweig nummeriert seine Stadtbezirke nur
		expect(gremiumName("Stadtbezirksratswahl 111", "ortsrat")).toBe(
			"Stadtbezirksrat",
		);
		expect(gremiumName("Ortsratswahl - Rössing", "ortsrat")).toBe("Ortsrat");
		expect(gremiumName("Wahl des Ortsrates Riepe - Riepe", "ortsrat")).toBe(
			"Ortsrat",
		);
		expect(gremiumName("Ortschaftsratswahl Sehlem", "ortsrat")).toBe(
			"Ortschaftsrat",
		);
		// Tippfehler der Wahlleitung: bleibt beim gewohnten Wort
		expect(gremiumName("Ortstratswahl Sehlem", "ortsrat")).toBe("Ortsrat");
	});
});
