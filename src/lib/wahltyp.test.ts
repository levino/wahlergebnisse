import { describe, expect, it } from "vitest";
import { ZUORDNUNG_2026 } from "../data/wahlzuordnung/2026.ts";
import {
	type Wahltyp,
	amtVon,
	deuteWahl,
	ebenenUeberschriften,
	istKreiswahl,
	istPersonenwahl,
	istTestwahl,
	slugify,
	wahlSlugs,
} from "./wahltyp.ts";

describe("deuteWahl", () => {
	it("schlägt Wahlart, Gebiet und Adresse nach", () => {
		expect(deuteWahl("2026", "03254000", 44)).toEqual({
			typ: "landrat",
			gebiet: "",
			slug: "landrat",
			wahl: "Landratswahl",
			gremium: "",
		});
		expect(deuteWahl("2026", "03254026", 61)).toEqual({
			typ: "ortsrat",
			gebiet: "Rössing",
			slug: "ortsrat-roessing",
			wahl: "Ortsratswahl",
			gremium: "Ortsrat",
		});
	});

	it("nennt das Gremium, wo es nicht Ortsrat heißt", () => {
		expect(deuteWahl("2026", "03101000", 896)).toMatchObject({
			typ: "ortsrat",
			gebiet: "111",
			gremium: "Stadtbezirksrat",
			wahl: "Stadtbezirksratswahl",
			slug: "ortsrat-111",
		});
	});

	it("unterscheidet Samtgemeinde und Mitgliedsgemeinde", () => {
		expect(deuteWahl("2026", "031515403", 1511)).toMatchObject({
			typ: "rat",
			gebiet: "",
			slug: "rat",
			wahl: "Samtgemeinderatswahl",
		});
		expect(deuteWahl("2026", "031515403", 2068)).toMatchObject({
			typ: "rat",
			gebiet: "Hankensbüttel",
			slug: "rat-hankensbuettel",
			wahl: "Gemeinderatswahl",
		});
	});

	it("liest den Wortlaut der Wahlleitung nicht mehr mit", () => {
		// „Orstratswahl", „Orschaft", „Bügermeisters" – die Titel der Wahlleitungen
		// stehen so im Bestand, die Zuordnung hängt nicht mehr an ihnen.
		expect(deuteWahl("2026", "03454045", 2785)).toMatchObject({
			typ: "ortsrat",
			gebiet: "Holsten-Bexten",
		});
		expect(deuteWahl("2026", "03361008", 2495)).toMatchObject({
			typ: "ortsrat",
			gebiet: "Otterstedt",
		});
		expect(deuteWahl("2026", "03402000", 2528)).toMatchObject({
			typ: "rat",
			wahl: "Stadtratswahl",
		});
	});

	it("weist eine Wahl ohne Eintrag als unbekannt aus, statt sie zu raten", () => {
		expect(deuteWahl("2026", "03254026", 999_999)).toEqual({
			typ: "unbekannt",
			gebiet: "",
			slug: "unbekannt-999999",
			wahl: "Unbekannte Wahl",
			gremium: "",
		});
		expect(deuteWahl("2021", "03254026", 61)).toMatchObject({
			typ: "unbekannt",
		});
	});
});

describe("Zuordnung 2026", () => {
	const ARTEN: Wahltyp[] = [
		"landrat",
		"landrat-stichwahl",
		"kreistag",
		"buergermeister",
		"buergermeister-stichwahl",
		"rat",
		"ortsrat",
	];

	it("vergibt je Behörde eindeutige Adressen", () => {
		const belegt = new Map<string, string[]>();
		for (const schluessel of Object.keys(ZUORDNUNG_2026)) {
			const [behoerde, wahlId, gebietId = ""] = schluessel.split("/");
			const { slug } = deuteWahl("2026", behoerde, Number(wahlId), gebietId);
			const adresse = `${behoerde}/${slug}`;
			belegt.set(adresse, [...(belegt.get(adresse) ?? []), schluessel]);
		}
		const doppelt = [...belegt].filter(([, wahlen]) => wahlen.length > 1);
		expect(doppelt).toEqual([]);
	});

	it("trägt keine geratene Wahlart", () => {
		const ohneArt = Object.entries(ZUORDNUNG_2026).filter(
			([, z]) => !ARTEN.includes(z[0]),
		);
		expect(ohneArt).toEqual([]);
	});

	it("benennt jede Ortsratswahl mit ihrem Gebiet", () => {
		const ohneGebiet = Object.entries(ZUORDNUNG_2026)
			.filter(([, z]) => z[0] === "ortsrat" && !z[2])
			.map(([k]) => k);
		expect(ohneGebiet).toEqual([]);
	});
});

describe("wahlSlugs", () => {
	it("trennt die Räte der Samtgemeinde Elm-Asse", () => {
		const erg = wahlSlugs("2026", "031585407", [
			{ wahlId: 1184 },
			{ wahlId: 1420 },
			{ wahlId: 1437 },
			{ wahlId: 1419 },
			{ wahlId: 1452 },
		]);
		expect(erg.map((e) => e.slug)).toEqual([
			"kreistag",
			"buergermeister",
			"rat",
			"rat-dahlum",
			"rat-schoeppenstedt",
		]);
	});

	it("unterscheidet die Ortsräte einer Wahl über mehrere Gebiete", () => {
		const erg = wahlSlugs("2026", "03103000", [
			{ wahlId: 30, gebietId: "ebene_8_id_1" },
			{ wahlId: 30, gebietId: "ebene_8_id_13" },
		]);
		expect(erg.map((e) => e.gebiet)).toEqual(["Almke-Neindorf", "Waldstadt"]);
		expect(erg.map((e) => e.slug)).toEqual([
			"ortsrat-almke-neindorf",
			"ortsrat-waldstadt",
		]);
	});
});

describe("istTestwahl", () => {
	it("kennt den Testdatensatz der Gemeinde Stadland", () => {
		expect(istTestwahl("2026", "03461009", 2187)).toBe(true);
		expect(istTestwahl("2026", "03461009", 974)).toBe(false);
	});
});

describe("Wahlarten", () => {
	it("führt Stichwahl und Hauptwahl auf dasselbe Amt zurück", () => {
		expect(amtVon("buergermeister-stichwahl")).toBe("buergermeister");
		expect(amtVon("landrat-stichwahl")).toBe("landrat");
		expect(amtVon("ortsrat")).toBe("ortsrat");
	});

	it("trennt Personen- von Verhältniswahl", () => {
		expect(istPersonenwahl("buergermeister")).toBe(true);
		expect(istPersonenwahl("rat")).toBe(false);
	});

	it("kennt die kreisweiten Wahlen", () => {
		expect(istKreiswahl("kreistag")).toBe(true);
		expect(istKreiswahl("landrat-stichwahl")).toBe(true);
		expect(istKreiswahl("rat")).toBe(false);
	});
});

describe("ebenenUeberschriften", () => {
	it("nennt die Region Hannover beim Namen", () => {
		expect(ebenenUeberschriften(["Regionsversammlungswahl"]).eigen).toBe(
			"Regionsebene",
		);
		expect(ebenenUeberschriften(["Kreistagswahl"]).eigen).toBe("Kreisebene");
		expect(ebenenUeberschriften([]).eigen).toBe("Kreisebene");
	});
});

describe("slugify", () => {
	it("macht aus einem Namen eine Adresse", () => {
		expect(slugify("Rössing")).toBe("roessing");
		expect(slugify("Stadt Alfeld (Leine)")).toBe("stadt-alfeld-leine");
	});
});
