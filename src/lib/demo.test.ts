/** Die Rechenregeln der Generalprobe – ohne Datenbank prüfbar. */
import { describe, expect, it } from "vitest";
import {
	NACHLAUF_SEKUNDEN,
	VORLAUF_ANTEIL,
	ZYKLUS_SEKUNDEN_STANDARD,
	eingangsAnteil,
	eingangsZeit,
	mische,
	rauschFaktor,
	zaehleZusammen,
	zyklusVon,
} from "./demo.ts";
import type { Ergebnis } from "./votemanager.ts";

const bezirk = (name: string, spd: number, cdu: number): Ergebnis => ({
	titel: name,
	gebietTitel: name,
	gebietKurz: name,
	zeitstempel: "2026-09-13T18:30:00.000Z",
	leer: false,
	personenwahl: false,
	stand: { anz: 1, max: 1, hinweis: [] },
	kennzahlen: {
		wahlberechtigte: 1000,
		waehler: 600,
		wahlbeteiligung: 60,
		ungueltig: 10,
	},
	parteien: [
		{
			key: "spd",
			kurz: "SPD",
			lang: "SPD",
			farbe: "#d60029",
			stimmen: spd,
			prozent: 0,
		},
		{
			key: "cdu",
			kurz: "CDU",
			lang: "CDU",
			farbe: "#000000",
			stimmen: cdu,
			prozent: 0,
		},
	],
	untergebiete: [],
});

describe("zyklusVon", () => {
	it("hält am Anfang den leeren Saal und am Ende das fertige Bild", () => {
		const s = ZYKLUS_SEKUNDEN_STANDARD * 1000;
		expect(zyklusVon(0).fortschritt).toBe(0);
		expect(zyklusVon(s * VORLAUF_ANTEIL * 0.5).fortschritt).toBe(0);
		expect(zyklusVon(s - NACHLAUF_SEKUNDEN * 500).fortschritt).toBe(1);
	});

	it("zählt dazwischen gleichmäßig hoch", () => {
		const s = ZYKLUS_SEKUNDEN_STANDARD * 1000;
		const mitte = zyklusVon(s * 0.5).fortschritt;
		expect(mitte).toBeGreaterThan(0.3);
		expect(mitte).toBeLessThan(0.7);
	});

	it("zählt die Durchläufe, damit jeder anders aussieht", () => {
		const s = ZYKLUS_SEKUNDEN_STANDARD * 1000;
		expect(zyklusVon(s * 3.5).nummer).toBe(3);
		expect(zyklusVon(s * 4.5).nummer).toBe(4);
	});

	it("fängt am Nullpunkt beim leeren Saal an", () => {
		// Wer die Demo aufruft, kurz nachdem sie gestartet ist, soll den Abend
		// von vorn sehen und nicht mitten in einer halb ausgezählten Runde.
		const beginn = Date.UTC(2026, 8, 13, 16, 0, 0);
		const z = zyklusVon(beginn + 1000, ZYKLUS_SEKUNDEN_STANDARD, beginn);
		expect(z.nummer).toBe(0);
		expect(z.fortschritt).toBe(0);
		expect(z.beginn).toBe(beginn);
	});
});

describe("eingangsZeit", () => {
	const beginn = Date.UTC(2026, 8, 13, 16, 0, 0);
	const zyklus = zyklusVon(beginn, ZYKLUS_SEKUNDEN_STANDARD, beginn);

	it("steht still, solange keine Meldung dazukommt", () => {
		// Der Zeitstempel eines Ergebnisses ist eine Aussage über den Stand,
		// keine Uhr: Zweimal derselbe Auszählstand heißt zweimal dieselbe Zeit –
		// sonst schriebe die Demo jede Zeile alle fünf Sekunden neu.
		expect(eingangsZeit(zyklus, [0.1, 0.4, 0.25])).toBe(
			eingangsZeit(zyklus, [0.1, 0.4, 0.25]),
		);
	});

	it("gehört zur zuletzt eingegangenen Einheit, nicht zu ihrer Zahl", () => {
		// Zehn frühe Meldungen sind älter als eine späte: Der Stempel folgt der
		// jüngsten Einheit, nicht dem Auszählstand.
		expect(eingangsZeit(zyklus, [0.1, 0.2, 0.3])).toBe(
			eingangsZeit(zyklus, [0.3]),
		);
		expect(eingangsZeit(zyklus, [0.1, 0.5])).toBeGreaterThan(
			eingangsZeit(zyklus, [0.1, 0.2, 0.3]),
		);
	});

	it("liegt im Durchlauf, nach dem Vorlauf und vor dem Nachlauf", () => {
		const s = ZYKLUS_SEKUNDEN_STANDARD * 1000;
		// Ohne Eingang: der leere Saal, in dem die Zählung gerade beginnt.
		expect(eingangsZeit(zyklus, [])).toBe(beginn + s * VORLAUF_ANTEIL);
		expect(eingangsZeit(zyklus, [1])).toBe(
			beginn + s - NACHLAUF_SEKUNDEN * 1000,
		);
	});
});

