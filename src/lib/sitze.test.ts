import { describe, expect, it } from "vitest";
import { hareNiemeyer, mehrheit } from "./sitze.ts";

describe("hareNiemeyer", () => {
	it("verteilt Sitze nach Quoten und größten Resten", () => {
		// Klassisches Beispiel: 10 Sitze, Stimmen 4160/3380/2460 → 4/3/3
		const r = hareNiemeyer(
			[
				{ key: "a", stimmen: 4160 },
				{ key: "b", stimmen: 3380 },
				{ key: "c", stimmen: 2460 },
			],
			10,
		);
		expect(r).toEqual([
			{ key: "a", sitze: 4 },
			{ key: "b", sitze: 3 },
			{ key: "c", sitze: 3 },
		]);
	});

	it("reproduziert die Kreistagswahl 2021 im Landkreis Hildesheim", () => {
		// Stimmen laut amtlichem Endergebnis, 64 Sitze
		const r = hareNiemeyer(
			[
				{ key: "spd", stimmen: 131834 },
				{ key: "cdu", stimmen: 116658 },
				{ key: "gruene", stimmen: 59774 },
				{ key: "afd", stimmen: 19936 },
				{ key: "unabhaengige", stimmen: 18811 },
				{ key: "fdp", stimmen: 19042 },
				{ key: "linke", stimmen: 10396 },
				{ key: "fw", stimmen: 2254 },
				{ key: "gut", stimmen: 1479 },
				{ key: "ikl", stimmen: 1332 },
				{ key: "partei", stimmen: 3405 },
				{ key: "piraten", stimmen: 1956 },
			],
			64,
		);
		const s = Object.fromEntries(r.map((x) => [x.key, x.sitze]));
		expect(s.spd).toBe(22);
		expect(s.cdu).toBe(19);
		expect(s.gruene).toBe(10);
		expect(s.afd).toBe(3);
		expect(s.unabhaengige).toBe(3);
		expect(s.fdp).toBe(3);
		expect(s.linke).toBe(2);
		expect(s.partei).toBe(1);
		expect(r.reduce((a, x) => a + x.sitze, 0)).toBe(64);
	});

	it("gibt bei null Stimmen keine Sitze", () => {
		expect(hareNiemeyer([{ key: "a", stimmen: 0 }], 5)).toEqual([
			{ key: "a", sitze: 0 },
		]);
	});
});

describe("mehrheit", () => {
	it("ist mehr als die Hälfte", () => {
		expect(mehrheit(64)).toBe(33);
		expect(mehrheit(31)).toBe(16);
	});
});
