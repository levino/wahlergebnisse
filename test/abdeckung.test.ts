import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	TERMINE_MIT_GLIEDERUNG,
	gliederungFuer,
	kreisgliederung,
	wahlleitungByAgs,
} from "../src/data/wahlgliederungen.ts";
import type {
	Beleg,
	Wahlgliederung,
	Wahlleitung,
} from "../src/data/wahlgliederung.ts";
import {
	LEERER_BESTAND,
	type Bestand,
	type Befund,
	type Katalogkreis,
	type Messung,
	belege,
	bericht,
	bestandAus,
	kreistagszahlenAus,
	pruefeAbdeckung,
	pruefeKatalogGegenVerzeichnis,
	pruefeKreisvollstaendigkeit,
} from "../src/lib/abdeckung.ts";
import { kreisBySlug } from "../src/data/kreise.ts";
import { aufraeumen, tempVerzeichnis } from "./helfer.ts";

const beleg = (herkunft: Beleg["herkunft"], grund?: string): Beleg => ({
	herkunft,
	quelle: "https://beispiel.invalid/termin.json",
	...(herkunft === "wahlleitung" ? { terminBeleg: "2026" } : {}),
	erhoben: "2026-09-12T00:00:00.000Z",
	...(grund ? { grund } : {}),
});

const wahlleitung = (
	teil: Partial<Wahlleitung> & Pick<Wahlleitung, "beleg">,
): Wahlleitung => ({
	ags: "03254026",
	slug: "nordstemmen",
	name: "Gemeinde Nordstemmen",
	art: "gemeinde",
	aemter: {},
	ortschaften: { stand: "unbekannt", eintraege: [], beleg: teil.beleg },
	wahlbezirke: { stand: "unbekannt", eintraege: [], beleg: teil.beleg },
	...teil,
});

const gliederung = (
	termin: string,
	w: Wahlleitung[],
	quelle = beleg("keine"),
): Wahlgliederung => ({
	termin,
	erzeugt: "2026-09-12T00:00:00.000Z",
	erhebung: "Probe",
	kreise: [
		{
			slug: "hildesheim",
			ags: "03254000",
			name: "Landkreis Hildesheim",
			art: "landkreis",
			kreiswahlbereiche: { stand: "unbekannt", eintraege: [], beleg: quelle },
			wahlbereichszuordnung: {
				stand: "unbekannt",
				eintraege: [],
				beleg: quelle,
			},
			wahlleitungen: w,
		},
	],
});

const mitWahlen = (...slugs: string[]): Bestand => ({
	wahlen: new Map([["03254026", new Set(slugs)]]),
	gebiete: new Map(),
	wahlbezirke: new Map(),
});

const faelle = (befunde: Befund[]) =>
	befunde.map((b) => `${b.fall}/${b.ebene}`);

