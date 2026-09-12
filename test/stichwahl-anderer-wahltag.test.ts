import { describe, expect, it } from "vitest";
import { findetSpaeterStatt, terminById } from "../src/data/termine.ts";

describe("eine Wahl an einem anderen Wahltag", () => {
	const termin2021 = terminById("2021")!;

	it("kennt den Stichwahltag des Termins", () => {
		expect(termin2021.stichwahl).toBe("2021-09-26");
	});

	it("gehört nicht zum nachgespielten Abend", () => {
		expect(
			findetSpaeterStatt(termin2021, termin2021.stichwahl, termin2021.datum),
		).toBe(true);
	});

	it("gehört dazu, sobald ihr Tag erreicht ist", () => {
		expect(
			findetSpaeterStatt(termin2021, termin2021.stichwahl, "2021-09-26"),
		).toBe(false);
	});

	it("misst am echten Tag, solange der Termin live ist", () => {
		const termin2026 = terminById("2026")!;
		expect(termin2026.live).toBe(true);
		expect(
			findetSpaeterStatt(termin2026, termin2026.stichwahl, "2026-09-13"),
		).toBe(true);
		expect(
			findetSpaeterStatt(termin2026, termin2026.stichwahl, "2026-09-27"),
		).toBe(false);
	});
});
