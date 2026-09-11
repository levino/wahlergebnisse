/** Die Regeln der Einblender auf der Leinwand – ohne Browser prüfbar. */
import { describe, expect, it } from "vitest";
import {
	type FolienStand,
	type Meldung,
	type ParteiStand,
	alleMeldungen,
	ansage,
	eigeneMeldungen,
	klangArt,
	kodiereStaende,
	liesStaende,
	satz,
	sprechsatz,
	vergleiche,
	zahlwort,
} from "./meldungen.ts";

const stand = (a: Partial<FolienStand> = {}): FolienStand => ({
	ort: "Rössing",
	wahl: "Ortsratswahl",
	anz: 1,
	max: 3,
	art: "zwischenstand",
	spitze: "SPD",
	...a,
});

const karte = (s: FolienStand) => new Map([["ortsrat-roessing", s]]);

describe("vergleiche", () => {
	it("meldet nichts über eine Folie, die es vorher nicht gab", () => {
		// Beim ersten Aufbau ist alles neu. Eine Meldung je Folie hieße: ein
		// Dutzend Einblender über Zahlen, die längst dastehen.
		expect(vergleiche(new Map(), karte(stand()))).toEqual([]);
	});

	it("meldet nichts, wenn sich nichts geändert hat", () => {
		expect(vergleiche(karte(stand()), karte(stand()))).toEqual([]);
	});

	it("macht aus der letzten Schnellmeldung die Nachricht des Abends", () => {
		const m = vergleiche(karte(stand({ anz: 2 })), karte(stand({ anz: 3 })));
		expect(m).toHaveLength(1);
		expect(m[0].art).toBe("fertig");
		expect(m[0].text).toBe("Rössing ist fertig ausgezählt!");
	});

	it("meldet den Fortschritt, solange noch gezählt wird", () => {
		const m = vergleiche(karte(stand({ anz: 1 })), karte(stand({ anz: 2 })));
		expect(m[0]).toMatchObject({ art: "stand", text: "2 von 3 ausgezählt" });
		// Die nackten Zahlen kommen mit, damit die Ansage sie ausschreiben kann.
		expect(m[0]).toMatchObject({ anz: 2, max: 3 });
	});

	it("meldet einen Führungswechsel mit beiden Namen", () => {
		// „CDU 34,1 %" allein sagt nicht, dass sich etwas gedreht hat – die
		// Nachricht ist das Vorbeiziehen.
		const m = vergleiche(
			karte(stand({ spitze: "SPD" })),
			karte(stand({ spitze: "CDU", anz: 2 })),
		);
		expect(m[0]).toMatchObject({
			art: "spitze",
			text: "CDU zieht an SPD vorbei",
		});
	});

	it("meldet je Folie höchstens eines – das Wichtigste", () => {
		// Eine Schnellmeldung ändert Auszählstand, Datenstand und Spitze auf
		// einen Schlag.
		const m = vergleiche(
			karte(stand({ anz: 2, spitze: "SPD" })),
			karte(stand({ anz: 3, spitze: "CDU", art: "endergebnis" })),
		);
		expect(m).toHaveLength(1);
		expect(m[0].art).toBe("fertig");
	});

	it("stellt die wichtigste Meldung nach vorn", () => {
		const alt = new Map([
			[
				"rat",
				stand({
					ort: "Nordstemmen",
					wahl: "Gemeinderatswahl",
					anz: 5,
					max: 23,
				}),
			],
			["ortsrat-roessing", stand({ anz: 2 })],
		]);
		const neu = new Map([
			[
				"rat",
				stand({
					ort: "Nordstemmen",
					wahl: "Gemeinderatswahl",
					anz: 6,
					max: 23,
				}),
			],
			["ortsrat-roessing", stand({ anz: 3 })],
		]);
		expect(vergleiche(alt, neu).map((m) => m.art)).toEqual(["fertig", "stand"]);
	});

	it("nennt die Hochrechnung, sobald sie steht", () => {
		const m = vergleiche(
			karte(stand({ art: "zwischenstand" })),
			karte(stand({ art: "hochrechnung", anz: 2 })),
		);
		expect(m[0]).toMatchObject({ art: "hochrechnung" });
	});
});

