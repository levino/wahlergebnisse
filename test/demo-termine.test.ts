import { describe, expect, it } from "vitest";

/** Muss stehen, bevor `termine.ts` zum ersten Mal geladen wird. */
process.env.WAHLEN_DEMO = "1";

const termine = async () => await import("../src/data/termine.ts");

describe("Die Probeninstanz kennt nur ihren Abend", () => {
	it("führt den Probentermin als laufend", async () => {
		const { PROBEN_TERMIN, TERMINE, istLive, terminById } = await termine();
		const probe = terminById(PROBEN_TERMIN);
		expect(probe).toBeDefined();
		expect(istLive(probe!)).toBe(true);
		expect(TERMINE.filter((t) => t.live).map((t) => t.id)).toEqual([
			PROBEN_TERMIN,
		]);
	});

	it("kennt keinen Termin nach ihm – 2026 gibt es hier nicht", async () => {
		const { PROBEN_TERMIN, TERMINE, terminById } = await termine();
		const probe = terminById(PROBEN_TERMIN)!;
		expect(terminById("2026")).toBeUndefined();
		expect(TERMINE.filter((t) => t.datum > probe.datum)).toEqual([]);
		expect(TERMINE.length).toBeGreaterThan(1);
	});

	it("bietet ihn in keiner Terminliste an – nicht kreisweit, nicht bei einer Wahlleitung", async () => {
		const { TERMINE, terminGiltFuerBehoerde, terminGiltFuerKreis } =
			await termine();
		const { KREISE } = await import("../src/data/kreise.ts");
		const ids = new Set(TERMINE.map((t) => t.id));
		expect(ids.has("2026")).toBe(false);
		for (const kreis of KREISE) {
			const kreisweit = TERMINE.filter((t) =>
				terminGiltFuerKreis(t, kreis.slug),
			);
			expect(kreisweit.map((t) => t.id)).toContain("2021");
			for (const b of kreis.behoerden)
				for (const t of TERMINE.filter((x) =>
					terminGiltFuerBehoerde(x, kreis, b),
				))
					expect(t.id).not.toBe("2026");
		}
	});

	it("liefert ihn in keiner API-Antwort aus", async () => {
		const { apiTermine } = await import("../src/lib/api.ts");
		const { kreisBySlug } = await import("../src/data/kreise.ts");
		const kreis = kreisBySlug("hildesheim")!;
		const alle = apiTermine();
		expect(alle.map((t) => t.id)).not.toContain("2026");
		expect(alle.find((t) => t.id === "2021")?.live).toBe(true);
		for (const b of kreis.behoerden)
			expect(apiTermine(kreis, b).map((t) => t.id)).not.toContain("2026");
	});

	it("schickt, wer einen Kreis aufruft, in den Probentermin", async () => {
		const { TERMINE, istLive } = await termine();
		expect(TERMINE.find(istLive)?.id).toBe("2021");
	});

	it("kennt die Kommunalwahl 2016 als Vergleichstermin", async () => {
		const { TERMINE, terminById, terminGiltFuerKreis } = await termine();
		const zweitausendsechzehn = terminById("2016");
		expect(zweitausendsechzehn).toBeDefined();
		expect(terminGiltFuerKreis(zweitausendsechzehn!, "hildesheim")).toBe(true);
		expect(TERMINE.filter((t) => t.id === "2016")).toHaveLength(1);
	});

	it("kennzeichnet jede Seite als Simulation", async () => {
		const { DEMO_HINWEIS, demoAn } = await import("../src/lib/demo.ts");
		expect(demoAn()).toBe(true);
		expect(DEMO_HINWEIS).toMatch(/Simulation/);
	});
});
