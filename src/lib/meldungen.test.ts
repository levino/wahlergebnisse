/** Die Regeln der Einblender auf der Leinwand – ohne Browser prüfbar. */
import { describe, expect, it } from "vitest";
import { type FolienStand, vergleiche } from "./meldungen.ts";

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
			["rat", stand({ ort: "Nordstemmen", wahl: "Gemeinderatswahl", anz: 5, max: 23 })],
			["ortsrat-roessing", stand({ anz: 2 })],
		]);
		const neu = new Map([
			["rat", stand({ ort: "Nordstemmen", wahl: "Gemeinderatswahl", anz: 6, max: 23 })],
			["ortsrat-roessing", stand({ anz: 3 })],
		]);
		expect(vergleiche(alt, neu).map((m) => m.art)).toEqual([
			"fertig",
			"stand",
		]);
	});

	it("nennt die Hochrechnung, sobald sie steht", () => {
		const m = vergleiche(
			karte(stand({ art: "zwischenstand" })),
			karte(stand({ art: "hochrechnung", anz: 2 })),
		);
		expect(m[0]).toMatchObject({ art: "hochrechnung" });
	});
});
