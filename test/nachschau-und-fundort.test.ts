/**
 * Die beiden Stellen, an denen der Poller nicht raten darf.
 *
 * **1. Wer liefert schon?** Sieben Kreise hatten den 13.09.2026 beim Abzug
 * nicht angelegt; die Region Hannover kündigt ihn in ihrem Termin-Index an und
 * liefert die Präsentation erkennbar erst kurz vor der Wahl (22 Behörden
 * einschließlich der Landeshauptstadt). Am Wahlabend soll niemand ausrollen
 * müssen, damit ein Kreis auftaucht: Der Poller sieht von Zeit zu Zeit nach
 * und führt ihn ab dem Augenblick normal weiter, in dem etwas kommt.
 *
 * **2. Wo liegt der Termin?** Der Ordner ist meist das Wahldatum, bei der
 * Landeshauptstadt Hannover aber `Wahl-2021-09-12`; und das Pfadschema gehört
 * zur Behörde, nicht zum Jahr – die Region Hannover hat ihre 2021er
 * Präsentation mit neuer Programmversion neu erzeugt und liefert sie als
 * einzige unter `daten/api/` aus. Beides steht so an den echten Servern und
 * wird hier gegen den Mock nachgestellt.
 */
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIXTURES, aufraeumen, tempVerzeichnis } from "./helfer.ts";
import {
	type MockVotemanager,
	starteMockVotemanager,
} from "./mock-votemanager.ts";

/** Der Kreis, der beim Abzug nichts hergab – 22 Behörden, Termin angekündigt. */
const SPAET = "region-hannover";
const REGION = "03241000";
const STADT = "03241001";
/** Der Ordner, unter dem die Landeshauptstadt ihre Termine führt. */
const ORDNER_2021 = "Wahl-2021-09-12";

let mock: MockVotemanager;
let tmp: string;
let wurzel: string;

/** Ein Termin-Index, wie ihn eine Behörde ausliefert. */
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

