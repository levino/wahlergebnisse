/**
 * Detailseite je Gemeinde bei kreisweiten Wahlen – unter den Bedingungen, die
 * in Niedersachsen wirklich herrschen: **kein Verzeichnislisting**.
 *
 * Dann findet der Poller beim Kreis kein einziges Gemeinde-Ergebnis der
 * Kreistags- oder Landratswahl; die Gemeinden stehen nur als Zeilen in der
 * Übersicht, und deren Verweis zeigt auf die Präsentation der Gemeinde. Genau
 * dorthin muss die App führen (siehe src/lib/kreiswahl.ts). Eine Gemeinde
 * ohne eigene Präsentation bleibt sichtbar, aber ohne Verweis.
 *
 * Der Fall wird hier für Hildesheim geprüft, weil nur dafür Fixtures
 * vorliegen; der Weg ist derselbe wie in jedem anderen Kreis – der Kreis wird
 * an keiner Stelle gesondert behandelt. Die Gemeinde Algermissen wird beim
 * Abgleich ausgelassen und spielt damit die Gemeinde, die ihre Präsentation
 * noch nicht angelegt hat.
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

/** Die Gemeinde, die in diesem Test keine eigene Präsentation hat. */
const OHNE_PRAESENTATION = "03254003"; // Gemeinde Algermissen

beforeAll(async () => {
	tmp = tempVerzeichnis("wahlen-kreiswahl-");
	mock = await starteMockVotemanager(FIXTURES, 0, { listing: false });
	process.env.VOTEMANAGER_BASIS = mock.url;
	process.env.DATABASE_PATH = join(tmp, "wahlen.db");
	const { oeffneDb } = await import("../src/lib/db.ts");
	const { pollTermin } = await import("../src/lib/poll.ts");
	const { terminById } = await import("../src/data/termine.ts");
	const { BEHOERDEN } = await import("../src/data/behoerden.ts");
	await pollTermin(oeffneDb(), terminById("2021")!, {
		nurBehoerden: BEHOERDEN.map((b) => b.ags).filter(
			(ags) => ags !== OHNE_PRAESENTATION,
		),
	});
});

afterAll(async () => {
	const { schliesseDb } = await import("../src/lib/db.ts");
	schliesseDb();
	await mock.schliessen();
	aufraeumen(tmp);
});

const seite = async (behoerdeSlug: string, wahl: string, gebiet?: string) => {
	const { ladeWahlSeite } = await import("../src/lib/seite.ts");
	const { kreisBySlug } = await import("../src/data/kreise.ts");
	const { terminById } = await import("../src/data/termine.ts");
	const { behoerdeBySlug } = await import("../src/data/behoerden.ts");
	return ladeWahlSeite(
		kreisBySlug("hildesheim")!,
		terminById("2021")!,
		behoerdeBySlug(behoerdeSlug)!,
		wahl,
		gebiet,
	);
};

