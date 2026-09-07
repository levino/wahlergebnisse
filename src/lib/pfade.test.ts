import { describe, expect, it } from "vitest";
import { kreisBySlug } from "../data/kreise.ts";
import {
	altePfadUmschreibung,
	behoerdeImKreis,
	behoerdePfad,
	kreisAusPfad,
	terminPfad,
	wahlPfad,
} from "./pfade.ts";

describe("Pfade", () => {
	it("setzt den Kreis vor jedes Segment", () => {
		expect(terminPfad("hildesheim", "2021")).toBe("/hildesheim/2021/");
		expect(behoerdePfad("hildesheim", "2021", "kreis")).toBe(
			"/hildesheim/2021/kreis/",
		);
		expect(wahlPfad("hildesheim", "2021", "kreis", "kreistag")).toBe(
			"/hildesheim/2021/kreis/kreistag/",
		);
		expect(
			wahlPfad("hildesheim", "2021", "kreis", "kreistag", "ebene_9_id_57"),
		).toBe("/hildesheim/2021/kreis/kreistag/ebene_9_id_57/");
	});

	it("erkennt den Kreis am ersten Segment", () => {
		expect(kreisAusPfad("/hildesheim/2021/kreis/")).toBe("hildesheim");
		expect(kreisAusPfad("/hildesheim")).toBe("hildesheim");
		expect(kreisAusPfad("/")).toBeUndefined();
		expect(kreisAusPfad("/2021/kreis/")).toBeUndefined();
		expect(kreisAusPfad("/rechtliches")).toBeUndefined();
	});
});

describe("Umschreibung alter Adressen", () => {
	it("schiebt den Standardkreis vor den Termin", () => {
		expect(altePfadUmschreibung("/2021/kreis/kreistag/")).toBe(
			"/hildesheim/2021/kreis/kreistag/",
		);
		expect(altePfadUmschreibung("/2021/")).toBe("/hildesheim/2021/");
		expect(altePfadUmschreibung("/2020/nordstemmen/buergermeister/")).toBe(
			"/hildesheim/2020/nordstemmen/buergermeister/",
		);
	});

	it("gilt genauso für die Schnittstelle", () => {
		expect(altePfadUmschreibung("/api/v1/2021/kreis/kreistag")).toBe(
			"/api/v1/hildesheim/2021/kreis/kreistag",
		);
		expect(
			altePfadUmschreibung("/api/v1/2026/kreis/kreistag/gebiete/ebene_9_id_57"),
		).toBe("/api/v1/hildesheim/2026/kreis/kreistag/gebiete/ebene_9_id_57");
	});

	it("lässt neue Adressen in Ruhe", () => {
		expect(altePfadUmschreibung("/hildesheim/2021/kreis/")).toBeUndefined();
		expect(
			altePfadUmschreibung("/api/v1/hildesheim/2021/kreis"),
		).toBeUndefined();
	});

	it("führt nicht im Kreis: einmal umgeschrieben, nie wieder", () => {
		const einmal = altePfadUmschreibung("/2021/kreis/kreistag/");
		expect(einmal).toBeDefined();
		expect(altePfadUmschreibung(einmal as string)).toBeUndefined();
	});

	it("lässt Unbekanntes zur 404 durch", () => {
		expect(altePfadUmschreibung("/")).toBeUndefined();
		expect(altePfadUmschreibung("/gibtsnicht/2021/")).toBeUndefined();
		expect(altePfadUmschreibung("/1999/kreis/")).toBeUndefined();
		expect(altePfadUmschreibung("/rechtliches")).toBeUndefined();
		expect(altePfadUmschreibung("/api")).toBeUndefined();
		expect(altePfadUmschreibung("/api/v1")).toBeUndefined();
		expect(altePfadUmschreibung("/api/v1/termine")).toBeUndefined();
		expect(
			altePfadUmschreibung("/api/v1/geo/gemeinden.geojson"),
		).toBeUndefined();
	});
});

describe("Behörde im Kreis", () => {
	it("löst Slug und Schlüssel auf, aber nur im eigenen Kreis", () => {
		const hi = kreisBySlug("hildesheim");
		if (!hi) throw new Error("Hildesheim fehlt im Katalog");
		expect(behoerdeImKreis(hi, "nordstemmen")?.slug).toBe("nordstemmen");
		expect(behoerdeImKreis(hi, "03254026")?.slug).toBe("nordstemmen");
		expect(behoerdeImKreis(hi, "gibtsnicht")).toBeUndefined();
	});
});
