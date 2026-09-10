/**
 * Die Generalprobe außerhalb des Standard-Kreises.
 *
 * **Worum es geht.** Die Probe soll in *jedem* Kreis laufen, nicht nur in dem,
 * für den es echte Fixtures gibt – am Wahlabend ruft jemand die Region
 * Hannover auf und muss dort einen laufenden Abend sehen. Zwei Dinge hingen
 * bis hierher stillschweigend am Landkreis Hildesheim:
 *
 *  – die Vorlage selbst, und
 *  – die Zuordnung der Kreiswahlbereiche zu Gemeinden. Sie las die Wahlräume
 *    der Gemeinden des **Standard**-Kreises. In der Region Hannover fand sie
 *    damit keine passende und ließ den Wahlbereich weg – nicht falsch, aber
 *    auch nicht das, was auf der Leinwand stehen soll.
 *
 * Geprüft wird gegen die Hildesheimer Fixtures, gespiegelt in die Region
 * Hannover (`demoKreisFixtures`). Die Namen in den Zahlen sind dann
 * Hildesheimer; worauf es ankommt – dass die Ämter gefunden werden, der Abend
 * schreibt und die Bereiche aus den Gemeinden **dieses** Kreises kommen –
 * lässt sich daran trotzdem prüfen.
 */
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { aufraeumen, demoKreisFixtures, tempVerzeichnis } from "./helfer.ts";
import {
	type MockVotemanager,
	starteMockVotemanager,
} from "./mock-votemanager.ts";

const KREIS = "region-hannover";
/** So viele Gemeinden der Region bekommen Zahlen – mehr kostet nur Laufzeit. */
const GEMEINDEN = 3;

let mock: MockVotemanager;
let tmp: string;

beforeAll(async () => {
	tmp = tempVerzeichnis("demo-kreise-");
	mock = await starteMockVotemanager(
		demoKreisFixtures(join(tmp, "votemanager"), [KREIS], GEMEINDEN),
	);
	process.env.VOTEMANAGER_BASIS = mock.url;
	process.env.DATABASE_PATH = join(tmp, "wahlen.db");
	const { oeffneDb } = await import("../src/lib/db.ts");
	const { pollTermin } = await import("../src/lib/poll.ts");
	const { terminById } = await import("../src/data/termine.ts");
	const { kreisBySlug } = await import("../src/data/kreise.ts");
	const kreis = kreisBySlug(KREIS)!;
	const ziele = [
		kreis.ags,
		...kreis.behoerden
			.filter((b) => b.art !== "kreis")
			.slice(0, GEMEINDEN)
			.map((b) => b.ags),
	];
	for (const id of ["2026", "2021", "2020"])
		await pollTermin(oeffneDb(), terminById(id)!, { nurBehoerden: ziele });
});

afterAll(async () => {
	const { schliesseDb } = await import("../src/lib/db.ts");
	schliesseDb();
	await mock.schliessen();
	aufraeumen(tmp);
});

const teile = async () => {
	const { oeffneDb } = await import("../src/lib/db.ts");
	const { kreisBySlug } = await import("../src/data/kreise.ts");
	const { terminById } = await import("../src/data/termine.ts");
	const kreis = kreisBySlug(KREIS)!;
	return {
		db: oeffneDb(),
		kreis,
		termin: terminById("2026")!,
		gemeinde: kreis.behoerden.filter((b) => b.art !== "kreis")[0],
		kreisBehoerde: kreis.behoerden.find((b) => b.ags === kreis.ags)!,
	};
};

describe("Ein anderer Kreis", () => {
	it("baut eine Vorlage und spielt einen Abend", async () => {
		const { baueVorlage, legeWahlenAn, raeumeDemoTermin, spieleStand } =
			await import("../src/lib/demo-abend.ts");
		const { zyklusVon } = await import("../src/lib/demo.ts");
		const { db, kreis, termin, gemeinde } = await teile();
		const wahlen = baueVorlage(db, kreis, termin, gemeinde);
		expect(wahlen.length).toBeGreaterThan(0);
		raeumeDemoTermin(db, termin, gemeinde, wahlen);
		legeWahlenAn(db, termin, gemeinde, wahlen);
		const beginn = Date.UTC(2026, 8, 13, 16, 0, 0);
		const geaendert = spieleStand(db, termin, gemeinde, wahlen, {
			...zyklusVon(beginn, 600, beginn),
			nummer: 5,
			fortschritt: 0.6,
		});
		expect(geaendert).toBeGreaterThan(0);
		// Und die Zahlen stehen wirklich unter diesem Kreis in der Datenbank.
		const { alleErgebnisse } = await import("../src/lib/abfragen.ts");
		const zeilen = alleErgebnisse(termin.id, gemeinde.ags, wahlen[0].wahlId);
		expect(zeilen.length).toBeGreaterThan(1);
		expect(zeilen.some((z) => !z.ergebnis.leer)).toBe(true);
	});

	it("sucht die Kreiswahlbereiche unter den Gemeinden dieses Kreises", async () => {
		// Der Kern des Fehlers: Ohne Angabe las die Zuordnung die Wahlräume der
		// Gemeinden des Standard-Kreises. In einem anderen Kreis kam damit
		// entweder nichts heraus oder – schlimmer – die Gemeinden von woanders.
		const { kreisWahlbereiche } = await import("../src/lib/wahlbereiche.ts");
		const { kreis } = await teile();
		const eigene = kreis.behoerden.filter((b) => b.art !== "kreis");
		const bereiche = kreisWahlbereiche("2021", eigene);
		const genannt = [...bereiche.values()].flat();
		expect(genannt.length).toBeGreaterThan(0);
		// Jeder genannte Name gehört zu diesem Kreis – kein Hildesheimer darunter.
		const eigeneNamen = new Set(eigene.map((b) => b.kurz));
		for (const name of genannt) expect(eigeneNamen.has(name)).toBe(true);
	});
});
