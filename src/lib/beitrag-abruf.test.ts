/** Der Zeiger auf den zuletzt gesehenen Beitrag – ohne Browser prüfbar. */
import { describe, expect, it } from "vitest";
import {
	BEITRAG_PFAD,
	type BeitragAnsicht,
	type BeitraegeAntwort,
	aufnahmeUrl,
	beitragZeiger,
	beitraegeUrl,
} from "./beitrag-abruf.ts";

const ORT = { termin: "2026", kreis: "hildesheim", behoerde: "03254026" };

const beitrag = (id: number): BeitragAnsicht => ({
	id,
	zeit: "2026-09-13T18:05:00.000Z",
	toasts: [
		{
			marke: "rat",
			ort: "Nordstemmen",
			wahl: "Gemeinderatswahl",
			art: "stand",
			text: `${id} von 23 ausgezählt`,
		},
	],
	aufnahme: aufnahmeUrl(id),
});

/** Eine Gegenstelle, die Buch führt, welche Adressen abgefragt wurden. */
const gegenstelle = (antworten: BeitraegeAntwort[]) => {
	const gefragt: string[] = [];
	let n = 0;
	const hole = (async (url: string) => {
		gefragt.push(String(url));
		const a = antworten[Math.min(n++, antworten.length - 1)];
		return {
			ok: true,
			json: async () => a,
		} as unknown as Response;
	}) as unknown as typeof fetch;
	return { hole, gefragt };
};

describe("beitraegeUrl", () => {
	it("nennt Termin, Kreis, Wahlleitung und den Stand des Zeigers", () => {
		const url = beitraegeUrl(ORT, 7);
		expect(url).toContain("termin=2026");
		expect(url).toContain("kreis=hildesheim");
		expect(url).toContain("behoerde=03254026");
		expect(url).toContain("seit=7");
	});

	it("lässt die Wahlleitung weg, wo es keine gibt", () => {
		expect(beitraegeUrl({ ...ORT, behoerde: "" }, 0)).not.toContain(
			"behoerde=",
		);
	});
});

describe("der Zeiger", () => {
	it("meldet beim ersten Ping nichts, sondern merkt sich den Stand", async () => {
		// Sonst hagelte es beim Öffnen der Seite Einblender über Zahlen, die
		// längst dastehen.
		const { hole, gefragt } = gegenstelle([]);
		const z = beitragZeiger(hole);
		expect(await z.hole(ORT, 12)).toBeUndefined();
		expect(z.stand()).toBe(12);
		expect(gefragt).toEqual([]);
	});

	it("holt danach alles seit dem eigenen Stand", async () => {
		const { hole, gefragt } = gegenstelle([
			{
				topic: "hildesheim/03254026",
				letzte: 14,
				beitraege: [beitrag(13), beitrag(14)],
			},
		]);
		const z = beitragZeiger(hole);
		await z.hole(ORT, 12);
		const schub = await z.hole(ORT, 14);
		expect(schub?.beitraege.map((p) => p.id)).toEqual([13, 14]);
		expect(gefragt[0]).toContain("seit=12");
		expect(z.stand()).toBe(14);
	});

	it("fragt nicht, wenn der Ping nichts Neues meldet", async () => {
		const { hole, gefragt } = gegenstelle([]);
		const z = beitragZeiger(hole);
		await z.hole(ORT, 9);
		expect(await z.hole(ORT, 9)).toBeUndefined();
		expect(await z.hole(ORT, 8)).toBeUndefined();
		expect(gefragt).toEqual([]);
	});

	it("springt über das, was der Deckel abgeschnitten hat", async () => {
		// Wer eine Stunde weg war, bekommt nicht hundert Einblender nachgereicht.
		const { hole } = gegenstelle([
			{
				topic: "hildesheim/03254026",
				letzte: 99,
				beitraege: [beitrag(5), beitrag(6)],
			},
		]);
		const z = beitragZeiger(hole);
		await z.hole(ORT, 4);
		const schub = await z.hole(ORT, 99);
		expect(schub?.beitraege).toHaveLength(2);
		expect(schub?.uebersprungen).toBe(true);
		expect(z.stand()).toBe(99);
	});

	it("sagt es, wenn nichts übersprungen wurde", async () => {
		const { hole } = gegenstelle([
			{
				topic: "hildesheim/03254026",
				letzte: 6,
				beitraege: [beitrag(5), beitrag(6)],
			},
		]);
		const z = beitragZeiger(hole);
		await z.hole(ORT, 4);
		expect((await z.hole(ORT, 6))?.uebersprungen).toBe(false);
	});

	it("hält zwei gleichzeitige Pings zu einem Abruf zusammen", async () => {
		const { hole, gefragt } = gegenstelle([
			{ topic: "hildesheim/03254026", letzte: 3, beitraege: [beitrag(3)] },
		]);
		const z = beitragZeiger(hole);
		await z.hole(ORT, 2);
		const [a, b] = await Promise.all([z.hole(ORT, 3), z.hole(ORT, 3)]);
		expect([a, b].filter(Boolean)).toHaveLength(1);
		expect(gefragt).toHaveLength(1);
	});

	it("hält den Stand, wenn die Gegenstelle nicht antwortet", async () => {
		const hole = (async () =>
			({
				ok: false,
				json: async () => ({}),
			}) as unknown as Response) as unknown as typeof fetch;
		const z = beitragZeiger(hole);
		await z.hole(ORT, 4);
		expect(await z.hole(ORT, 5)).toBeUndefined();
		expect(z.stand()).toBe(4);
	});
});

describe("aufnahmeUrl", () => {
	it("führt über die Beitragskennung, nicht über den Satz", () => {
		const url = aufnahmeUrl(41);
		expect(url).toBe(`${BEITRAG_PFAD}/41.mp3`);
		expect(url).not.toContain("text");
	});
});
