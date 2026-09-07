import { describe, expect, it } from "vitest";
import {
	agsAusPraesentationsUrl,
	gebietsnamen,
	parseErgebnis,
	parseListing,
	parseStand,
	parseUebersicht,
	parseErgebnisDateiname,
	ebeneVonGebietId,
} from "./votemanager.ts";

describe("parseErgebnis", () => {
	it("liest eine Verhältniswahl mit Sitzen und Kandidaten", () => {
		const e = parseErgebnis(
			{
				zeitstempel: "08.04.2022 12:45",
				seitentitel: "Gemeindewahl 12.09.2021 - Gemeinde Nordstemmen",
				Komponente: {
					tabelle: {
						zeilen: [
							{
								label: {
									labelKurz: "SPD - Summe Partei- und Kandidaten-Stimmen",
								},
								zahl: "7.487",
								prozent: "40,89 %",
							},
							{
								label: { labelKurz: "SPD - Stimmen für die Partei" },
								zahl: "2.106",
								prozent: "11,50 %",
							},
							{
								label: { labelKurz: "SPD - Summe Kandidaten-Stimmen" },
								zahl: "5.381",
								prozent: "29,39 %",
								sub_zeilen: [
									{
										label: { labelKurz: "Gerald Ludewig" },
										zahl: "1.052",
										prozent: "19,55 %",
									},
								],
							},
						],
					},
					gebietsverlinkung: [
						{
							titel: "Wahlbezirke",
							gebietslinks: [
								{
									id: "ebene_6_id_3111",
									type: "ergebnis",
									title: "01 - Nordstemmen",
								},
							],
						},
					],
					info: {
						titel: "Gemeinde Nordstemmen - Gesamtergebnis",
						hinweis: [
							"Alle Schnellmeldungen eingegangen!",
							"23 von 23 Ergebnissen",
						],
						tabelle: {
							zeilen: [
								{
									label: { labelKurz: "Wahlberechtigte" },
									zahl: "10.102",
									prozent: "",
								},
								{
									label: { labelKurz: "Wählerinnen/Wähler" },
									zahl: "6.289",
									prozent: "62,25 %",
								},
								{
									label: { labelKurz: "ungültige Stimmzettel" },
									zahl: "118",
									prozent: "1,88 %",
								},
								{
									label: { labelKurz: "gültige Stimmzettel" },
									zahl: "6.171",
									prozent: "98,12 %",
								},
								{
									label: { labelKurz: "gültige Stimmen" },
									zahl: "18.310",
									prozent: "",
								},
							],
						},
					},
					sitze: {
						hinweis: "Es wurden 30  Sitze vergeben.",
						tortenDiagramm: {
							entries: [
								{
									sitze: 12,
									color: "#d60029",
									label: "SPD",
									tooltip: "Sozialdemokratische Partei Deutschlands",
								},
							],
						},
						tabelle: {
							ueberschriften: ["Partei", "Kandidat/in", "Mandat", "Stimmen"],
							zeilen: [
								["SPD", "Ludewig, Gerald", "Nordstemmen, direkt", "1.052"],
							],
						},
					},
					grafik: {
						balken: [
							{
								bezeichnung: "SPD",
								color: "#d60029",
								bezeichnungAusfuehrlich:
									"Sozialdemokratische Partei Deutschlands",
								wert: 7487,
								prozentGerundet: 40.89,
							},
						],
					},
					wahlbeteiligung: { text: { prozent: 62.25 } },
				},
			},
			false,
			"Gemeinde Nordstemmen",
		);
		expect(e.leer).toBe(false);
		expect(e.gebietKurz).toBe("Gemeinde Nordstemmen");
		expect(e.stand).toMatchObject({ anz: 23, max: 23 });
		expect(e.kennzahlen).toEqual({
			wahlberechtigte: 10102,
			waehler: 6289,
			wahlbeteiligung: 62.25,
			ungueltig: 118,
			gueltig: 6171,
			stimmen: 18310,
		});
		expect(e.parteien[0]).toMatchObject({
			key: "spd",
			stimmen: 7487,
			prozent: 40.89,
			listenstimmen: 2106,
			kandidatenstimmen: 5381,
		});
		expect(e.parteien[0].kandidaten?.[0]).toEqual({
			name: "Gerald Ludewig",
			stimmen: 1052,
			prozentInPartei: 19.55,
		});
		expect(e.sitze?.gesamt).toBe(12);
		expect(e.sitze?.gewaehlte[0]).toEqual({
			partei: "SPD",
			name: "Ludewig, Gerald",
			mandat: "Nordstemmen, direkt",
			stimmen: 1052,
		});
		expect(e.untergebiete[0].gebiete[0].id).toBe("ebene_6_id_3111");
	});

	it("trennt bei Personenwahlen Kandidat und Partei", () => {
		const e = parseErgebnis(
			{
				seitentitel: "Landratswahl 12.09.2021 - Landkreis Hildesheim",
				Komponente: {
					info: {
						titel: "Landkreis Hildesheim - Gesamtergebnis",
						hinweis: ["426 von 426 Ergebnissen"],
					},
					grafik: {
						balken: [
							{
								bezeichnung: "Lynack, SPD",
								color: "#d60029",
								bezeichnungAusfuehrlich:
									"Bernd Lynack, Sozialdemokratische Partei Deutschlands",
								wert: 53934,
								prozentGerundet: 41.3,
							},
						],
					},
				},
			},
			true,
		);
		expect(e.parteien[0].kandidat).toEqual({
			name: "Bernd Lynack",
			partei: "SPD",
		});
	});

	it("erkennt leere Dateien vor der Wahl", () => {
		const e = parseErgebnis(
			{
				zeitstempel: "17.02.2026 06:36",
				seitentitel: "Kreistagswahl - Landkreis Hildesheim",
			},
			false,
			"Landkreis Hildesheim",
		);
		expect(e.leer).toBe(true);
		expect(e.gebietKurz).toBe("Landkreis Hildesheim");
	});

	it("setzt einen ausgezählten Wahlbezirk auf 1 von 1", () => {
		const e = parseErgebnis(
			{
				seitentitel:
					"Gemeindewahl 12.09.2021 - Gemeinde Nordstemmen - 09 - Rössing - DGH",
				Komponente: {
					info: {
						titel: "Gemeinde Nordstemmen - 09 - Rössing - DGH",
						hinweis: [null as unknown as string],
						tabelle: {
							zeilen: [
								{
									label: { labelKurz: "Wählerinnen/Wähler" },
									zahl: "268",
									prozent: "41,49 %",
								},
							],
						},
					},
					grafik: {
						balken: [
							{
								bezeichnung: "SPD",
								color: "#d60029",
								wert: 300,
								prozentGerundet: 39.2,
							},
						],
					},
				},
			},
			false,
			"Gemeinde Nordstemmen",
		);
		expect(e.gebietKurz).toBe("09 - Rössing - DGH");
		expect(e.stand).toMatchObject({ anz: 1, max: 1 });
	});
});

