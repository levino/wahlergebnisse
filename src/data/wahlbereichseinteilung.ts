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
	/** Name des Wahlbereichs, wenn das Dokument ihm einen gibt */
	name?: string;
	/**
	 * Gemeinden, wortwörtlich wie im Dokument. Eine Gemeinde, die das Dokument
	 * auf mehrere Wahlbereiche aufteilt, steht in jedem davon – dadurch bleibt
	 * sie ohne eindeutigen Bereich, statt einem falschen zugeschlagen zu werden.
	 * Bei kreisfreien Städten ist es die Stadt selbst; abgegrenzt wird dort nach
	 * Stadtteilen oder Wahlbezirken.
	 */
	gemeinden: string[];
	/** Ortsteile oder Stadtteile, soweit das Dokument nach ihnen abgrenzt */
	ortsteile?: string[];
	/** Wahlbezirke oder Stadtbezirke, soweit das Dokument nach ihnen abgrenzt */
	bezirke?: string[];
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
		kreis: "salzgitter",
		quelle:
			"https://www2.salzgitter.de/rathaus/wahlen/downloads-wahlen/2025-06-26-3925_18-Kommunalwahl-am-13.09.6.pdf",
		dokument:
			"Beschlussvorlage 3925/18 „Kommunalwahl am 13.09.2026; hier: Wahlbereichseinteilung für die Wahl zum Rat der Stadt Salzgitter“ (§ 7 NKWG), Rat der Stadt am 29.10.2025. Die Stadtteile stehen in Anlage 2, die die 100 Wahlbezirke einzeln ihrem Bereich zuordnet. Lebenstedt ist auf A, B und C aufgeteilt, Salzgitter-Bad (im Dokument „Bad“) auf E und F.",
		erhoben: "2026-09-12T12:30:00.000Z",
		bereiche: [
			{
				kuerzel: "A",
				gemeinden: ["Salzgitter"],
				ortsteile: [
					"Bruchmachtersen",
					"Lebenstedt",
					"Lesse",
					"Lichtenberg",
					"Osterlinde",
					"Reppner",
					"Salder",
				],
			},
			{ kuerzel: "B", gemeinden: ["Salzgitter"], ortsteile: ["Lebenstedt"] },
			{
				kuerzel: "C",
				gemeinden: ["Salzgitter"],
				ortsteile: ["Engelnstedt", "Lebenstedt"],
			},
			{
				kuerzel: "D",
				gemeinden: ["Salzgitter"],
				ortsteile: [
					"Barum",
					"Beddingen",
					"Beinum",
					"Bleckenstedt",
					"Drütte",
					"Flachstöckheim",
					"Hallendorf",
					"Immendorf",
					"Lobmachtersen",
					"Ohlendorf",
					"Sauingen",
					"Thiede",
					"Watenstedt",
					"Üfingen",
				],
			},
			{
				kuerzel: "E",
				gemeinden: ["Salzgitter"],
				ortsteile: ["Bad", "Calbecht", "Engerode", "Gebhardshagen", "Heerte"],
			},
			{
				kuerzel: "F",
				gemeinden: ["Salzgitter"],
				ortsteile: ["Bad", "Gitter", "Groß Mahner", "Hohenrode", "Ringelheim"],
			},
		],
	},
	{
		termin: "2026",
		kreis: "braunschweig",
		quelle:
			"https://www.ratsinfo.braunschweig.sitzung-online.de/public/VO020?VOLFDNR=1035752",
		dokument:
			"Beschlussvorlage 25-26613 „Kommunalwahlen 2026: Anzahl und Abgrenzung der Gemeindewahlbereiche“ vom 14.10.2025, vom Rat am 04.11.2025 ungeändert beschlossen (§ 7 Abs. 5 NKWG). Die Wahlbekanntmachung vom 03.12.2025 nennt nur Nummern und Namen und verweist für die Abgrenzung auf ihre Karte. Identität der Vorlage über die OParl-Schnittstelle desselben Hauses gegengeprüft.",
		erhoben: "2026-09-12T12:05:00.000Z",
		bereiche: [
			{
				kuerzel: "11",
				name: "Nordost",
				gemeinden: ["Braunschweig"],
				bezirke: ["Stadtbezirk 111", "Stadtbezirk 112"],
			},
			{
				kuerzel: "12",
				name: "Östlicher Ring",
				gemeinden: ["Braunschweig"],
				bezirke: ["Stadtbezirk 120"],
			},
			{
				kuerzel: "13",
				name: "Innenstadt/Südlicher Ring",
				gemeinden: ["Braunschweig"],
				bezirke: ["Stadtbezirk 130"],
			},
			{
				kuerzel: "21",
				name: "Südost",
				gemeinden: ["Braunschweig"],
				bezirke: ["Stadtbezirk 211", "Stadtbezirk 212"],
			},
			{
				kuerzel: "22",
				name: "Südwest",
				gemeinden: ["Braunschweig"],
				bezirke: ["Stadtbezirk 221", "Stadtbezirk 222"],
			},
			{
				kuerzel: "31",
				name: "Westlicher Ring",
				gemeinden: ["Braunschweig"],
				bezirke: ["Stadtbezirk 310"],
			},
			{
				kuerzel: "32",
				name: "Nordwest",
				gemeinden: ["Braunschweig"],
				bezirke: ["Stadtbezirk 321", "Stadtbezirk 322"],
			},
			{
				kuerzel: "33",
				name: "Nördlicher Ring",
				gemeinden: ["Braunschweig"],
				bezirke: ["Stadtbezirk 330"],
			},
		],
	},
	{
		termin: "2026",
		kreis: "wolfsburg",
		quelle:
			"https://www.wolfsburg.de/-/media/wolfsburg/statistik_daten_fakten/wahlen/kommunalwahl_2026/1_wahlbekanntmachung_2026.pdf",
		dokument:
			"Amtliche Bekanntmachung „Wahl zum Rat und zu den Ortsräten der Stadt Wolfsburg am 13. September 2026“, Abschnitt 3.1 Ratswahl, vom 09.01.2026",
		erhoben: "2026-09-12T12:05:00.000Z",
		bereiche: [
			{
				kuerzel: "1",
				gemeinden: ["Wolfsburg"],
				ortsteile: [
					"Brackstedt",
					"Neuhaus",
					"Reislingen",
					"Velstove",
					"Vorsfelde",
					"Warmenau",
					"Wendschott",
				],
			},
			{
				kuerzel: "2",
				gemeinden: ["Wolfsburg"],
				ortsteile: [
					"Alt-Wolfsburg",
					"Hellwinkel",
					"Heßlingen",
					"Köhlerberg",
					"Kreuzheide",
					"Rothenfelde",
					"Schillerteich",
					"Stadtmitte",
					"Steimker Berg",
					"Steimker Gärten",
					"Teichbreite",
					"Tiergartenbreite",
				],
			},
			{
				kuerzel: "3",
				gemeinden: ["Wolfsburg"],
				ortsteile: [
					"Barnstorf",
					"Eichelkamp",
					"Hageberg",
					"Hehlingen",
					"Hohenstein",
					"Klieversberg",
					"Laagberg",
					"Nordsteimke",
					"Rabenberg",
					"Wohltberg",
				],
			},
			{
				kuerzel: "4",
				gemeinden: ["Wolfsburg"],
				ortsteile: [
					"Fallersleben",
					"Kästorf",
					"Sandkamp",
					"Sülfeld",
					"Westhagen",
				],
			},
			{
				kuerzel: "5",
				gemeinden: ["Wolfsburg"],
				ortsteile: [
					"Almke",
					"Detmerode",
					"Ehmen",
					"Hattorf",
					"Heiligendorf",
					"Mörse",
					"Neindorf",
				],
			},
		],
	},
	{
		termin: "2026",
		kreis: "gifhorn",
		quelle:
			"https://www.landkreis-gifhorn.de/loadDocument.phtml?FID=4083.7118.1&Ext=PDF",
		dokument:
			"Wahlbekanntmachung nach §§ 6 und 16 NKWG für die Wahl des Kreistages am 13.09.2026, Abschnitt II.2 „Zahl und Abgrenzung der Wahlbereiche“, vom 05.01.2026",
		erhoben: "2026-09-12T12:05:00.000Z",
		bereiche: [
			{
				kuerzel: "1",
				gemeinden: ["Stadt Gifhorn"],
				bezirke: [
					"Stadt Gifhorn I (Wahlbezirke 100 – 109, 202 – 204)",
					"Stadt Gifhorn II (Wahlbezirke 205 – 209, 301 – 309)",
				],
			},
			{
				kuerzel: "2",
				gemeinden: ["Stadt Gifhorn", "Samtgemeinde Meinersen"],
				bezirke: ["Stadt Gifhorn III (Wahlbezirke 401 – 410, 110)"],
			},
			{
				kuerzel: "3",
				gemeinden: ["Samtgemeinde Papenteich", "Samtgemeinde Isenbüttel"],
			},
			{
				kuerzel: "4",
				gemeinden: [
					"Gemeinde Sassenburg",
					"Samtgemeinde Brome",
					"Samtgemeinde Boldecker Land",
				],
			},
			{
				kuerzel: "5",
				gemeinden: [
					"Samtgemeinde Wesendorf",
					"Stadt Wittingen",
					"Samtgemeinde Hankensbüttel",
				],
			},
		],
	},
	{
		termin: "2026",
		kreis: "goslar",
		quelle:
			"https://www.landkreis-goslar.de/loadDocument.phtml?FID=3601.4046.1&Ext=PDF",
		dokument:
			"Amtsblatt Landkreis Goslar 02/26 vom 15.01.2026, S. 5–6, Wahlbekanntmachung für die Neuwahl des Kreistages am 13.09.2026, Abschnitt 3; beruht auf dem Kreistagsbeschluss vom 08.12.2025",
		erhoben: "2026-09-12T12:05:00.000Z",
		bereiche: [
			{
				kuerzel: "I",
				name: "Oberharz",
				gemeinden: [
					"Stadt Braunlage",
					"Berg- und Universitätsstadt Clausthal-Zellerfeld",
				],
			},
			{
				kuerzel: "II",
				name: "Goslar Nord",
				gemeinden: ["Stadt Goslar"],
				ortsteile: [
					"Baßgeige",
					"Grauhof",
					"Hahndorf",
					"Immenrode",
					"Jerstedt",
					"Jürgenohl",
					"Lengde",
					"Lochtum",
					"Ohlhof",
					"Vienenburg",
					"Weddingen",
					"Wiedelah",
				],
			},
			{
				kuerzel: "III",
				name: "Goslar Süd",
				gemeinden: ["Stadt Goslar"],
				ortsteile: [
					"Altstadt",
					"Georgenberg",
					"Hahnenklee",
					"Oker",
					"Rammelsberg",
					"Steinberg",
					"Sudmerberg",
				],
			},
			{
				kuerzel: "IV",
				name: "Bad Harzburg",
				gemeinden: ["Stadt Bad Harzburg"],
			},
			{
				kuerzel: "V",
				name: "Langelsheim / Liebenburg",
				gemeinden: ["Stadt Langelsheim", "Gemeinde Liebenburg"],
			},
			{ kuerzel: "VI", name: "Seesen", gemeinden: ["Stadt Seesen"] },
		],
	},
	{
		termin: "2026",
		kreis: "helmstedt",
		quelle:
			"https://www.landkreis-helmstedt.de/medien/dokumente/ab_6_vom_11.02.2026.pdf",
		dokument:
			"Amtsblatt für den Landkreis Helmstedt Nr. 6 vom 11.02.2026, S. 38–39, Wahlbekanntmachung des Kreiswahlleiters, Abschnitt III; Kreistagsbeschluss vom 10.12.2025 (Drucksache 105/2025, Anlage 3)",
		erhoben: "2026-09-12T12:05:00.000Z",
		bereiche: [
			{ kuerzel: "I", gemeinden: ["Stadt Helmstedt"] },
			{
				kuerzel: "II",
				gemeinden: [
					"Stadt Schöningen",
					"Samtgemeinde Heeseberg",
					"Samtgemeinde Nord-Elm",
				],
			},
			{
				kuerzel: "III",
				gemeinden: ["Stadt Königslutter", "Samtgemeinde Grasleben"],
			},
			{ kuerzel: "IV", gemeinden: ["Samtgemeinde Velpke", "Gemeinde Lehre"] },
		],
	},
	{
		termin: "2026",
		kreis: "wolfenbuettel",
		quelle:
			"https://www.lk-wolfenbuettel.de/output/download.php?fid=3282.2713.1.PDF",
		dokument:
			"Wahlbekanntmachung nach § 16 NKWG zur Wahl des Kreistages am 13.09.2026, Abschnitt 2; Kreistagsbeschluss vom 24.11.2025, ausgefertigt am 04.12.2025",
		erhoben: "2026-09-12T12:05:00.000Z",
		bereiche: [
			{
				kuerzel: "I",
				gemeinden: ["Stadt Wolfenbüttel"],
				bezirke: ["Wahlbereiche I und II zur Wahl des Stadtrats Wolfenbüttel"],
			},
			{
				kuerzel: "II",
				gemeinden: ["Stadt Wolfenbüttel"],
				bezirke: [
					"Wahlbereiche III und IV zur Wahl des Stadtrats Wolfenbüttel",
				],
			},
			{
				kuerzel: "III",
				gemeinden: [
					"Samtgemeinde Elm-Asse",
					"Samtgemeinde Oderwald",
					"Gemeinde Schladen-Werla",
				],
			},
			{
				kuerzel: "IV",
				gemeinden: [
					"Samtgemeinde Baddeckenstedt",
					"Samtgemeinde Sickte",
					"Gemeinde Cremlingen",
				],
			},
		],
	},
	{
		termin: "2026",
		kreis: "peine",
		quelle:
			"https://www.landkreis-peine.de/buergerinformationssystem/to020?TOLFDNR=2000823",
		dokument:
			"Beschluss des Kreistages vom 21.01.2026, TOP 6 „Kommunalwahl 2026 – Festlegung der Wahlbereiche“ (§ 7 NKWG), Beschlussvorlage 2025/192. Anlage 1 der Vorlage nummeriert II und III vertauscht; maßgeblich ist der Beschlusstext.",
		erhoben: "2026-09-12T12:05:00.000Z",
		bereiche: [
			{ kuerzel: "I", gemeinden: ["Edemissen", "Wendeburg"] },
			{ kuerzel: "II", gemeinden: ["Lengede", "Vechelde"] },
			{ kuerzel: "III", gemeinden: ["Hohenhameln", "Ilsede"] },
			{ kuerzel: "IV", name: "Peine-West", gemeinden: ["Peine"] },
			{ kuerzel: "V", name: "Peine-Ost", gemeinden: ["Peine"] },
		],
	},
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
	{
		termin: "2026",
		kreis: "cuxhaven",
		quelle:
			"https://www.landkreis-cuxhaven.de/output/download.php?fid=3189.7353.1.",
		dokument:
			"Bekanntmachung der Kreiswahlleiterin für die Kommunalwahlen am 13.09.2026, Ziffer 5 „Zahl und Abgrenzung der Wahlbereiche“, vom 17.01.2026; Kreistagsbeschluss vom 03.12.2025",
		erhoben: "2026-09-12T12:10:00.000Z",
		bereiche: [
			{ kuerzel: "1", gemeinden: ["Stadt Cuxhaven"] },
			{
				kuerzel: "2",
				gemeinden: ["Stadt Geestland", "Gemeinde Wurster Nordseeküste"],
			},
			{
				kuerzel: "3",
				gemeinden: [
					"Samtgemeinde Börde Lamstedt",
					"Samtgemeinde Hemmoor",
					"Samtgemeinde Land Hadeln",
				],
			},
			{
				kuerzel: "4",
				gemeinden: [
					"Gemeinde Beverstedt",
					"Gemeinde Hagen im Bremischen",
					"Gemeinde Loxstedt",
					"Gemeinde Schiffdorf",
				],
			},
		],
	},
	{
		termin: "2026",
		kreis: "stade",
		quelle:
			"https://www.landkreis-stade.de/downloads/datei/MTYyM2RkNDBhYjIxN2RmZXJrQnNRckw1SE4wWDRDeVdEV0JpdHJGMU9PNzJpRDhHUVMxUWZ6ek0rNzVGcW1tMEExYkJuSXl6ZStTSFZZenNwN0lkYVdaSUdHdE9HOEhDcWpsbmJVR2h2MnVZVFZqUFl3bE9tVjVxNi9XVmhCODZ3OFRab2VNNDdwZVAvUTRoQ1ZNSDFraW9YSWFVbTkrKzBSWUFMZz09",
		dokument:
			"Wahlbekanntmachung und Aufforderung zur Einreichung von Wahlvorschlägen (§§ 16, 45b NKWG), Ziffer 1.2, Stand 05.05.2026; Kreistagsbeschluss vom 15.12.2025. Die ältere Fassung vom 26.02.2026 ist auf der Kreisseite selbst als veraltet gekennzeichnet.",
		erhoben: "2026-09-12T12:10:00.000Z",
		bereiche: [
			{
				kuerzel: "1",
				gemeinden: [
					"Gemeinde Drochtersen",
					"Samtgemeinde Oldendorf-Himmelpforten",
					"Samtgemeinde Nordkehdingen",
				],
			},
			{ kuerzel: "2", gemeinden: ["Hansestadt Stade"] },
			{ kuerzel: "3", gemeinden: ["Hansestadt Buxtehude"] },
			{
				kuerzel: "4",
				gemeinden: [
					"Samtgemeinde Apensen",
					"Samtgemeinde Fredenbeck",
					"Samtgemeinde Harsefeld",
				],
			},
			{
				kuerzel: "5",
				gemeinden: [
					"Gemeinde Jork",
					"Samtgemeinde Horneburg",
					"Samtgemeinde Lühe",
				],
			},
		],
	},
	{
		termin: "2026",
		kreis: "rotenburg",
		quelle:
			"https://www.lk-row.de/downloads/datei/Y2ExMzNmMDcyODI3ZDg0NEFIaEZsSDlzTHBuREdzR3VjYjhIN2pSa0UybTZteGltYjdpaVhVQjBuSU1DemhYZ09PS2taTm5MZ1A1bjZ6b2ZBNTdBRnRmY2FGWm5RcjI3TmxEWEhHSVN5b3FPVm1TcFJzaXlqMFFEMGF6VUdPYVo1azRxZW9RRzJpWTQ5RElzK1YxenE3T1J3b1NxeisxSGxTRHFwTFJIejBNQXNQUUxZS1NZUG5XWTBKa2ExZHM0MksxTVVZWnZaWDFxc09wUg",
		dokument:
			"Wahlbekanntmachung des Kreiswahlleiters für die Kreiswahl und die Landratswahl am 13.09.2026, Ziffer 1.2, vom 30.01.2026",
		erhoben: "2026-09-12T12:10:00.000Z",
		bereiche: [
			{
				kuerzel: "1",
				gemeinden: [
					"Stadt Bremervörde",
					"Gemeinde Gnarrenburg",
					"Samtgemeinde Geestequelle",
					"Samtgemeinde Selsingen",
				],
			},
			{
				kuerzel: "2",
				gemeinden: [
					"Samtgemeinde Sittensen",
					"Samtgemeinde Tarmstedt",
					"Samtgemeinde Zeven",
				],
			},
			{
				kuerzel: "3",
				gemeinden: ["Stadt Rotenburg (Wümme)", "Samtgemeinde Sottrum"],
			},
			{
				kuerzel: "4",
				gemeinden: [
					"Stadt Visselhövede",
					"Gemeinde Scheeßel",
					"Samtgemeinde Bothel",
					"Samtgemeinde Fintel",
				],
			},
		],
	},
	{
		termin: "2026",
		kreis: "osterholz",
		quelle:
			"https://www.landkreis-osterholz.de/downloads/datei/YWQ5MzRmYjViZDk1NzM4OFZuMVdKeDhqS0liMXptRW9kV3RZOGlMbjl1SGhKZnNTT3JSS1NpWVQ4dmVqUEY4RUlTdldPTlVtZmNxUFFzWUlGQVdzdVZmamNYU3ZBclh6bzU1NC9LV2ZZazh1OGV5OWh1M0hpb0M2UDZ5YVhpOHZvWXhNNEd2ZFVPUVVSd05ucGxvejdGUGc2N21xT21IcTlnNVpjUzR5Y2ZEanRkRThWbkxxMkZ1ZEJaQT0",
		dokument:
			"Wahlbekanntmachung Nr. 1 der Kreiswahlleiterin nach § 16 Abs. 1 NKWG, Punkt 4, vom 26.03.2026; Kreistagsbeschluss vom 19.03.2026. Gegenüber 2021 neu zugeschnitten (vorher vier Wahlbereiche).",
		erhoben: "2026-09-12T12:10:00.000Z",
		bereiche: [
			{
				kuerzel: "1",
				gemeinden: ["Gemeinde Ritterhude", "Gemeinde Schwanewede"],
			},
			{
				kuerzel: "2",
				gemeinden: [
					"Gemeinde Lilienthal",
					"Gemeinde Grasberg",
					"Gemeinde Worpswede",
				],
			},
			{
				kuerzel: "3",
				gemeinden: ["Stadt Osterholz-Scharmbeck", "Samtgemeinde Hambergen"],
			},
		],
	},
	{
		termin: "2026",
		kreis: "verden",
		quelle:
			"https://www.landkreis-verden.de/downloads/datei/ODllZjM2ZGVhMWIwMDA2OUs2UUxHeGVnSTRVcVpFcDV5SWhlQ1BXMlY4ZStaWWd3VmpveFlUUm1OVFFxdms5Z3VwRUV6Y2xob0w1b3cxSHBlZnJCLzBHZXpJU3NieGMzcDZWOXQ5Z0JiRFdzdVp5bDB3WkdUbnBqU1hOK2owRjdaNzVWR3k0UlAvNlptcEl2ZHRsV2VPckp1UTh0eExQcGZjODJVdz09",
		dokument:
			"„Kreiswahl am 13.09.2026 – Wahlbekanntmachung Nr. 2“ nach § 16 NKWG, Ziffer 2; Kreistagsbeschluss vom 12.12.2025. Die Einteilung steht als vierspaltige Tabelle; die Spaltenzuordnung wurde über die Wort-Koordinaten geprüft.",
		erhoben: "2026-09-12T12:10:00.000Z",
		bereiche: [
			{ kuerzel: "A", gemeinden: ["Stadt Achim"] },
			{
				kuerzel: "B",
				gemeinden: ["Stadt Verden (Aller)", "Gemeinde Dörverden"],
			},
			{ kuerzel: "C", gemeinden: ["Gemeinde Oyten", "Flecken Ottersberg"] },
			{
				kuerzel: "D",
				gemeinden: [
					"Gemeinde Kirchlinteln",
					"Flecken Langwedel",
					"Samtgemeinde Thedinghausen",
				],
			},
		],
	},
	{
		termin: "2026",
		kreis: "wesermarsch",
		quelle:
			"https://wesermarsch.de/wp-content/uploads/2026/08/Bekanntmachung-Zulassung-Kreiswahl-1.pdf",
		dokument:
			"Öffentliche Bekanntmachung über die zugelassenen Wahlvorschläge für die Kreiswahl am 13.09.2026 (§ 28 Abs. 6 NKWG), vom 29.07.2026; die Gemeinden stehen in den Wahlbereichs-Überschriften ohne Zusatz Stadt/Gemeinde.",
		erhoben: "2026-09-12T12:10:00.000Z",
		bereiche: [
			{ kuerzel: "1", gemeinden: ["Nordenham"] },
			{ kuerzel: "2", gemeinden: ["Jade", "Butjadingen", "Stadland"] },
			{ kuerzel: "3", gemeinden: ["Brake", "Ovelgönne"] },
			{ kuerzel: "4", gemeinden: ["Berne", "Elsfleth", "Lemwerder"] },
		],
	},
	{
		termin: "2026",
		kreis: "emden",
		quelle:
			"https://www.emden.de/fileadmin/media/stadtemden/PDF/FB_200/FD_210_Verwaltungsdienste/2026-02-24_-_Kommunalwahl_Wahlbekanntmachung.pdf",
		dokument:
			"Wahlbekanntmachung der Wahlleitung zur Kommunalwahl am 13.09.2026 für das Wahlgebiet Stadt Emden (§ 16 NKWG), vom 24.02.2026. Abgegrenzt wird nach Wahlbezirken, nicht nach Stadtteilen.",
		erhoben: "2026-09-12T12:10:00.000Z",
		bereiche: [
			{
				kuerzel: "I",
				name: "West",
				gemeinden: ["Emden"],
				bezirke: [
					"10 – Harsweg",
					"20 – Conrebbersweg I",
					"25 – Conrebbersweg II",
					"30 – Larrelt",
					"40 – Constantia-West I",
					"45 – Constantia-West II",
					"230 – Port Arthur",
					"240 – Transvaal I",
					"245 – Constantia I",
					"246 – Constantia II",
					"250 – Transvaal II",
					"380 – Twixlum",
					"400 – Wybelsum",
				],
			},
			{
				kuerzel: "II",
				name: "Nord",
				gemeinden: ["Emden"],
				bezirke: [
					"60 – Barenburg",
					"70 – Grüner Weg",
					"80 – Stern-/Früchteburg",
					"100 – Bentinkshof",
					"110 – Boltentor",
					"120 – Förderschule",
					"130 – Neue Heimat",
					"160 – Wolthusen I",
					"170 – Wolthusen II",
					"175 – Wolthusen III",
					"180 – Uphusen/Marienwehr",
				],
			},
			{
				kuerzel: "III",
				name: "Ost",
				gemeinden: ["Emden"],
				bezirke: [
					"190 – Grundschule am Wall",
					"200 – Stadtmitte I",
					"210 – Stadtmitte II",
					"280 – Faldern",
					"300 – Herrentor",
					"310 – Herrentor II",
					"315 – Herrentor III",
					"320 – Friesland",
					"330 – Borssum I",
					"340 – Borssum II",
					"350 – Borssum III",
					"355 – Borssum IV",
					"360 – Widdelswehr",
					"370 – Petkum",
				],
			},
		],
	},
	{
		termin: "2026",
		kreis: "wilhelmshaven",
		quelle:
			"https://www.wilhelmshaven.de/PDF/Amtliche_Bekanntmachungen/17_2026_Elektronisches_Amtsblatt.pdf",
		dokument:
			"Amtsblatt für die Stadt Wilhelmshaven, Ausgabe 17/26 vom 10.03.2026, Wahlbekanntmachung des Gemeindewahlleiters, Abschnitt 3; Ratsbeschluss vom 17.12.2025",
		erhoben: "2026-09-12T12:10:00.000Z",
		bereiche: [
			{
				kuerzel: "Nord",
				gemeinden: ["Wilhelmshaven"],
				ortsteile: [
					"Himmelreich/Coldewei",
					"Rüstersiel",
					"Fedderwardergroden",
					"Voslapp",
					"Fedderwarden",
					"Sengwarden",
				],
			},
			{
				kuerzel: "West",
				gemeinden: ["Wilhelmshaven"],
				ortsteile: [
					"Neuende/Europaviertel",
					"Wiesenhof",
					"Aldenburg/Schaar",
					"Maadebogen",
					"Langewerth/ Maadetal",
					"Siebethsburg",
					"Altengroden",
				],
			},
			{
				kuerzel: "Ost",
				gemeinden: ["Wilhelmshaven"],
				ortsteile: [
					"Heppens",
					"Pädagogenviertel",
					"Tonndeich",
					"Villenviertel",
					"Neuengroden",
				],
			},
			{
				kuerzel: "Süd",
				gemeinden: ["Wilhelmshaven"],
				ortsteile: ["Innenstadt", "Bant"],
			},
		],
	},
	{
		termin: "2026",
		kreis: "aurich",
		quelle:
			"https://www.landkreis-aurich.de/wp-content/uploads/2026/02/Wahlbekanntmachung_Kreiswahl.pdf",
		dokument:
			"Wahlbekanntmachung des Kreiswahlleiters für die Kreiswahl am 13.09.2026 (§ 16 NKWG), vom 16.01.2026, Abschnitt II",
		erhoben: "2026-09-12T12:10:00.000Z",
		bereiche: [
			{ kuerzel: "I", gemeinden: ["Gemeinde Krummhörn", "Stadt Norden"] },
			{
				kuerzel: "II",
				gemeinden: [
					"Gemeinde Baltrum",
					"Gemeinde Dornum",
					"Gemeinde Großheide",
					"Samtgemeinde Hage",
					"Gemeinde Juist",
					"Stadt Norderney",
				],
			},
			{
				kuerzel: "III",
				gemeinden: [
					"Samtgemeinde Brookmerland",
					"Gemeinde Hinte",
					"Gemeinde Südbrookmerland",
				],
			},
			{ kuerzel: "IV", gemeinden: ["Stadt Aurich"] },
			{
				kuerzel: "V",
				gemeinden: ["Gemeinde Großefehn", "Gemeinde Ihlow", "Stadt Wiesmoor"],
			},
		],
	},
	{
		termin: "2026",
		kreis: "wittmund",
		quelle:
			"https://www.landkreis-wittmund.de/index.php?La=1&object=tx,3105.57697.1&kuo=2&sub=0",
		dokument:
			"Wahlbekanntmachung für die Kreiswahl am 13.09.2026 (§ 16 NKWG), veröffentlicht am 12.03.2026; Kreistagsbeschluss vom 29.09.2025. Gegengeprüft an der Bekanntmachung der zugelassenen Wahlvorschläge vom 27.07.2026.",
		erhoben: "2026-09-12T12:10:00.000Z",
		bereiche: [
			{ kuerzel: "I", gemeinden: ["Gemeinde Friedeburg"] },
			{
				kuerzel: "II",
				gemeinden: ["Stadt Wittmund"],
				ortsteile: ["Uttel", "Willen", "Wittmund"],
			},
			{
				kuerzel: "III",
				gemeinden: ["Stadt Wittmund"],
				ortsteile: [
					"Ardorf",
					"Asel",
					"Berdum",
					"Blersum",
					"Burhafe",
					"Buttforde",
					"Carolinensiel",
					"Eggelingen",
					"Funnix",
					"Hovel",
					"Leerhafe",
				],
			},
			{ kuerzel: "IV", gemeinden: ["Stadt Esens", "Gemeinde Langeoog"] },
			{
				kuerzel: "V",
				gemeinden: [
					"Gemeinde Dunum",
					"Gemeinde Holtgast",
					"Gemeinde Moorweg",
					"Gemeinde Neuharlingersiel",
					"Gemeinde Stedesdorf",
					"Gemeinde Werdum",
					"Gemeinde Spiekeroog",
				],
			},
			{ kuerzel: "VI", gemeinden: ["Samtgemeinde Holtriem"] },
		],
	},
	{
		termin: "2026",
		kreis: "friesland",
		quelle:
			"https://www.friesland.de/portal/seiten/wahlen-901000341-20800.html",
		dokument:
			"Wahlbekanntmachung des Kreiswahlleiters für die Kommunalwahlen am 13.09.2026 im Landkreis Friesland, Abschnitt A „Wahl des Kreistages (Kreiswahl)“, vom 06.05.2026; dort als Download verlinkt",
		erhoben: "2026-09-12T12:10:00.000Z",
		bereiche: [
			{ kuerzel: "I", gemeinden: ["Stadt Varel"] },
			{ kuerzel: "II", gemeinden: ["Gemeinde Bockhorn", "Gemeinde Zetel"] },
			{ kuerzel: "III", gemeinden: ["Stadt Schortens", "Gemeinde Sande"] },
			{
				kuerzel: "IV",
				gemeinden: [
					"Stadt Jever",
					"Gemeinde Wangerland",
					"Gemeinde Wangerooge",
				],
			},
		],
	},
	{
		termin: "2026",
		kreis: "leer",
		quelle:
			"https://www.landkreis-leer.de/output/download.php?fid=3399.7145.1.PDF",
		dokument:
			"Wahlbekanntmachung und Aufforderung zur Einreichung von Wahlvorschlägen zur Kreiswahl am 13.09.2026 (§ 16 NKWG), vom 24.03.2026, Abschnitt III. Das Dokument stellt fest, die Grenzen der Wahlbereiche stimmten mit den Gemeindegrenzen überein.",
		erhoben: "2026-09-12T12:10:00.000Z",
		bereiche: [
			{ kuerzel: "I", gemeinden: ["Leer"] },
			{ kuerzel: "II", gemeinden: ["Hesel", "Moormerland"] },
			{ kuerzel: "III", gemeinden: ["Jümme", "Uplengen", "Ostrhauderfehn"] },
			{ kuerzel: "IV", gemeinden: ["Borkum", "Bunde", "Jemgum", "Weener"] },
			{ kuerzel: "V", gemeinden: ["Rhauderfehn", "Westoverledingen"] },
		],
	},
	{
		termin: "2026",
		kreis: "ammerland",
		quelle:
			"https://www.ammerland.de/loadDocument.phtml?FID=2843.8610.1&Ext=PDF",
		dokument:
			"Gemeinsame Wahlbekanntmachung für die Kommunalwahlen am 13.09.2026 (§ 16 NKWG), Ziffer 2 a); verlinkt unter https://www.ammerland.de/Aktuelles/Topthemen/Kommunalwahl/",
		erhoben: "2026-09-12T12:10:00.000Z",
		bereiche: [
			{ kuerzel: "I", gemeinden: ["Gemeinde Apen", "Gemeinde Wiefelstede"] },
			{ kuerzel: "II", gemeinden: ["Gemeinde Bad Zwischenahn"] },
			{ kuerzel: "III", gemeinden: ["Gemeinde Edewecht"] },
			{ kuerzel: "IV", gemeinden: ["Gemeinde Rastede"] },
			{ kuerzel: "V", gemeinden: ["Stadt Westerstede"] },
		],
	},
	{
		termin: "2026",
		kreis: "region-hannover",
		quelle:
			"https://bekanntmachungen.region-hannover.de/Weitere-orts%C3%BCbliche-Bekanntmachungen/%C3%96ffentliche-Wahlbekanntmachung-Nr.-1-der-Regionswahlleitung-der-Region-Hannover",
		dokument:
			"Öffentliche Wahlbekanntmachung Nr. 1 der Regionswahlleitung (§ 16 NKWG); Einteilung durch Beschluss der Regionsversammlung vom 11.11.2025. Die Online-Fassung nennt kein Ausfertigungsdatum.",
		erhoben: "2026-09-12T12:15:00.000Z",
		bereiche: [
			{
				kuerzel: "01",
				name: "Hannover - Mitte",
				gemeinden: ["Hannover"],
				ortsteile: [
					"Mitte",
					"Calenberger Neustadt",
					"Nordstadt",
					"Südstadt",
					"Bult",
					"Zoo",
					"Oststadt",
				],
			},
			{
				kuerzel: "02",
				name: "Hannover - Nord",
				gemeinden: ["Hannover"],
				ortsteile: ["List", "Vahrenwald", "Vahrenheide", "Sahlkamp"],
			},
			{
				kuerzel: "03",
				name: "Hannover - Nordwest",
				gemeinden: ["Hannover"],
				ortsteile: [
					"Hainholz",
					"Herrenhausen",
					"Burg",
					"Leinhausen",
					"Ledeburg",
					"Stöcken",
					"Marienwerder",
					"Nordhafen",
					"Davenstedt",
					"Badenstedt",
					"Ahlem",
					"Vinnhorst",
					"Brink-Hafen",
				],
			},
			{
				kuerzel: "04",
				name: "Hannover - Nordost",
				gemeinden: ["Hannover"],
				ortsteile: [
					"Bothfeld",
					"Lahe",
					"Groß-Buchholz",
					"Isernhagen-Süd",
					"Misburg-Nord",
					"Misburg-Süd",
					"Anderten",
				],
			},
			{
				kuerzel: "05",
				name: "Hannover - Südost",
				gemeinden: ["Hannover"],
				ortsteile: [
					"Waldhausen",
					"Waldheim",
					"Kleefeld",
					"Heideviertel",
					"Kirchrode",
					"Döhren",
					"Seelhorst",
					"Wülfel",
					"Mittelfeld",
					"Bemerode",
					"Wülferode",
				],
			},
			{
				kuerzel: "06",
				name: "Hannover - Südwest",
				gemeinden: ["Hannover"],
				ortsteile: [
					"Linden-Nord",
					"Linden-Mitte",
					"Linden-Süd",
					"Limmer",
					"Bornum",
					"Ricklingen",
					"Oberricklingen",
					"Mühlenberg",
					"Wettbergen",
				],
			},
			{
				kuerzel: "07",
				name: "Springe",
				gemeinden: [
					"Stadt Hemmingen",
					"Stadt Ronnenberg",
					"Stadt Springe",
					"Gemeinde Wennigsen (Deister)",
				],
			},
			{
				kuerzel: "08",
				name: "Laatzen",
				gemeinden: ["Stadt Laatzen", "Stadt Pattensen", "Stadt Sehnde"],
			},
			{
				kuerzel: "09",
				name: "Lehrte",
				gemeinden: ["Stadt Burgdorf", "Stadt Lehrte", "Gemeinde Uetze"],
			},
			{
				kuerzel: "10",
				name: "Langenhagen",
				gemeinden: [
					"Stadt Burgwedel",
					"Gemeinde Isernhagen",
					"Stadt Langenhagen",
				],
			},
			{
				kuerzel: "11",
				name: "Garbsen",
				gemeinden: ["Stadt Garbsen", "Gemeinde Wedemark"],
			},
			{
				kuerzel: "12",
				name: "Neustadt",
				gemeinden: ["Stadt Neustadt am Rübenberge", "Stadt Wunstorf"],
			},
			{
				kuerzel: "13",
				name: "Barsinghausen",
				gemeinden: ["Stadt Barsinghausen", "Stadt Gehrden", "Stadt Seelze"],
			},
		],
	},
	{
		termin: "2026",
		kreis: "celle",
		quelle: "https://www.landkreis-celle.de/media/custom/3314_4177_1.PDF",
		dokument:
			"Wahlbekanntmachung der Kreiswahlleitung für die Kreiswahl am 13.09.2026 (§ 16 NKWG), vom 02.02.2026; Kreistagsbeschluss vom 30.10.2025",
		erhoben: "2026-09-12T12:15:00.000Z",
		bereiche: [
			{
				kuerzel: "1",
				name: "Stadt Celle Ost",
				gemeinden: ["Stadt Celle"],
				ortsteile: [
					"Altencelle",
					"Altenhagen/Bostel/Lachtehausen",
					"Blumlage/Altstadt",
					"Garßen",
					"Hehlentor",
					"Vorwerk",
					"Westercelle",
				],
			},
			{
				kuerzel: "2",
				name: "Stadt Celle West",
				gemeinden: ["Stadt Celle"],
				ortsteile: [
					"Boye",
					"Groß Hehlen/Hustedt/Scheuen",
					"Klein Hehlen",
					"Neuenhäusen",
					"Neustadt/Heese",
					"Wietzenbruch",
				],
			},
			{
				kuerzel: "3",
				gemeinden: [
					"Gemeinde Hambühren",
					"Gemeinde Wietze",
					"Gemeinde Winsen (Aller)",
				],
			},
			{
				kuerzel: "4",
				gemeinden: [
					"Stadt Bergen",
					"Gemeinde Eschede",
					"Gemeinde Faßberg",
					"Gemeinde Südheide",
					"Gemeindefreier Bezirk Lohheide",
				],
			},
			{
				kuerzel: "5",
				gemeinden: [
					"Samtgemeinde Flotwedel",
					"Samtgemeinde Lachendorf",
					"Samtgemeinde Wathlingen",
				],
			},
		],
	},
	{
		termin: "2026",
		kreis: "uelzen",
		quelle:
			"https://www.landkreis-uelzen.de/desktopdefault.aspx/tabid-39/112_read-18558/",
		dokument:
			"Wahlbekanntmachung für die Kreiswahl und die damit verbundene Direktwahl am 13.09.2026, Abschnitt III (§ 16 NKWG), vom 04.03.2026; Einteilung laut Kreistagssitzung vom 16.12.2025",
		erhoben: "2026-09-12T12:15:00.000Z",
		bereiche: [
			{ kuerzel: "1", gemeinden: ["Hansestadt Uelzen"] },
			{
				kuerzel: "2",
				gemeinden: ["Samtgemeinde Bevensen-Ebstorf", "Gemeinde Bienenbüttel"],
			},
			{
				kuerzel: "3",
				gemeinden: [
					"Samtgemeinde Aue",
					"Samtgemeinde Rosche",
					"Samtgemeinde Suderburg",
				],
			},
		],
	},
	{
		termin: "2026",
		kreis: "heidekreis",
		quelle:
			"https://www.heidekreis.de/_Resources/Persistent/d/8/c/0/d8c065d05f0b9369dab424b678ad23971fde3191/Amtsblatt%2020_2025.pdf",
		dokument:
			"Amtsblatt für den Landkreis Heidekreis Nr. 20/2025 vom 18.12.2025, S. 1, Wahlbekanntmachung zur Kreiswahl am 13.09.2026 (§ 16 NKWG)",
		erhoben: "2026-09-12T12:15:00.000Z",
		bereiche: [
			{
				kuerzel: "1",
				gemeinden: [
					"Stadt Schneverdingen",
					"Gemeinde Bispingen",
					"Gemeinde Neuenkirchen",
					"Gemeinde Wietzendorf",
				],
			},
			{ kuerzel: "2", gemeinden: ["Stadt Munster", "Stadt Soltau"] },
			{
				kuerzel: "3",
				gemeinden: [
					"Stadt Bad Fallingbostel",
					"Gemeindefreier Bezirk Osterheide",
					"Samtgemeinde Ahlden",
					"Samtgemeinde Rethem",
					"Samtgemeinde Schwarmstedt",
				],
			},
			{ kuerzel: "4", gemeinden: ["Stadt Walsrode"] },
		],
	},
	{
		termin: "2026",
		kreis: "harburg",
		quelle:
			"https://www.landkreis-harburg.de/portal/seiten/kommunalwahlen-2026-901007463-20100.html",
		dokument:
			"Wahlbekanntmachung für die Kreiswahl im Landkreis Harburg am 13.09.2026, vom 08.01.2026, dort als „Wahlbekanntmachung (Wahlbereiche)“ verlinkt. Eine aktualisierte Fassung vom 05.05.2026 ändert nur einzelne Wahlbezirke, nicht die Zuordnung der Gemeinden.",
		erhoben: "2026-09-12T12:15:00.000Z",
		bereiche: [
			{
				kuerzel: "1",
				gemeinden: ["Stadt Winsen (Luhe)", "Samtgemeinde Elbmarsch"],
				bezirke: ["Stadt Winsen-Nord"],
			},
			{
				kuerzel: "2",
				gemeinden: ["Stadt Winsen (Luhe)", "Gemeinde Stelle"],
				bezirke: ["Stadt Winsen-Süd"],
			},
			{
				kuerzel: "3",
				gemeinden: ["Samtgemeinde Salzhausen", "Samtgemeinde Hanstedt"],
			},
			{
				kuerzel: "4",
				name: "Gemeinde Seevetal-Süd",
				gemeinden: ["Gemeinde Seevetal"],
				ortsteile: [
					"Fleestedt",
					"Beckedorf",
					"Glüsingen",
					"Metzendorf",
					"Hittfeld",
					"Heimstorf",
					"Lindhorst",
					"Emmelndorf",
					"Over",
					"Bullenhausen",
					"Groß-Moor",
					"Holtorfsloh",
					"Ohlendorf",
					"Ramelsloh",
				],
			},
			{
				kuerzel: "5",
				name: "Gemeinde Seevetal-Nord",
				gemeinden: ["Gemeinde Seevetal"],
				ortsteile: ["Meckelfeld", "Klein-Moor", "Maschen", "Horst", "Hörsten"],
			},
			{
				kuerzel: "6",
				gemeinden: ["Gemeinde Rosengarten", "Samtgemeinde Hollenstedt"],
			},
			{ kuerzel: "7", gemeinden: ["Gemeinde Neu Wulmstorf"] },
			{
				kuerzel: "8",
				gemeinden: ["Stadt Buchholz in der Nordheide"],
				bezirke: ["Stadt Buchholz-Nordwest"],
			},
			{
				kuerzel: "9",
				gemeinden: [
					"Stadt Buchholz in der Nordheide",
					"Samtgemeinde Jesteburg",
				],
				bezirke: ["Stadt Buchholz-Südost"],
			},
			{ kuerzel: "10", gemeinden: ["Samtgemeinde Tostedt"] },
		],
	},
	{
		termin: "2026",
		kreis: "lueneburg",
		quelle:
			"https://www.landkreis-lueneburg.de/_Resources/Persistent/b/f/d/f/bfdfecd5d578ccf96011c4c889aa0d43d0aa0c3c/Wahlbekanntmachung%20Kreiswahl%2013.09.2026.pdf",
		dokument:
			"Wahlbekanntmachung zur Kreiswahl am 13.09.2026 (§ 16 NKWG), vom 02.12.2025, auch im Amtsblatt Nr. 13.2025 vom 05.12.2025, S. 391. Das Dokument sagt selbst, die Ortsteile der Wahlbereiche 1 und 2 ließen nur eine grobe Orientierung zu; die genaue Grenze innerhalb der Hansestadt ist straßenscharf und liegt beim Landkreis aus.",
		erhoben: "2026-09-12T12:15:00.000Z",
		bereiche: [
			{
				kuerzel: "1",
				name: "Hansestadt Lüneburg Nord",
				gemeinden: ["Hansestadt Lüneburg"],
				ortsteile: [
					"Östliche Altstadt",
					"Westliche Altstadt",
					"Ebensberg",
					"Goseburg-Zeltberg",
					"Kreideberg",
					"Lüne-Moorfeld",
					"Ochtmissen",
				],
			},
			{
				kuerzel: "2",
				name: "Hansestadt Lüneburg Süd",
				gemeinden: ["Hansestadt Lüneburg"],
				ortsteile: [
					"Bockelsberg",
					"Häcklingen",
					"Hagen",
					"Kaltenmoor",
					"Klosterkamp",
					"Oedeme",
					"Rettmer",
					"Rotes Feld",
					"Wilschenbruch",
				],
			},
			{
				kuerzel: "3",
				gemeinden: [
					"Samtgemeinde Amelinghausen",
					"Samtgemeinde Gellersen",
					"Samtgemeinde Ilmenau",
				],
			},
			{
				kuerzel: "4",
				gemeinden: [
					"Gemeinde Adendorf",
					"Samtgemeinde Bardowick",
					"Samtgemeinde Ostheide",
				],
			},
			{
				kuerzel: "5",
				gemeinden: [
					"Stadt Bleckede",
					"Gemeinde Amt Neuhaus",
					"Samtgemeinde Dahlenburg",
					"Samtgemeinde Scharnebeck",
				],
			},
		],
	},
	{
		termin: "2026",
		kreis: "luechow-dannenberg",
		quelle:
			"https://www.luechow-dannenberg.de/medien/dokumente/amtsblatt_nr._11_vom_26.03.2026.pdf",
		dokument:
			"Elektronisches Amtsblatt für den Landkreis Lüchow-Dannenberg Nr. 11 vom 26.03.2026, Wahlbekanntmachung für die Kreiswahl und die Landratswahl am 13.09.2026, Ziffer 1.2, vom 24.03.2026",
		erhoben: "2026-09-12T12:15:00.000Z",
		bereiche: [
			{
				kuerzel: "I",
				name: "Nord",
				gemeinden: ["Samtgemeinde Elbtalaue", "Samtgemeinde Gartow"],
			},
			{
				kuerzel: "II",
				name: "Süd",
				gemeinden: ["Samtgemeinde Lüchow (Wendland)"],
			},
		],
	},
	{
		termin: "2026",
		kreis: "northeim",
		quelle:
			"https://landkreis-northeim.de/medien/dokumente/wahlbekanntmachung_aufforferungwahlvorschlaege.pdf",
		dokument:
			"Wahlbekanntmachung und Aufforderung zur Einreichung von Wahlvorschlägen für die Kreiswahl am 13.09.2026 (§§ 16, 45 Abs. 4 NKWG), vom 05.02.2026. Einbeck und Northeim sind straßenscharf aufgeteilt; das gemeindefreie Gebiet Solling nennt die Bekanntmachung – anders als 2021 – keinem Wahlbereich zugeordnet.",
		erhoben: "2026-09-12T12:20:00.000Z",
		bereiche: [
			{
				kuerzel: "I",
				gemeinden: ["Bad Gandersheim", "Einbeck", "Kalefeld"],
				bezirke: ["Einbeck 3"],
			},
			{
				kuerzel: "II",
				gemeinden: ["Dassel", "Einbeck"],
				bezirke: ["Einbeck 2"],
			},
			{
				kuerzel: "III",
				gemeinden: ["Einbeck", "Moringen"],
				bezirke: ["Einbeck 1"],
			},
			{
				kuerzel: "IV",
				gemeinden: ["Katlenburg-Lindau", "Northeim"],
				bezirke: ["Northeim 2"],
			},
			{
				kuerzel: "V",
				gemeinden: ["Nörten Hardenberg", "Northeim"],
				bezirke: ["Northeim 1"],
			},
			{ kuerzel: "VI", gemeinden: ["Bodenfelde", "Hardegsen", "Uslar"] },
		],
	},
	{
		termin: "2026",
		kreis: "goettingen",
		quelle:
			"https://www.landkreisgoettingen.de/loadDocument.phtml?FID=4093.10981.1&Ext=PDF",
		dokument:
			"Öffentliche Bekanntmachung „Kreiswahl im Landkreis Göttingen am 13.09.2026“ (§ 16 NKWG), Az. 10.1/12 91 22/2026, vom 19.03.2026. Welche Stadtteile zu Göttingen Ost, Süd, West, Nord und Mitte gehören, sagt die Bekanntmachung nicht; die einschlägige Vorlage im Ratsinformationssystem war nicht erreichbar.",
		erhoben: "2026-09-12T12:20:00.000Z",
		bereiche: [
			{ kuerzel: "1", name: "Göttingen Ost", gemeinden: ["Stadt Göttingen"] },
			{ kuerzel: "2", name: "Göttingen Süd", gemeinden: ["Stadt Göttingen"] },
			{ kuerzel: "3", name: "Göttingen West", gemeinden: ["Stadt Göttingen"] },
			{ kuerzel: "4", name: "Göttingen Nord", gemeinden: ["Stadt Göttingen"] },
			{ kuerzel: "5", name: "Göttingen Mitte", gemeinden: ["Stadt Göttingen"] },
			{ kuerzel: "6", gemeinden: ["Stadt Hann. Münden"] },
			{
				kuerzel: "7",
				gemeinden: [
					"Gemeinde Rosdorf",
					"Samtgemeinde Dransfeld",
					"Gemeinde Staufenberg",
				],
			},
			{
				kuerzel: "8",
				gemeinden: [
					"Flecken Adelebsen",
					"Flecken Bovenden",
					"Gemeinde Friedland",
				],
			},
			{
				kuerzel: "9",
				gemeinden: ["Samtgemeinde Gieboldehausen", "Gemeinde Gleichen"],
			},
			{
				kuerzel: "10",
				gemeinden: ["Stadt Duderstadt", "Samtgemeinde Radolfshausen"],
			},
			{ kuerzel: "11", gemeinden: ["Stadt Osterode am Harz"] },
			{
				kuerzel: "12",
				gemeinden: [
					"Gemeinde Bad Grund",
					"Samtgemeinde Hattorf am Harz",
					"Stadt Herzberg am Harz",
				],
			},
			{
				kuerzel: "13",
				gemeinden: [
					"Stadt Bad Lauterberg im Harz",
					"Stadt Bad Sachsa",
					"Gemeinde Walkenried",
				],
			},
		],
	},
	{
		termin: "2026",
		kreis: "holzminden",
		quelle:
			"https://www.landkreis-holzminden.de/portal/seiten/wahlen-900000021-25600.html",
		dokument:
			"Amtliche Wahlseite des Landkreises („Für die Kreiswahl wurden die drei folgenden Wahlbereiche gebildet“); wortgleich bestätigt im Digitalen Amtsblatt Nr. 25 vom 28.07.2026, lfd. Nr. 42, Bekanntmachung über die zugelassenen Wahlvorschläge vom 24.07.2026",
		erhoben: "2026-09-12T12:20:00.000Z",
		bereiche: [
			{
				kuerzel: "I",
				gemeinden: ["Samtgemeinde Bodenwerder-Polle", "Samtgemeinde Bevern"],
			},
			{
				kuerzel: "II",
				gemeinden: [
					"Samtgemeinde Eschershausen-Stadtoldendorf",
					"Flecken Delligsen",
				],
			},
			{
				kuerzel: "III",
				gemeinden: ["Stadt Holzminden", "Samtgemeinde Boffzen"],
			},
		],
	},
	{
		termin: "2026",
		kreis: "hameln-pyrmont",
		quelle: "https://hameln-pyrmont.de/media/custom/3767_3005_1.PDF",
		dokument:
			"Amtsblatt für den Landkreis Hameln-Pyrmont, Ausgabe 01/2026 vom 05.01.2026, Amtliche Bekanntmachung zur Kommunalwahl am 13.09.2026 (§§ 16, 45b Abs. 4 NKWG), Abschnitt c.2. Die Stadt Hameln ist nach Wahlbezirksnummern aufgeteilt, nicht nach Stadtteilen.",
		erhoben: "2026-09-12T12:20:00.000Z",
		bereiche: [
			{ kuerzel: "1", name: "Bad Pyrmont", gemeinden: ["Stadt Bad Pyrmont"] },
			{
				kuerzel: "2",
				name: "Aerzen/Emmerthal",
				gemeinden: ["Flecken Aerzen", "Gemeinde Emmerthal"],
			},
			{
				kuerzel: "3",
				name: "Coppenbrügge/Salzhemmendorf",
				gemeinden: ["Flecken Coppenbrügge", "Flecken Salzhemmendorf"],
			},
			{
				kuerzel: "4",
				name: "Hameln I",
				gemeinden: ["Stadt Hameln"],
				bezirke: ["Wahlbezirke 10 bis 17 und 60 bis 67"],
			},
			{
				kuerzel: "5",
				name: "Hameln II",
				gemeinden: ["Stadt Hameln"],
				bezirke: ["Wahlbezirke 40 bis 48 und 50 bis 56"],
			},
			{
				kuerzel: "6",
				name: "Hameln III",
				gemeinden: ["Stadt Hameln"],
				bezirke: ["Wahlbezirke 20 bis 27 und 30 bis 38"],
			},
			{
				kuerzel: "7",
				name: "Hessisch Oldendorf",
				gemeinden: ["Stadt Hessisch Oldendorf"],
			},
			{
				kuerzel: "8",
				name: "Bad Münder",
				gemeinden: ["Stadt Bad Münder am Deister"],
			},
		],
	},
	{
		termin: "2026",
		kreis: "schaumburg",
		quelle:
			"https://www.schaumburg.de/index.php?object=tx,3020.5&ModID=7&FID=3020.33628.1",
		dokument:
			"Wahlbekanntmachung zur Kreiswahl im Landkreis Schaumburg am 13.09.2026 (§ 16 NKWG), Ziffer II, veröffentlicht am 18.12.2025",
		erhoben: "2026-09-12T12:20:00.000Z",
		bereiche: [
			{ kuerzel: "1", gemeinden: ["Stadt Rinteln"] },
			{
				kuerzel: "2",
				gemeinden: ["Stadt Stadthagen", "Samtgemeinde Niedernwöhren"],
			},
			{
				kuerzel: "3",
				gemeinden: ["Stadt Bückeburg", "Samtgemeinde Eilsen"],
			},
			{
				kuerzel: "4",
				gemeinden: ["Samtgemeinde Nenndorf", "Samtgemeinde Sachsenhagen"],
			},
			{
				kuerzel: "5",
				gemeinden: [
					"Stadt Obernkirchen",
					"Gemeinde Auetal",
					"Samtgemeinde Nienstädt",
				],
			},
			{
				kuerzel: "6",
				gemeinden: ["Samtgemeinde Lindhorst", "Samtgemeinde Rodenberg"],
			},
		],
	},
	{
		termin: "2026",
		kreis: "nienburg",
		quelle:
			"https://www.lk-nienburg.de/downloads/datei/ZjE1N2ZkYjg5NzE2MmJlZFJFWDF2M0J1dHVFTXMyekdnKzBmdDZ6eFdGSDR0NFUrR3BWRllOYlZMN3BKVTBvaS9Sa3FwSjRTS3Y4OHJkUFhSekVabUVua3JIQWp2MlQra0hBUERWWDBOVHZOTG9vQ1hSWVp5YmtDbVVBVHhDN3BHS2FKRzdRdHE5SXh2TmMy",
		dokument:
			"Amtsblatt für den Landkreis Nienburg/Weser, Ausgabe Nr. 1 vom 06.01.2026, S. 5, Öffentliche Bekanntmachung des Kreiswahlleiters, Ziffer IV; Kreistagsbeschluss vom 12.12.2025, drei Wahlbereiche. Die im Netz auffindbare Vierer-Einteilung stammt aus der Bekanntmachung zur Kreiswahl 2016 und gilt für 2026 nicht.",
		erhoben: "2026-09-12T12:20:00.000Z",
		bereiche: [
			{
				kuerzel: "I",
				gemeinden: ["Stadt Nienburg/Weser", "Samtgemeinde Steimbke"],
			},
			{
				kuerzel: "II",
				gemeinden: [
					"Samtgemeinde Grafschaft Hoya",
					"Samtgemeinde Heemsen",
					"Samtgemeinde Weser-Aue",
				],
			},
			{
				kuerzel: "III",
				gemeinden: [
					"Samtgemeinde Mittelweser",
					"Stadt Rehburg-Loccum",
					"Flecken Steyerberg",
					"Samtgemeinde Uchte",
				],
			},
		],
	},
	{
		termin: "2026",
		kreis: "diepholz",
		quelle:
			"https://www.diepholz.de/portal/bekanntmachungen/kommunalwahl-am-13-september-2026-900010987-21750.html",
		dokument:
			"Wahlbekanntmachung und Aufforderung zur Einreichung von Wahlvorschlägen für die Kreiswahl im Landkreis Diepholz am 13.09.2026 (§ 16 NKWG), Ziffer 2, vom 30.01.2026; Kreistagsbeschluss vom 08.12.2025",
		erhoben: "2026-09-12T12:20:00.000Z",
		bereiche: [
			{ kuerzel: "1", gemeinden: ["Gemeinde Stuhr"] },
			{ kuerzel: "2", gemeinden: ["Gemeinde Weyhe"] },
			{
				kuerzel: "3",
				gemeinden: ["Stadt Syke", "Samtgemeinde Bruchhausen-Vilsen"],
			},
			{
				kuerzel: "4",
				gemeinden: [
					"Stadt Bassum",
					"Stadt Twistringen",
					"Samtgemeinde Barnstorf",
				],
			},
			{
				kuerzel: "5",
				gemeinden: [
					"Stadt Sulingen",
					"Samtgemeinde Kirchdorf",
					"Samtgemeinde Schwaförden",
					"Samtgemeinde Siedenburg",
				],
			},
			{
				kuerzel: "6",
				gemeinden: [
					"Stadt Diepholz",
					"Gemeinde Wagenfeld",
					"Samtgemeinde „Altes Amt Lemförde“",
					"Samtgemeinde Rehden",
				],
			},
		],
	},
	{
		termin: "2026",
		kreis: "oldenburg-stadt",
		quelle:
			"https://www.oldenburg.de/fileadmin/oldenburg/Benutzer/Dateien/22_Rechtsamt/Bekanntmachungen/20260724-Zulassung_Wahlvorschlaege.pdf",
		dokument:
			"Bekanntmachung über die zugelassenen Wahlvorschläge, Wahlausschuss vom 23.07.2026; Ratsbeschluss vom 27.10.2025 (Vorlage 25/0681) legt sechs Wahlbereiche fest, ohne sie zu beschreiben. Welche Stadtteile zu welchem Wahlbereich gehören, sagt kein amtliches Dokument der Stadt; die Anlage ist eine Karte ohne Stadtteilnamen.",
		erhoben: "2026-09-12T12:25:00.000Z",
		bereiche: [
			{ kuerzel: "I", name: "Stadtmitte Nord", gemeinden: ["Oldenburg"] },
			{ kuerzel: "II", name: "Stadtmitte Süd", gemeinden: ["Oldenburg"] },
			{ kuerzel: "III", name: "Nordwest", gemeinden: ["Oldenburg"] },
			{ kuerzel: "IV", name: "Nordost", gemeinden: ["Oldenburg"] },
			{ kuerzel: "V", name: "Süd", gemeinden: ["Oldenburg"] },
			{ kuerzel: "VI", name: "Südwest", gemeinden: ["Oldenburg"] },
		],
	},
	{
		termin: "2026",
		kreis: "oldenburg-land",
		quelle:
			"https://votemanager.kdo.de/20260913/03458000/daten/opendata/Open-Data-03458000-Kreiswahl-Landkreis-Oldenburg-Wahlbereiche.csv",
		dokument:
			"Offene Daten der Wahlleitung zur Kreiswahl 2026, Gebietsnamen der Wahlbereichsebene; wortgleich mit der Bekanntmachung über die zugelassenen Wahlvorschläge (Kreiswahlausschuss vom 23.07.2026)",
		erhoben: "2026-09-12T12:25:00.000Z",
		bereiche: [
			{ kuerzel: "1", gemeinden: ["Gemeinde Ganderkesee"] },
			{
				kuerzel: "2",
				gemeinden: [
					"Gemeinde Dötlingen",
					"Samtgemeinde Harpstedt",
					"Stadt Wildeshausen",
				],
			},
			{ kuerzel: "3", gemeinden: ["Gemeinde Hatten", "Gemeinde Hude"] },
			{
				kuerzel: "4",
				gemeinden: ["Gemeinde Großenkneten", "Gemeinde Wardenburg"],
			},
		],
	},
	{
		termin: "2026",
		kreis: "cloppenburg",
		quelle:
			"https://www.lkclp.de/uploads/client/pms/files/ktw_2026_wahlbekanntmachung.pdf",
		dokument:
			"Wahlbekanntmachung zur Kreistagswahl am 13.09.2026, Abschnitt II „Zahl und Abgrenzung der Wahlbereiche“; Kreistagsbeschluss vom 18.12.2025. Die Bekanntmachung der zugelassenen Wahlvorschläge nummeriert dieselben Gebiete in derselben Reihenfolge.",
		erhoben: "2026-09-12T12:25:00.000Z",
		bereiche: [
			{ kuerzel: "I", gemeinden: ["Barßel", "Saterland"] },
			{ kuerzel: "II", gemeinden: ["Friesoythe"] },
			{ kuerzel: "III", gemeinden: ["Bösel", "Garrel", "Molbergen"] },
			{ kuerzel: "IV", gemeinden: ["Cloppenburg"] },
			{ kuerzel: "V", gemeinden: ["Cappeln", "Emstek", "Essen"] },
			{ kuerzel: "VI", gemeinden: ["Löningen", "Lastrup", "Lindern"] },
		],
	},
	{
		termin: "2026",
		kreis: "vechta",
		quelle:
			"https://www.landkreis-vechta.de/fileadmin/Downloads/10/Wahlen/Amtsblatt_15_Wahlbekanntmachung.pdf",
		dokument:
			"Amtsblatt für den Landkreis Vechta Nr. 15/2026, verkündet am 31.03.2026, Wahlbekanntmachung für die Kreistagswahl am 13.09.2026; Kreistagsbeschluss vom 09.10.2025",
		erhoben: "2026-09-12T12:25:00.000Z",
		bereiche: [
			{
				kuerzel: "I",
				gemeinden: [
					"Gemeinde Bakum",
					"Gemeinde Goldenstedt",
					"Gemeinde Visbek",
				],
			},
			{ kuerzel: "II", gemeinden: ["Stadt Vechta"] },
			{ kuerzel: "III", gemeinden: ["Stadt Lohne"] },
			{
				kuerzel: "IV",
				gemeinden: ["Stadt Dinklage", "Gemeinde Holdorf", "Gemeinde Steinfeld"],
			},
			{
				kuerzel: "V",
				gemeinden: ["Stadt Damme", "Gemeinde Neuenkirchen-Vörden"],
			},
		],
	},
	{
		termin: "2026",
		kreis: "emsland",
		quelle:
			"https://www.emsland.de/pdf_files/politik/wahlbereichseinteilung-2026_8328_1.pdf",
		dokument:
			"Karte „Wahlbereichseinteilung Kreiswahl 2026“ des Landkreises, verlinkt als „10 Wahlbereiche“ unter https://www.emsland.de/das-emsland/politik/wahlen/wahlen.html. Eine Wahlbekanntmachung mit Textabgrenzung war nicht auffindbar; die Zuordnung steht in den Farbflächen der Karte. Das eingebettete Hintergrundbild trägt im Original die Überschrift „Kreiswahl 2006“, überlagert von der Zeile „Kreiswahl 2026“.",
		erhoben: "2026-09-12T12:25:00.000Z",
		bereiche: [
			{ kuerzel: "1", gemeinden: ["Papenburg"] },
			{
				kuerzel: "2",
				gemeinden: ["Rhede (Ems)", "SG Dörpen", "SG Nordhümmling"],
			},
			{ kuerzel: "3", gemeinden: ["SG Sögel", "SG Werlte"] },
			{ kuerzel: "4", gemeinden: ["SG Lathen", "Haren (Ems)"] },
			{ kuerzel: "5", gemeinden: ["Meppen"] },
			{ kuerzel: "6", gemeinden: ["Twist", "Geeste", "Haselünne"] },
			{ kuerzel: "7", gemeinden: ["Emsbüren", "SG Spelle", "Salzbergen"] },
			{ kuerzel: "8", gemeinden: ["SG Herzlake", "SG Lengerich", "SG Freren"] },
			{ kuerzel: "9", gemeinden: ["Lingen (Ems)"] },
			{ kuerzel: "10", gemeinden: ["Lingen (Ems)"] },
		],
	},
	{
		termin: "2026",
		kreis: "grafschaft-bentheim",
		quelle:
			"https://www.grafschaft-bentheim.de/grafschaft-wAssets/docs/buergerservice-kreishaus-politik/kommunalwahl/Wahlbekanntmachung-nach-16-und-45b-NKWG.pdf",
		dokument:
			"Wahlbekanntmachung nach §§ 16, 45b NKWG, Abschnitt „Zahl und Abgrenzung der Wahlbereiche“; Kreistagsbeschluss vom 13.11.2025. Für die Abgrenzung der vier Nordhorner Wahlbereiche verweist sie auf die Bekanntmachung der Stadt Nordhorn.",
		erhoben: "2026-09-12T12:25:00.000Z",
		bereiche: [
			{
				kuerzel: "1",
				gemeinden: ["Stadt Bad Bentheim", "Samtgemeinde Schüttorf"],
			},
			{
				kuerzel: "2",
				gemeinden: ["Stadt Nordhorn"],
				bezirke: ["Nordhorn I – Nord", "Nordhorn II – Ost"],
			},
			{
				kuerzel: "3",
				gemeinden: ["Stadt Nordhorn"],
				bezirke: ["Nordhorn III – Süd", "Nordhorn IV – West"],
			},
			{
				kuerzel: "4",
				gemeinden: ["Gemeinde Wietmarschen", "Samtgemeinde Neuenhaus"],
			},
			{
				kuerzel: "5",
				gemeinden: ["Samtgemeinde Emlichheim", "Samtgemeinde Uelsen"],
			},
		],
	},
	{
		termin: "2026",
		kreis: "osnabrueck-stadt",
		quelle:
			"https://demokratisch.osnabrueck.de/fileadmin/demokratisch/wahlen/Bekanntmachung_Wahlvorschlaege.pdf",
		dokument:
			"Bekanntmachung über die zugelassenen Wahlvorschläge, Gemeindewahlausschuss vom 29.07.2026. Kein amtliches Dokument der Stadt ordnet Stadtteile einem Wahlbereich zu; die Wahlbereiche folgen auch nicht den Stadtteilgrenzen. Die Zuordnung der 115 Wahlbezirke steht im Kartendienst der Stadt (https://geo.osnabrueck.de/arcgis/rest/services/wahlen/wahl_2026/MapServer/1, Felder W_bezirk/W_bereich).",
		erhoben: "2026-09-12T12:25:00.000Z",
		bereiche: [
			{ kuerzel: "1", gemeinden: ["Osnabrück"] },
			{ kuerzel: "2", gemeinden: ["Osnabrück"] },
			{ kuerzel: "3", gemeinden: ["Osnabrück"] },
			{ kuerzel: "4", gemeinden: ["Osnabrück"] },
			{ kuerzel: "5", gemeinden: ["Osnabrück"] },
			{ kuerzel: "6", gemeinden: ["Osnabrück"] },
			{ kuerzel: "7", gemeinden: ["Osnabrück"] },
			{ kuerzel: "8", gemeinden: ["Osnabrück"] },
		],
	},
	{
		termin: "2026",
		kreis: "osnabrueck-land",
		quelle:
			"https://www.landkreis-osnabrueck.de/system/files?file=2026-07%2Fkreiswahl-2026-bekanntmachung-der-zugelassenen-wahlvorschlaege-korrigierte-fassung_0.pdf",
		dokument:
			"Bekanntmachung über die zugelassenen Wahlvorschläge zur Kreiswahl 2026 (korrigierte Fassung), veröffentlicht am 29.07.2026; wortgleich mit den offenen Daten der Wahlleitung",
		erhoben: "2026-09-12T12:25:00.000Z",
		bereiche: [
			{
				kuerzel: "1",
				gemeinden: ["Samtgemeinde Artland", "Samtgemeinde Fürstenau"],
			},
			{ kuerzel: "2", gemeinden: ["Samtgemeinde Bersenbrück"] },
			{
				kuerzel: "3",
				gemeinden: ["Stadt Bramsche", "Samtgemeinde Neuenkirchen"],
			},
			{ kuerzel: "4", gemeinden: ["Gemeinde Belm", "Gemeinde Wallenhorst"] },
			{
				kuerzel: "5",
				gemeinden: [
					"Gemeinde Bad Essen",
					"Gemeinde Ostercappeln",
					"Gemeinde Bohmte",
				],
			},
			{ kuerzel: "6", gemeinden: ["Stadt Georgsmarienhütte"] },
			{
				kuerzel: "7",
				gemeinden: [
					"Gemeinde Hagen a.T.W.",
					"Gemeinde Hasbergen",
					"Stadt Bad Iburg",
				],
			},
			{
				kuerzel: "8",
				gemeinden: [
					"Gemeinde Bad Laer",
					"Gemeinde Bad Rothenfelde",
					"Gemeinde Glandorf",
					"Stadt Dissen a.T.W.",
				],
			},
			{
				kuerzel: "9",
				gemeinden: [
					"Gemeinde Bissendorf",
					"Gemeinde Hilter a.T.W.",
					"Stadt Melle",
				],
				ortsteile: ["Bruchmühlen", "Buer", "Oldendorf-Westerhausen"],
			},
			{
				kuerzel: "10",
				gemeinden: ["Stadt Melle"],
				ortsteile: [
					"Gesmold",
					"Melle-Mitte",
					"Riemsloh",
					"Neuenkirchen",
					"Wellingholzhausen",
				],
			},
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

/** Eine Kommune des Kreises mit den Wahlbereichen, in denen sie liegt. */
export type Kommune = { name: string; bereiche: string[] };

export type Kommunenverzeichnis = {
	termin: string;
	quelle: string;
	dokument: string;
	kommunen: Kommune[];
};

/**
 * Die Kommunen eines Kreises, wie die Wahlbekanntmachung sie aufzählt – der
 * Maßstab dafür, ob eine Kreissumme das ganze Kreisgebiet umfasst.
 */
export const kommunenLautBekanntmachung = (
	kreis: string,
): Kommunenverzeichnis | undefined => {
	const e = EINTEILUNGEN.find((x) => x.kreis === kreis);
	if (!e) return undefined;
	const bereiche = new Map<string, string[]>();
	for (const b of e.bereiche)
		for (const g of b.gemeinden)
			bereiche.set(g, [...(bereiche.get(g) ?? []), b.kuerzel]);
	return {
		termin: e.termin,
		quelle: e.quelle,
		dokument: e.dokument,
		kommunen: [...bereiche]
			.map(([name, bs]) => ({ name, bereiche: bs }))
			.sort((a, b) => a.name.localeCompare(b.name, "de")),
	};
};