describe("Gegenprobe: wem gehört eine Lücke", () => {
	it("meldet als unseren Fehler, was die Wahlleitung veröffentlicht und die Anwendung nicht führt", () => {
		const befunde = pruefeAbdeckung({
			verzeichnis: gliederung("2026", [
				wahlleitung({
					beleg: beleg("wahlleitung"),
					aemter: {
						rat: {
							stand: "belegt",
							wahlen: [{ slug: "rat", titel: "Gemeindewahl" }],
						},
					},
				}),
			]),
			bestand: LEERER_BESTAND,
		});
		expect(faelle(befunde)).toEqual(["anwendung/wahlleitung", "anwendung/rat"]);
		expect(befunde[1].quelle).toBe("https://beispiel.invalid/termin.json");
	});

	it("meldet nichts, wenn die Anwendung führt, was veröffentlicht ist", () => {
		const befunde = pruefeAbdeckung({
			verzeichnis: gliederung("2026", [
				wahlleitung({
					beleg: beleg("wahlleitung"),
					aemter: {
						rat: {
							stand: "belegt",
							wahlen: [{ slug: "rat", titel: "Gemeindewahl" }],
						},
					},
				}),
			]),
			bestand: mitWahlen("rat"),
		});
		expect(befunde).toEqual([]);
	});

	it("meldet als Lücke der Wahlleitung, was 2021 da war und 2026 nicht veröffentlicht ist", () => {
		const befunde = pruefeAbdeckung({
			verzeichnis: gliederung("2026", [
				wahlleitung({
					beleg: beleg("wahlleitung"),
					aemter: {
						rat: {
							stand: "belegt",
							wahlen: [{ slug: "rat", titel: "Gemeindewahl" }],
						},
					},
				}),
			]),
			vergleich: gliederung("2021", [
				wahlleitung({
					beleg: beleg("wahlleitung"),
					aemter: {
						rat: {
							stand: "belegt",
							wahlen: [{ slug: "rat", titel: "Gemeindewahl" }],
						},
						buergermeister: {
							stand: "belegt",
							wahlen: [{ slug: "buergermeister", titel: "Bürgermeisterwahl" }],
						},
					},
				}),
			]),
			bestand: mitWahlen("rat"),
		});
		expect(faelle(befunde)).toEqual(["wahlleitung/buergermeister"]);
		expect(befunde[0].text).toContain("zum Termin 2021 gab es sie");
	});

	it("schweigt, wo das Verzeichnis das Amt für 2026 als entfallen führt", () => {
		const befunde = pruefeAbdeckung({
			verzeichnis: gliederung("2026", [
				wahlleitung({
					beleg: beleg("wahlleitung"),
					aemter: {
						rat: {
							stand: "belegt",
							wahlen: [{ slug: "rat", titel: "Gemeindewahl" }],
						},
						buergermeister: {
							stand: "entfaellt",
							wahlen: [],
							beleg: beleg("katalog", "Amtszeit läuft bis 2027"),
						},
					},
				}),
			]),
			vergleich: gliederung("2021", [
				wahlleitung({
					beleg: beleg("wahlleitung"),
					aemter: {
						buergermeister: {
							stand: "belegt",
							wahlen: [{ slug: "buergermeister", titel: "Bürgermeisterwahl" }],
						},
					},
				}),
			]),
			bestand: mitWahlen("rat"),
		});
		expect(befunde).toEqual([]);
	});

	it("hält eine schweigende Wahlleitung nie für unseren Fehler", () => {
		const befunde = pruefeAbdeckung({
			verzeichnis: gliederung("2026", [
				wahlleitung({
					beleg: beleg("keine", "kein termin.json"),
				}),
			]),
			vergleich: gliederung("2021", [
				wahlleitung({
					beleg: beleg("wahlleitung"),
					aemter: {
						rat: {
							stand: "belegt",
							wahlen: [{ slug: "rat", titel: "Gemeindewahl" }],
						},
					},
				}),
			]),
			bestand: LEERER_BESTAND,
		});
		expect(faelle(befunde)).toEqual(["wahlleitung/wahlleitung"]);
		expect(befunde[0].text).toContain("kein termin.json");
	});

	it("verlangt keine Stichwahl, die der erste Wahlgang erst auslösen muss", () => {
		const befunde = pruefeAbdeckung({
			verzeichnis: gliederung("2026", [
				wahlleitung({
					beleg: beleg("wahlleitung"),
					aemter: {
						buergermeister: {
							stand: "belegt",
							wahlen: [{ slug: "buergermeister", titel: "Bürgermeisterwahl" }],
						},
					},
				}),
			]),
			vergleich: gliederung("2021", [
				wahlleitung({
					beleg: beleg("wahlleitung"),
					aemter: {
						buergermeister: {
							stand: "belegt",
							wahlen: [{ slug: "buergermeister", titel: "Bürgermeisterwahl" }],
						},
						"buergermeister-stichwahl": {
							stand: "belegt",
							wahlen: [
								{
									slug: "buergermeister-stichwahl",
									titel: "Stichwahl des Bürgermeisters",
								},
							],
						},
					},
				}),
			]),
			bestand: mitWahlen("buergermeister"),
		});
		expect(befunde).toEqual([]);
	});

	it("meldet gegen das Verzeichnis, was die Anwendung führt und das Verzeichnis nicht kennt", () => {
		const befunde = pruefeAbdeckung({
			verzeichnis: gliederung("2026", [
				wahlleitung({
					beleg: beleg("wahlleitung"),
					aemter: {
						rat: {
							stand: "belegt",
							wahlen: [{ slug: "rat", titel: "Gemeindewahl" }],
						},
					},
				}),
			]),
			bestand: mitWahlen("rat", "ortsrat-roessing"),
		});
		expect(faelle(befunde)).toEqual(["verzeichnis/wahlleitung"]);
		expect(befunde[0].gegenstand).toBe("ortsrat-roessing");
	});

	it("meldet die eine fehlende Wahl unter zehn vorhandenen desselben Amts", () => {
		const raete = (...gebiete: Array<string | undefined>) => ({
			stand: "belegt" as const,
			wahlen: gebiete.map((g) => ({
				slug: g ? `rat-${g.toLowerCase()}` : "rat",
				titel: "Ratswahl",
				...(g ? { gebiet: g } : {}),
			})),
		});
		const befunde = pruefeAbdeckung({
			verzeichnis: gliederung("2026", [
				wahlleitung({
					art: "samtgemeinde",
					beleg: beleg("wahlleitung"),
					aemter: { rat: raete("Damnatz", "Gusborn", "Jameln") },
				}),
			]),
			vergleich: gliederung("2021", [
				wahlleitung({
					art: "samtgemeinde",
					beleg: beleg("wahlleitung"),
					aemter: { rat: raete(undefined, "Damnatz", "Gusborn", "Jameln") },
				}),
			]),
			bestand: mitWahlen("rat-damnatz", "rat-gusborn", "rat-jameln"),
		});
		expect(faelle(befunde)).toEqual(["wahlleitung/rat"]);
		expect(befunde[0].text).toContain("keine Ratswahl für 2026");
	});

	it("schweigt, solange jede Wahl des Vergleichstermins ihre Entsprechung hat", () => {
		const raete = {
			stand: "belegt" as const,
			wahlen: [
				{ slug: "rat", titel: "Ratswahl" },
				{ slug: "rat-damnatz", titel: "Ratswahl", gebiet: "Damnatz" },
			],
		};
		const befunde = pruefeAbdeckung({
			verzeichnis: gliederung("2026", [
				wahlleitung({ beleg: beleg("wahlleitung"), aemter: { rat: raete } }),
			]),
			vergleich: gliederung("2021", [
				wahlleitung({ beleg: beleg("wahlleitung"), aemter: { rat: raete } }),
			]),
			bestand: mitWahlen("rat", "rat-damnatz"),
		});
		expect(befunde).toEqual([]);
	});

	it("zählt die vier Fälle getrennt", () => {
		const b = bericht("2026", [
			{
				fall: "anwendung",
				ebene: "rat",
				kreis: "x",
				behoerde: "1",
				name: "a",
				gegenstand: "g",
				quelle: "q",
				text: "t",
			},
			{
				fall: "wahlleitung",
				ebene: "rat",
				kreis: "x",
				behoerde: "1",
				name: "a",
				gegenstand: "g",
				quelle: "q",
				text: "t",
			},
		]);
		expect(b.jeFall).toEqual({
			anwendung: 1,
			wahlleitung: 1,
			verzeichnis: 0,
			messung: 0,
		});
		expect(b.gesamt).toBe(2);
	});
});

