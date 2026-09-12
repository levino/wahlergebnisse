import { afterEach, describe, expect, it } from "vitest";
import { terminById } from "../src/data/termine.ts";
import type { ApiErgebnis } from "../src/lib/api.ts";
import { parseCsv } from "../src/lib/liste.ts";
import {
	type Bericht,
	landesamtZeile,
	laufe,
	rueckgabewert,
	vergleicheLandesamt,
	holer as macheHoler,
} from "../src/lib/stichprobe.ts";
import { type Kassette, legeEin } from "./kassette.ts";

const TERMIN = terminById("2021");
if (!TERMIN) throw new Error("Termin 2021 fehlt");

let kassette: Kassette | undefined;

afterEach(() => {
	kassette?.fertig();
	kassette = undefined;
});

const lauf = async (name: string): Promise<Bericht> => {
	kassette = await legeEin(name, { openai: false });
	return laufe({
		termin: TERMIN,
		api: "https://wahlergebnisse.levinkeller.de",
		umfang: 1,
		saat: 7,
		kreise: ["hildesheim"],
		behoerden: ["nordstemmen"],
		wahlenJeLeitung: 1,
		fehlendePruefen: 2,
		holer: macheHoler({ grenze: { proSekunde: 1000, spitze: 1000 } }),
	});
};

const arten = (b: Bericht): string[] =>
	b.ziehungen.flatMap((z) => z.befunde.map((x) => x.art));

describe("Stichprobe gegen die Wahlleitung", () => {
	it("meldet nichts, wenn beide Seiten dieselben Zahlen führen", async () => {
		const b = await lauf("stichprobe-gleich");
		expect(b.ziehungen).toHaveLength(1);
		expect(b.ziehungen[0].verglichen).toBeGreaterThan(0);
		expect(arten(b)).toEqual([]);
		expect(rueckgabewert(b)).toBe(0);
	});

	it("meldet abweichende Stimmen als Abweichung", async () => {
		const b = await lauf("stichprobe-abweichung");
		const abweichungen = b.ziehungen[0].befunde.filter(
			(x) => x.art === "abweichung",
		);
		expect(abweichungen.length).toBeGreaterThan(0);
		expect(abweichungen[0].text).toContain("(wir)");
		expect(rueckgabewert(b)).toBe(1);
	});

	it("meldet ein Gebiet, das die Wahlleitung führt und wir nicht", async () => {
		const b = await lauf("stichprobe-fehlt-bei-uns");
		const fehlend = b.ziehungen[0].befunde.filter(
			(x) => x.art === "fehlt-bei-uns",
		);
		expect(fehlend.length).toBeGreaterThan(0);
		expect(fehlend[0].gegen).toBe("wahlleitung");
		expect(rueckgabewert(b)).toBe(1);
	});

	it("unterscheidet „Quelle hat nichts“ von einer Abweichung", async () => {
		const b = await lauf("stichprobe-quelle-leer");
		expect(arten(b)).toContain("quelle-leer");
		expect(arten(b)).not.toContain("abweichung");
		expect(rueckgabewert(b)).toBe(0);
	});

	it("meldet eine nicht erreichbare Quelle getrennt", async () => {
		const b = await lauf("stichprobe-unerreichbar");
		const unerreichbar = b.ziehungen[0].befunde.filter(
			(x) => x.art === "unerreichbar",
		);
		expect(unerreichbar).toHaveLength(1);
		expect(unerreichbar[0].text).toContain("500");
		expect(rueckgabewert(b)).toBe(2);
	});
});

describe("Abgleich mit dem Landesamt für Statistik", () => {
	const KOPF =
		"Wahlkreis;Wahlberechtigte;Wähler;Gültige Stimmzettel;Gültige Stimmen;Sitze;CDU Stimmen;CDU Sitze;SPD Stimmen;SPD Sitze";
	const zeilen = parseCsv(
		`${KOPF}\nLandkreis Hildesheim;100;60;58;174;50;90;26;84;24\n`,
	);
	const unser = {
		kennzahlen: {
			wahlberechtigte: 100,
			waehler: 60,
			ungueltig: 2,
			gueltigeStimmzettel: 58,
			gueltigeStimmen: 174,
		},
		parteien: [
			{ key: "cdu", kurz: "CDU", name: "CDU", stimmen: 90 },
			{ key: "spd", kurz: "SPD", name: "SPD", stimmen: 84 },
		],
	} as unknown as ApiErgebnis;

	it("findet die Zeile über den Namen der Behörde", () => {
		expect(landesamtZeile(zeilen, ["Landkreis Hildesheim"])?.Wahlkreis).toBe(
			"Landkreis Hildesheim",
		);
		expect(landesamtZeile(zeilen, ["Hildesheim"])?.Wahlkreis).toBe(
			"Landkreis Hildesheim",
		);
		expect(landesamtZeile(zeilen, ["Landkreis Peine"])).toBeUndefined();
	});

	it("meldet nichts, solange beide Seiten dieselben Zahlen führen", () => {
		expect(vergleicheLandesamt(unser, zeilen[0])).toEqual([]);
	});

	it("meldet abweichende Stimmen je Partei", () => {
		expect(
			vergleicheLandesamt(unser, { ...zeilen[0], "CDU Stimmen": "91" }),
		).toEqual([{ feld: "CDU Stimmen", unser: 90, quelle: 91 }]);
	});

	it("lässt Spalten aus, die das Landesamt nicht führt", () => {
		expect(
			vergleicheLandesamt(unser, { ...zeilen[0], Wahlberechtigte: "" }),
		).toEqual([]);
	});
});
