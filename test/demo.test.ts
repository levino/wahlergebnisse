import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIXTURES, aufraeumen, tempVerzeichnis } from "./helfer.ts";
import {
	type MockVotemanager,
	starteMockVotemanager,
} from "./mock-votemanager.ts";

/**
 * Die Probe lebt vom Schalter: Erst mit ihm ist 2021 der laufende Termin –
 * mit Ticker, Auszählstand und Live-Kennzeichnung. Er muss stehen, bevor
 * `termine.ts` zum ersten Mal geladen wird; deshalb keine statische Einfuhr
 * von dort in dieser Datei.
 */
process.env.WAHLEN_DEMO = "1";

let mock: MockVotemanager;
let tmp: string;

const DEMO = "03254026";
const KREIS = "03254000";
/** Der Abend, den die Probe nachspielt. */
const PROBE = "2021";

const teile = async () => {
	const { oeffneDb } = await import("../src/lib/db.ts");
	const { kreisBySlug } = await import("../src/data/kreise.ts");
	const { terminById } = await import("../src/data/termine.ts");
	const kreis = kreisBySlug("hildesheim")!;
	return {
		db: oeffneDb(),
		kreis,
		termin: terminById(PROBE)!,
		behoerde: kreis.behoerden.find((b) => b.ags === DEMO)!,
		kreisBehoerde: kreis.behoerden.find((b) => b.ags === KREIS)!,
	};
};

const spiele = async (fortschritt: number, zyklusNummer = 7) => {
	const { baueVorlage, spieleStand } = await import("../src/lib/demo-abend.ts");
	const { zyklusVon } = await import("../src/lib/demo.ts");
	const { db, kreis, termin, behoerde } = await teile();
	const wahlen = baueVorlage(db, kreis, termin, behoerde);
	const beginn = Date.UTC(2021, 8, 12, 16, 0, 0);
	const geaendert = spieleStand(db, termin, behoerde, wahlen, {
		...zyklusVon(beginn, 600, beginn),
		nummer: zyklusNummer,
		fortschritt,
	});
	return { kreis, termin, behoerde, wahlen, geaendert };
};

/** Auszählstand einer Wahl am Probentermin, in Schnellmeldungen. */
const standVon = async (
	behoerdeAgs: string,
	wahlId: number,
	gebietId: string,
) => {
	const { oeffneDb } = await import("../src/lib/db.ts");
	return oeffneDb()
		.prepare(
			"SELECT stand_anz, stand_max FROM ergebnisse WHERE termin = ? AND behoerde = ? AND wahl_id = ? AND gebiet_id = ?",
		)
		.get(PROBE, behoerdeAgs, wahlId, gebietId) as
		| { stand_anz: number | null; stand_max: number | null }
		| undefined;
};

beforeAll(async () => {
	tmp = tempVerzeichnis("demo-");
	mock = await starteMockVotemanager(FIXTURES);
	process.env.VOTEMANAGER_BASIS = mock.url;
	process.env.DATABASE_PATH = join(tmp, "wahlen.db");
	const { oeffneDb } = await import("../src/lib/db.ts");
	const { pollTermin } = await import("../src/lib/poll.ts");
	const { terminById } = await import("../src/data/termine.ts");
	const db = oeffneDb();
	await pollTermin(db, terminById(PROBE)!, { nurBehoerden: [DEMO, KREIS] });
	legeFremdenTerminAn(db);
	const { bereiteProbeVor } = await import("../src/lib/demo-abend.ts");
	bereiteProbeVor(db, terminById(PROBE)!);
});

/**
 * Ein Termin, den die Probe nicht spielt – von Hand gesetzt.
 *
 * Unter dem Schalter kennt die Anwendung 2026 gar nicht mehr; die Zeilen
 * kommen deshalb nicht aus dem Poller, sondern direkt in die Tabellen. Wer
 * sie später unverändert vorfindet, weiß: Die Probe hat sie nicht angefasst.
 */