describe("Bestandsaufnahme aus der Datenbank", () => {
	let tmp: string;
	let db: DatabaseSync;

	beforeAll(() => {
		tmp = tempVerzeichnis("abdeckung-");
		db = new DatabaseSync(join(tmp, "probe.db"));
		db.exec(`
			CREATE TABLE wahleintraege (termin TEXT, behoerde TEXT, wahl_id INTEGER, gebiet_id TEXT, slug TEXT);
			CREATE TABLE ergebnisse (termin TEXT, behoerde TEXT, wahl_id INTEGER, gebiet_id TEXT);
			CREATE TABLE wahlraeume (termin TEXT, behoerde TEXT, id INTEGER, bezirk TEXT);
			INSERT INTO wahleintraege VALUES ('2026','03254000',45,'ebene_-52_id_62','kreistag');
			INSERT INTO ergebnisse VALUES ('2026','03254000',45,'ebene_-53_id_160');
			INSERT INTO wahlraeume VALUES ('2026','03254026',1,'01 - Nordstemmen'),('2026','03254026',2,'02 - Adensen');
		`);
	});
	afterAll(() => {
		db.close();
		aufraeumen(tmp);
	});

	it("führt Wahlen, Gebiete und Wahlbezirke je Wahlleitung zusammen", () => {
		const bestand = bestandAus(db, "2026");
		expect([...(bestand.wahlen.get("03254000") ?? [])]).toEqual(["kreistag"]);
		expect(
			[...(bestand.gebiete.get("03254000/kreistag") ?? [])].sort(),
		).toEqual(["ebene_-52_id_62", "ebene_-53_id_160"]);
		expect(bestand.wahlbezirke.get("03254026")).toBe(2);
	});

	it("erkennt einen veröffentlichten Kreiswahlbereich, den die Anwendung nicht führt", () => {
		const kreiswahlbereiche = (ids: string[]) => ({
			stand: "belegt" as const,
			eintraege: ids.map((id) => ({
				kuerzel: id.slice(-1),
				name: id.slice(-1),
				gebietId: id,
			})),
			beleg: beleg("wahlleitung"),
		});
		const verzeichnis = gliederung("2026", [
			wahlleitung({
				ags: "03254000",
				slug: "kreis",
				name: "Landkreis Hildesheim",
				art: "kreis",
				beleg: beleg("wahlleitung"),
				aemter: {
					kreistag: {
						stand: "belegt",
						wahlen: [{ slug: "kreistag", titel: "Kreistagswahl" }],
					},
				},
			}),
		]);
		verzeichnis.kreise[0].kreiswahlbereiche = kreiswahlbereiche([
			"ebene_-53_id_160",
			"ebene_-53_id_162",
		]);
		const befunde = pruefeAbdeckung({
			verzeichnis,
			bestand: bestandAus(db, "2026"),
		});
		expect(faelle(befunde)).toEqual(["anwendung/kreiswahlbereich"]);
		expect(befunde[0].gegenstand).toBe("2");
	});
});

