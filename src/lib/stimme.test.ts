/** Der Ansage-Schalter und die Adresse, die alle Zuschauer teilen. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ANSAGE_PFAD, ansageUrl } from "./ansage.ts";

const speicher = new Map<string, string>();

vi.stubGlobal("localStorage", {
	getItem: (k: string) => speicher.get(k) ?? null,
	setItem: (k: string, v: string) => {
		speicher.set(k, v);
	},
	removeItem: (k: string) => {
		speicher.delete(k);
	},
});

const modul = async () => {
	vi.resetModules();
	return await import("./stimme.ts");
};

beforeEach(() => {
	speicher.clear();
});

describe("ansageUrl", () => {
	it("führt keine Stimme mit – alle Zuschauer fragen dieselbe Adresse", async () => {
		const eine = ansageUrl("Rössing ist fertig ausgezählt.", "03254026");
		const andere = ansageUrl("Rössing ist fertig ausgezählt.", "03254026");
		expect(eine).toBe(andere);
		expect(eine).not.toContain("stimme");
		expect(eine.startsWith(`${ANSAGE_PFAD}?`)).toBe(true);
	});

	it("trennt die Wahlleitungen, nicht die Zuschauer", () => {
		const satz = "Rat Nordstemmen: 15 von 23 ausgezählt.";
		expect(ansageUrl(satz, "03254026")).not.toBe(ansageUrl(satz, "03254021"));
	});

	it("kodiert Umlaute und Satzzeichen", () => {
		expect(ansageUrl("Groß Escherde – 2 von 3.", "03254026")).toContain(
			encodeURIComponent("Groß Escherde – 2 von 3."),
		);
	});
});

describe("der Ansage-Schalter", () => {
	it("steht am Wahlabend von selbst auf an", async () => {
		const { ansageAn } = await modul();
		expect(ansageAn()).toBe(true);
	});

	it("merkt sich das Abschalten", async () => {
		const { ansageAn, setzeAnsage } = await modul();
		setzeAnsage(false);
		expect(ansageAn()).toBe(false);
		setzeAnsage(true);
		expect(ansageAn()).toBe(true);
	});

	it("bleibt an, wenn der Speicher zumacht", async () => {
		const { ansageAn } = await modul();
		vi.stubGlobal("localStorage", {
			getItem: () => {
				throw new Error("kein Speicher");
			},
			setItem: () => {
				throw new Error("kein Speicher");
			},
			removeItem: () => {},
		});
		expect(ansageAn()).toBe(true);
		vi.stubGlobal("localStorage", {
			getItem: (k: string) => speicher.get(k) ?? null,
			setItem: (k: string, v: string) => {
				speicher.set(k, v);
			},
			removeItem: (k: string) => {
				speicher.delete(k);
			},
		});
	});

	it("hält den Schalter getrennt vom Ton", async () => {
		const { STIMME_SCHLUESSEL } = await modul();
		const { TON_SCHLUESSEL } = await import("./klang.ts");
		expect(STIMME_SCHLUESSEL).not.toBe(TON_SCHLUESSEL);
	});
});

describe("der Hinweis auf die erzeugte Stimme", () => {
	it("sagt, dass die Stimme synthetisch ist – Auflage des Anbieters", async () => {
		const { STIMME_HINWEIS } = await modul();
		expect(STIMME_HINWEIS).toMatch(/synthetisch/i);
	});
});
