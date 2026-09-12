import { describe, expect, it } from "vitest";
import type { Ereignis } from "./abfragen.ts";
import type { WahlFolie } from "./dashboard.ts";
import type { FolienStand } from "./meldungen.ts";
import {
	type Schub,
	type WahlKontext,
	beitraegeAus,
	bisZumLetztenSatz,
	eingaengeAus,
	erfundeneZahlen,
	gebietsName,
	kontextText,
	pruefeAntwort,
	wahlKontext,
	worumEsGeht,
} from "./moderation.ts";

const vorher = (a: Partial<FolienStand> = {}): FolienStand => ({
	ort: "Nordstemmen",
	wahl: "Gemeinderatswahl",
	anz: 20,
	max: 23,
	art: "zwischenstand",
	spitze: "SPD",
	parteien: [
		{ key: "spd", platz: 1, prozent: 33.4, sitze: 11 },
		{ key: "cdu", platz: 2, prozent: 32.1, sitze: 10 },
	],
	...a,
});

const folie = (a: Partial<WahlFolie> = {}): WahlFolie => ({
	art: "wahl",
	key: "03254026-rat",
	marke: "rat",
	quelle: {
		behoerde: "03254026",
		wahlId: 52,
		gesamtGebietId: "ebene_0_id_0",
	},
	ort: "Nordstemmen",
	wahl: "Gemeinderatswahl",
	href: "/",
	zuschnitt: "eigen",
	test: false,
	personenwahl: false,
	balken: [
		{
			key: "cdu",
			kurz: "CDU",
			lang: "CDU",
			farbe: "#000",
			stimmen: 4100,
			prozent: 34.2,
			name: "CDU",
			diff: 2.1,
		},
		{
			key: "spd",
			kurz: "SPD",
			lang: "SPD",
			farbe: "#e3000f",
			stimmen: 3700,
			prozent: 30.8,
			name: "SPD",
			diff: -1.4,
		},
	] as WahlFolie["balken"],
	weitere: 0,
	sitze: {
		quelle: "hochrechnung",
		art: "struktur",
		gesamt: 30,
		verteilung: [
			{
				key: "cdu",
				kurz: "CDU",
				lang: "CDU",
				farbe: "#000",
				sitze: 11,
				vorher: 10,
			},
			{
				key: "spd",
				kurz: "SPD",
				lang: "SPD",
				farbe: "#e3000f",
				sitze: 10,
				vorher: 11,
			},
		],
		hinweis: "",
		unsicherheit: "niedrig",
	},
	datenstand: {
		art: "hochrechnung",
		titel: "Hochrechnung",
		text: "21 von 23 Wahlbezirken",
		unsicherheit: "niedrig",
	},
	anz: 21,
	max: 23,
	wahlbeteiligung: 61.2,
	wahlbeteiligungVorher: 58.9,
	vergleichTitel: "Kommunalwahl 2021",
	...a,
});

const ereignis = (a: Partial<Ereignis> = {}): Ereignis => ({
	id: 1,
	termin: "2026-09-13",
	zeit: "2026-09-13T19:12:00.000Z",
	behoerde: "03254026",
	behoerdeName: "Nordstemmen",
	wahlId: 52,
	gebietId: "ebene_-1_id_7",
	art: "fertig",
	text: "Rössing 01: Gemeinderatswahl ausgezählt",
	daten: {
		anz: 1,
		max: 1,
		spitze: [{ kurz: "CDU", prozent: 41.0, farbe: "#000" }],
		wahlbeteiligung: 64.3,
	},
	...a,
});

const schub = (
	wahlen: WahlKontext[],
	fest = "Nordstemmen.",
	unveraendert: Schub["unveraendert"] = [],
): Schub => ({
	behoerde: "03254026",
	termin: "2026-09-13",
	partei: "CDU",
	eingaenge: eingaengeAus(wahlen),
	unveraendert,
	wahlen,
	fest,
});

const kontext = (): string =>
	kontextText(
		schub([
			wahlKontext(
				folie(),
				vorher(),
				["Gemeinderatswahl Nordstemmen: CDU zieht an SPD vorbei"],
				beitraegeAus([ereignis()], folie(), vorher()),
			),
		]),
	);