const legeFremdenTerminAn = (db: import("../src/lib/db.ts").Db): void => {
	db.prepare(
		"INSERT OR REPLACE INTO wahleintraege (termin, behoerde, wahl_id, gebiet_id, titel, gebiet_titel, gebiet, typ, slug, reihenfolge) VALUES ('2026', ?, 52, 'ebene_3_id_14', 'Gemeindewahl 2026', 'Gemeinde Nordstemmen', '', 'rat', 'rat', 0)",
	).run(DEMO);
	db.prepare(
		"INSERT OR REPLACE INTO ergebnisse (termin, behoerde, wahl_id, gebiet_id, ebene, titel, leer, stand_anz, stand_max, json, hash, aktualisiert) VALUES ('2026', ?, 52, 'ebene_3_id_14', 3, 'Nordstemmen', 1, 0, 23, '{}', 'x', '2026-09-13T16:00:00.000Z')",
	).run(DEMO);
};

afterAll(async () => {
	const { schliesseDb } = await import("../src/lib/db.ts");
	schliesseDb();
	await mock.schliessen();
	aufraeumen(tmp);
});

describe("Vorlage", () => {
	it("nimmt die Ämter des Abends, den sie nachspielt", async () => {
		const { wahlen } = await spiele(0);
		const typen = wahlen.map((w) => w.typ);
		expect(typen).toContain("rat");
		expect(typen).toContain("ortsrat");
		expect(typen).toContain("kreistag");
		expect(typen).toContain("landrat");
		const aemter = wahlen.map((w) => `${w.typ}|${w.gebietTitel}`);
		expect(new Set(aemter).size).toBe(aemter.length);
		expect(typen.filter((t) => t === "ortsrat").length).toBeGreaterThan(1);
	});

	it("lässt die Stichwahl aus: an diesem Abend stand sie noch aus", async () => {
		const { db, termin, behoerde } = await teile();
		const { wahlen } = await spiele(1);
		expect(wahlen.map((w) => w.typ)).not.toContain("landrat-stichwahl");
		const stich = db
			.prepare(
				"SELECT wahl_id FROM wahleintraege WHERE termin = ? AND behoerde = ? AND typ LIKE '%-stichwahl'",
			)
			.all(termin.id, behoerde.ags) as Array<{ wahl_id: number }>;
		expect(stich.length).toBeGreaterThan(0);
		for (const s of stich)
			expect(
				db
					.prepare(
						"SELECT COUNT(*) AS n FROM ergebnisse WHERE termin = ? AND behoerde = ? AND wahl_id = ?",
					)
					.get(termin.id, behoerde.ags, s.wahl_id),
			).toEqual({ n: 0 });
	});

	it("kennt zu jeder Wahl ihre Wahllokale", async () => {
		const { wahlen } = await spiele(0);
		for (const w of wahlen) expect(w.lokale.length).toBeGreaterThan(0);
	});

	it("gibt jedem Ortsrat die Wahlbezirke seiner Ortschaft und keine fremden", async () => {
		const { wahlen } = await spiele(0);
		const ortsraete = new Map(
			wahlen
				.filter((w) => w.typ === "ortsrat")
				.map((w) => [w.gebietTitel.trim(), w]),
		);
		expect(ortsraete.size).toBe(9);
		expect(ortsraete.get("Rössing")?.lokale.length).toBe(3);
		expect(ortsraete.get("Mahlerten")?.lokale.length).toBe(1);
		expect(ortsraete.get("Nordstemmen")?.lokale.length).toBe(6);
		for (const w of ortsraete.values()) {
			const gesamt = w.zeilen.find((z) => z.gebietId === w.gebietId);
			expect(gesamt?.meldungen).toBe(w.lokale.length);
			expect(gesamt?.lokale.length).toBe(w.lokale.length);
		}
		const rat = wahlen.find((w) => w.typ === "rat");
		expect(rat?.lokale.length).toBe(23);
		const summe = [...ortsraete.values()].reduce(
			(n, w) => n + w.lokale.length,
			0,
		);
		expect(summe).toBe(22);
	});
});