beforeAll(async () => {
	tmp = tempVerzeichnis("nachschau-");
	wurzel = join(tmp, "wurzel");
	cpSync(FIXTURES, wurzel, { recursive: true });

	// Die Region hat den 13.09.2026 jetzt freigeschaltet – für sie selbst und
	// für die Landeshauptstadt.
	for (const ags of [REGION, STADT])
		cpSync(
			join(FIXTURES, "20260913/03254000"),
			join(wurzel, `20260913/${ags}`),
			{
				recursive: true,
			},
		);

	// Die Kommunalwahl 2021 der Region liegt in einem Ordner, der nicht nach
	// dem Wahltag heißt, und im neuen Pfadschema (daten/api statt
	// api/praesentation). Beides steht so bei den echten Servern.
	cpSync(
		join(FIXTURES, "20210912/03254000/api/praesentation"),
		join(wurzel, `${ORDNER_2021}/${REGION}/daten/api`),
		{ recursive: true },
	);
	terminIndex(wurzel, REGION, [
		{
			date: "13.09.2026",
			name: "Allgemeine Kommunalwahlen 2026",
			ordner: "20260913",
		},
		{
			date: "12.09.2021",
			name: "Allgemeine Kommunalwahlen 2021",
			ordner: ORDNER_2021,
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

describe("Ein Kreis, der erst kurz vor der Wahl freischaltet", () => {
	it("wird bemerkt und im selben Lauf mitgenommen – ohne Neustart", async () => {
		const { oeffneDb } = await import("../src/lib/db.ts");
		const { pollTermin, kreisLiefert } = await import("../src/lib/poll.ts");
		const { terminById } = await import("../src/data/termine.ts");
		const { kreisBySlug } = await import("../src/data/kreise.ts");
		const { wahleintraege } = await import("../src/lib/abfragen.ts");
		const db = oeffneDb();
		const kreis = kreisBySlug(SPAET)!;

		// Ausgangsannahme aus dem Katalog: liegt nicht vor.
		expect(kreis.vorhanden).toBe(false);
		expect(kreisLiefert(db, kreis)).toBe(false);

		const s = await pollTermin(db, terminById("2026")!, { nurKreise: [SPAET] });
		expect(s.fehler).toEqual([]);
		// Die Nachschau hat die Präsentation gefunden – und der Lauf hat die
		// Behörden gleich abgefragt, statt sie auf den nächsten zu vertrösten.
		expect(kreisLiefert(db, kreis)).toBe(true);
		expect(wahleintraege("2026", REGION).length).toBeGreaterThan(0);
		expect(wahleintraege("2026", STADT).length).toBeGreaterThan(0);
	}, 60_000);

	it("bleibt vorhanden, wenn der Server danach schweigt", async () => {
		const { oeffneDb } = await import("../src/lib/db.ts");
		const { kreisLiefert } = await import("../src/lib/poll.ts");
		const { kreisBySlug } = await import("../src/data/kreise.ts");
		const { kreisVorhanden } = await import("../src/lib/abfragen.ts");
		const db = oeffneDb();
		const kreis = kreisBySlug(SPAET)!;
		// Ein Aussetzer ist kein „liegt nicht vor“: Die Marke bleibt, und die
		// Anzeige richtet sich ohnehin nach dem Bestand.
		expect(kreisLiefert(db, kreis)).toBe(true);
		expect(kreisVorhanden(kreis)).toBe(true);
	});

	it("lässt einen Kreis ohne Präsentation in Ruhe und ohne Fehler", async () => {
		const { oeffneDb } = await import("../src/lib/db.ts");
		const { pollTermin, kreisLiefert } = await import("../src/lib/poll.ts");
		const { terminById } = await import("../src/data/termine.ts");
		const { kreisBySlug } = await import("../src/data/kreise.ts");
		const db = oeffneDb();
		// Der Heidekreis hat hier keine Fixtures – die Nachschau findet nichts.
		const s = await pollTermin(db, terminById("2026")!, {
			nurKreise: ["heidekreis"],
		});
		expect(s.fehler).toEqual([]);
		expect(kreisLiefert(db, kreisBySlug("heidekreis")!)).toBe(false);
		// Und sie kostet eine Anfrage, nicht dreizehn Behörden voll.
		expect(s.anfragen).toBeLessThanOrEqual(2);
	}, 60_000);

	it("fragt einen stummen Kreis nicht bei jedem Lauf erneut", async () => {
		const { oeffneDb } = await import("../src/lib/db.ts");
		const { pollTermin } = await import("../src/lib/poll.ts");
		const { terminById } = await import("../src/data/termine.ts");
		const db = oeffneDb();
		const s = await pollTermin(db, terminById("2026")!, {
			nurKreise: ["heidekreis"],
		});
		expect(s.anfragen).toBe(0);
	}, 60_000);
});

describe("Ein Termin, der nicht dort liegt, wo er liegen müsste", () => {
	it("wird über den Termin-Index gefunden – fremder Ordner, fremdes Schema", async () => {
		const { oeffneDb } = await import("../src/lib/db.ts");
		const { pollTermin } = await import("../src/lib/poll.ts");
		const { terminById } = await import("../src/data/termine.ts");
		const { metaGet } = await import("../src/lib/db.ts");
		const { wahleintraege } = await import("../src/lib/abfragen.ts");
		const db = oeffneDb();

		const s = await pollTermin(db, terminById("2021")!, {
			nurKreise: [SPAET],
			nurBehoerden: [REGION],
		});
		expect(s.fehler).toEqual([]);
		expect(wahleintraege("2021", REGION).length).toBeGreaterThan(0);

		// Aus dem Index kam der Ordner, aus dem Fehlversuch das Schema.
		const gemerkt = JSON.parse(metaGet(db, `fundort:2021:${REGION}`) ?? "{}");
		expect(gemerkt.ordner).toBe(ORDNER_2021);
		expect(gemerkt.layout).toBe("v26");
	}, 60_000);

	it("nimmt die Vorgabe des Termins, wenn es keinen Index gibt", async () => {
		const { oeffneDb } = await import("../src/lib/db.ts");
		const { pollTermin } = await import("../src/lib/poll.ts");
		const { terminById } = await import("../src/data/termine.ts");
		const { metaGet } = await import("../src/lib/db.ts");
		const { wahleintraege } = await import("../src/lib/abfragen.ts");
		const db = oeffneDb();

		// Hildesheim hat in diesen Fixtures keinen Termin-Index. Der Termin
		// liegt dort, wo der Katalog es sagt – und genau das muss reichen.
		const s = await pollTermin(db, terminById("2021")!, {
			nurKreise: ["hildesheim"],
			nurBehoerden: ["03254026"],
		});
		expect(s.fehler).toEqual([]);
		expect(wahleintraege("2021", "03254026").length).toBeGreaterThan(0);
		const gemerkt = JSON.parse(metaGet(db, "fundort:2021:03254026") ?? "{}");
		expect(gemerkt.ordner).toBe("20210912");
		expect(gemerkt.layout).toBe("v22");
		expect(gemerkt.imIndex).toBe(false);
	}, 60_000);
});

describe("Ein Archivtermin, der plötzlich für mehr Kreise gilt", () => {
	it("gilt nicht als vollständig, solange Behörden fehlen", async () => {
		const { oeffneDb, metaSet } = await import("../src/lib/db.ts");
		const { terminVollstaendig, behoerdenFuer } = await import(
			"../src/lib/poll.ts"
		);
		const { terminById } = await import("../src/data/termine.ts");
		const db = oeffneDb();
		const termin = terminById("2021")!;

		// So sieht ein Volume aus, das den alten Bestand trägt: Die Marke steht,
		// aber sie stammt aus einer Zeit, in der 2021 nur für Hildesheim galt.
		// Ohne den Vergleich blieben die 40 neuen Kreise für immer leer.
		metaSet(db, "termin:2021:vollstaendig", new Date().toISOString());
		metaSet(db, "termin:2021:behoerden", "19");
		expect(terminVollstaendig(db, termin)).toBe(false);

		// Erst wenn die Marke alle heutigen Behörden abdeckt, ist Ruhe.
		metaSet(
			db,
			"termin:2021:behoerden",
			String(behoerdenFuer(db, termin).length),
		);
		expect(terminVollstaendig(db, termin)).toBe(true);
		// Ohne Marke gibt es nichts zu überspringen.
		expect(terminVollstaendig(db, terminById("2020")!)).toBe(false);
	});
});
