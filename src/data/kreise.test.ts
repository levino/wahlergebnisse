import { describe, expect, it } from "vitest";
import { BEHOERDEN, KREIS_AGS, behoerdeBySlug } from "./behoerden.ts";
import {
	ALLE_BEHOERDEN,
	KREISE,
	KREISE_OHNE_QUELLE,
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
		const ohne = KREISE.filter((k) => !k.vorhanden).map((k) => k.slug);
		expect(ohne.sort()).toEqual([
			"celle",
			"harburg",
			"heidekreis",
			"region-hannover",
			"salzgitter",
			"uelzen",
		]);
		expect(VORHANDENE_KREISE).toHaveLength(43);
		expect(KREISE_OHNE_QUELLE.map((k) => k.slug).sort()).toEqual([
			"celle",
			"uelzen",
		]);
		for (const k of KREISE.filter((x) => !x.vorhanden))
			expect(k.hinweis, k.slug).toBeTruthy();
	});

	it("nennt für jeden Kreis ohne eigene Zahlen die amtliche Fundstelle", () => {
		for (const k of KREISE.filter((x) => !x.vorhanden)) {
			expect(k.quellen?.length, `${k.slug} ohne Fundstelle`).toBeGreaterThan(0);
			for (const q of k.quellen ?? []) {
				expect(q.url, k.slug).toMatch(/^https:\/\//);
				expect(q.titel.length, `${k.slug}: ${q.url}`).toBeGreaterThan(5);
			}
		}
	});

	it("verlinkt Celle und Uelzen auf ihre eigenen Wahlpräsentationen", () => {
		const celle = kreisBySlug("celle");
		expect(celle?.quellen?.map((q) => q.url)).toContain(
			"https://wahl.landkreis-celle.de/ivu/kreis2021_celle/ergebnisse.html",
		);
		const uelzen = kreisBySlug("uelzen");
		expect(uelzen?.quellen?.map((q) => q.url)).toContain(
			"https://wahlen.landkreis-uelzen.de/kw2021/kt/ergebnisse.html",
		);
	});

	it("fragt Wolfsburg und Salzgitter auf ihren eigenen Hosts ab", () => {
		expect(kreisBySlug("wolfsburg")?.basis).toBe(
			"https://wahlen.wolfsburg.de/",
		);
		expect(kreisBySlug("salzgitter")?.basis).toBe(
			"https://wahlen.salzgitter.de/ergebnisse/",
		);
		for (const slug of ["wolfsburg", "salzgitter"]) {
			const k = kreisBySlug(slug);
			if (!k) throw new Error(slug);
			for (const b of k.behoerden)
				expect(wurzelVon(k, b), `${slug}/${b.slug}`).toBe(k.basis);
		}
	});

	it("weiß, wo es die Kommunalwahl 2021 gibt", () => {
		const mit2021 = KREISE.filter((k) => k.archive?.includes("2021"));
		expect(mit2021).toHaveLength(40);
		for (const slug of [
			"salzgitter",
			"wolfsburg",
			"celle",
			"uelzen",
			"heidekreis",
		])
			expect(kreisBySlug(slug)?.archive ?? [], slug).not.toContain("2021");
		expect(kreisBySlug("region-hannover")?.archive).toEqual(["2021"]);
		expect(
			KREISE.filter((k) => k.archive?.includes("2020")).map((k) => k.slug),
		).toEqual([]);
		expect(
			KREISE.flatMap((k) => k.behoerden)
				.filter((b) => b.archive?.includes("2020"))
				.map((b) => b.ags),
		).toEqual(["03254026"]);
	});

	it("nimmt auch die neunstelligen Schlüssel der Samtgemeinden mit", () => {
		const samtgemeinden = ALLE_BEHOERDEN.filter(
			(b) => b.art === "samtgemeinde",
		);
		expect(samtgemeinden.length).toBeGreaterThan(100);
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
		expect(
			kreisBySlug("goettingen")?.behoerden.some((b) => b.slug === "kreis"),
		).toBe(true);
		expect(
			kreisBySlug("holzminden")?.behoerden.some((b) => b.slug === "kreis"),
		).toBe(true);
	});

	it("führt keine Behörde doppelt", () => {
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
		expect(wurzelVon(goe, goe.behoerden[0])).toBe(goe.basis);
		expect(kreisBySlug("hildesheim")!.basis).toBe(
			"https://wahlen.kreis-hi.de/wahlen/",
		);
	});

	it("lässt sich für Tests und Vorschauen auf einen Mock umbiegen", () => {
		const vorher = process.env.VOTEMANAGER_BASIS;
		process.env.VOTEMANAGER_BASIS = "http://127.0.0.1:1234/wahlen";
		try {
			const k = kreisBySlug("hildesheim")!;
			expect(wurzelVon(k, k.behoerden[0])).toBe(
				"http://127.0.0.1:1234/wahlen/",
			);
		} finally {
			if (vorher === undefined) delete process.env.VOTEMANAGER_BASIS;
			else process.env.VOTEMANAGER_BASIS = vorher;
		}
	});
});
