import { describe, expect, it } from "vitest";
import type { WahlEintragZeile } from "./abfragen.ts";
import { gemeindeUntertitel } from "./uebersicht.ts";
import type { Wahltyp } from "./wahltyp.ts";

const wahl = (typ: Wahltyp, kurz: string): WahlEintragZeile => ({
	termin: "2026",
	behoerde: "03254000",
	wahlId: 1,
	gebietId: "ebene_3_id_1",
	titel: kurz,
	gebietTitel: kurz,
	typ,
	slug: typ,
	kurz,
	// Seit den eindeutigen Adressen trägt jeder Eintrag sein Gebiet.
	gebiet: "",
});

describe("gemeindeUntertitel", () => {
	it("zählt einen einzelnen Ortsrat in der Einzahl", () => {
		expect(
			gemeindeUntertitel([
				wahl("rat", "Gemeindewahl"),
				wahl("ortsrat", "Ortsratswahl"),
			]),
		).toBe("Gemeindewahl · 1 Ortsrat");
	});

	it("zählt mehrere in der Mehrzahl", () => {
		expect(
			gemeindeUntertitel([
				wahl("rat", "Gemeindewahl"),
				wahl("ortsrat", "Ortsratswahl"),
				wahl("ortsrat", "Ortsratswahl"),
			]),
		).toBe("Gemeindewahl · 2 Ortsräte");
	});

	it("nennt auch eine Wahl, deren Art nicht erkannt wurde", () => {
		// Die Stadt Alfeld führt 2026 nur eine Wahl, und die ist als "sonstige"
		// eingestuft – vorher stand sie deshalb als einzige ohne Untertitel da.
		expect(gemeindeUntertitel([wahl("sonstige", "Bürgerentscheid")])).toBe(
			"Bürgerentscheid",
		);
	});

	it("lässt kreisweite Wahlen weg – sie stehen in jeder Gemeinde", () => {
		expect(
			gemeindeUntertitel([
				wahl("landrat", "Landratswahl"),
				wahl("kreistag", "Kreistagswahl"),
				wahl("buergermeister", "Bürgermeisterwahl"),
			]),
		).toBe("Bürgermeisterwahl");
	});

	it("bleibt leer, wenn es nichts Eigenes zu nennen gibt", () => {
		expect(gemeindeUntertitel([wahl("kreistag", "Kreistagswahl")])).toBe("");
	});
});
