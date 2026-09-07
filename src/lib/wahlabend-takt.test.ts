/**
 * Der Wahlabend als Rechnung: Was der eingestellte Takt über sieben Stunden
 * mit den echten 45 Kreisen anrichtet.
 *
 * Dieser Test spielt keine Daten durch – das tut
 * test/wahlabend-viele-kreise.test.ts gegen den Mock. Hier geht es um die
 * Zahlen aus dem Kopfkommentar von takt.ts: Wie alt wird ein Kreis, den
 * niemand ansieht? Wie viele Anfragen je Sekunde bekommt der größte Host ab?
 * Passt ein einzelner Lauf noch in den Grundtakt? Sobald jemand an den
 * Abständen oder am Deckel dreht, sagt dieser Test, was das bedeutet.
 *
 * Der Ansatz von 18 bedingten Anfragen je Behörde und Lauf ist gemessen:
 * ein Durchgang durch die 19 Hildesheimer Behörden kostet im eingeschwungenen
 * Zustand 342 Anfragen, wenn alle Ebenen mit Zahlen besetzt sind
 * (test/wahlabend-viele-kreise.test.ts hält die Messung fest).
 */
import { describe, expect, it } from "vitest";
import { KREISE } from "../data/kreise.ts";
import type { Termin } from "../data/termine.ts";
import { STANDARD_GRENZE, STANDARD_GRENZEN } from "./drossel.ts";
import {
	BETRACHTET_S,
	GRUNDTAKT_S,
	STANDARD_ABSTAENDE,
	STANDARD_HOECHSTENS,
	faelligeKreise,
} from "./takt.ts";

/** Gemessener Ansatz: bedingte Anfragen je Behörde und Lauf. */
const ANFRAGEN_JE_BEHOERDE = 18;

const wahltag: Termin = {
	id: "2026",
	titel: "Kommunalwahl 2026",
	datum: "2026-09-13",
	ordner: "20260913",
	layout: "v26",
	live: true,
	beschreibung: "",
};

const abfragbar = KREISE.filter((k) => k.vorhanden);

/** Anfragen, die ein Lauf über diesen Kreis auf welchem Host auslöst. */
const anfragenJeHost = (slug: string): Map<string, number> => {
	const kreis = abfragbar.find((k) => k.slug === slug)!;
	const m = new Map<string, number>();
	for (const b of kreis.behoerden) {
		const host = new URL(b.wurzel ?? kreis.basis).host;
		m.set(host, (m.get(host) ?? 0) + ANFRAGEN_JE_BEHOERDE);
	}
	return m;
};

const grenzeVon = (host: string) => STANDARD_GRENZEN[host] ?? STANDARD_GRENZE;

/**
 * Spielt den Abend im Minutentakt durch und protokolliert, wann welcher Kreis
 * geholt wurde und was das je Host gekostet hat.
 */
const spieleAbendDurch = (opts: {
	/** Slugs, die durchgehend jemand ansieht. */
	betrachtet: string[];
	von?: string;
	bis?: string;
}) => {
	const von = new Date(opts.von ?? "2026-09-13T15:00:00Z").getTime(); // 17 Uhr Berlin
	const bis = new Date(opts.bis ?? "2026-09-13T22:00:00Z").getTime(); // 24 Uhr Berlin
	const geholt = new Map<string, number>();
	const gesehen = new Map<string, number>();
	/** Host → Anfragen je Lauf, in Reihenfolge der Läufe. */
	const proLauf: Array<Map<string, number>> = [];
	const gesamtJeHost = new Map<string, number>();
	let hoechstesAlter = 0;
	let hoechstesAlterBetrachtet = 0;
	let groessterLauf = 0;
	const groessenDerLaeufe: number[] = [];

	for (let t = von; t <= bis; t += GRUNDTAKT_S * 1000) {
		for (const slug of opts.betrachtet) gesehen.set(slug, t);
		const faellig = faelligeKreise({
			jetzt: new Date(t),
			termine: [wahltag],
			kreise: abfragbar.map((k) => k.slug),
			gesehen,
			geholt,
			abstaende: STANDARD_ABSTAENDE,
			betrachtetS: BETRACHTET_S,
			hoechstens: STANDARD_HOECHSTENS,
		});
		const lauf = new Map<string, number>();
		for (const slug of faellig) {
			geholt.set(slug, t);
			for (const [host, n] of anfragenJeHost(slug)) {
				lauf.set(host, (lauf.get(host) ?? 0) + n);
				gesamtJeHost.set(host, (gesamtJeHost.get(host) ?? 0) + n);
			}
		}
		proLauf.push(lauf);
		groessenDerLaeufe.push(faellig.length);
		groessterLauf = Math.max(groessterLauf, faellig.length);

		// Alter messen, nachdem der Lauf durch ist: So alt wären die Zahlen,
		// wenn jetzt jemand irgendeinen Kreis öffnet.
		for (const k of abfragbar) {
			const alter = (t - (geholt.get(k.slug) ?? von)) / 1000;
			hoechstesAlter = Math.max(hoechstesAlter, alter);
			if (opts.betrachtet.includes(k.slug))
				hoechstesAlterBetrachtet = Math.max(hoechstesAlterBetrachtet, alter);
		}
	}

	const dauer = (bis - von) / 1000;
	return {
		dauer,
		laeufe: proLauf.length,
		hoechstesAlter,
		hoechstesAlterBetrachtet,
		groessterLauf,
		groessenDerLaeufe,
		gesamtJeHost,
		proLauf,
		rateJeHost: new Map(
			[...gesamtJeHost].map(([h, n]) => [h, n / dauer] as const),
		),
	};
};

