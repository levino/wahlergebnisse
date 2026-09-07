/**
 * Der MCP-Endpunkt aus der Sicht eines Sprachmodells: Welche Werkzeuge es
 * gibt, was ihre Schemas verlangen und was bei Kreisen und Terminen
 * herauskommt, für die nichts vorliegt.
 *
 * Geprüft werden die Werkzeuge selbst (`rufeWerkzeug` ist dieselbe Stelle, die
 * der HTTP-Handler aufruft) – ohne Netz, gegen die Fixtures über den
 * Mock-votemanager. Dass derselbe Aufbau auch über die Leitung stimmt, prüft
 * e2e/api.e2e.ts mit echten JSON-RPC-Aufrufen.
 */
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIXTURES, aufraeumen, tempVerzeichnis } from "./helfer.ts";
import {
	type MockVotemanager,
	starteMockVotemanager,
} from "./mock-votemanager.ts";

let mock: MockVotemanager;
let tmp: string;

/** Die Werkzeuge einmal laden – erst nachdem DATABASE_PATH gesetzt ist. */
const mcp = async () => await import("../server/mcp.ts");

/** Antwort als geparstes JSON; wirft, wenn das Werkzeug einen Fehler meldet. */
const daten = async (name: string, args: Record<string, unknown> = {}) => {
	const { rufeWerkzeug } = await mcp();
	const a = rufeWerkzeug(name, args);
	if (a.isError) throw new Error(`Werkzeug '${name}': ${a.content[0].text}`);
	return JSON.parse(a.content[0].text);
};

/** Antwort roh, mitsamt Fehlerkennzeichen. */
const antwort = async (name: string, args: Record<string, unknown> = {}) => {
	const { rufeWerkzeug } = await mcp();
	const a = rufeWerkzeug(name, args);
	return { text: a.content[0].text, fehler: a.isError === true };
};

beforeAll(async () => {
	tmp = tempVerzeichnis();
	mock = await starteMockVotemanager(FIXTURES);
	process.env.VOTEMANAGER_BASIS = mock.url;
	process.env.DATABASE_PATH = join(tmp, "wahlen.db");
	const { oeffneDb } = await import("../src/lib/db.ts");
	const { pollTermin } = await import("../src/lib/poll.ts");
	const { terminById } = await import("../src/data/termine.ts");
	await pollTermin(oeffneDb(), terminById("2021")!, {
		nurBehoerden: ["03254000", "03254026"],
	});
	// Der Wahltag einer einzigen Gemeinde – gebraucht für die Prüfung, dass die
	// Auskunft ihn bei Nordstemmen führt und nicht beim Landkreis.
	await pollTermin(oeffneDb(), terminById("2020")!);
});

afterAll(async () => {
	const { schliesseDb } = await import("../src/lib/db.ts");
	schliesseDb();
	await mock.schliessen();
	aufraeumen(tmp);
});

describe("MCP-Werkzeuge", () => {
	it("führt die Suchwerkzeuge vor den Datenwerkzeugen auf", async () => {
		const { WERKZEUGE } = await mcp();
		expect(WERKZEUGE.map((w) => w.name)).toEqual([
			"kreise",
			"gemeinde_suchen",
			"wahltermine",
			"ueberblick",
			"behoerden",
			"wahlen",
			"ergebnis",
			"gebiete",
			"ticker",
			"wahllokale",
			"vergleich",
		]);
	});

	it("verlangt den Kreis bei jedem Werkzeug, das Zahlen liefert", async () => {
		const { WERKZEUGE } = await mcp();
		const ohneKreis = ["kreise", "gemeinde_suchen", "wahltermine"];
		for (const w of WERKZEUGE) {
			if (ohneKreis.includes(w.name)) continue;
			expect(w.schema.required, w.name).toContain("kreis");
			expect(w.schema.properties.kreis, w.name).toBeTruthy();
		}
		// 'wahltermine' kennt den Kreis, verlangt ihn aber nicht.
		const termine = WERKZEUGE.find((w) => w.name === "wahltermine")!;
		expect(termine.schema.properties.kreis).toBeTruthy();
		expect(termine.schema.required ?? []).not.toContain("kreis");
	});

	it("nennt im Kreis-Feld alle 45 Slugs und im Text den Slug, nicht den Schlüssel", async () => {
		const { WERKZEUGE } = await mcp();
		const kreisFeld = WERKZEUGE.find((w) => w.name === "ergebnis")!.schema
			.properties.kreis as { enum: string[]; description: string };
		expect(kreisFeld.enum).toHaveLength(45);
		expect(kreisFeld.enum).toContain("hildesheim");
		expect(kreisFeld.enum).toContain("region-hannover");
		expect(kreisFeld.description).toContain("Slug");
		expect(kreisFeld.description).toContain("gemeinde_suchen");
	});

	it("beschreibt die Behörde ohne Aufzählung, weil Slugs nur im Kreis gelten", async () => {
		const { WERKZEUGE } = await mcp();
		const feld = WERKZEUGE.find((w) => w.name === "ergebnis")!.schema.properties
			.behoerde as { enum?: string[]; description: string };
		expect(feld.enum).toBeUndefined();
		expect(feld.description).toContain("behoerden");
	});
});

