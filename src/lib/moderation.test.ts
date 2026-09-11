import { describe, expect, it } from "vitest";
import type { Ereignis } from "./abfragen.ts";
import type { WahlFolie } from "./dashboard.ts";
import type { FolienStand } from "./meldungen.ts";
import {
	type Schub,
	type WahlKontext,
	beitraegeAus,
	erfundeneZahlen,
	kontextText,
	pruefeAntwort,
	wahlKontext,
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

const schub = (wahlen: WahlKontext[], fest = "Nordstemmen."): Schub => ({
	behoerde: "03254026",
	termin: "2026-09-13",
	partei: "CDU",
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
		const schlecht = pruefeAntwort("Die CDU kommt auf 47 Prozent.", k, 240);
		expect(schlecht).toHaveProperty("fehler");
		const gut = pruefeAntwort(
			"Da kommen neue Zahlen rein – Rössing hat ausgezählt, und die CDU zieht an der SPD vorbei.",
			k,
			240,
		);
		expect(gut).toEqual({
			satz: "Da kommen neue Zahlen rein – Rössing hat ausgezählt, und die CDU zieht an der SPD vorbei.",
		});
	});
});

describe("die Länge", () => {
	const k = kontext();

	it("lässt dem Moderator seine Sätze", () => {
		const fuenf =
			"Neue Zahlen sind da. Rössing ist durch. Die CDU liegt vorn. Aber es bleibt eng. Erst die Hälfte ist ausgezählt.";
		expect(pruefeAntwort(fuenf, k, 600)).toEqual({ satz: fuenf });
	});

	it("nimmt trotzdem keinen Vortrag", () => {
		const sieben = "Kurz. ".repeat(7).trim();
		expect(pruefeAntwort(sieben, k, 600)).toHaveProperty("fehler");
	});

	it("nimmt keinen Satz, den die Sprachausgabe abschneidet", () => {
		expect(pruefeAntwort(`${"Wort ".repeat(60)}.`, k, 240)).toHaveProperty(
			"fehler",
		);
	});

	it("streift Anführungszeichen und Zeilenumbrüche ab", () => {
		expect(pruefeAntwort("  „Rössing ist durch.“  ", k, 240)).toEqual({
			satz: "Rössing ist durch.",
		});
	});
});