describe("ansage", () => {
	const m = (art: string, text: string, zahlen: Partial<Meldung> = {}) =>
		({
			ort: "Rössing",
			wahl: "Ortsratswahl",
			art,
			text,
			...zahlen,
		}) as Meldung;

	it("nennt die Wahl, nicht nur den Ort", () => {
		// „Rössing ist fertig ausgezählt" ließe im Saal offen, welche Wahl –
		// eine Gemeinde führt an dem Abend fünf davon.
		expect(satz(m("fertig", "Rössing ist fertig ausgezählt!"))).toBe(
			"Ortsratswahl Rössing: fertig ausgezählt!",
		);
	});

	it("sagt bei einem Schub genau das Wichtigste", () => {
		// Fünf Sätze hintereinander hört niemand zu Ende, und der letzte wäre
		// der wichtigste gewesen. Der Rest steht als Einblender daneben.
		const text = ansage([
			m("fertig", "Rössing ist fertig ausgezählt!"),
			m("stand", "3 von 5 ausgezählt"),
			m("stand", "4 von 9 ausgezählt"),
		]);
		expect(text).toBe("Ortsratswahl Rössing ist fertig ausgezählt.");
	});

	it("schweigt beim bloßen Auszählstand", () => {
		// Die häufigste Meldung des Abends und die uninteressanteste – und der
		// einzige Satz, der sich nicht vorab erzeugen ließe.
		expect(ansage([m("stand", "3 von 5 ausgezählt", { anz: 3, max: 5 })])).toBe(
			"",
		);
	});

	it("schweigt, wenn nichts passiert ist", () => {
		expect(ansage([])).toBe("");
	});

	it("stellt die eigene Partei voran und das Gebiet dahinter", () => {
		// „CDU liegt vorn!" ist der Satz, auf den es ankommt – wo, ist die
		// Nachfrage. Bei allen anderen Meldungen ist es umgekehrt.
		expect(satz(m("jubel", "CDU liegt vorn!"))).toBe(
			"CDU liegt vorn! – Ortsratswahl Rössing.",
		);
	});
});

describe("kodiereStaende / liesStaende", () => {
	const staende: ParteiStand[] = [
		{ key: "cdu", platz: 1, prozent: 34.1, sitze: 9 },
		{ key: "spd", platz: 2, prozent: 30, sitze: 8 },
	];

	it("bringt die Stände unverändert durch das Merkmal", () => {
		expect(liesStaende(kodiereStaende(staende))).toEqual(staende);
	});

	it("unterscheidet keine Sitze von gar keiner Sitzverteilung", () => {
		// Ohne diesen Unterschied meldete die Leinwand einen verlorenen Sitz,
		// sobald eine Bürgermeisterfolie neben einer Ratsfolie steht.
		const ohne: ParteiStand[] = [{ key: "cdu", platz: 1, prozent: 51.2 }];
		expect(kodiereStaende(ohne)).toBe("cdu:1:51.2:-");
		expect(liesStaende("cdu:1:51.2:-")[0].sitze).toBe(undefined);
		expect(liesStaende("cdu:1:51.2:0")[0].sitze).toBe(0);
	});

	it("kommt mit einer Folie ohne Balken zurecht", () => {
		expect(kodiereStaende([])).toBe("");
		expect(liesStaende("")).toEqual([]);
		expect(liesStaende(undefined)).toEqual([]);
	});
});