describe("Kreise finden", () => {
	it("listet alle 45 Kreise mit Slug und Verfügbarkeit", async () => {
		const d = await daten("kreise");
		expect(d.anzahl).toBe(45);
		expect(
			d.kreise.find((k: { slug: string }) => k.slug === "hildesheim"),
		).toMatchObject({ kurz: "Hildesheim", ergebnisseVorhanden: true });
		const sz = d.kreise.find((k: { slug: string }) => k.slug === "salzgitter");
		expect(sz.ergebnisseVorhanden).toBe(false);
		expect(sz.hinweis).toBeTruthy();
	});

	it("grenzt die Liste mit 'suche' ein", async () => {
		const d = await daten("kreise", { suche: "osna" });
		expect(d.kreise.map((k: { slug: string }) => k.slug)).toEqual([
			"osnabrueck-stadt",
			"osnabrueck-land",
		]);
	});

	it("findet den Kreis zu einem Ortsnamen", async () => {
		const d = await daten("gemeinde_suchen", { name: "Nordstemmen" });
		expect(d.anzahl).toBe(1);
		expect(d.eindeutig).toBe(true);
		expect(d.treffer[0]).toMatchObject({
			kreis: "hildesheim",
			behoerde: "nordstemmen",
			art: "gemeinde",
			ags: "03254026",
			ergebnisseVorhanden: true,
		});
	});

	it("zeigt Namensvettern, statt den ersten Treffer zu nehmen", async () => {
		const d = await daten("gemeinde_suchen", { name: "Neuenkirchen" });
		expect(d.anzahl).toBeGreaterThan(1);
		expect(d.eindeutig).toBe(false);
		expect(d.hinweis).toMatch(/Mehrere/);
		const kreise = new Set(d.treffer.map((t: { kreis: string }) => t.kreis));
		expect(kreise.size).toBeGreaterThan(1);
	});

	it("ist bei Umlauten, Zusätzen und Schlüsseln nachsichtig", async () => {
		for (const frage of [
			"roessing",
			"Gemeinde Nordstemmen",
			"NORDSTEMMEN",
			"03254026",
		]) {
			const d = await daten("gemeinde_suchen", { name: frage });
			if (frage === "roessing") {
				// Rössing ist ein Ortsteil, keine Wahlleitung – das sagt der Hinweis.
				expect(d.anzahl).toBe(0);
				expect(d.hinweis).toMatch(/Ortsteile/);
				continue;
			}
			expect(
				d.treffer.map((t: { behoerde: string }) => t.behoerde),
				frage,
			).toContain("nordstemmen");
		}
	});

	it("liefert bei leerer Suche nichts statt aller Wahlleitungen", async () => {
		for (const frage of ["-", "?!"]) {
			const d = await daten("gemeinde_suchen", { name: frage });
			expect(d.anzahl, frage).toBe(0);
		}
	});

	it("findet die Kreisbehörde über den Kreisnamen", async () => {
		const d = await daten("gemeinde_suchen", { name: "Landkreis Hildesheim" });
		expect(
			d.treffer.some(
				(t: { kreis: string; behoerde: string }) =>
					t.kreis === "hildesheim" && t.behoerde === "kreis",
			),
		).toBe(true);
	});
});

