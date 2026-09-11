import { describe, expect, it } from "vitest";
import {
	type Grenze,
	STANDARD_GRENZE,
	STANDARD_GRENZEN,
	grenzenAusUmgebung,
	hostDrossel,
} from "./drossel.ts";

const uhr = () => {
	let t = 0;
	return {
		jetzt: () => t,
		warte: async (ms: number) => {
			t += ms;
		},
		vor: (ms: number) => {
			t += ms;
		},
	};
};

describe("hostDrossel", () => {
	const grenze: Grenze = { proSekunde: 10, spitze: 20 };

	it("gibt den Vorrat sofort heraus und bremst erst danach", async () => {
		const u = uhr();
		const d = hostDrossel({
			grenzen: { "fremd.example": grenze },
			jetzt: u.jetzt,
			warte: u.warte,
		});
		for (let i = 0; i < 20; i++) await d.nimm("fremd.example");
		expect(u.jetzt()).toBe(0); // die Spitze kostet keine Zeit

		await d.nimm("fremd.example");
		expect(u.jetzt()).toBeGreaterThanOrEqual(100);
	});

	it("hält die Rate über viele Anfragen ein", async () => {
		const u = uhr();
		const d = hostDrossel({
			grenzen: { "fremd.example": grenze },
			jetzt: u.jetzt,
			warte: u.warte,
		});
		const anzahl = 520;
		for (let i = 0; i < anzahl; i++) await d.nimm("fremd.example");
		const sekunden = u.jetzt() / 1000;
		expect(sekunden).toBeGreaterThanOrEqual(49);
		expect(anzahl / Math.max(sekunden, 1)).toBeLessThanOrEqual(
			grenze.proSekunde + 1,
		);
	});

	it("führt je Host ein eigenes Konto – der große Host bremst den kleinen nicht", async () => {
		const u = uhr();
		const d = hostDrossel({
			grenzen: {
				"gross.example": { proSekunde: 60, spitze: 120 },
				"klein.example": { proSekunde: 2, spitze: 2 },
			},
			jetzt: u.jetzt,
			warte: u.warte,
		});
		for (let i = 0; i < 100; i++) await d.nimm("gross.example");
		expect(u.jetzt()).toBe(0); // alles aus dem Vorrat
		expect(d.frei("klein.example")).toBe(2); // unberührt
	});

	it("gibt unbekannten Hosts die vorsichtige Vorgabe", async () => {
		const u = uhr();
		const d = hostDrossel({ grenzen: {}, jetzt: u.jetzt, warte: u.warte });
		expect(d.frei("unbekannt.example")).toBe(STANDARD_GRENZE.spitze);
	});

	it("bremst den eigenen Rechner nicht – Tests laufen gegen einen Mock", async () => {
		const u = uhr();
		const d = hostDrossel({ grenzen: {}, jetzt: u.jetzt, warte: u.warte });
		for (let i = 0; i < 5_000; i++) await d.nimm("127.0.0.1:8099");
		expect(u.jetzt()).toBe(0);
	});

	it("nimmt eine ausdrückliche Grenze auch für den eigenen Rechner an", async () => {
		const u = uhr();
		const d = hostDrossel({
			grenzen: { "127.0.0.1:8099": { proSekunde: 5, spitze: 5 } },
			jetzt: u.jetzt,
			warte: u.warte,
		});
		for (let i = 0; i < 10; i++) await d.nimm("127.0.0.1:8099");
		expect(u.jetzt()).toBeGreaterThanOrEqual(1000);
	});

	it("deckelt den Vorrat, egal wie lange Ruhe war", async () => {
		const u = uhr();
		const d = hostDrossel({
			grenzen: { "fremd.example": grenze },
			jetzt: u.jetzt,
			warte: u.warte,
		});
		await d.nimm("fremd.example");
		u.vor(3600_000); // eine Stunde Pause
		expect(d.frei("fremd.example")).toBe(grenze.spitze);
	});
});

describe("grenzenAusUmgebung", () => {
	it("nimmt ohne Angabe die Standardwerte", () => {
		expect(grenzenAusUmgebung(undefined)).toEqual(STANDARD_GRENZEN);
		expect(grenzenAusUmgebung("  ")).toEqual(STANDARD_GRENZEN);
	});

	it("liest host=rate:spitze und ergänzt die Spitze, wenn sie fehlt", () => {
		const g = grenzenAusUmgebung("a.example=5:9, b.example=4");
		expect(g["a.example"]).toEqual({ proSekunde: 5, spitze: 9 });
		expect(g["b.example"]).toEqual({ proSekunde: 4, spitze: 8 });
		expect(g["votemanager.kdo.de"]).toEqual(
			STANDARD_GRENZEN["votemanager.kdo.de"],
		);
	});

	it("überschreibt einen Standardwert, wenn ein Betreiber eine Zahl nennt", () => {
		expect(grenzenAusUmgebung("votemanager.kdo.de=5")).toMatchObject({
			"votemanager.kdo.de": { proSekunde: 5 },
		});
	});

	it("übergeht Unsinn, statt den Poller lahmzulegen", () => {
		const g = grenzenAusUmgebung("kaputt, =3, x.example=0, y.example=abc");
		expect(g["x.example"]).toBeUndefined();
		expect(g["y.example"]).toBeUndefined();
	});
});