describe("Gemeinden einer kreisweiten Wahl", () => {
	it("beim Kreis liegt kein Gemeinde-Ergebnis, in der Übersicht stehen alle", async () => {
		const { ergebnisseEbene, uebersichten, wahleintraege } = await import(
			"../src/lib/abfragen.ts"
		);
		const kreistag = wahleintraege("2021", "03254000").find(
			(w) => w.typ === "kreistag",
		)!;
		// Das ist die Lücke: ohne Listing findet der Poller beim Kreis nur das
		// Gesamtgebiet und die Wahlbereiche – keine einzige Gemeinde.
		expect(
			ergebnisseEbene("2021", "03254000", kreistag.wahlId, 3),
		).toHaveLength(0);
		const gemeinden = uebersichten("2021", "03254000", kreistag.wahlId).find(
			(u) => u.titel === "Gemeinden",
		)!;
		expect(gemeinden.uebersicht.zeilen.length).toBeGreaterThan(15);
		// … und keine dieser Zeilen trägt eine Gebiets-Id, nur einen Verweis
		// auf die fremde Präsentation.
		expect(gemeinden.uebersicht.zeilen.every((z) => !z.gebietId)).toBe(true);
	});

	it("Tabelle verlinkt jede Gemeinde auf ihre eigene Kreistagsseite", async () => {
		const m = (await seite("kreis", "kreistag"))!;
		const tabelle = m.tabellen.find((t) => t.titel === "Gemeinden")!;
		expect(
			tabelle.zeilen.find((z) => z.label === "Gemeinde Nordstemmen")?.href,
		).toBe("/hildesheim/2021/nordstemmen/kreistag/");
		expect(
			tabelle.zeilen.find((z) => z.label === "Stadt Alfeld (Leine)")?.href,
		).toBe("/hildesheim/2021/alfeld/kreistag/");
		// Die Gemeinde ohne Präsentation bleibt in der Tabelle, aber ohne Verweis
		const ohne = tabelle.zeilen.find(
			(z) => z.label === "Gemeinde Algermissen",
		)!;
		expect(ohne.href).toBeUndefined();
		expect(ohne.werte.length).toBeGreaterThan(0);
		// Alle übrigen Zeilen führen irgendwohin – niemand bleibt stumm.
		expect(tabelle.zeilen.filter((z) => !z.href).map((z) => z.label)).toEqual([
			"Gemeinde Algermissen",
		]);
	});

	it("Karte und Gebiets-Menü führen an dieselbe Stelle", async () => {
		const m = (await seite("kreis", "kreistag"))!;
		const gemeinden = m.karte!.ebenen.find((e) => e.id === "gemeinden")!;
		expect(gemeinden.flaechen.find((f) => f.name === "Nordstemmen")?.href).toBe(
			"/hildesheim/2021/nordstemmen/kreistag/",
		);
		// Ohne Präsentation bleibt die Fläche eingefärbt, nur eben ohne Ziel.
		const algermissen = gemeinden.flaechen.find(
			(f) => f.name === "Algermissen",
		);
		expect(algermissen).toBeDefined();
		expect(algermissen?.href).toBeUndefined();

		const { alsAuswahl } = await import("../src/lib/gebietsbaum.ts");
		const auswahl = alsAuswahl(m.gebiete);
		expect(auswahl.find((g) => g.titel === "Gemeinde Nordstemmen")?.href).toBe(
			"/hildesheim/2021/nordstemmen/kreistag/",
		);
		// Ohne Präsentation gibt es auch nichts anzuspringen: kein Eintrag –
		// alle übrigen Gemeinden stehen aber im Menü.
		const imMenue = auswahl.filter((g) =>
			/^(Gemeinde|Stadt|Samtgemeinde) /.test(g.titel),
		);
		expect(imMenue.length).toBeGreaterThan(15);
		expect(auswahl.some((g) => g.titel === "Gemeinde Algermissen")).toBe(false);
		// Unterhalb der Gemeinde stehen weiterhin ihre Wahlbezirke
		expect(auswahl.some((g) => /Rössing/.test(g.titel))).toBe(true);
	});

	it("dieselbe Regel gilt für die Landratswahl", async () => {
		const m = (await seite("kreis", "landrat"))!;
		const tabelle = m.tabellen.find((t) => t.titel === "Gemeinden")!;
		expect(
			tabelle.zeilen.find((z) => z.label === "Gemeinde Nordstemmen")?.href,
		).toBe("/hildesheim/2021/nordstemmen/landrat/");
	});

	it("die verlinkte Seite trägt die Zahlen der Gemeinde – und keine erfundenen Sitze", async () => {
		const m = (await seite("nordstemmen", "kreistag"))!;
		expect(m.gebietName).toBe("Gemeinde Nordstemmen");
		expect(m.aktuell?.standAnz).toBe(23);
		expect(m.balken.find((b) => b.kurz === "SPD")?.prozent).toBeGreaterThan(0);
		// Untergebiete, die der Kreis gar nicht führt
		expect(m.tabellen.map((t) => t.titel)).toContain("Wahlbezirke");
		// Der Kreistag wird im Kreis verteilt, nicht in der Gemeinde.
		expect(m.sitze).toBeUndefined();
	});
});