describe("Ein Durchlauf", () => {
	it("beginnt mit einer leeren Aufstellung", async () => {
		const { kreis, termin, behoerde } = await spiele(0);
		const { ladeDashboard, kreisebeneFuer } = await import(
			"../src/lib/dashboard.ts"
		);
		const { wahleintraege } = await import("../src/lib/abfragen.ts");
		const kreisBehoerde = kreis.behoerden.find((b) => b.ags === kreis.ags)!;
		const m = ladeDashboard(
			kreis,
			termin,
			behoerde,
			wahleintraege(termin.id, behoerde.ags),
			kreisebeneFuer(termin, kreisBehoerde, behoerde),
		);
		expect(m.folien.length).toBeGreaterThan(5);
		const wahlFolien = m.folien.filter((f) => f.art === "wahl");
		expect(wahlFolien.every((f) => f.art === "wahl" && f.anz === 0)).toBe(true);
	});

	it("zählt unterwegs hoch und rechnet hoch", async () => {
		const { kreis, termin, behoerde } = await spiele(0.4);
		const { wahlKern } = await import("../src/lib/seite.ts");
		const { wahleintraege } = await import("../src/lib/abfragen.ts");
		const rat = wahleintraege(termin.id, behoerde.ags).find(
			(w) => w.typ === "rat",
		)!;
		const m = wahlKern(kreis, termin, behoerde, rat.slug)!;
		expect(m.aktuell?.standAnz).toBeGreaterThan(0);
		expect(m.aktuell!.standAnz!).toBeLessThan(m.aktuell!.standMax!);
		expect(m.datenstand.art).not.toBe("endergebnis");
		expect(m.balken.length).toBeGreaterThan(0);
	});

	it("endet vollständig ausgezählt", async () => {
		const { kreis, termin, behoerde } = await spiele(1);
		const { wahlKern } = await import("../src/lib/seite.ts");
		const { wahleintraege } = await import("../src/lib/abfragen.ts");
		const rat = wahleintraege(termin.id, behoerde.ags).find(
			(w) => w.typ === "rat",
		)!;
		const m = wahlKern(kreis, termin, behoerde, rat.slug)!;
		expect(m.aktuell?.standAnz).toBe(m.aktuell?.standMax);
		expect(m.datenstand.art).toBe("endergebnis");
	});

	it("füllt den Ticker, während die Bezirke eingehen", async () => {
		const { oeffneDb } = await import("../src/lib/db.ts");
		const zaehle = () =>
			(
				oeffneDb()
					.prepare("SELECT COUNT(*) AS n FROM ereignisse WHERE termin = ?")
					.get(PROBE) as { n: number }
			).n;
		await spiele(0.2, 11);
		const vorher = zaehle();
		await spiele(0.6, 11);
		expect(zaehle()).toBeGreaterThan(vorher);
	});

	it("weicht von den amtlichen Zahlen ab, damit sich etwas bewegt", async () => {
		const { db, termin, behoerde } = await teile();
		const { wahlen } = await spiele(1, 3);
		const { alleErgebnisse } = await import("../src/lib/abfragen.ts");
		const rat = wahlen.find((w) => w.typ === "rat")!;
		const gespielt = alleErgebnisse(termin.id, behoerde.ags, rat.wahlId).find(
			(z) => z.gebietId === rat.gebietId,
		)!;
		const amtlich = JSON.parse(
			(
				db
					.prepare(
						"SELECT json FROM demo_quelle WHERE termin = ? AND behoerde = ? AND wahl_id = ? AND gebiet_id = ?",
					)
					.get(termin.id, behoerde.ags, rat.wahlId, rat.gebietId) as {
					json: string;
				}
			).json,
		) as { parteien: Array<{ key: string; stimmen: number }> };
		const echt = new Map(amtlich.parteien.map((p) => [p.key, p.stimmen]));
		const abweichung = gespielt.ergebnis.parteien.filter(
			(p) => p.stimmen !== echt.get(p.key),
		);
		expect(abweichung.length).toBeGreaterThan(0);
	});
});