describe("der Kontext", () => {
	it("bringt beide Stände mit – vorher und jetzt", () => {
		const k = kontext();
		expect(k).toContain("Vorher auf der Leinwand");
		expect(k).toContain("20 von 23");
		expect(k).toContain("Auszählstand jetzt: 21 von 23");
	});

	it("nennt Veränderung zur Vorwahl, Sitze und Wahlbeteiligung", () => {
		const k = kontext();
		expect(k).toContain("CDU 34,2 Prozent");
		expect(k).toContain("+2,1 zur Vorwahl");
		expect(k).toContain("11 Sitze (vorher 10)");
		expect(k).toContain("Wahlbeteiligung: 61,2 Prozent (Vorwahl 58,9 Prozent)");
		expect(k).toContain("Kommunalwahl 2021");
	});

	it("nennt Zuschnitt, Datenstand und Unsicherheit", () => {
		const k = kontext();
		expect(k).toContain("eigenes Gebiet der Wahlleitung");
		expect(k).toContain("Hochrechnung");
		expect(k).toContain("Unsicherheit niedrig");
	});

	it("nennt das eingegangene Gebiet – die einzige erlaubte Ursache", () => {
		expect(kontext()).toContain("Rössing 01");
	});

	it("stellt das Ereignis vor die Wahlen", () => {
		const k = kontext();
		expect(k).toContain("Eingegangen: Rössing 01");
		// Der Eingang steht vor dem Zustandsteil, nicht darin.
		expect(k.indexOf("Eingegangen:")).toBeLessThan(k.indexOf("WAHL:"));
		expect(k.indexOf("DAS EREIGNIS")).toBeLessThan(
			k.indexOf("ZUSTAND DER WAHLEN"),
		);
	});

	it("sagt ausdrücklich, wo sich nichts geändert hat", () => {
		const k = kontextText(
			schub(
				[
					wahlKontext(
						folie(),
						vorher(),
						[],
						beitraegeAus([ereignis()], folie(), vorher()),
					),
				],
				"Nordstemmen.",
				[
					{
						wahl: "Kreistagswahl",
						ort: "Landkreis Hildesheim",
						anz: 196,
						max: 426,
					},
				],
			),
		);
		expect(k).toContain(
			"Dort hat sich nichts geändert: Kreistagswahl Landkreis Hildesheim steht bei 196 von 426",
		);
	});
});

describe("die Reihenfolge in der Gliederung", () => {
	const balken = (namen: Array<[string, number]>): WahlFolie["balken"] =>
		namen.map(([name, prozent]) => ({
			key: name.toLowerCase(),
			kurz: name,
			lang: name,
			farbe: "#000",
			stimmen: Math.round(prozent * 100),
			prozent,
			name,
		})) as WahlFolie["balken"];

	const mitBalken = (namen: Array<[string, number]>): string =>
		kontextText(
			schub([
				wahlKontext(
					folie({ balken: balken(namen), sitze: undefined }),
					vorher(),
					["Gemeinderatswahl Nordstemmen: fertig ausgezählt!"],
					[],
				),
			]),
		);

	const zeile = (kontext: string): string =>
		kontext
			.split("\n")
			.find((z) => z.trim().startsWith("Reihenfolge:"))
			?.trim()
			.slice("Reihenfolge:".length)
			.trim() ?? "";

	it("nennt bei vielen Parteien die ersten drei", () => {
		const k = mitBalken([
			["SPD", 40.9],
			["CDU", 31.8],
			["GRÜNE", 12.0],
			["FDP", 3.2],
		]);
		expect(zeile(k).split("; ")).toEqual([
			"SPD 40,9 Prozent",
			"CDU 31,8 Prozent",
			"GRÜNE 12,0 Prozent",
		]);
	});

	it("erfindet bei zwei Bewerbern keinen dritten", () => {
		// Bei einer Personenwahl stehen in den Balken die Bewerber. Treten nur
		// zwei an, bleiben es zwei.
		const k = mitBalken([
			["Müller", 54.3],
			["Schneider", 45.7],
		]);
		expect(zeile(k).split("; ")).toEqual([
			"Müller 54,3 Prozent",
			"Schneider 45,7 Prozent",
		]);
	});

	it("steht vor dem Zustandsteil, nicht darin", () => {
		const k = mitBalken([
			["SPD", 40.9],
			["CDU", 31.8],
			["GRÜNE", 12.0],
		]);
		expect(k.indexOf("Reihenfolge:")).toBeLessThan(
			k.indexOf("ZUSTAND DER WAHLEN"),
		);
	});
});

