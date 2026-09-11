/**
 * Eine Wahlleitung mit eigener Quelle schaltet vor ihrer Kreisbehörde frei.
 *
 * Die Region Hannover kündigt den 13.09.2026 in ihrem Termin-Index an und
 * antwortet auf die Präsentation weiter mit 404. Die Landeshauptstadt
 * (03241001) liegt auf einem eigenen Server und liefert bereits – geprüft am
 * 11.09.2026: `wahlergebnis.hannover.gov.de/Wahl-2026-09-13/03241001/daten/api/
 * termin.json` antwortet mit 200 und führt Oberbürgermeister-, Rats- und
 * dreizehn Stadtbezirksratswahlen.
 *
 * Eine Nachschau je Kreis findet das nie: Sie fragt die Kreisbehörde, und die
 * schweigt. Freigeschaltet wird aber je **Quelle**. Genau das steht hier – und
 * dazu, dass es die Sparsamkeit nicht aufgibt: Die übrigen zwanzig
 * Wahlleitungen der Region teilen sich den Server ihrer Kreisbehörde und
 * werden weiterhin nicht einzeln angefragt.
 */
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIXTURES, aufraeumen, tempVerzeichnis } from "./helfer.ts";
import {
	type MockVotemanager,
	starteMockVotemanager,
} from "./mock-votemanager.ts";

const KREIS = "region-hannover";
/** Die Kreisbehörde: kündigt den Termin an, liefert ihn nicht. */
const REGION = "03241000";
/** Die Landeshauptstadt: eigener Server, eigener Ordner, liefert. */
const STADT = "03241001";
/** Eine Wahlleitung ohne eigene Quelle – sie hängt an der Kreisbehörde. */
const GEMEINDE = "03241002";
/** Der Ordner, unter dem die Landeshauptstadt ihre Termine führt. */
const ORDNER = "Wahl-2026-09-13";

let mock: MockVotemanager;
let tmp: string;

const terminIndex = (
	wurzel: string,
	ags: string,
	termine: Array<{ date: string; name: string; ordner: string }>,
): void => {
	const ziel = join(wurzel, ags, "api");
	mkdirSync(ziel, { recursive: true });
	writeFileSync(
		join(ziel, "termine.json"),
		JSON.stringify({
			termine: termine.map((t) => ({
				date: t.date,
				name: t.name,
				url: `../${t.ordner}/${ags}/praesentation/`,
			})),
		}),
	);
};

/** Anfragen des Mocks, die einen bestimmten Gebietsschlüssel betreffen. */
const anfragenFuer = (ags: string): string[] =>
	mock.anfragen.filter((p) => p.includes(`/${ags}/`));

beforeAll(async () => {
	tmp = tempVerzeichnis("eigene-quelle-");
	const wurzel = join(tmp, "wurzel");
	cpSync(FIXTURES, wurzel, { recursive: true });

	// Die Landeshauptstadt liefert – unter ihrem eigenen Ordner, den nur ihr
	// Termin-Index kennt.
	cpSync(join(FIXTURES, "20260913/03254026"), join(wurzel, ORDNER, STADT), {
		recursive: true,
	});
	terminIndex(wurzel, STADT, [
		{ date: "13.09.2026", name: "Kommunalwahlen", ordner: ORDNER },
	]);

	// Die Region kündigt den Termin an, das Verzeichnis dazu gibt es nicht.
	terminIndex(wurzel, REGION, [
		{
			date: "13.09.2026",
			name: "Allgemeine Kommunalwahlen 2026",
			ordner: "20260913",
		},
	]);

	mock = await starteMockVotemanager(wurzel, 0, { listing: false });
	process.env.VOTEMANAGER_BASIS = mock.url;
	process.env.DATABASE_PATH = join(tmp, "wahlen.db");
});

afterAll(async () => {
	const { schliesseDb } = await import("../src/lib/db.ts");
	schliesseDb();
	await mock.schliessen();
	aufraeumen(tmp);
});