describe("Die Meldungen tröpfeln", () => {
	it("lässt die Wahlen einer Wahlleitung nicht im Gleichschritt vorrücken", async () => {
		const { behoerde, wahlen } = await spiele(0.5, 21);
		const jeGroesse = new Map<number, Set<number>>();
		for (const w of wahlen) {
			const s = await standVon(behoerde.ags, w.wahlId, w.gebietId);
			if (s?.stand_anz == null) continue;
			const menge = jeGroesse.get(w.lokale.length) ?? new Set<number>();
			menge.add(s.stand_anz);
			jeGroesse.set(w.lokale.length, menge);
		}
		expect(jeGroesse.size).toBeGreaterThan(0);
		expect([...jeGroesse.values()].some((m) => m.size > 1)).toBe(true);
	});

	it("kommt in Klumpen und Lücken herein, nicht gleichmäßig", async () => {
		const { behoerde, wahlen } = await spiele(0, 23);
		const rat = wahlen.find((w) => /Gemeindewahl/.test(w.titel));
		if (!rat) throw new Error("Gemeindewahl fehlt in der Vorlage");
		const staende: number[] = [];
		for (const f of [0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1]) {
			await spiele(f, 23);
			const s = await standVon(behoerde.ags, rat.wahlId, rat.gebietId);
			staende.push(s?.stand_anz ?? 0);
		}
		const schritte = staende.map((n, i) => n - (i === 0 ? 0 : staende[i - 1]));
		expect(staende[staende.length - 1]).toBe(rat.lokale.length);
		expect(new Set(schritte).size).toBeGreaterThan(2);
		expect(Math.max(...schritte)).toBeGreaterThan(
			rat.lokale.length / schritte.length,
		);
	});

	it("spielt jeden Durchlauf gleich", async () => {
		const { alleErgebnisse } = await import("../src/lib/abfragen.ts");
		const abzug = (behoerdeAgs: string, wahlId: number) =>
			alleErgebnisse(PROBE, behoerdeAgs, wahlId)
				.map((z) => ({
					gebietId: z.gebietId,
					anz: z.ergebnis.stand.anz,
					max: z.ergebnis.stand.max,
					stimmen: z.ergebnis.parteien.map((p) => p.stimmen),
				}))
				.sort((x, y) => x.gebietId.localeCompare(y.gebietId));

		const erst = await spiele(0.45, 3);
		const rat = erst.wahlen.find((w) => /Gemeindewahl/.test(w.titel))!;
		const vorher = abzug(erst.behoerde.ags, rat.wahlId);
		await spiele(0.45, 91);
		expect(abzug(erst.behoerde.ags, rat.wahlId)).toEqual(vorher);
	});

	it("bleibt zustandslos: derselbe Augenblick, derselbe Stand", async () => {
		const { baueVorlage, spieleStand } = await import(
			"../src/lib/demo-abend.ts"
		);
		const { zyklusVon } = await import("../src/lib/demo.ts");
		const { db, kreis, termin, behoerde } = await teile();
		const wahlen = baueVorlage(db, kreis, termin, behoerde);
		const nullpunkt = Date.now() - 31 * 600_000 - 300_000;
		const zyklus = {
			...zyklusVon(Date.now(), 600, nullpunkt),
			fortschritt: 0.55,
		};
		expect(zyklus.nummer).toBe(31);
		expect(spieleStand(db, termin, behoerde, wahlen, zyklus)).toBeGreaterThan(
			0,
		);
		expect(spieleStand(db, termin, behoerde, wahlen, zyklus)).toBe(0);
		const frisch = baueVorlage(db, kreis, termin, behoerde);
		expect(spieleStand(db, termin, behoerde, frisch, zyklus)).toBe(0);
		const naechster = {
			...zyklus,
			nummer: zyklus.nummer + 1,
			beginn: zyklus.beginn + zyklus.dauer,
		};
		expect(
			spieleStand(db, termin, behoerde, wahlen, naechster),
		).toBeGreaterThan(0);
	});
});

