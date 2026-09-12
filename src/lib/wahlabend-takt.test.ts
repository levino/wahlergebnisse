import { describe, expect, it } from "vitest";
import {
	KREISE,
	VORHANDENE_KREISE,
	ivuQuellen,
	nutztIvu,
} from "../data/kreise.ts";
import type { Termin } from "../data/termine.ts";
import { STANDARD_VERBINDUNGEN } from "./warteschlange.ts";
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

const kandidaten = VORHANDENE_KREISE;
const abfragbar = KREISE.filter((k) => k.vorhanden);

/** Anfragen, die ein Lauf über diesen Kreis auf welchem Host auslöst. */
const anfragenJeHost = (slug: string): Map<string, number> => {
	const kreis = kandidaten.find((k) => k.slug === slug)!;
	const m = new Map<string, number>();
	if (nutztIvu(kreis)) {
		// Im Ruhezustand fragt jede Wahl nur ihre Kreisseite bedingt nach;
		// die Gebietsseiten zieht erst eine geänderte Wurzel nach.
		for (const url of ivuQuellen(kreis, wahltag)) {
			const host = new URL(url).host;
			m.set(host, (m.get(host) ?? 0) + 1);
		}
		return m;
	}
	if (!kreis.vorhanden) {
		const b = kreis.behoerden.find((x) => x.ags === kreis.ags);
		m.set(new URL(b?.wurzel ?? kreis.basis).host, 1);
		return m;
	}
	for (const b of kreis.behoerden) {
		const host = new URL(b.wurzel ?? kreis.basis).host;
		m.set(host, (m.get(host) ?? 0) + ANFRAGEN_JE_BEHOERDE);
	}
	return m;
};

const GEMESSENE_ANTWORTZEIT_MS = 38;

const DURCHSATZ_JE_SEKUNDE =
	(STANDARD_VERBINDUNGEN.hoechstens * 1000) / GEMESSENE_ANTWORTZEIT_MS;

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
			kreise: kandidaten.map((k) => k.slug),
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

		for (const k of kandidaten) {
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

describe("Wahlabend, 45 angefasste Kreise", () => {
	it("kennt den Bestand, auf dem die Rechnung beruht", () => {
		expect(kandidaten).toHaveLength(45);
		expect(abfragbar).toHaveLength(41);
		const ueberVotemanager = abfragbar.filter((k) => !nutztIvu(k));
		expect(ueberVotemanager).toHaveLength(39);
		expect(ueberVotemanager.flatMap((k) => k.behoerden)).toHaveLength(375);
		const jeHost = new Map<string, number>();
		for (const k of ueberVotemanager)
			for (const b of k.behoerden) {
				const host = new URL(b.wurzel ?? k.basis).host;
				jeHost.set(host, (jeHost.get(host) ?? 0) + 1);
			}
		expect(jeHost.get("votemanager.kdo.de")).toBe(353);
		expect(jeHost.get("wahlen.kreis-hi.de")).toBe(19);
		expect(
			abfragbar
				.filter(nutztIvu)
				.map((k) => k.slug)
				.sort(),
		).toEqual(["celle", "uelzen"]);
	});

	it("lässt keinen Kreis stundenlang alt werden – höchstens vier Minuten", () => {
		const abend = spieleAbendDurch({ betrachtet: ["hildesheim"] });
		expect(abend.hoechstesAlter).toBeLessThanOrEqual(
			STANDARD_ABSTAENDE.wahlabend.uebrig + GRUNDTAKT_S,
		);
		expect(abend.hoechstesAlter).toBeLessThanOrEqual(240);
		expect(abend.hoechstesAlterBetrachtet).toBeLessThanOrEqual(
			STANDARD_ABSTAENDE.wahlabend.betrachtet,
		);
	});

	it("bleibt auf jedem Host unter dem Durchsatz der Warteschlange", () => {
		const abend = spieleAbendDurch({ betrachtet: ["hildesheim"] });
		for (const [host, rate] of abend.rateJeHost) {
			expect(rate, `${host}: ${rate.toFixed(1)} Anfragen/s`).toBeLessThan(
				DURCHSATZ_JE_SEKUNDE,
			);
		}
		expect(abend.rateJeHost.get("votemanager.kdo.de")).toBeCloseTo(32.9, 0);
		expect(abend.rateJeHost.get("wahlen.kreis-hi.de")).toBeCloseTo(5.7, 0);
		// IVU fragt im Ruhezustand je Wahl nur die Kreisseite nach; die
		// Gebietsseiten kosten erst, wenn dort etwas Neues steht.
		expect(abend.rateJeHost.get("wahlen.landkreis-uelzen.de")).toBeCloseTo(
			0.01,
			2,
		);
		expect(abend.rateJeHost.get("wahl.landkreis-celle.de")).toBeCloseTo(
			0.01,
			2,
		);
	});

	it("hält auch zwölf gleichzeitig betrachtete Kreise aus", () => {
		const viele = abfragbar
			.filter((k) => k.basis.includes("kdo.de"))
			.slice(0, 12)
			.map((k) => k.slug);
		const abend = spieleAbendDurch({ betrachtet: viele });
		for (const [host, rate] of abend.rateJeHost)
			expect(rate, `${host}: ${rate.toFixed(1)} Anfragen/s`).toBeLessThan(
				DURCHSATZ_JE_SEKUNDE,
			);
	});

	it("bringt einen einzelnen Lauf im Grundtakt unter", () => {
		const abend = spieleAbendDurch({ betrachtet: ["hildesheim"] });
		for (const lauf of abend.proLauf)
			for (const [host, n] of lauf)
				expect(n, `${host}: ${n} Anfragen in einem Lauf`).toBeLessThanOrEqual(
					DURCHSATZ_JE_SEKUNDE * GRUNDTAKT_S,
				);
	});

	it("verteilt die Last gleichmäßig auf die Minuten", () => {
		const abend = spieleAbendDurch({ betrachtet: ["hildesheim"] });
		expect(abend.groessterLauf).toBe(STANDARD_HOECHSTENS.wahlabend);
		for (const n of abend.groessenDerLaeufe)
			expect(n).toBeLessThanOrEqual(STANDARD_HOECHSTENS.wahlabend);
		const schnitt =
			abend.groessenDerLaeufe.reduce((a, b) => a + b, 0) /
			abend.groessenDerLaeufe.length;
		// Alle Kreise in drei Läufen – solange der Deckel je Lauf das zulässt.
		expect(schnitt).toBeCloseTo(
			Math.min(STANDARD_HOECHSTENS.wahlabend, (kandidaten.length - 1) / 3 + 1),
			0,
		);
		const groessteHostlast = Math.max(
			...abend.proLauf.flatMap((l) => [...l.values()]),
		);
		expect(groessteHostlast).toBeLessThanOrEqual(
			DURCHSATZ_JE_SEKUNDE * GRUNDTAKT_S,
		);
		expect(groessteHostlast).toBe(2394);
	});

	it("summiert sich über den Abend auf rund eine Million bedingte Anfragen", () => {
		const abend = spieleAbendDurch({ betrachtet: ["hildesheim"] });
		const summe = [...abend.gesamtJeHost.values()].reduce((a, b) => a + b, 0);
		expect(summe).toBeGreaterThan(950_000);
		expect(summe).toBeLessThan(1_050_000);
	});
});