describe("worumEsGeht", () => {
	const kreisFolie = (a: Partial<WahlFolie> = {}) =>
		folie({
			wahl: "Kreistagswahl",
			ort: "Landkreis Hildesheim",
			zuschnitt: "kreis",
			max: 426,
			...a,
		});

	it("trennt die beiden Kreistagsfolien nach dem, was sie zeigen", () => {
		// Beide heißen „Kreistagswahl". Ohne den Unterschied verklebt die
		// Ansage sie zu „am Kreistag in Wahlbereich B".
		const kreis = worumEsGeht(kreisFolie());
		const bereich = worumEsGeht(
			kreisFolie({
				ort: "Wahlbereich B",
				zuschnitt: "wahlbereich",
				beisatz: "Elze, Nordstemmen",
				max: 37,
			}),
		);
		expect(kreis).toContain("Sitzverteilung");
		expect(bereich).toContain("Reihenfolge der Bewerber");
		expect(bereich).toContain("Wahlbereich B");
		expect(bereich).not.toBe(kreis);
	});

	it("nennt beim Kreis ohne Sitzverteilung das Ergebnis, nicht Sitze", () => {
		// Die Landratswahl läuft über denselben Zuschnitt, verteilt aber nichts.
		expect(worumEsGeht(kreisFolie({ sitze: undefined }))).toBe(
			"das Ergebnis im ganzen Landkreis",
		);
	});

	it("lässt die eigenen Wahlen der Gemeinde ohne Zusatz", () => {
		expect(worumEsGeht(folie())).toBeUndefined();
	});

	it("stellt den Unterschied in den Kontext, nicht in eine Klammer", () => {
		const bereich = folie({
			marke: "kreistag-wahlbereich-b",
			wahl: "Kreistagswahl",
			ort: "Wahlbereich B",
			zuschnitt: "wahlbereich",
			beisatz: "Elze, Nordstemmen",
		});
		const k = kontextText(
			schub([wahlKontext(bereich, vorher(), [], [])], "Kreistag."),
		);
		expect(k).toContain("Darum geht es hier: wer aus Wahlbereich B");
		expect(k).toContain("Gemeinden: Elze, Nordstemmen");
		expect(k).not.toContain("(Kreiswahlbereich");
	});
});