describe("Eine Wahlleitung mit eigener Quelle in einem stummen Kreis", () => {
	it("wird abgeholt, obwohl ihre Kreisbehörde schweigt", async () => {
		const { oeffneDb } = await import("../src/lib/db.ts");
		const { pollTermin, behoerdeLiefert, kreisLiefert, eigeneQuelle } =
			await import("../src/lib/poll.ts");
		const { terminById } = await import("../src/data/termine.ts");
		const { kreisBySlug } = await import("../src/data/kreise.ts");
		const { wahleintraege } = await import("../src/lib/abfragen.ts");
		const db = oeffneDb();
		const kreis = kreisBySlug(KREIS)!;
		const stadt = kreis.behoerden.find((b) => b.ags === STADT)!;
		const gemeinde = kreis.behoerden.find((b) => b.ags === GEMEINDE)!;

		expect(eigeneQuelle(stadt)).toBe(true);
		expect(eigeneQuelle(gemeinde)).toBe(false);
		expect(behoerdeLiefert(db, kreis, stadt)).toBe(false);

		const s = await pollTermin(db, terminById("2026")!, { nurKreise: [KREIS] });
		expect(s.fehler).toEqual([]);

		// Die Nachschau hat die eigene Quelle gefunden – und der Lauf hat die
		// Wahlleitung gleich abgefragt, statt sie zu vertrösten.
		expect(behoerdeLiefert(db, kreis, stadt)).toBe(true);
		expect(wahleintraege("2026", STADT).length).toBeGreaterThan(0);

		// Der Kreis gilt deshalb nicht als liefernd: Seine Präsentation fehlt
		// weiterhin, und die übrigen Wahlleitungen hängen daran.
		expect(kreisLiefert(db, kreis)).toBe(false);
		expect(behoerdeLiefert(db, kreis, gemeinde)).toBe(false);
		expect(wahleintraege("2026", REGION)).toEqual([]);
	}, 60_000);

	it("kostet eine Anfrage je Quelle, nicht je Behörde", () => {
		// Zwei Stellen werden nachgesehen: die Kreisbehörde für den Kreis und
		// die Landeshauptstadt für ihre eigene Quelle. Die übrigen zwanzig
		// Wahlleitungen der Region werden gar nicht erst gefragt.
		expect(anfragenFuer(REGION).length).toBeGreaterThan(0);
		expect(anfragenFuer(GEMEINDE)).toEqual([]);
		for (const ags of ["03241003", "03241009", "03241013"])
			expect(anfragenFuer(ags)).toEqual([]);
	});

	it("fragt die stumme Kreisbehörde nicht bei jedem Lauf erneut", async () => {
		const { oeffneDb } = await import("../src/lib/db.ts");
		const { pollTermin } = await import("../src/lib/poll.ts");
		const { terminById } = await import("../src/data/termine.ts");
		const db = oeffneDb();
		const vorher = anfragenFuer(REGION).length;

		const s = await pollTermin(db, terminById("2026")!, { nurKreise: [KREIS] });
		expect(s.fehler).toEqual([]);
		// Der Deckel steht: die Viertelstunde ist nicht um.
		expect(anfragenFuer(REGION).length).toBe(vorher);
		// Die Landeshauptstadt dagegen wird ab jetzt normal weitergeführt.
		expect(anfragenFuer(STADT).length).toBeGreaterThan(vorher);
	}, 60_000);

	it("führt die Wahlen der Landeshauptstadt mit ihren eigenen Namen", async () => {
		const { wahleintraege } = await import("../src/lib/abfragen.ts");
		const eintraege = wahleintraege("2026", STADT);
		// Die Fixtures tragen Nordstemmener Titel; geprüft wird, dass der Weg
		// von der eigenen Quelle bis in die Wahltabelle durchläuft.
		expect(eintraege.map((e) => e.typ)).toContain("rat");
		expect(eintraege.every((e) => e.slug.length > 0)).toBe(true);
	});
});