describe("eingangsAnteil", () => {
	const einheiten = Array.from({ length: 40 }, (_, i) => `bezirk-${i}`);
	const anteile = (zyklusNummer = 7) =>
		einheiten.map((e) => eingangsAnteil(zyklusNummer, e));

	it("liegt in der Zählphase: bei Fortschritt 0 nichts, am Ende alles", () => {
		for (const a of anteile()) {
			expect(a).toBeGreaterThan(0);
			expect(a).toBeLessThanOrEqual(1);
		}
	});

	it("ist zustandslos: gleicher Startwert, gleicher Abend", () => {
		// Zwei Anfragen im selben Augenblick – und ein Neustart des Prozesses –
		// müssen denselben Abend sehen.
		expect(anteile()).toEqual(anteile());
		expect(eingangsAnteil(7, "a")).not.toBe(eingangsAnteil(8, "a"));
		expect(eingangsAnteil(7, "a")).not.toBe(eingangsAnteil(7, "b"));
	});

	it("kommt ungleichmäßig herein – mit Klumpen und Lücken", () => {
		// Der Sinn der Übung: Vorher rückten alle Einheiten im Gleichschritt vor
		// und die Leinwand bekam Schwälle. Ein echter Abend hat Abstände, die
		// sich um ein Vielfaches unterscheiden – zwei Meldungen fast zugleich,
		// dann minutenlang nichts.
		const sortiert = [...anteile()].sort((a, b) => a - b);
		const abstaende = sortiert
			.slice(1)
			.map((a, i) => a - sortiert[i])
			.sort((a, b) => a - b);
		const mittlerer = abstaende[Math.floor(abstaende.length / 2)];
		const groesster = abstaende[abstaende.length - 1];
		expect(groesster).toBeGreaterThan(mittlerer * 3);
		// Und die Eingänge sind nicht durch die Einheitenzahl geteilt: Gleich
		// verteilt läge jeder Abstand bei 1/40.
		expect(abstaende[0]).toBeLessThan(1 / einheiten.length);
	});

	it("drängt sich zum Anfang der Zählphase – kleine Bezirke melden früh", () => {
		// Die Krümmung zieht die Zeitpunkte nach vorn: In der ersten Hälfte der
		// Zählphase geht mehr ein als in der zweiten.
		const frueh = anteile().filter((a) => a <= 0.5).length;
		expect(frueh).toBeGreaterThan(einheiten.length / 2);
	});
});

describe("mische", () => {
	it("mischt bei gleichem Startwert immer gleich", () => {
		// Zwei Anfragen im selben Augenblick müssen denselben Abend sehen.
		const a = mische([1, 2, 3, 4, 5, 6, 7, 8], "abend");
		expect(mische([1, 2, 3, 4, 5, 6, 7, 8], "abend")).toEqual(a);
		expect(a).not.toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
		expect([...a].sort()).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
	});

	it("mischt bei anderem Startwert anders", () => {
		expect(mische([1, 2, 3, 4, 5, 6, 7, 8], "a")).not.toEqual(
			mische([1, 2, 3, 4, 5, 6, 7, 8], "b"),
		);
	});
});

describe("rauschFaktor", () => {
	it("bleibt in der Nähe von eins", () => {
		for (const key of ["spd", "cdu", "gruene", "fdp"])
			for (const z of [1, 2, 99]) {
				const f = rauschFaktor(z, key);
				expect(f).toBeGreaterThan(0.9);
				expect(f).toBeLessThan(1.1);
			}
	});

	it("verschiebt die Parteien verschieden – sonst bewegte sich nichts", () => {
		expect(rauschFaktor(1, "spd")).not.toBe(rauschFaktor(1, "cdu"));
		expect(rauschFaktor(1, "spd")).not.toBe(rauschFaktor(2, "spd"));
	});
});

describe("zaehleZusammen", () => {
	const vorlage = bezirk("Gemeinde", 0, 0);
	const eins = () => 1;

	it("summiert Stimmen und Kennzahlen der eingegangenen Bezirke", () => {
		const e = zaehleZusammen(
			vorlage,
			[bezirk("A", 100, 50), bezirk("B", 60, 90)],
			2,
			3,
			eins,
		);
		expect(e.parteien.find((p) => p.key === "spd")?.stimmen).toBe(160);
		expect(e.parteien.find((p) => p.key === "cdu")?.stimmen).toBe(140);
		expect(e.kennzahlen.wahlberechtigte).toBe(2000);
		expect(e.kennzahlen.wahlbeteiligung).toBe(60);
		expect(e.stand).toMatchObject({ anz: 2, max: 3 });
	});

	it("rechnet die Anteile aus der Summe, nicht aus der Vorlage", () => {
		const e = zaehleZusammen(vorlage, [bezirk("A", 300, 100)], 1, 3, eins);
		expect(e.parteien.find((p) => p.key === "spd")?.prozent).toBe(75);
		expect(e.parteien.find((p) => p.key === "cdu")?.prozent).toBe(25);
	});

	it("ist leer, solange nichts eingegangen ist", () => {
		const e = zaehleZusammen(vorlage, [], 0, 3, eins);
		expect(e.leer).toBe(true);
		expect(e.parteien.every((p) => p.stimmen === 0)).toBe(true);
	});

	it("gibt Sitze erst heraus, wenn alles ausgezählt ist", () => {
		// Vorher rechnet die Anwendung selbst hoch – und genau das soll die
		// Generalprobe ja vorführen.
		const mitSitzen: Ergebnis = {
			...vorlage,
			sitze: { gesamt: 30, hinweis: "", verteilung: [], gewaehlte: [] },
		};
		expect(
			zaehleZusammen(mitSitzen, [bezirk("A", 1, 1)], 1, 3, eins).sitze,
		).toBeUndefined();
		expect(
			zaehleZusammen(mitSitzen, [bezirk("A", 1, 1)], 3, 3, eins).sitze,
		).toBeDefined();
	});

	it("wendet das Rauschen je Partei an", () => {
		const e = zaehleZusammen(vorlage, [bezirk("A", 1000, 1000)], 1, 1, (key) =>
			key === "spd" ? 1.1 : 0.9,
		);
		expect(e.parteien.find((p) => p.key === "spd")?.stimmen).toBe(1100);
		expect(e.parteien.find((p) => p.key === "cdu")?.stimmen).toBe(900);
	});
});