describe("Kreis als Pflichtangabe", () => {
	it("erklärt bei fehlendem Kreis, wie er zu finden ist", async () => {
		const a = await antwort("ergebnis", {
			termin: "2021",
			behoerde: "nordstemmen",
			wahl: "rat",
		});
		expect(a.fehler).toBe(true);
		expect(a.text).toContain("'kreis'");
		expect(a.text).toContain("gemeinde_suchen");
	});

	it("weist einen unbekannten Kreis zurück und verweist auf 'kreise'", async () => {
		const a = await antwort("ueberblick", {
			kreis: "gibtsnicht",
			termin: "2021",
		});
		expect(a.fehler).toBe(true);
		expect(a.text).toContain("kreise");
	});

	it("nimmt auch den Gebietsschlüssel des Kreises an", async () => {
		const d = await daten("ueberblick", { kreis: "03254000", termin: "2021" });
		expect(d.kreis.slug).toBe("hildesheim");
	});

	it("meldet eine Behörde aus einem anderen Kreis als Fehler", async () => {
		const a = await antwort("ergebnis", {
			kreis: "nienburg",
			termin: "2026",
			behoerde: "nordstemmen",
			wahl: "rat",
		});
		expect(a.fehler).toBe(true);
		expect(a.text).toContain("gemeinde_suchen");
	});
});

describe("Lücken im Bestand", () => {
	it("erklärt einen Kreis ohne Präsentation, statt zu scheitern", async () => {
		for (const werkzeug of [
			"ueberblick",
			"behoerden",
			"wahlen",
			"ticker",
		] as const) {
			const a = await antwort(werkzeug, {
				kreis: "salzgitter",
				termin: "2026",
			});
			expect(a.fehler, werkzeug).toBe(false);
			expect(a.text, werkzeug).toContain("Stadt Salzgitter");
			expect(a.text, werkzeug).toMatch(/keine Ergebnisse vor/);
		}
	});

	it("sagt bei einem Archivtermin, für welche Kreise er vorliegt", async () => {
		// Die Kommunalwahl 2021 gibt es fast überall, die Landratswahl vom
		// 09.10.2022 nur im Landkreis Harburg. Wer sie anderswo abfragt, soll
		// das erfahren – und hören, was es dort stattdessen gibt.
		const a = await antwort("ueberblick", {
			kreis: "osnabrueck-land",
			termin: "2022-10-09",
		});
		expect(a.fehler).toBe(false);
		expect(a.text).toContain("Harburg");
		expect(a.text).toContain("2021");
	});

	it("weist bei einem Gemeinde-Wahltag auf die Wahlleitung", async () => {
		// Der 13.09.2020 ist der Wahltag der Gemeinde Nordstemmen, nicht der des
		// Landkreises. Kreisweit abgefragt kommt keine leere Antwort, sondern
		// der Weg zur richtigen Ebene.
		const a = await antwort("ueberblick", {
			kreis: "hildesheim",
			termin: "2020",
		});
		expect(a.fehler).toBe(false);
		expect(a.text).toContain("nordstemmen");
		expect(a.text).toContain("behoerde");
		// Mit der Wahlleitung geht dieselbe Frage auf.
		const b = await antwort("wahlen", {
			kreis: "hildesheim",
			termin: "2020",
			behoerde: "nordstemmen",
		});
		expect(b.fehler).toBe(false);
		expect(b.text).toContain("buergermeister");
		// Und bei der Nachbargemeinde bleibt es bei der Erklärung.
		const c = await antwort("wahlen", {
			kreis: "hildesheim",
			termin: "2020",
			behoerde: "algermissen",
		});
		expect(c.fehler).toBe(false);
		expect(c.text).toMatch(/nicht gewählt/);
	});

	it("führt bei den Terminen mit, für wen sie gelten", async () => {
		const alle = await daten("wahltermine");
		expect(alle.termine.find((t: { id: string }) => t.id === "2026").gilt).toBe(
			"alle Kreise",
		);
		// 2021 gilt nicht überall – Salzgitter, Wolfsburg, Celle, Uelzen und
		// der Heidekreis liefern diesen Wahltag nicht aus.
		const gilt2021 = alle.termine.find(
			(t: { id: string }) => t.id === "2021",
		).gilt;
		expect(gilt2021).toHaveLength(40);
		expect(gilt2021).toContain("hildesheim");
		expect(gilt2021).not.toContain("salzgitter");

		const dort = await daten("wahltermine", { kreis: "salzgitter" });
		expect(dort.termine.map((t: { id: string }) => t.id)).toEqual(["2026"]);

		// Der Landkreis Hildesheim hat zwei kreisweite Wahltage. Die fünf
		// Direktwahl-Vorwerte seiner Kommunen – Söhlde am 14.12.2025,
		// Nordstemmen am 13.09.2020 – stehen getrennt davon, jeder mit der
		// Wahlleitung, die ihn führt. In einen Topf geworfen, fragte ein Modell
		// sie kreisweit ab und bekäme nichts.
		const hier = await daten("wahltermine", { kreis: "hildesheim" });
		expect(hier.termine.map((t: { id: string }) => t.id)).toEqual([
			"2026",
			"2021",
		]);
		expect(
			hier.weitereTermine.map(
				(t: { id: string; nurBei: string[] }) => `${t.id}:${t.nurBei}`,
			),
		).toEqual([
			"2025-12-14:soehlde",
			"2023-03-05:algermissen",
			"2020-09-20:elze",
			"2020:nordstemmen",
			"2018-12-16:bad-salzdetfurth",
		]);
		// Auch landesweit trennt die Auskunft die Ebenen.
		const bm2020 = alle.termine.find((t: { id: string }) => t.id === "2020");
		expect(bm2020.gilt).toEqual([]);
		expect(bm2020.nurWahlleitungen).toEqual(["hildesheim/nordstemmen"]);
	});
});