describe("eigeneMeldungen", () => {
	const cdu = { key: "cdu", kurz: "CDU" };
	const mit = (...p: ParteiStand[]) => stand({ parteien: p });
	const platz = (n: number, prozent = 30, sitze?: number): ParteiStand => ({
		key: "cdu",
		platz: n,
		prozent,
		sitze,
	});

	it("schweigt, solange keine Partei eingestellt ist", () => {
		// Ohne Einstellung ist der Abend eine Auswertung und keine Fieberkurve.
		expect(
			eigeneMeldungen(karte(mit(platz(2))), karte(mit(platz(1))), undefined),
		).toEqual([]);
	});

	it("ruft es aus, wenn die eigene Partei vorn liegt", () => {
		const m = eigeneMeldungen(karte(mit(platz(2))), karte(mit(platz(1))), cdu);
		expect(m).toEqual([
			{
				ort: "Rössing",
				wahl: "Ortsratswahl",
				art: "jubel",
				text: "CDU liegt vorn!",
			},
		]);
	});

	it("nennt den Platz, wenn es nicht für die Spitze reicht", () => {
		const m = eigeneMeldungen(karte(mit(platz(4))), karte(mit(platz(3))), cdu);
		expect(m[0]).toMatchObject({
			art: "jubel",
			text: "CDU klettert auf Platz 3",
		});
	});

	it("sagt auch, wenn es rückwärts geht", () => {
		const runter = eigeneMeldungen(
			karte(mit(platz(1))),
			karte(mit(platz(2))),
			cdu,
		);
		expect(runter[0]).toMatchObject({
			art: "abstieg",
			text: "CDU liegt nicht mehr vorn",
		});
		const tiefer = eigeneMeldungen(
			karte(mit(platz(2))),
			karte(mit(platz(3))),
			cdu,
		);
		expect(tiefer[0]).toMatchObject({
			art: "abstieg",
			text: "CDU rutscht auf Platz 3",
		});
	});

	it("meldet gewonnene und verlorene Sitze mit dem neuen Stand", () => {
		const dazu = eigeneMeldungen(
			karte(mit(platz(2, 30, 8))),
			karte(mit(platz(2, 30, 9))),
			cdu,
		);
		expect(dazu[0]).toMatchObject({
			art: "jubel",
			text: "CDU gewinnt einen Sitz – jetzt 9",
		});
		const weg = eigeneMeldungen(
			karte(mit(platz(2, 30, 9))),
			karte(mit(platz(2, 30, 7))),
			cdu,
		);
		expect(weg[0]).toMatchObject({
			art: "abstieg",
			text: "CDU verliert 2 Sitze – nur noch 7",
		});
	});

	it("meldet einen deutlichen Sprung im Anteil – und das Rauschen nicht", () => {
		// Ein einzelner Wahlbezirk bewegt den Anteil um Zehntel. Eine Fanfare
		// je Zehntel wäre nach einer halben Stunde kein Jubel mehr.
		expect(
			eigeneMeldungen(
				karte(mit(platz(2, 30))),
				karte(mit(platz(2, 30.4))),
				cdu,
			),
		).toEqual([]);
		const sprung = eigeneMeldungen(
			karte(mit(platz(2, 30))),
			karte(mit(platz(2, 32.5))),
			cdu,
		);
		expect(sprung[0]).toMatchObject({
			art: "jubel",
			text: "CDU legt zu: 32,5 %",
		});
	});

	it("meldet je Folie nur das Größte – der Platz vor dem Sitz", () => {
		// Ein Wahlbezirk ändert Platz, Sitz und Anteil auf einen Schlag; drei
		// Fanfaren übereinander wären dieselbe Nachricht dreimal.
		const m = eigeneMeldungen(
			karte(mit(platz(2, 30, 8))),
			karte(mit(platz(1, 34, 9))),
			cdu,
		);
		expect(m).toHaveLength(1);
		expect(m[0].text).toBe("CDU liegt vorn!");
	});

	it("meldet nichts über eine Partei ohne Vergleich", () => {
		// Wer neu in die gezeigten Balken rutscht, hat kein Vorher – eine
		// Meldung darüber wäre geraten.
		expect(
			eigeneMeldungen(
				karte(mit({ key: "spd", platz: 1, prozent: 40 })),
				karte(mit(platz(2))),
				cdu,
			),
		).toEqual([]);
	});

	it("kennt keine Partei auf einer Folie ohne Stände", () => {
		expect(eigeneMeldungen(karte(stand()), karte(stand()), cdu)).toEqual([]);
	});
});

describe("alleMeldungen", () => {
	const cdu = { key: "cdu", kurz: "CDU" };

	it("stellt die eigene Partei vor jede fremde Nachricht", () => {
		// Wer seine Partei eingestellt hat, ist an dem Abend ihretwegen da.
		const alt = karte(
			stand({ anz: 2, parteien: [{ key: "cdu", platz: 2, prozent: 30 }] }),
		);
		const neu = karte(
			stand({ anz: 3, parteien: [{ key: "cdu", platz: 1, prozent: 34 }] }),
		);
		const m = alleMeldungen(alt, neu, cdu);
		expect(m.map((x) => x.art)).toEqual(["jubel", "fertig"]);
	});

	it("bleibt ohne eingestellte Partei bei den gewohnten Meldungen", () => {
		const m = alleMeldungen(karte(stand({ anz: 2 })), karte(stand({ anz: 3 })));
		expect(m.map((x) => x.art)).toEqual(["fertig"]);
	});
});

describe("klangArt", () => {
	const m = (art: string) =>
		({ ort: "Rössing", wahl: "Ortsratswahl", art, text: "" }) as Parameters<
			typeof satz
		>[0];

	it("gibt der eigenen Partei die Fanfare", () => {
		expect(klangArt([m("jubel"), m("fertig")])).toBe("jubel");
		expect(klangArt([m("abstieg")])).toBe("abstieg");
	});

	it("lässt es bei den gewohnten Tönen, wo es nicht um die eigene geht", () => {
		expect(klangArt([m("fertig")])).toBe("fertig");
		expect(klangArt([m("stand")])).toBe("neu");
		expect(klangArt([])).toBe("neu");
	});
});

