/**
 * Der Termin-Index einer Wahlleitung, gelesen wie die Präsentation ihn liest.
 *
 * Die Beispiele stammen aus echten Antworten vom 07.09.2026 – sie zeigen die
 * drei Dinge, die man nicht raten kann: den Namen (jeder Kreis nennt denselben
 * Wahltag anders), den Ordner (die Landeshauptstadt Hannover benutzt kein
 * Datum) und die Frage, welcher Eintrag überhaupt gemeint ist (die Stichwahl
 * zwei Wochen später verweist auf dieselbe Präsentation zurück).
 */
import { describe, expect, it } from "vitest";
import {
	apiBasisVon,
	findeOrdner,
	indexDatum,
	kreiseMitTermin,
	openDataUrl,
	opendataBasisVon,
	parseTerminIndex,
	terminById,
	terminGiltFuerKreis,
	terminGiltIrgendwoImKreis,
	wahlleitungenMitTermin,
} from "./termine.ts";

const kommunalwahl2021 = terminById("2021")!;
const kommunalwahl2026 = terminById("2026")!;
const nordstemmen2020 = terminById("2020")!;

/** So antwortet votemanager.kdo.de für den Landkreis Peine. */
const peine = {
	termine: [
		{
			date: "13.09.2026",
			name: "Kommunalwahlen",
			url: "../20260913/03157000/praesentation/",
		},
		{
			date: "26.09.2021",
			name: "Bundestagswahl",
			url: "../20210926/03157000/praesentation/",
		},
		{
			date: "26.09.2021",
			name: "Stichwahl einer Landrätin/eines Landrats",
			url: "../20210912/03157000/praesentation/",
		},
		{
			date: "12.09.2021",
			name: "Kommunalwahl",
			url: "../20210912/03157000/praesentation/",
		},
	],
};

/** Und so die Landeshauptstadt Hannover – ohne Datum im Ordner. */
const hannover = {
	termine: [
		{
			date: "13.09.2026",
			name: "Kommunalwahlen",
			url: "../Wahl-2026-09-13/03241001/praesentation/",
		},
		{
			date: "12.09.2021",
			name: "Kommunalwahlen",
			url: "../Wahl-2021-09-12/03241001/praesentation/",
		},
	],
};

describe("Termin-Index", () => {
	it("liest Datum, Namen und Ordner", () => {
		expect(parseTerminIndex(peine)).toContainEqual({
			datum: "12.09.2021",
			name: "Kommunalwahl",
			ordner: "20210912",
		});
	});

	it("übergeht Einträge ohne auswertbare Adresse", () => {
		expect(
			parseTerminIndex({
				termine: [
					{ date: "12.09.2021", name: "Ohne url" },
					{ date: "12.09.2021", name: "Fremde url", url: "https://anderswo/" },
				],
			}),
		).toEqual([]);
		expect(parseTerminIndex({})).toEqual([]);
	});

	it("sucht über das Wahldatum, nicht über den Namen", () => {
		// „Kommunalwahl“, „Kreiswahl 2021“, „Wahl des Kreistages“ – und bei
		// Wilhelmshaven steht als einziger Eintrag des Tages die Wahl zum
		// Seniorenbeirat. Der Name taugt nicht als Schlüssel, das Datum schon.
		const seltsam = {
			termine: [
				{
					date: "12.09.2021",
					name: "Wahl  zum Seniorenbeirat der Stadt Wilhelmshaven",
					url: "../20210912/03405000/praesentation/",
				},
			],
		};
		expect(findeOrdner(parseTerminIndex(seltsam), kommunalwahl2021)).toBe(
			"20210912",
		);
	});

	it("nimmt bei mehreren Einträgen desselben Tages den ersten – sie meinen dieselbe Präsentation", () => {
		expect(findeOrdner(parseTerminIndex(peine), kommunalwahl2021)).toBe(
			"20210912",
		);
		// Die Bundestagswahl zwei Wochen später hat einen eigenen Ordner und
		// darf nicht mit hineingeraten.
		expect(findeOrdner(parseTerminIndex(peine), kommunalwahl2026)).toBe(
			"20260913",
		);
	});

	it("findet auch einen Ordner, der nicht nach dem Wahltag heißt", () => {
		expect(findeOrdner(parseTerminIndex(hannover), kommunalwahl2021)).toBe(
			"Wahl-2021-09-12",
		);
		expect(findeOrdner(parseTerminIndex(hannover), kommunalwahl2026)).toBe(
			"Wahl-2026-09-13",
		);
	});

	it("meldet nichts, wenn der Wahltag im Index fehlt", () => {
		// Salzgitter und Wolfsburg führen den 12.09.2021 nicht.
		expect(findeOrdner(parseTerminIndex(hannover), nordstemmen2020)).toBe(
			undefined,
		);
	});

	it("schreibt das Datum so, wie der Index es schreibt", () => {
		expect(indexDatum(kommunalwahl2021)).toBe("12.09.2021");
		expect(indexDatum(nordstemmen2020)).toBe("13.09.2020");
	});
});

