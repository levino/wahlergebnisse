/**
 * Prüfungen am erzeugten Katalog. Er entsteht aus fremden Rohdaten; diese
 * Tests halten die Zusagen fest, auf die sich Adressen und Poller verlassen.
 */
import { describe, expect, it } from "vitest";
import { BEHOERDEN, KREIS_AGS, behoerdeBySlug } from "./behoerden.ts";
import {
	ALLE_BEHOERDEN,
	KREISE,
	VORHANDENE_KREISE,
	kreisBySlug,
	kreisVonBehoerde,
	wurzelVon,
} from "./kreise.ts";

describe("Katalog", () => {
	it("deckt alle 45 niedersächsischen Kreise ab", () => {
		expect(KREISE).toHaveLength(45);
		expect(ALLE_BEHOERDEN.length).toBeGreaterThan(400);
	});

	it("führt die Kreise ohne benutzbare Präsentation als nicht vorhanden", () => {
		// Celle und Uelzen benutzen keinen votemanager; bei den übrigen fünf ist
		// der 13.09.2026 nicht (abrufbar) angelegt – siehe scripts/quellen/erhebung.md.
		const ohne = KREISE.filter((k) => !k.vorhanden).map((k) => k.slug);
		expect(ohne.sort()).toEqual([
			"celle",
			"harburg",
			"heidekreis",
			"region-hannover",
			"salzgitter",
			"uelzen",
			"wolfsburg",
		]);
		expect(VORHANDENE_KREISE).toHaveLength(38);
		// Nicht vorhanden heißt: benannt, aber nicht abgefragt – mit Begründung.
		for (const k of KREISE.filter((x) => !x.vorhanden))
			expect(k.hinweis, k.slug).toBeTruthy();
	});

	it("nimmt auch die neunstelligen Schlüssel der Samtgemeinden mit", () => {
		const samtgemeinden = ALLE_BEHOERDEN.filter(
			(b) => b.art === "samtgemeinde",
		);
		expect(samtgemeinden.length).toBeGreaterThan(100);
		// Sie stehen in behoerden.json ohne ags-Feld; der Schlüssel kommt aus der URL.
		for (const b of samtgemeinden) expect(b.ags).toMatch(/^\d{9}$/);
	});

	it("ordnet jede Behörde über die ersten fünf Stellen ihrem Kreis zu", () => {
		for (const kreis of KREISE)
			for (const b of kreis.behoerden)
				expect(kreisVonBehoerde(b.ags)?.slug, b.ags).toBe(kreis.slug);
		expect(kreisVonBehoerde("032545406")?.slug).toBe("hildesheim");
	});

	it("hält die Slugs eindeutig – je Kreis, nicht landesweit", () => {
		expect(new Set(KREISE.map((k) => k.slug)).size).toBe(KREISE.length);
		for (const k of KREISE) {
			const slugs = k.behoerden.map((b) => b.slug);
			expect(new Set(slugs).size, k.slug).toBe(slugs.length);
			for (const s of slugs)
				expect(s, `${k.slug}/${s}`).toMatch(/^[a-z0-9-]+$/);
		}
		// Derselbe Slug in zwei Kreisen ist erlaubt – der Kreis steht davor.
		expect(
			kreisBySlug("goettingen")?.behoerden.some((b) => b.slug === "kreis"),
		).toBe(true);
		expect(
			kreisBySlug("holzminden")?.behoerden.some((b) => b.slug === "kreis"),
		).toBe(true);
	});

	it("führt keine Behörde doppelt", () => {
		// Goslar nennt „Stadt Langelsheim“ in behoerden.json zweimal: 03153007 ist
		// die stillgelegte Instanz (kein Termin 13.09.2026), 03153019 trägt die
		// Daten. Nur die arbeitende gehört in den Katalog – sonst wäre
		// /goslar/2026/langelsheim/ eine Sackgasse und die Seite, die jemand
		// sucht, versteckte sich hinter „langelsheim-2“.
		for (const k of KREISE) {
			const namen = k.behoerden.map((b) => b.name.toLowerCase());
			expect(new Set(namen).size, k.slug).toBe(namen.length);
			const ags = k.behoerden.map((b) => b.ags);
			expect(new Set(ags).size, k.slug).toBe(ags.length);
		}
		const langelsheim = kreisBySlug("goslar")?.behoerden.filter((b) =>
			b.slug.startsWith("langelsheim"),
		);
		expect(langelsheim).toHaveLength(1);
		expect(langelsheim?.[0].slug).toBe("langelsheim");
		expect(langelsheim?.[0].ags).toBe("03153019");
	});

	it("bewahrt die Hildesheimer Slugs aus der ersten Fassung", () => {
		expect(KREIS_AGS).toBe("03254000");
		expect(BEHOERDEN).toHaveLength(19);
		expect(BEHOERDEN.map((b) => b.slug)).toEqual([
			"kreis",
			"alfeld",
			"algermissen",
			"bad-salzdetfurth",
			"bockenem",
			"diekholzen",
			"elze",
			"giesen",
			"harsum",
			"hildesheim",
			"holle",
			"nordstemmen",
			"sarstedt",
			"schellerten",
			"soehlde",
			"freden",
			"lamspringe",
			"sibbesse",
			"leinebergland",
		]);
		expect(behoerdeBySlug("leinebergland")?.ags).toBe("032545406");
	});

	it("kennt die Wurzel je Behörde, wo sie vom Kreis abweicht", () => {
		const goe = kreisBySlug("goettingen")!;
		expect(goe.basis).toBe("https://votemanager.kdo.de/");
		const muenden = goe.behoerden.find((b) => b.slug === "hann-muenden")!;
		expect(wurzelVon(goe, muenden)).toBe(
			"https://wahlen.hann.muenden.de/prod/",
		);
		// Ohne eigene Wurzel gilt die des Kreises.
		expect(wurzelVon(goe, goe.behoerden[0])).toBe(goe.basis);
		// Hildesheim liegt als einziger Kreis auf einem eigenen Host mit Präfix.
		expect(kreisBySlug("hildesheim")!.basis).toBe(
			"https://wahlen.kreis-hi.de/wahlen/",
		);
	});

	it("lässt sich für Tests und Vorschauen auf einen Mock umbiegen", () => {
		const vorher = process.env.VOTEMANAGER_BASIS;
		process.env.VOTEMANAGER_BASIS = "http://127.0.0.1:1234/wahlen";
		try {
			const k = kreisBySlug("hildesheim")!;
			// ohne Schrägstrich angegeben, mit Schrägstrich zurück
			expect(wurzelVon(k, k.behoerden[0])).toBe(
				"http://127.0.0.1:1234/wahlen/",
			);
		} finally {
			if (vorher === undefined) delete process.env.VOTEMANAGER_BASIS;
			else process.env.VOTEMANAGER_BASIS = vorher;
		}
	});
});