describe("Kreisebene in der Generalprobe", () => {
	it("hält den Wahlbereich auf seinen eigenen Gemeinden", async () => {
		const { baueVorlage } = await import("../src/lib/demo-abend.ts");
		const { db, kreis, termin, kreisBehoerde } = await teile();
		const wahlen = baueVorlage(db, kreis, termin, kreisBehoerde);
		const kreistag = wahlen.find((w) => w.typ === "kreistag");
		if (!kreistag)
			throw new Error(
				`Kreistagswahl fehlt in der Vorlage (gefunden: ${wahlen.map((w) => w.titel).join(", ") || "nichts"})`,
			);

		const bereich = kreistag.zeilen.find((z) => /^B$/.test(z.titel.trim()));
		if (!bereich) throw new Error("Wahlbereich B fehlt in der Vorlage");
		expect(bereich.lokale.length).toBeGreaterThan(0);
		expect(bereich.lokale.length).toBeLessThan(kreistag.lokale.length);
	});

	it("zeigt dieselbe Gemeinde beim Kreis und bei ihr selbst gleich", async () => {
		const { alleErgebnisse } = await import("../src/lib/abfragen.ts");
		const { baueVorlage, spieleStand } = await import(
			"../src/lib/demo-abend.ts"
		);
		const { zyklusVon } = await import("../src/lib/demo.ts");
		const { db, kreis, termin } = await teile();
		const beide = [KREIS, DEMO].map((ags) => {
			const behoerde = kreis.behoerden.find((b) => b.ags === ags)!;
			const wahlen = baueVorlage(db, kreis, termin, behoerde);
			const kreistag = wahlen.find((w) => w.typ === "kreistag")!;
			return { behoerde, wahlen, kreistag };
		});
		const beginn = Date.UTC(2021, 8, 12, 16, 0, 0);
		const abzug = (ags: string, wahlId: number) => {
			const z = alleErgebnisse(termin.id, ags, wahlId).find(
				(r) => r.gebietId === "ebene_3_id_14",
			);
			return {
				anz: z?.ergebnis.stand.anz,
				max: z?.ergebnis.stand.max,
				stimmen: Object.fromEntries(
					(z?.ergebnis.parteien ?? []).map((p) => [p.key, p.stimmen]),
				),
			};
		};
		const staende: Array<number | undefined> = [];
		for (const fortschritt of [0.2, 0.45, 0.7, 1]) {
			const zyklus = {
				...zyklusVon(beginn, 600, beginn),
				nummer: 13,
				fortschritt,
			};
			for (const { behoerde, wahlen } of beide)
				spieleStand(db, termin, behoerde, wahlen, zyklus);
			const [ausKreis, ausGemeinde] = beide.map((b) =>
				abzug(b.behoerde.ags, b.kreistag.wahlId),
			);
			expect(ausKreis.max).toBe(23);
			expect(ausGemeinde).toEqual(ausKreis);
			staende.push(ausKreis.anz);
		}
		expect(staende.some((n) => n !== undefined && n > 0 && n < 23)).toBe(true);
		expect(staende[staende.length - 1]).toBe(23);
	});

	it("lässt den Kreistag in Wahllokalen vorrücken, nicht in Gemeinden", async () => {
		const { baueVorlage, spieleStand } = await import(
			"../src/lib/demo-abend.ts"
		);
		const { zyklusVon } = await import("../src/lib/demo.ts");
		const { db, kreis, termin, kreisBehoerde } = await teile();
		const wahlen = baueVorlage(db, kreis, termin, kreisBehoerde);
		const kreistag = wahlen.find((w) => w.typ === "kreistag")!;
		expect(kreistag.lokale.length).toBe(23 + 17);
		expect(
			kreistag.zeilen.find((z) => z.gebietId === kreistag.gebietId)?.meldungen,
		).toBe(426);
		const beginn = Date.UTC(2021, 8, 12, 16, 0, 0);
		const kreisweit = new Set<number>();
		const nordstemmen = new Set<number>();
		for (let i = 0; i <= 40; i++) {
			spieleStand(db, termin, kreisBehoerde, wahlen, {
				...zyklusVon(beginn, 600, beginn),
				nummer: 17,
				fortschritt: i / 40,
			});
			kreisweit.add(
				(await standVon(KREIS, kreistag.wahlId, kreistag.gebietId))
					?.stand_anz ?? 0,
			);
			nordstemmen.add(
				(await standVon(KREIS, kreistag.wahlId, "ebene_3_id_14"))?.stand_anz ??
					0,
			);
		}
		expect(nordstemmen.size).toBeGreaterThan(10);
		expect(kreisweit.size).toBeGreaterThan(19);
	});

	it("zählt Schnellmeldungen und nicht Gebietszeilen", async () => {
		const { alleErgebnisse } = await import("../src/lib/abfragen.ts");
		const { baueVorlage, spieleStand } = await import(
			"../src/lib/demo-abend.ts"
		);
		const { zyklusVon } = await import("../src/lib/demo.ts");
		const { db, kreis, termin, kreisBehoerde } = await teile();
		const wahlen = baueVorlage(db, kreis, termin, kreisBehoerde);
		const beginn = Date.UTC(2021, 8, 12, 16, 0, 0);
		spieleStand(db, termin, kreisBehoerde, wahlen, {
			...zyklusVon(beginn, 600, beginn),
			nummer: 3,
			fortschritt: 1,
		});

		const kreistag = wahlen.find((w) => w.typ === "kreistag")!;
		const zeilen = alleErgebnisse(termin.id, KREIS, kreistag.wahlId);
		const gesamt = zeilen.find((z) => z.gebietId === kreistag.gebietId);
		const bereich = zeilen.find((z) => /^B$/.test(z.titel.trim()));
		expect(gesamt?.ergebnis.stand.max ?? 0).toBeGreaterThan(100);
		expect(bereich?.ergebnis.stand.max ?? 0).toBeGreaterThan(20);
		expect(bereich?.ergebnis.stand.max ?? 0).toBeLessThan(
			gesamt?.ergebnis.stand.max ?? 0,
		);
		expect(gesamt?.ergebnis.stand.anz).toBe(gesamt?.ergebnis.stand.max);
	});
});