describe("Pfade eines Fundorts", () => {
	const v22 = { ordner: "20210912", layout: "v22" } as const;
	const v26 = { ordner: "Wahl-2026-09-13", layout: "v26" } as const;
	const wurzel = "https://beispiel.de/";

	it("kennt beide Schemata", () => {
		expect(apiBasisVon(v22, "03157000", wurzel)).toBe(
			"https://beispiel.de/20210912/03157000/api/praesentation",
		);
		expect(apiBasisVon(v26, "03241001", wurzel)).toBe(
			"https://beispiel.de/Wahl-2026-09-13/03241001/daten/api",
		);
		expect(opendataBasisVon(v22, "03157000", wurzel)).toBe(
			"https://beispiel.de/20210912/03157000/praesentation",
		);
		expect(opendataBasisVon(v26, "03241001", wurzel)).toBe(
			"https://beispiel.de/Wahl-2026-09-13/03241001/daten/opendata",
		);
	});

	it("sucht open_data.json dort, wo sie wirklich liegt", () => {
		// In v22 bei der API, in v26 bei den CSVs. Wer sie in v26 bei der API
		// sucht, bekommt 404 – und damit keine Listenplätze der Bewerber.
		expect(openDataUrl(v22, "03157000", wurzel)).toBe(
			"https://beispiel.de/20210912/03157000/api/praesentation/open_data.json",
		);
		expect(openDataUrl(v26, "03241001", wurzel)).toBe(
			"https://beispiel.de/Wahl-2026-09-13/03241001/daten/opendata/open_data.json",
		);
	});
});

describe("Für wen ein Termin gilt", () => {
	it("gibt den laufenden Termin überall aus", () => {
		expect(kreiseMitTermin(kommunalwahl2026)).toHaveLength(45);
	});

	it("gibt einen Archivtermin nur dort aus, wo er erhoben wurde", () => {
		expect(terminGiltFuerKreis(kommunalwahl2021, "hildesheim")).toBe(true);
		expect(terminGiltFuerKreis(kommunalwahl2021, "region-hannover")).toBe(true);
		expect(terminGiltFuerKreis(kommunalwahl2021, "salzgitter")).toBe(false);
		expect(terminGiltFuerKreis(kommunalwahl2021, "celle")).toBe(false);
	});

	it("hält eine Bürgermeisterwahl von der Kreisebene fern", () => {
		// Der 13.09.2020 ist der Wahltag der Gemeinde Nordstemmen, nicht der des
		// Landkreises Hildesheim. Im Kreisgebiet gibt es ihn – deshalb fragt der
		// Poller dort nach –, auf der Kreisebene nicht: keine Kopfzeile, keine
		// Terminseite, keine kreisweite Auskunft.
		expect(terminGiltIrgendwoImKreis(nordstemmen2020, "hildesheim")).toBe(true);
		expect(terminGiltFuerKreis(nordstemmen2020, "hildesheim")).toBe(false);
		expect(terminGiltIrgendwoImKreis(nordstemmen2020, "peine")).toBe(false);
		expect(kreiseMitTermin(nordstemmen2020)).toEqual([]);
		expect(wahlleitungenMitTermin(nordstemmen2020)).toEqual([
			"hildesheim/nordstemmen",
		]);
	});

	it("lässt eine Landratswahl auf der Kreisebene stehen", () => {
		// Der Gegenfall: Am 26.05.2019 hat der Landkreis Emsland seinen Landrat
		// gewählt – das ist eine Wahl des ganzen Kreisgebiets und gehört auf die
		// Kreisebene, auch wenn acht seiner Gemeinden am selben Tag zusätzlich
		// ihren Bürgermeister gewählt haben. Im Landkreis Peine hat an dem Tag
		// nur die Gemeinde Wendeburg gewählt; dort bleibt der Tag unten.
		const t = terminById("2019-05-26")!;
		expect(terminGiltFuerKreis(t, "emsland")).toBe(true);
		expect(terminGiltFuerKreis(t, "peine")).toBe(false);
		expect(terminGiltIrgendwoImKreis(t, "peine")).toBe(true);
		expect(wahlleitungenMitTermin(t)).toContain("peine/wendeburg");
		expect(wahlleitungenMitTermin(t)).not.toContain("emsland/kreis");
	});
});