describe("Das eingecheckte Verzeichnis", () => {
	it("führt beide Termine mit allen 45 Kreisen und 413 Wahlleitungen", () => {
		expect(TERMINE_MIT_GLIEDERUNG.sort()).toEqual(["2021", "2026"]);
		for (const termin of TERMINE_MIT_GLIEDERUNG) {
			const g = gliederungFuer(termin) as Wahlgliederung;
			expect(g.kreise, termin).toHaveLength(45);
			expect(
				g.kreise.reduce((s, k) => s + k.wahlleitungen.length, 0),
				termin,
			).toBe(413);
		}
	});

	it("nennt zu jedem Eintrag eine Herkunft und eine Quelle", () => {
		for (const termin of TERMINE_MIT_GLIEDERUNG) {
			const g = gliederungFuer(termin) as Wahlgliederung;
			for (const { wo, beleg: b } of belege(g)) {
				expect(b.herkunft, `${termin} ${wo}`).toMatch(
					/^(wahlleitung|bekanntmachung|katalog|vergleich|keine)$/,
				);
				expect(b.quelle.length, `${termin} ${wo}`).toBeGreaterThan(0);
				expect(b.erhoben, `${termin} ${wo}`).toMatch(/^\d{4}-\d{2}-\d{2}T/);
			}
		}
	});

	it("stützt keinen Eintrag eines Termins auf einen anderen", () => {
		for (const termin of TERMINE_MIT_GLIEDERUNG) {
			const g = gliederungFuer(termin) as Wahlgliederung;
			for (const { wo, beleg: b } of belege(g)) {
				expect(b.herkunft, `${termin} ${wo}`).not.toBe("vergleich");
				if (b.terminBeleg)
					expect(b.terminBeleg, `${termin} ${wo}`).toBe(termin);
			}
		}
	});

	it("lässt unbekannte Gebietsmengen leer, statt sie zu raten", () => {
		for (const termin of TERMINE_MIT_GLIEDERUNG) {
			const g = gliederungFuer(termin) as Wahlgliederung;
			for (const k of g.kreise) {
				for (const menge of [k.kreiswahlbereiche, k.wahlbereichszuordnung])
					if (menge.stand === "unbekannt")
						expect(menge.eintraege, `${termin} ${k.slug}`).toHaveLength(0);
				for (const w of k.wahlleitungen)
					for (const menge of [
						w.ortschaften,
						w.wahlbezirke,
						...(w.mitgliedsgemeinden ? [w.mitgliedsgemeinden] : []),
					])
						if (menge.stand === "unbekannt")
							expect(menge.eintraege, `${termin} ${w.slug}`).toHaveLength(0);
			}
		}
	});

	it("hält den Zuschnitt von 2021 fest, wie er 2021 war", () => {
		const hi = kreisgliederung("2021", "hildesheim");
		expect(hi?.kreiswahlbereiche.eintraege.map((b) => b.kuerzel)).toEqual([
			"A",
			"B",
			"C",
			"D",
			"E",
			"F",
			"G",
			"H",
			"I",
			"K",
			"L",
			"M",
		]);
		const nordstemmen = wahlleitungByAgs("2021", "03254026");
		expect(nordstemmen?.ortschaften.eintraege.map((o) => o.name)).toContain(
			"Rössing",
		);
	});

	it("übernimmt für 2026 keinen einzigen Zuschnitt aus 2021", () => {
		const g2026 = gliederungFuer("2026") as Wahlgliederung;
		const g2021 = gliederungFuer("2021") as Wahlgliederung;
		for (const k of g2026.kreise) {
			const alt = g2021.kreise.find((x) => x.slug === k.slug);
			if (k.kreiswahlbereiche.stand !== "belegt")
				expect(k.kreiswahlbereiche.eintraege, k.slug).toHaveLength(0);
			if (!alt) continue;
			for (const w of k.wahlleitungen) {
				if (w.beleg.herkunft === "wahlleitung") continue;
				expect(Object.keys(w.aemter), `${k.slug}/${w.slug}`).toHaveLength(0);
				expect(w.wahlbezirke.eintraege, `${k.slug}/${w.slug}`).toHaveLength(0);
				expect(w.ortschaften.eintraege, `${k.slug}/${w.slug}`).toHaveLength(0);
			}
		}
	});

	it("ist mit sich selbst deckungsgleich: was drinsteht, findet die Gegenprobe wieder", () => {
		const g = gliederungFuer("2026") as Wahlgliederung;
		const wahlen = new Map<string, Set<string>>();
		const gebiete = new Map<string, Set<string>>();
		const wahlbezirke = new Map<string, number>();
		for (const k of g.kreise) {
			for (const w of k.wahlleitungen) {
				const slugs = new Set<string>();
				for (const a of Object.values(w.aemter))
					for (const wahl of a.wahlen) slugs.add(wahl.slug);
				if (slugs.size) wahlen.set(w.ags, slugs);
				if (w.wahlbezirke.eintraege.length)
					wahlbezirke.set(w.ags, w.wahlbezirke.eintraege.length);
			}
			const kreisbehoerde = k.wahlleitungen.find((w) => w.ags === k.ags);
			for (const wahl of kreisbehoerde?.aemter.kreistag?.wahlen ?? [])
				gebiete.set(
					`${k.ags}/${wahl.slug}`,
					new Set(
						k.kreiswahlbereiche.eintraege
							.map((b) => b.gebietId)
							.filter((id): id is string => Boolean(id)),
					),
				);
		}
		const befunde = pruefeAbdeckung({
			verzeichnis: g,
			bestand: { wahlen, gebiete, wahlbezirke },
		});
		expect(befunde.map((b) => b.text)).toEqual([]);
	});
});

