import { cpSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIXTURES_LUECHOW, aufraeumen, tempVerzeichnis } from "./helfer.ts";
import {
	type MockVotemanager,
	starteMockVotemanager,
} from "./mock-votemanager.ts";

const VOLLSTAENDIG = { kreis: "luechow-dannenberg", ags: "03354000" };
const TEILSUMME = { kreis: "harburg", ags: "03353000" };

const OHNE_EIGENE_WAHLLEITUNG = [
	"Gemeinde Rosengarten",
	"Samtgemeinde Hanstedt",
	"Samtgemeinde Hollenstedt",
	"Samtgemeinde Jesteburg",
	"Samtgemeinde Salzhausen",
	"Samtgemeinde Tostedt",
	"Stadt Buchholz in der Nordheide",
];

let mock: MockVotemanager;
let tmp: string;

const ersetzeUeberall = (verzeichnis: string): void => {
	for (const eintrag of readdirSync(verzeichnis, { withFileTypes: true })) {
		const pfad = join(verzeichnis, eintrag.name);
		if (eintrag.isDirectory()) {
			ersetzeUeberall(pfad);
			continue;
		}
		writeFileSync(
			pfad,
			readFileSync(pfad, "utf-8")
				.replaceAll("03354000", TEILSUMME.ags)
				.replaceAll("Landkreis Lüchow-Dannenberg", "Landkreis Harburg")
				.replaceAll("I - Nord", "1 - Winsen-Nord / Elbmarsch")
				.replaceAll("II -  Süd", "7 - Neu Wulmstorf"),
		);
	}
};

const wahlEintrag = async (ags: string) => {
	const { wahlBySlug } = await import("../src/lib/abfragen.ts");
	return wahlBySlug("2021", ags, "kreistag");
};

const apiErgebnis = async (kreisSlug: string, ags: string) => {
	const { apiWahl } = await import("../src/lib/api.ts");
	const { kreisBySlug } = await import("../src/data/kreise.ts");
	const behoerde = kreisBySlug(kreisSlug)?.behoerden.find((b) => b.ags === ags);
	if (!behoerde) throw new Error(`keine Behörde ${ags}`);
	return apiWahl("2021", behoerde, "kreistag")?.ergebnis;
};

const kern = async (kreisSlug: string, ags: string) => {
	const { wahlKern } = await import("../src/lib/wahlkern.ts");
	const { kreisBySlug } = await import("../src/data/kreise.ts");
	const { terminById } = await import("../src/data/termine.ts");
	const kreis = kreisBySlug(kreisSlug);
	const behoerde = kreis?.behoerden.find((b) => b.ags === ags);
	if (!kreis || !behoerde) throw new Error(`keine Behörde ${ags}`);
	return wahlKern(kreis, terminById("2021")!, behoerde, "kreistag");
};

beforeAll(async () => {
	tmp = tempVerzeichnis("kreis-teilsumme-");
	const wurzel = join(tmp, "wurzel");
	cpSync(FIXTURES_LUECHOW, wurzel, { recursive: true });
	cpSync(join(wurzel, VOLLSTAENDIG.ags), join(wurzel, TEILSUMME.ags), {
		recursive: true,
	});
	cpSync(
		join(wurzel, "20210912", VOLLSTAENDIG.ags),
		join(wurzel, "20210912", TEILSUMME.ags),
		{ recursive: true },
	);
	ersetzeUeberall(join(wurzel, TEILSUMME.ags));
	ersetzeUeberall(join(wurzel, "20210912", TEILSUMME.ags));

	mock = await starteMockVotemanager(wurzel, 0, { listing: false });
	process.env.VOTEMANAGER_BASIS = mock.url;
	process.env.DATABASE_PATH = join(tmp, "wahlen.db");
	process.env.POLL_ARCHIV_PRO_SEKUNDE = "500";
	process.env.POLL_ARCHIV_PARALLEL = "4";

	const { oeffneDb } = await import("../src/lib/db.ts");
	const { pollTermin } = await import("../src/lib/poll.ts");
	const { terminById } = await import("../src/data/termine.ts");
	const termin = terminById("2021")!;
	const db = oeffneDb();
	expect(
		(await pollTermin(db, termin, { nurKreise: [VOLLSTAENDIG.kreis] })).fehler,
	).toEqual([]);
	expect(
		(
			await pollTermin(db, termin, {
				nurKreise: [TEILSUMME.kreis],
				nurBehoerden: [TEILSUMME.ags],
			})
		).fehler,
	).toEqual([]);
});

afterAll(async () => {
	const { schliesseDb } = await import("../src/lib/db.ts");
	schliesseDb();
	await mock.schliessen();
	aufraeumen(tmp);
	delete process.env.POLL_ARCHIV_PRO_SEKUNDE;
	delete process.env.POLL_ARCHIV_PARALLEL;
});

describe("Kreissumme über alle Kommunen des Kreises", () => {
	it("bleibt vollständig, wenn jede Kommune im Kreisergebnis steckt", async () => {
		const erg = await apiErgebnis(VOLLSTAENDIG.kreis, VOLLSTAENDIG.ags);
		expect(erg?.stand.schnellmeldungen).toEqual({
			eingegangen: 86,
			erwartet: 86,
		});
		expect(erg?.stand.vollstaendig).toBe(true);
		expect(erg?.stand.teilgebiet).toBeNull();
		expect(
			(await kern(VOLLSTAENDIG.kreis, VOLLSTAENDIG.ags))?.datenstand.art,
		).toBe("endergebnis");
	});
});

