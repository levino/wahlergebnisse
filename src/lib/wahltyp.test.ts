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
		expect(
			erkenneWahltyp("Wahl der Samtgemeindebürgemeisterin - Samtgemeinde"),
		).toBe("buergermeister");
		expect(erkenneWahltyp("Ortstratswahl Sehlem - Ortschaft Sehlem")).toBe(
			"ortsrat",
		);
	});

	it("liest die Region Hannover als Kreis", () => {
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
		expect(erkenneWahltyp("Ortsratswahl Ahlten - Region Hannover")).toBe(
			"ortsrat",
		);
		expect(erkenneWahltyp("Stadtratswahl - Region Hannover")).toBe("rat");
	});

	it("fängt die vier Vertipper der Wahlleitungen ab", () => {
		expect(erkenneWahltyp("Wahl des Samtgemeindrates")).toBe("rat");
		expect(erkenneWahltyp("Gemeindedewahl Bothel")).toBe("rat");
		expect(erkenneWahltyp("Gemeindwahl Groß Ippener")).toBe("rat");
		expect(erkenneWahltyp("Gemeindewahl - Gemeinde Nordstemmen")).toBe("rat");
		expect(erkenneWahltyp("Samtgemeindewahl - Samtgemeinde Elm-Asse")).toBe(
			"rat",
		);
	});

	it("deutet die nackte „Stichwahl“ nach der Behörde", () => {
		expect(erkenneWahltyp("Stichwahl", "Stadt Delmenhorst")).toBe(
			"buergermeister-stichwahl",
		);
		expect(erkenneWahltyp("Stichwahl", "Landkreis Hildesheim")).toBe(
			"landrat-stichwahl",
		);
		expect(erkenneWahltyp("Stichwahl")).toBe("buergermeister-stichwahl");
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
		expect(kurzBezeichnung("Kreistagswahl - Region Hannover", "kreistag")).toBe(
			"Kreistagswahl",
		);
	});
});

describe("Adressen der Region Hannover", () => {
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
		expect(ebenenUeberschriften([]).eigen).toBe("Kreisebene");
	});

	it("beschriftet auch in der Schnittstelle nicht mit 'Kreistagswahl'", () => {
		expect(wahltypLabel("kreistag", eintraege[2].titel)).toBe(
			"Regionsversammlungswahl",
		);
		expect(wahltypLabel("landrat", eintraege[0].titel)).toBe(
			"Regionspräsidentenwahl",
		);
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
		expect(gebietsname("Ortsratswahl Wahle")).toBe("Wahle");
		expect(gebietsname("Samtgemeinde Land Hadeln")).toBe("Land Hadeln");
		expect(gebietsname("Stadt Stadtoldendorf")).toBe("Stadtoldendorf");
		expect(gebietsname("Ortsratswahl Neuhaus (Oste)")).toBe("Neuhaus (Oste)");
	});
});

describe("wahlGebiet", () => {
	it("nimmt den Wahltitel, wo der Gebietsname unbrauchbar ist", () => {
		expect(
			wahlGebiet("Ortsratswahl Amelsen - Ergebnis", "Ergebnis", "Stadt Dassel"),
		).toBe("Amelsen");
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
		expect(istTestwahl("Direktwahl TEST")).toBe(true);
		expect(istTestwahl("Direktwahl TEST - Gemeinde Stadland")).toBe(true);
		expect(istTestwahl("MUSTER Ratswahl")).toBe(true);
		expect(istTestwahl("Testwahl 2026")).toBe(true);
		expect(istTestwahl("Probewahl des Rates")).toBe(true);
	});

	it("hält echte Wahlen für echt, auch wenn der Name so klingt", () => {
		expect(istTestwahl("Ortsratswahl Testorf-Steinfort")).toBe(false);
		expect(istTestwahl("Wahl des Rates der Gemeinde Probsteierhagen")).toBe(
			false,
		);
		expect(istTestwahl("Ortsratswahl Musterhausen")).toBe(false);
		expect(istTestwahl("Ortsratswahl Probe")).toBe(false);
		expect(istTestwahl("Kreistagswahl - Landkreis Hildesheim")).toBe(false);
	});
});

describe("Titel, die die Wahlart offenlassen", () => {
	it("deutet Kommunal- und Direktwahl nach der Behörde", () => {
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
		expect(gremiumName("Ortstratswahl Sehlem", "ortsrat")).toBe("Ortsrat");
	});
});