describe("Vollständigkeit des Katalogs, gemessen an der Kreistagswahl 2021", () => {
	const NORTHEIM: Array<[string, string, number, number]> = [
		["03155000", "Landkreis Northeim", 110854, 240],
		["03155001", "Stadt Bad Gandersheim", 8032, 21],
		["03155002", "Flecken Bodenfelde", 2590, 4],
		["03155003", "Stadt Dassel", 8206, 24],
		["03155005", "Stadt Hardegsen", 6515, 15],
		["03155006", "Gemeinde Kalefeld", 5332, 16],
		["03155007", "Gemeinde Katlenburg-Lindau", 5985, 11],
		["03155009", "Stadt Moringen", 5961, 14],
		["03155010", "Flecken Nörten-Hardenberg", 7057, 14],
		["03155011", "Stadt Northeim", 23563, 33],
		["03155012", "Stadt Uslar", 11790, 24],
		["03155013", "Stadt Einbeck", 25823, 64],
	];

	type Zeile = (typeof NORTHEIM)[number];

	const messungAus = (zeilen: Zeile[]): Messung => ({
		termin: "2021",
		zahlen: new Map(
			zeilen.map(([ags, , wahlberechtigte, max]) => [
				ags,
				{ wahlberechtigte, anz: max, max },
			]),
		),
	});

	const katalogkreis = (ohne: string[] = []): Katalogkreis => ({
		slug: "northeim",
		ags: "03155000",
		name: "Landkreis Northeim",
		behoerden: NORTHEIM.filter(([ags]) => !ohne.includes(ags)).map(
			([ags, name]) => ({ ags, name }),
		),
	});

	it("nennt Northeim, solange Kalefeld im Katalog fehlt", () => {
		const befunde = pruefeKreisvollstaendigkeit(
			[katalogkreis(["03155006"])],
			messungAus(NORTHEIM),
		);
		expect(befunde).toHaveLength(1);
		expect(befunde[0].fall).toBe("anwendung");
		expect(befunde[0].ebene).toBe("kreisgebiet");
		expect(befunde[0].text).toContain("5.332 Wahlberechtigte");
		expect(befunde[0].text).toContain("16 Schnellmeldungen");
	});

	it("schweigt, sobald Kalefeld im Katalog steht", () => {
		expect(
			pruefeKreisvollstaendigkeit([katalogkreis()], messungAus(NORTHEIM)),
		).toEqual([]);
	});

	it("deutet eine Behörde, die die Kreistagswahl nicht selbst meldet, nicht als Lücke", () => {
		const befunde = pruefeKreisvollstaendigkeit(
			[katalogkreis()],
			messungAus(NORTHEIM.filter(([ags]) => ags !== "03155013")),
		);
		expect(befunde).toHaveLength(1);
		expect(befunde[0].fall).toBe("messung");
		expect(befunde[0].text).toContain("Stadt Einbeck");
		expect(befunde[0].text).toContain("die Probe entscheidet nicht");
	});

	it("sagt es, wenn die Kreisbehörde selbst keine Kreistagswahl beisteuert", () => {
		const befunde = pruefeKreisvollstaendigkeit(
			[katalogkreis()],
			messungAus(NORTHEIM.filter(([ags]) => ags !== "03155000")),
		);
		expect(befunde).toHaveLength(1);
		expect(befunde[0].fall).toBe("messung");
		expect(befunde[0].text).toContain("nicht nachgerechnet");
	});

	it("misst eine kreisfreie Stadt nicht, die keine Gemeinden unter sich hat", () => {
		expect(
			pruefeKreisvollstaendigkeit(
				[
					{
						slug: "emden",
						ags: "03402000",
						name: "Stadt Emden",
						behoerden: [{ ags: "03402000", name: "Stadt Emden" }],
					},
				],
				messungAus([]),
			),
		).toEqual([]);
	});
});