describe("Der Termin, der nicht gespielt wird", () => {
	it("bleibt unberührt: nichts angelegt, nichts geschrieben, nichts geleert", async () => {
		const { db, kreis, termin } = await teile();
		const { baueVorlage, spieleStand } = await import(
			"../src/lib/demo-abend.ts"
		);
		const { zyklusVon } = await import("../src/lib/demo.ts");
		const abzug = () =>
			db
				.prepare(
					`SELECT 'e' AS art, wahl_id, gebiet_id, leer, stand_anz, json FROM ergebnisse WHERE termin = '2026'
					 UNION ALL
					 SELECT 'w', wahl_id, gebiet_id, 0, 0, titel FROM wahleintraege WHERE termin = '2026'
					 ORDER BY art, wahl_id, gebiet_id`,
				)
				.all();
		const vorher = abzug();
		expect(vorher.length).toBe(2);

		const beginn = Date.UTC(2021, 8, 12, 16, 0, 0);
		for (const behoerde of kreis.behoerden) {
			const wahlen = baueVorlage(db, kreis, termin, behoerde);
			for (const fortschritt of [0, 0.5, 1])
				spieleStand(db, termin, behoerde, wahlen, {
					...zyklusVon(beginn, 600, beginn),
					nummer: 55,
					fortschritt,
				});
		}

		expect(abzug()).toEqual(vorher);
		expect(
			db
				.prepare("SELECT COUNT(*) AS n FROM ereignisse WHERE termin = '2026'")
				.get(),
		).toEqual({ n: 0 });
		expect(
			db
				.prepare("SELECT COUNT(*) AS n FROM wahlen WHERE termin = '2026'")
				.get(),
		).toEqual({ n: 0 });
	});
});