describe("Helfer", () => {
	it("parseStand", () => {
		expect(
			parseStand([
				"Alle Schnellmeldungen eingegangen!",
				"426 von 426 Ergebnissen",
			]),
		).toEqual({ anz: 426, max: 426 });
		expect(parseStand(["3 von 23"])).toEqual({ anz: 3, max: 23 });
		expect(parseStand([])).toEqual({});
	});
	it("gebietsnamen", () => {
		expect(
			gebietsnamen(
				"Kreiswahl 12.09.2021 - Landkreis Hildesheim - Gemeinde Nordstemmen",
				"Landkreis Hildesheim",
			),
		).toEqual({
			gebietTitel: "Landkreis Hildesheim - Gemeinde Nordstemmen",
			gebietKurz: "Gemeinde Nordstemmen",
		});
		expect(
			gebietsnamen(
				"Ortsratswahl - Adensen - Ortschaft Adensen",
				"Gemeinde Nordstemmen",
			).gebietKurz,
		).toBe("Ortschaft Adensen");
	});
	it("parseListing liest Apache-Autoindex", () => {
		const html = `<tr><td valign="top"><img src="/icons/unknown.gif" alt="[   ]"></td><td><a href="ergebnis_ebene_3_id_14_0.json">ergebnis_ebene_3_id_14_0.json</a></td><td align="right">2022-04-08 13:56  </td><td align="right"> 15K</td><td>&nbsp;</td></tr>`;
		expect(parseListing(html)).toEqual([
			{
				name: "ergebnis_ebene_3_id_14_0.json",
				geaendert: "2022-04-08 13:56",
				groesse: "15K",
			},
		]);
	});
	it("Dateinamen und Ebenen", () => {
		expect(parseErgebnisDateiname("ergebnis_ebene_-52_id_62_0.json")).toEqual({
			gebietId: "ebene_-52_id_62",
			stimmentyp: 0,
		});
		expect(ebeneVonGebietId("ebene_6_id_3111")).toBe(6);
	});
	it("parseUebersicht liest Spalten und Zeilen", () => {
		const u = parseUebersicht({
			seitentitel: "Wahlbezirke",
			tabelle: {
				header: [
					{ labelKurz: "Wahlbezirk" },
					{ labelKurz: "Stand" },
					{ labelKurz: "Wahlberechtigte" },
					{ labelKurz: "Wahlbeteiligung" },
					{ labelKurz: "SPD" },
					{ labelKurz: "Sonstige" },
				],
				zeilen: [
					{
						label: "01 - Nordstemmen",
						link: { id: "ebene_6_id_3111", type: "ergebnis", title: "01" },
						statusString: "eingegangen",
						statusProzent: 100,
						stimmbezirk: true,
						felder: [
							{ absolut: "446", prozent: "446" },
							{ absolut: "128", prozent: "28,70 %" },
							{ absolut: "170", prozent: "45,70 %" },
							{ absolut: "15", prozent: "4,03 %" },
						],
					},
				],
			},
		});
		expect(u.spalten.map((s) => s.kurz)).toEqual(["SPD", "Sonstige"]);
		expect(u.zeilen[0]).toMatchObject({
			gebietId: "ebene_6_id_3111",
			status: "eingegangen",
			wahlberechtigte: 446,
			wahlbeteiligung: 28.7,
		});
		expect(u.zeilen[0].werte[0]).toEqual({
			kurz: "SPD",
			absolut: 170,
			prozent: 45.7,
		});
	});
});

describe("agsAusPraesentationsUrl", () => {
	it("liest den Gebietsschlüssel aus dem Verweis auf eine fremde Präsentation", () => {
		// So verlinkt der Kreis seine Gemeinden bei Kreistags- und Landratswahl –
		// gleich in beiden Programmversionen (2021 wie 2026).
		expect(
			agsAusPraesentationsUrl("../../03254026/praesentation/index.html"),
		).toBe("03254026");
		expect(
			agsAusPraesentationsUrl("../../03157006/praesentation/index.html"),
		).toBe("03157006");
		// Samtgemeinden haben neun Stellen
		expect(
			agsAusPraesentationsUrl("../../032545406/praesentation/index.html"),
		).toBe("032545406");
	});

	it("bleibt stumm, wo kein Schlüssel steht", () => {
		expect(agsAusPraesentationsUrl(undefined)).toBeUndefined();
		expect(agsAusPraesentationsUrl("https://www.example.org/wahl/")).toBe(
			undefined,
		);
		// Die laufende Nummer einer Gebiets-Id ist kein Gebietsschlüssel
		expect(agsAusPraesentationsUrl("ebene_3_id_14")).toBeUndefined();
	});
});