describe("Kreistagszahlen aus der Datenbank", () => {
	let tmp: string;
	let db: DatabaseSync;

	beforeAll(() => {
		tmp = tempVerzeichnis("kreistagszahlen-");
		db = new DatabaseSync(join(tmp, "probe.db"));
		db.exec(`
			CREATE TABLE wahleintraege (termin TEXT, behoerde TEXT, wahl_id INTEGER, gebiet_id TEXT, slug TEXT);
			CREATE TABLE ergebnisse (termin TEXT, behoerde TEXT, wahl_id INTEGER, gebiet_id TEXT, ebene INTEGER, stand_anz INTEGER, stand_max INTEGER, json TEXT);
			INSERT INTO wahleintraege VALUES ('2021','03155000',219,'ebene_1_id_247','kreistag'),('2021','03155000',220,'ebene_1_id_247','landrat');
			INSERT INTO ergebnisse VALUES
				('2021','03155000',219,'ebene_9_id_1827',9,49,49,'{"kennzahlen":{"wahlberechtigte":28895}}'),
				('2021','03155000',219,'ebene_1_id_247',1,240,240,'{"kennzahlen":{"wahlberechtigte":110854}}'),
				('2021','03155000',220,'ebene_1_id_247',1,240,240,'{"kennzahlen":{"wahlberechtigte":110854}}');
		`);
	});
	afterAll(() => {
		db.close();
		aufraeumen(tmp);
	});

	it("nimmt je Wahlleitung das Gesamtgebiet der Kreistagswahl, nicht den Wahlbereich", () => {
		expect(kreistagszahlenAus(db, "2021").get("03155000")).toEqual({
			wahlberechtigte: 110854,
			anz: 240,
			max: 240,
		});
	});

	it("führt nichts für einen Termin, zu dem keine Kreistagswahl vorliegt", () => {
		expect(kreistagszahlenAus(db, "2026").size).toBe(0);
	});
});