describe("Wahlabend, 38 abfragbare Kreise", () => {
	it("kennt den Bestand, auf dem die Rechnung beruht", () => {
		expect(abfragbar).toHaveLength(38);
		expect(abfragbar.flatMap((k) => k.behoerden)).toHaveLength(371);
		const jeHost = new Map<string, number>();
		for (const k of abfragbar)
			for (const b of k.behoerden) {
				const host = new URL(b.wurzel ?? k.basis).host;
				jeHost.set(host, (jeHost.get(host) ?? 0) + 1);
			}
		expect(jeHost.get("votemanager.kdo.de")).toBe(350);
		expect(jeHost.get("wahlen.kreis-hi.de")).toBe(19);
	});

	it("lässt keinen Kreis stundenlang alt werden – höchstens vier Minuten", () => {
		const abend = spieleAbendDurch({ betrachtet: ["hildesheim"] });
		// Abstand 180 s plus ein Grundtakt Wartezeit, bis der Lauf ihn mitnimmt.
		expect(abend.hoechstesAlter).toBeLessThanOrEqual(
			STANDARD_ABSTAENDE.wahlabend.uebrig + GRUNDTAKT_S,
		);
		expect(abend.hoechstesAlter).toBeLessThanOrEqual(240);
		// Der betrachtete Kreis bleibt im Minutentakt.
		expect(abend.hoechstesAlterBetrachtet).toBeLessThanOrEqual(
			STANDARD_ABSTAENDE.wahlabend.betrachtet,
		);
	});

	it("bleibt auf jedem Host unter seinem Anfragenkonto", () => {
		const abend = spieleAbendDurch({ betrachtet: ["hildesheim"] });
		for (const [host, rate] of abend.rateJeHost) {
			expect(rate, `${host}: ${rate.toFixed(1)} Anfragen/s`).toBeLessThan(
				grenzeVon(host).proSekunde,
			);
		}
		// Die Zahlen aus dem Kopfkommentar von takt.ts.
		expect(abend.rateJeHost.get("votemanager.kdo.de")).toBeCloseTo(35.1, 0);
		// Hildesheim wird durchgehend betrachtet: Grundlast plus Minutentakt.
		expect(abend.rateJeHost.get("wahlen.kreis-hi.de")).toBeCloseTo(5.7, 0);
	});

	it("hält auch zwölf gleichzeitig betrachtete Kreise aus", () => {
		const viele = abfragbar
			.filter((k) => k.basis.includes("kdo.de"))
			.slice(0, 12)
			.map((k) => k.slug);
		const abend = spieleAbendDurch({ betrachtet: viele });
		for (const [host, rate] of abend.rateJeHost)
			expect(rate, `${host}: ${rate.toFixed(1)} Anfragen/s`).toBeLessThan(
				grenzeVon(host).proSekunde,
			);
	});

	it("bringt einen einzelnen Lauf im Grundtakt unter", () => {
		const abend = spieleAbendDurch({ betrachtet: ["hildesheim"] });
		// Ein Lauf darf höchstens so viele Anfragen an einen Host stellen, wie
		// dessen Konto in einem Grundtakt hergibt – sonst schiebt sich der
		// nächste Lauf hinter den vorigen und der Rückstand wächst.
		for (const lauf of abend.proLauf)
			for (const [host, n] of lauf)
				expect(n, `${host}: ${n} Anfragen in einem Lauf`).toBeLessThanOrEqual(
					grenzeVon(host).proSekunde * GRUNDTAKT_S,
				);
	});

	it("verteilt die Last gleichmäßig auf die Minuten", () => {
		const abend = spieleAbendDurch({ betrachtet: ["hildesheim"] });
		// Der Deckel teilt den Kaltstart in drei Gruppen, die ihren Abstand
		// behalten: 15 / 15 / 8+1. Kein Lauf fasst mehr als den Deckel an.
		expect(abend.groessterLauf).toBe(STANDARD_HOECHSTENS.wahlabend);
		expect(abend.groessenDerLaeufe.slice(0, 6)).toEqual([
			15, 15, 10, 15, 15, 10,
		]);
		// Der größte Lauf kostet einem Host 2 592 Anfragen – bei 60 je Sekunde
		// 43 s und damit deutlich weniger als der Grundtakt von 60 s.
		const groessteHostlast = Math.max(
			...abend.proLauf.flatMap((l) => [...l.values()]),
		);
		expect(groessteHostlast).toBe(2574);
	});

	it("summiert sich über den Abend auf gut eine Million bedingte Anfragen", () => {
		const abend = spieleAbendDurch({ betrachtet: ["hildesheim"] });
		const summe = [...abend.gesamtJeHost.values()].reduce((a, b) => a + b, 0);
		// 17 bis 24 Uhr, überwiegend mit 304 ohne Rumpf beantwortet.
		expect(summe).toBeGreaterThan(1_000_000);
		expect(summe).toBeLessThan(1_100_000);
	});
});