describe("Ergebnisse mit Kreis", () => {
	it("liefert das Ratsergebnis von Nordstemmen", async () => {
		const d = await daten("ergebnis", {
			kreis: "hildesheim",
			termin: "2021",
			behoerde: "nordstemmen",
			wahl: "rat",
		});
		expect(d.ergebnis.sitze.gesamt).toBe(30);
		expect(
			d.ergebnis.parteien.find((p: { key: string }) => p.key === "cdu").sitze,
		).toBe(9);
	});

	it("nennt den Kreis in Listen und Überblick", async () => {
		const w = await daten("wahlen", { kreis: "hildesheim", termin: "2021" });
		expect(w.kreis).toBe("hildesheim");
		expect(w.anzahl).toBeGreaterThan(0);

		const b = await daten("behoerden", { kreis: "hildesheim", termin: "2021" });
		expect(b.kreis).toBe("hildesheim");
		expect(b.behoerden.map((x: { slug: string }) => x.slug)).toContain(
			"nordstemmen",
		);

		const u = await daten("ueberblick", {
			kreis: "hildesheim",
			termin: "2021",
		});
		expect(u.kreis.slug).toBe("hildesheim");
	});

	it("gibt die Gebietstabelle als CSV aus", async () => {
		const a = await antwort("gebiete", {
			kreis: "hildesheim",
			termin: "2021",
			behoerde: "nordstemmen",
			wahl: "rat",
			ebene: "ortsteil",
			format: "csv",
		});
		expect(a.fehler).toBe(false);
		expect(a.text).toContain("gebiet_name;ebene");
	});

	/**
	 * Der Ticker füllt sich nur bei Live-Terminen, und die 2026er Fixtures sind
	 * von vor der Wahl. Deshalb hier zwei Meldungen von Hand – eine aus
	 * Hildesheim, eine aus Nienburg –, um zu prüfen, dass jeder Kreis nur seine
	 * eigenen sieht und die Schlüssel im richtigen Kreis in Slugs aufgelöst
	 * werden.
	 */
	it("hält den Ticker im eigenen Kreis", async () => {
		const { oeffneDb } = await import("../src/lib/db.ts");
		const db = oeffneDb();
		for (const [ags, text] of [
			["03254026", "Nordstemmen: Rat 3 von 23"],
			["03256022", "Nienburg: Rat 1 von 12"],
		]) {
			db.prepare(
				"INSERT INTO ereignisse (termin, zeit, behoerde, wahl_id, gebiet_id, art, text, json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
			).run(
				"2026",
				"2026-09-13T18:05:00.000Z",
				ags,
				1,
				"ebene_3_id_1",
				"fortschritt",
				text,
				JSON.stringify({ anz: 1, max: 12, spitze: [] }),
			);
		}

		const hier = await daten("ticker", { kreis: "hildesheim", termin: "2026" });
		expect(hier.kreis).toBe("hildesheim");
		expect(hier.ereignisse).toHaveLength(1);
		// Slug und Name aus dem angefragten Kreis, nicht der Gebietsschlüssel.
		expect(hier.ereignisse[0].behoerde).toBe("nordstemmen");
		expect(hier.ereignisse[0].behoerdeName).toBe("Nordstemmen");

		const dort = await daten("ticker", { kreis: "nienburg", termin: "2026" });
		expect(dort.ereignisse).toHaveLength(1);
		expect(dort.ereignisse[0].behoerde).not.toMatch(/^\d+$/);
		expect(dort.ereignisse[0].text).toContain("Nienburg");
	});
});