describe("eingaengeAus", () => {
	const beitrag = (
		a: Partial<import("./moderation.ts").GebietsBeitrag> = {},
	) => ({
		behoerde: "03254026",
		gebietId: "ebene_6_id_6006",
		name: "01 - Nordstemmen - Gemeindejugendring",
		spitze: [],
		...a,
	});
	const kontextFuer = (
		wahl: string,
		ort: string,
		beitraege: ReturnType<typeof beitrag>[],
	) =>
		({
			wahl,
			ort,
			zuschnitt: "eigen",
			anz: 1,
			max: 3,
			datenstand: "Zwischenstand",
			parteien: [],
			vorher: vorher(),
			beitraege,
			meldungen: [],
		}) as unknown as WahlKontext;

	it("bündelt dieselbe Urne über mehrere Wahlen zu einem Ereignis", () => {
		// Dasselbe Wahllokal zählt für Gemeinderat und Ortsrat; die
		// Wahlleitung nennt es in der Ortsratswahl anders.
		const raus = eingaengeAus([
			kontextFuer("Gemeinderatswahl", "Nordstemmen", [beitrag()]),
			kontextFuer("Ortsratswahl", "Adensen", [
				beitrag({ name: "Adensen - 01 - Nordstemmen - Gemeindejugendring" }),
			]),
		]);
		expect(raus).toHaveLength(1);
		expect(raus[0].wirkungen.map((w) => w.wahl)).toEqual([
			"Gemeinderatswahl",
			"Ortsratswahl",
		]);
	});

	it("nimmt den kürzesten Namen – den ohne Ortschafts-Vorsatz", () => {
		const raus = eingaengeAus([
			kontextFuer("Ortsratswahl", "Adensen", [
				beitrag({ name: "Adensen - 01 - Nordstemmen - Gemeindejugendring" }),
			]),
			kontextFuer("Gemeinderatswahl", "Nordstemmen", [beitrag()]),
		]);
		expect(raus[0].gebiet).toBe("01 - Nordstemmen - Gemeindejugendring");
	});

	it("führt Wahlleitungen nicht zusammen", () => {
		// Der Kreis führt zum Kreistag Gemeindezeilen, keine Wahllokale – eine
		// gleiche Gebietsnummer bedeutet dort etwas anderes.
		const raus = eingaengeAus([
			kontextFuer("Gemeinderatswahl", "Nordstemmen", [beitrag()]),
			kontextFuer("Kreistagswahl", "Landkreis Hildesheim", [
				beitrag({ behoerde: "03254000", name: "Nordstemmen" }),
			]),
		]);
		expect(raus).toHaveLength(2);
	});

	it("hängt jeder Wirkung die Spitze ihrer Wahl an", () => {
		const mitParteien = {
			...kontextFuer("Gemeinderatswahl", "Nordstemmen", [beitrag()]),
			parteien: [
				{ kurz: "SPD", prozent: 40.9 },
				{ kurz: "CDU", prozent: 31.8 },
				{ kurz: "GRÜNE", prozent: 12.0 },
				{ kurz: "FDP", prozent: 3.2 },
			],
		} as WahlKontext;
		expect(
			eingaengeAus([mitParteien])[0].wirkungen[0].reihenfolge.map(
				(p) => p.kurz,
			),
		).toEqual(["SPD", "CDU", "GRÜNE"]);
	});

	it("meldet die Wirkung als fertig, sobald die Wahl durch ist", () => {
		const durch = {
			...kontextFuer("Ortsratswahl", "Rössing", [beitrag()]),
			anz: 3,
			max: 3,
		} as WahlKontext;
		expect(eingaengeAus([durch])[0].wirkungen[0].fertig).toBe(true);
	});
});

describe("gebietsName", () => {
	it("streift die Wahl vom Ereignistext ab", () => {
		expect(gebietsName("Ortschaft Wolthusen: Ortsratswahl vollständig")).toBe(
			"Ortschaft Wolthusen",
		);
		expect(gebietsName("Rössing 01: Gemeinderatswahl 3 von 23")).toBe(
			"Rössing 01",
		);
	});

	it("lässt einen Text ohne Doppelpunkt stehen", () => {
		expect(gebietsName("Briefwahl Nordstemmen")).toBe("Briefwahl Nordstemmen");
	});

	it("sagt, welche Partei der Zuschauer eingestellt hat", () => {
		expect(kontext()).toContain("CDU");
		expect(kontextText({ ...schub([]), partei: undefined })).toContain(
			"keine eigene Partei",
		);
	});
});

describe("der Beitrag des eingegangenen Gebiets", () => {
	it("nimmt so viele Ereignisse, wie Schnellmeldungen dazugekommen sind", () => {
		const drei = [1, 2, 3].map((i) =>
			ereignis({ id: i, gebietId: `ebene_-1_id_${i}` }),
		);
		expect(beitraegeAus(drei, folie(), vorher())).toHaveLength(1);
		expect(beitraegeAus(drei, folie(), vorher({ anz: 18 }))).toHaveLength(3);
	});

	it("lässt das Gesamtgebiet weg – dort geht nichts ein", () => {
		expect(
			beitraegeAus([ereignis({ gebietId: "ebene_0_id_0" })], folie(), vorher()),
		).toEqual([]);
	});

	it("lässt fremde Wahlen und fremde Wahlleitungen weg", () => {
		expect(beitraegeAus([ereignis({ wahlId: 53 })], folie(), vorher())).toEqual(
			[],
		);
		expect(
			beitraegeAus([ereignis({ behoerde: "03254021" })], folie(), vorher()),
		).toEqual([]);
	});

	it("schweigt beim Kreiswahlbereich", () => {
		const bereich = folie({
			zuschnitt: "wahlbereich",
			quelle: {
				behoerde: "03254026",
				wahlId: 52,
				gesamtGebietId: "ebene_0_id_0",
				gebietId: "ebene_9_id_2",
			},
		});
		expect(beitraegeAus([ereignis()], bereich, vorher())).toEqual([]);
	});
});