describe("sprechsatz", () => {
	const m = (art: string, text: string, zahlen: Partial<Meldung> = {}) =>
		({ ort: "Rössing", wahl: "Ortsratswahl", art, text, ...zahlen }) as Meldung;

	it("macht aus dem Doppelpunkt einen ganzen Satz", () => {
		// Gehört ist ein Doppelpunkt nichts: Die einen lesen ihn als Pause, die
		// anderen gar nicht. Ein Verb versteht jeder.
		expect(sprechsatz(m("fertig", "Rössing ist fertig ausgezählt!"))).toBe(
			"Ortsratswahl Rössing ist fertig ausgezählt.",
		);
	});

	it("schreibt den Auszählstand in Wörtern", () => {
		// „8 von 23" liest jede Stimme anders – ausgeschrieben alle gleich.
		expect(
			sprechsatz(m("stand", "8 von 23 ausgezählt", { anz: 8, max: 23 })),
		).toBe(
			"Ortsratswahl Rössing. acht von dreiundzwanzig Wahlbezirken ausgezählt.",
		);
	});

	it("kommt auch ohne bekannte Höchstzahl aus", () => {
		expect(
			sprechsatz(m("stand", "4 Schnellmeldungen", { anz: 4, max: 0 })),
		).toContain("vier Schnellmeldungen");
	});

	it("lässt die Namen beim Führungswechsel stehen", () => {
		expect(sprechsatz(m("spitze", "CDU zieht an SPD vorbei"))).toBe(
			"Ortsratswahl Rössing. CDU zieht an SPD vorbei.",
		);
	});
});

describe("große Wahlen melden in Zehnerschritten", () => {
	// Die kreisweiten Wahlen haben rund 426 Auszähleinheiten, die einer
	// Gemeinde 18 bis 23. Ohne diese Regel meldete der Kreistag alle acht
	// Sekunden und übertönte genau das, wofür die Leinwand im Saal steht.
	const kreis = (anz: number) =>
		new Map([
			[
				"kreistag",
				stand({ ort: "Hildesheim", wahl: "Kreistagswahl", anz, max: 426 }),
			],
		]);

	it("meldet beim Überschreiten einer Zehnerschwelle", () => {
		expect(vergleiche(kreis(38), kreis(47))[0]).toMatchObject({
			art: "stand",
			prozent: 10,
			text: "10 Prozent ausgezählt",
		});
	});

	it("schweigt zwischen zwei Schwellen", () => {
		// 11 % auf 19 % – vierzig Schnellmeldungen ohne eine einzige Meldung.
		expect(vergleiche(kreis(47), kreis(81))).toEqual([]);
	});

	it("meldet bei der nächsten Schwelle wieder", () => {
		expect(vergleiche(kreis(81), kreis(90))[0]).toMatchObject({ prozent: 20 });
	});

	it("meldet weder null noch hundert Prozent", () => {
		// Null ist keine Nachricht, und „hundert Prozent" sagt schon „fertig".
		expect(vergleiche(kreis(0), kreis(20))).toEqual([]);
		expect(vergleiche(kreis(420), kreis(426))[0]).toMatchObject({
			art: "fertig",
		});
	});

	it("lässt die seltenen Meldungen unangetastet", () => {
		const a = kreis(100);
		const b = new Map([
			[
				"kreistag",
				stand({
					ort: "Hildesheim",
					wahl: "Kreistagswahl",
					anz: 101,
					max: 426,
					art: "hochrechnung",
				}),
			],
		]);
		expect(vergleiche(a, b)[0]).toMatchObject({ art: "hochrechnung" });
	});

	it("meldet bei einer Gemeindewahl weiter jede Schnellmeldung", () => {
		// 23 Schnellmeldungen über einen Abend sind kein Dauerfeuer – dort ist
		// jede einzelne die Nachricht.
		expect(
			vergleiche(karte(stand({ anz: 1 })), karte(stand({ anz: 2 })))[0],
		).toMatchObject({ text: "2 von 3 ausgezählt" });
	});

	it("schreibt die Schwelle in der Ansage aus", () => {
		const m = vergleiche(kreis(38), kreis(47))[0];
		expect(sprechsatz(m)).toBe(
			"Kreistagswahl Hildesheim. zehn Prozent ausgezählt.",
		);
	});
});

