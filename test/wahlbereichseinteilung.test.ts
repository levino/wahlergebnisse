import { describe, expect, it } from "vitest";
import { KATALOG } from "../src/data/kreis-katalog.ts";
import {
	EINTEILUNGEN,
	einteilungFuer,
} from "../src/data/wahlbereichseinteilung.ts";
import { kreisgliederung } from "../src/data/wahlgliederungen.ts";
import { bereichVonGemeinde } from "../src/lib/wahlbereiche.ts";

const KREIS_SLUGS = new Set(KATALOG.map((k) => k.slug));

describe("das Register der erhobenen Wahlbereichseinteilungen", () => {
	it("kennt nur Kreise, die es im Katalog gibt", () => {
		const unbekannt = EINTEILUNGEN.filter((e) => !KREIS_SLUGS.has(e.kreis));
		expect(unbekannt.map((e) => e.kreis)).toEqual([]);
	});

	it("führt jeden Kreis eines Termins nur einmal", () => {
		const gesehen = EINTEILUNGEN.map((e) => `${e.termin}/${e.kreis}`);
		expect(gesehen.length).toBe(new Set(gesehen).size);
	});

	it("vergibt jedes Kürzel innerhalb eines Kreises nur einmal", () => {
		for (const e of EINTEILUNGEN) {
			const kuerzel = e.bereiche.map((b) => b.kuerzel);
			expect(new Set(kuerzel).size, e.kreis).toBe(kuerzel.length);
		}
	});

	it("nennt zu jedem Eintrag eine Adresse, ein Dokument und einen Erhebungszeitpunkt", () => {
		for (const e of EINTEILUNGEN) {
			expect(e.quelle, e.kreis).toMatch(/^https?:\/\//);
			expect(e.dokument.length, e.kreis).toBeGreaterThan(10);
			expect(e.erhoben, e.kreis).toMatch(/^\d{4}-\d{2}-\d{2}T/);
			expect(e.bereiche.length, e.kreis).toBeGreaterThan(0);
		}
	});

	it("nennt keine Gemeinde zweimal im selben Wahlbereich", () => {
		for (const e of EINTEILUNGEN)
			for (const b of e.bereiche)
				expect(new Set(b.gemeinden).size, `${e.kreis}/${b.kuerzel}`).toBe(
					b.gemeinden.length,
				);
	});

	it("trägt den Termin, für den erhoben wurde – nie einen anderen", () => {
		for (const e of EINTEILUNGEN) {
			const menge = einteilungFuer(e.termin, e.kreis);
			expect(menge?.beleg.terminBeleg, e.kreis).toBe(e.termin);
			expect(menge?.beleg.herkunft, e.kreis).toBe("bekanntmachung");
		}
	});

	it("tritt nur ein, wo die Wahlleitung selbst nichts führt", () => {
		for (const e of EINTEILUNGEN) {
			const k = kreisgliederung(e.termin, e.kreis);
			if (!k) continue;
			expect(k.wahlbereichszuordnung.stand, e.kreis).toBe("belegt");
		}
	});

	it("lässt eine auf mehrere Bereiche geteilte Gemeinde ohne eindeutigen Bereich", () => {
		const hildesheim = kreisgliederung("2026", "hildesheim");
		const zuordnung = new Map(
			(hildesheim?.wahlbereichszuordnung.eintraege ?? []).map((e) => [
				e.kuerzel,
				e.gemeinden,
			]),
		);
		expect(bereichVonGemeinde("Nordstemmen", zuordnung)).toBe("B");
		expect(bereichVonGemeinde("Hildesheim", zuordnung)).toBeUndefined();
	});
});
