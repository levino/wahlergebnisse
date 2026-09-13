import { describe, expect, it } from "vitest";
import { type Partei, parteiZuSitzeintrag } from "../src/lib/votemanager.ts";

const partei = (kurz: string, lang = kurz): Partei => ({
	key: kurz
		.trim()
		.toLowerCase()
		.replace(/[\s./-]+/g, ""),
	kurz,
	lang,
	farbe: "#000",
	stimmen: 0,
	prozent: 0,
});

describe("Die Sitzverteilung findet ihre Partei", () => {
	// Ortsrat Nordstemmen, Wahlabend 2026: die Torte nennt
	// „Einzelwahlvorschlag Köhn", das Ergebnis „Köhn, Einzelwahlvorschlag".
	// Köhns Sitz fehlte deshalb an seinem Balken.
	const nordstemmen = [
		partei("SPD", "Sozialdemokratische Partei Deutschlands"),
		partei("CDU", "Christlich Demokratische Union Deutschlands"),
		partei("GRÜNE", "BÜNDNIS 90/DIE GRÜNEN"),
		partei("Köhn, Einzelwahlvorschlag"),
	];

	it("erkennt denselben Namen in anderer Wortfolge", () => {
		expect(
			parteiZuSitzeintrag(
				nordstemmen,
				"Einzelwahlvorschlag Köhn",
				"Einzelwahlvorschlag Köhn",
			)?.kurz,
		).toBe("Köhn, Einzelwahlvorschlag");
	});

	it("nimmt den vollen Namen aus dem Tooltip, wenn die Kürzung über zwei Wörter geht", () => {
		// Rat Burgdorf, Region Hannover: „Einzelwahlv...Fleischmann" – die
		// Auslassung verschluckt die Wortgrenze, aus zwei Wörtern wird eines.
		// Über das Label allein ist da nichts zu holen, über den Tooltip schon.
		const burgdorf = [
			partei("CDU"),
			partei("SPD"),
			partei("Die PARTEI"),
			partei("Fleischmann, Einzelwahlvorschlag"),
		];
		expect(
			parteiZuSitzeintrag(
				burgdorf,
				"Einzelwahlv...Fleischmann",
				"Einzelwahlvorschlag Fleischmann",
			)?.kurz,
		).toBe("Fleischmann, Einzelwahlvorschlag");
		// Ohne Tooltip bleibt es offen, statt geraten zu werden.
		expect(
			parteiZuSitzeintrag(burgdorf, "Einzelwahlv...Fleischmann"),
		).toBeUndefined();
	});

	it("erkennt ihn auch, wenn die Torte den Namen kürzt", () => {
		// Ortsrat Klein Escherde: „Einzelwahlv...hlag Weigel".
		const klein = [
			partei("WGKE"),
			partei("Weigel, Einzelwahlvorschlag"),
			partei("Sayna, Einzelwahlvorschlag"),
		];
		expect(parteiZuSitzeintrag(klein, "Einzelwahlv...hlag Weigel")?.kurz).toBe(
			"Weigel, Einzelwahlvorschlag",
		);
	});

	it("findet die gewöhnlichen Parteien weiterhin über den Langnamen", () => {
		expect(
			parteiZuSitzeintrag(
				nordstemmen,
				"SPD",
				"Sozialdemokratische Partei Deutschlands",
			)?.kurz,
		).toBe("SPD");
	});

	it("ordnet nichts zu, wenn zwei Bewerber gleich gut passen", () => {
		// Zwei Einzelwahlvorschläge Köhn – dann ist die Wortmenge nicht eindeutig,
		// und ein geratener Sitz wäre schlimmer als ein fehlender.
		const doppelt = [
			partei("Köhn, Einzelwahlvorschlag"),
			partei("Einzelwahlvorschlag, Köhn"),
		];
		expect(
			parteiZuSitzeintrag(doppelt, "Einzelwahlvorschlag Köhn"),
		).toBeUndefined();
	});

	it("ordnet nichts zu, wenn ein Wort fehlt oder eines zu viel ist", () => {
		expect(
			parteiZuSitzeintrag(nordstemmen, "Einzelwahlvorschlag"),
		).toBeUndefined();
		expect(
			parteiZuSitzeintrag(nordstemmen, "Einzelwahlvorschlag Köhn Meier"),
		).toBeUndefined();
	});
});