describe("die eigene Partei, gesprochen", () => {
	const eigen = (text: string, art: "jubel" | "abstieg" = "jubel") =>
		({ ort: "Rössing", wahl: "Ortsratswahl", art, text }) as Meldung;

	it("sagt zuerst die Nachricht und dann das Gebiet", () => {
		expect(sprechsatz(eigen("CDU liegt vorn!"))).toBe(
			"CDU liegt vorn! – Ortsratswahl Rössing.",
		);
	});

	it("rundet Prozente in der Ansage auf ganze Prozent", () => {
		// „vierunddreißig Komma eins" stolpert beim Sprechen, und aus fünf
		// Metern ist die Nachkommastelle nicht die Information. Zugleich
		// zehntelt es die Zahl verschiedener Sätze – und teuer ist am
		// Ansagedienst genau die.
		expect(sprechsatz(eigen("CDU legt zu: 34,1 %"))).toBe(
			"CDU legt zu: vierunddreißig Prozent – Ortsratswahl Rössing.",
		);
	});

	it("lässt den genauen Wert auf der Leinwand stehen", () => {
		// Nur die Ansage rundet. Eine gerundete Zahl neben einem genauen
		// Balken wäre schlicht falsch – hier wird gelesen, nicht gehört.
		expect(satz(eigen("CDU legt zu: 34,1 %"))).toBe(
			"CDU legt zu: 34,1 % – Ortsratswahl Rössing.",
		);
	});

	it("schreibt auch Plätze und Sitze aus", () => {
		expect(sprechsatz(eigen("CDU klettert auf Platz 3"))).toContain(
			"Platz drei",
		);
		expect(
			sprechsatz(eigen("CDU verliert 2 Sitze – nur noch 10", "abstieg")),
		).toContain("zwei Sitze – nur noch zehn");
	});

	it("wird angesagt – sie ist der Grund für das Ganze", () => {
		expect(ansage([eigen("CDU liegt vorn!")])).toBe(
			"CDU liegt vorn! – Ortsratswahl Rössing.",
		);
	});
});

describe("Ansage und Vorproduktion sagen denselben Satz", () => {
	it("was der Server vorab erzeugt, fordert der Browser genau so an", async () => {
		// Die Aufnahme liegt unter dem Hash ihres Satzes. Laufen die beiden
		// Fassungen auseinander, findet der Browser sie nicht – er merkt es
		// nicht einmal, weil er dann selbst spricht, und die erzeugte Datei
		// wäre bezahlt und nie gespielt. Deshalb hier festgenagelt.
		const folie = { ort: "Rössing", wahl: "Ortsratswahl" };
		const vorab = sprechsatz({ ...folie, art: "fertig", text: "" });
		const angefordert = ansage(
			vergleiche(
				karte(stand({ ...folie, anz: 2, max: 3 })),
				karte(stand({ ...folie, anz: 3, max: 3 })),
			),
		);
		expect(angefordert).toBe(vorab);
	});
});

describe("zahlwort", () => {
	it("schreibt die Zahlen aus, die am Wahlabend vorkommen", () => {
		expect(zahlwort(0)).toBe("null");
		expect(zahlwort(1)).toBe("eins");
		expect(zahlwort(8)).toBe("acht");
		expect(zahlwort(16)).toBe("sechzehn");
		expect(zahlwort(20)).toBe("zwanzig");
		// „einundzwanzig", nicht „einsundzwanzig".
		expect(zahlwort(21)).toBe("einundzwanzig");
		expect(zahlwort(23)).toBe("dreiundzwanzig");
		expect(zahlwort(30)).toBe("dreißig");
		expect(zahlwort(77)).toBe("siebenundsiebzig");
		expect(zahlwort(100)).toBe("einhundert");
		expect(zahlwort(123)).toBe("einhundertdreiundzwanzig");
		expect(zahlwort(1000)).toBe("eintausend");
		expect(zahlwort(2021)).toBe("zweitausendeinundzwanzig");
	});

	it("gibt große und krumme Zahlen unverändert zurück", () => {
		// Ausgeschrieben gewönne daran niemand etwas – und im Auszählstand
		// kommen solche Zahlen ohnehin nicht vor.
		expect(zahlwort(12345)).toBe("12345");
		expect(zahlwort(1.5)).toBe("1.5");
		expect(zahlwort(-3)).toBe("-3");
	});
});