describe("Kreissumme, die nur einen Teil der Kommunen umfasst", () => {
	it("führt trotzdem alle Schnellmeldungen der Quelle als eingegangen", async () => {
		const erg = await apiErgebnis(TEILSUMME.kreis, TEILSUMME.ags);
		expect(erg?.stand.schnellmeldungen).toEqual({
			eingegangen: 86,
			erwartet: 86,
		});
	});

	it("heißt nirgends vollständig und nennt die fehlenden Kommunen", async () => {
		const erg = await apiErgebnis(TEILSUMME.kreis, TEILSUMME.ags);
		expect(erg?.stand.vollstaendig).toBe(false);
		expect(erg?.stand.teilgebiet?.kommunen).toBe(12);
		expect(erg?.stand.teilgebiet?.fehlend).toEqual(OHNE_EIGENE_WAHLLEITUNG);
		expect(erg?.stand.teilgebiet?.quelle).toMatch(/^https?:\/\//);
	});

	it("heißt Teilergebnis statt Endergebnis, obwohl die Quelle Sitze verteilt", async () => {
		const k = await kern(TEILSUMME.kreis, TEILSUMME.ags);
		expect(await wahlEintrag(TEILSUMME.ags)).toBeTruthy();
		expect(k?.sitze?.quelle).toBe("amtlich");
		expect(k?.datenstand.art).toBe("teilgebiet");
		expect(k?.datenstand.titel).toBe("Teilergebnis");
		expect(k?.datenstand.text).toContain("Samtgemeinde Tostedt");
		expect(k?.datenstand.text).not.toMatch(/Alle \d+ Schnellmeldungen/);
	});

	it("behält die Sitze der Wahlleitung, rechnet aber selbst keine aus", async () => {
		const k = await kern(TEILSUMME.kreis, TEILSUMME.ags);
		expect(k?.sitze?.quelle).not.toBe("hochrechnung");
	});

	it("zählt eine Kommune mit, sobald ihr Kreiswahlbereich veröffentlicht ist", async () => {
		const { deckungslueckeAus } = await import("../src/lib/kreisdeckung.ts");
		const { kreisBySlug } = await import("../src/data/kreise.ts");
		const kreis = kreisBySlug(TEILSUMME.kreis)!;
		const ohne = deckungslueckeAus(kreis, new Set<string>(), {
			bereiche: new Set(["1"]),
			gemeinden: new Set<string>(),
		});
		expect(ohne?.fehlend).not.toContain("Stadt Winsen (Luhe)");
		expect(ohne?.fehlend).not.toContain("Samtgemeinde Elbmarsch");
		expect(ohne?.fehlend.length).toBe(10);
		const blind = deckungslueckeAus(kreis, new Set<string>(), {
			bereiche: new Set<string>(),
			gemeinden: new Set<string>(),
		});
		expect(blind).toBeUndefined();
	});

	it("zeigt die Lücke auch auf der Leinwand und meldet dort kein Fertig", async () => {
		const { ladeDashboard } = await import("../src/lib/dashboard.ts");
		const { wahleintraege } = await import("../src/lib/abfragen.ts");
		const { kreisBySlug } = await import("../src/data/kreise.ts");
		const { terminById } = await import("../src/data/termine.ts");
		const kreis = kreisBySlug(TEILSUMME.kreis)!;
		const behoerde = kreis.behoerden.find((b) => b.ags === TEILSUMME.ags)!;
		const m = ladeDashboard(
			kreis,
			terminById("2021")!,
			behoerde,
			wahleintraege("2021", TEILSUMME.ags),
			undefined,
		);
		const folie = m.folien.find((f) => f.art === "wahl");
		expect(folie?.art === "wahl" && folie.datenstand.art).toBe("teilgebiet");
		expect(folie?.art === "wahl" && folie.deckung?.fehlend.length).toBe(7);
		const ueberblick = m.folien.find((f) => f.art === "ueberblick");
		if (ueberblick?.art === "ueberblick")
			expect(ueberblick.zeilen.every((z) => !z.fertig)).toBe(true);
	});

	it("löst keine Ansage „fertig ausgezählt“ aus", async () => {
		const { vergleiche } = await import("../src/lib/meldungen.ts");
		const stand = (anz: number, art: string) => ({
			ort: "Landkreis Harburg",
			wahl: "Kreistagswahl",
			anz,
			max: 86,
			art,
			spitze: "CDU",
		});
		expect(
			vergleiche(
				new Map([["kreistag", stand(80, "teilgebiet")]]),
				new Map([["kreistag", stand(86, "teilgebiet")]]),
			).some((m) => m.art === "fertig"),
		).toBe(false);
		expect(
			vergleiche(
				new Map([["kreistag", stand(80, "zwischenstand")]]),
				new Map([["kreistag", stand(86, "endergebnis")]]),
			).some((m) => m.art === "fertig"),
		).toBe(true);
	});
});