describe("Katalog gegen Verzeichnis", () => {
	const kreis: Katalogkreis = {
		slug: "northeim",
		ags: "03155000",
		name: "Landkreis Northeim",
		behoerden: [
			{ ags: "03155000", name: "Landkreis Northeim" },
			{ ags: "03155006", name: "Gemeinde Kalefeld" },
		],
	};
	const nurKreisbehoerde = gliederung("2026", [
		wahlleitung({
			ags: "03155000",
			slug: "kreis",
			name: "Landkreis Northeim",
			art: "kreis",
			beleg: beleg("wahlleitung"),
		}),
	]);

	it("weist eine Behörde, die für den Termin nichts veröffentlicht, sichtbar aus", () => {
		const befunde = pruefeKatalogGegenVerzeichnis(
			[kreis],
			nurKreisbehoerde,
			LEERER_BESTAND,
		);
		expect(befunde).toHaveLength(1);
		expect(befunde[0].fall).toBe("wahlleitung");
		expect(befunde[0].name).toBe("Gemeinde Kalefeld");
		expect(befunde[0].text).toContain("nichts veröffentlicht");
	});

	it("verlangt das Verzeichnis nachzuziehen, wenn die Anwendung schon Zahlen führt", () => {
		const befunde = pruefeKatalogGegenVerzeichnis([kreis], nurKreisbehoerde, {
			wahlen: new Map([["03155006", new Set(["kreistag", "rat"])]]),
			gebiete: new Map(),
			wahlbezirke: new Map(),
		});
		expect(befunde).toHaveLength(1);
		expect(befunde[0].fall).toBe("verzeichnis");
		expect(befunde[0].text).toContain("2 Wahlen");
	});
});

describe("Der eingecheckte Katalog", () => {
	it("führt die Gemeinden, die 2021 eine eigene Kreistagswahl gemeldet haben", () => {
		const behoerden = (slug: string) =>
			(kreisBySlug(slug)?.behoerden ?? []).map((b) => b.ags);
		expect(behoerden("northeim")).toContain("03155006");
		expect(behoerden("wittmund")).toEqual(
			expect.arrayContaining(["03462007", "03462014"]),
		);
	});
});