describe("die Prüfung auf erfundene Zahlen", () => {
	const k = kontext();

	it("lässt durch, was im Kontext steht", () => {
		expect(
			erfundeneZahlen("Die CDU steht bei 34,2 Prozent, 21 von 23 sind da.", k),
		).toEqual([]);
	});

	it("lässt die gerundete Fassung durch", () => {
		expect(erfundeneZahlen("Die CDU liegt bei 34 Prozent.", k)).toEqual([]);
	});

	it("hält jede Zahl auf, die nirgends steht", () => {
		expect(
			erfundeneZahlen("Die CDU liegt bei 47 Prozent und holt 19 Sitze.", k),
		).toEqual(["47", "19"]);
	});

	it("verwirft die Antwort und überlässt der festen Formulierung das Wort", () => {
		const schlecht = pruefeAntwort("Die CDU kommt auf 47 Prozent.", k);
		expect(schlecht).toHaveProperty("fehler");
		const gut = pruefeAntwort(
			"Da kommen neue Zahlen rein – Rössing hat ausgezählt, und die CDU zieht an der SPD vorbei.",
			k,
		);
		expect(gut).toEqual({
			satz: "Da kommen neue Zahlen rein – Rössing hat ausgezählt, und die CDU zieht an der SPD vorbei.",
		});
	});
});

describe("die Länge", () => {
	const k = kontext();

	it("spricht auch einen langen Absatz, statt ihn wegzuwerfen", () => {
		// Eine bezahlte Antwort wegzuwerfen und dafür die Vorlage vorzulesen
		// ist das schlechteste Ergebnis: bezahlt und trotzdem abgelesen.
		const lang = "Rössing ist durch. ".repeat(20).trim();
		expect(pruefeAntwort(lang, k)).toEqual({ satz: lang });
	});

	it("spricht so viele Sätze, wie das Modell schickt", () => {
		const sieben = "Kurz. ".repeat(7).trim();
		expect(pruefeAntwort(sieben, k)).toEqual({ satz: sieben });
	});

	it("streift Anführungszeichen und Zeilenumbrüche ab", () => {
		expect(pruefeAntwort("  „Rössing ist durch.“  ", k)).toEqual({
			satz: "Rössing ist durch.",
		});
	});
});

describe("ein abgeschnittener Satz", () => {
	const k = kontext();

	it("wird auf den letzten ganzen Satz zurückgeschnitten", () => {
		// Reißt die Antwort an der Token-Grenze ab, wird der angefangene Satz
		// nicht gesprochen – der Rest davor schon.
		expect(
			pruefeAntwort("Rössing ist durch. Die CDU liegt jetzt bei 34 Pro", k),
		).toEqual({ satz: "Rössing ist durch." });
	});

	it("überlebt Anführungszeichen am Satzende", () => {
		expect(bisZumLetztenSatz("Er sagte: „Rössing ist durch.“")).toBe(
			"Er sagte: „Rössing ist durch.“",
		);
	});

	it("gibt auf, wenn kein ganzer Satz übrig bleibt", () => {
		expect(pruefeAntwort("In Rössing sind die Zahlen gerade", k)).toEqual({
			fehler: "kein vollständiger Satz",
		});
	});

	it("prüft die Zahlen erst am zurückgeschnittenen Satz", () => {
		// Die erfundene Zahl steht im abgeschnittenen Rest – sie darf die
		// sprechbaren Sätze davor nicht mit sich reißen.
		expect(
			pruefeAntwort("Rössing ist durch. Die CDU holt 47 Prozent und", k),
		).toEqual({ satz: "Rössing ist durch." });
	});
});
