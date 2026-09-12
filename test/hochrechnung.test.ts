import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIXTURES, aufraeumen, tempVerzeichnis } from "./helfer.ts";
import {
	type MockVotemanager,
	starteMockVotemanager,
} from "./mock-votemanager.ts";
import {
	MINDEST_MELDUNGEN,
	MITTEL_AB,
	NIEDRIG_AB,
	type Einheit,
	istBriefwahl,
	ordneZu,
	rechneHoch,
	schwelle,
	unsicherheit,
} from "../src/lib/hochrechnung.ts";
import { hareNiemeyer } from "../src/lib/sitze.ts";

let mock: MockVotemanager;
let tmp: string;

/** Ein Wahlbezirk mit seinen Stimmen je Partei. */
type Bezirk = { id: string; name: string; stimmen: Map<string, number> };
let bezirkeVon: (wahlId: number) => Bezirk[];

const GEMEINDEWAHL = 27;
const KREISWAHL = 31;
const LANDRATSWAHL = 28;

beforeAll(async () => {
	tmp = tempVerzeichnis("hochrechnung-");
	mock = await starteMockVotemanager(FIXTURES);
	process.env.VOTEMANAGER_BASIS = mock.url;
	process.env.DATABASE_PATH = join(tmp, "wahlen.db");
	const { oeffneDb } = await import("../src/lib/db.ts");
	const { pollTermin } = await import("../src/lib/poll.ts");
	const { terminById } = await import("../src/data/termine.ts");
	await pollTermin(oeffneDb(), terminById("2021")!, {
		nurBehoerden: ["03254026"],
	});
	const { ergebnisseEbene } = await import("../src/lib/abfragen.ts");
	bezirkeVon = (wahlId) =>
		ergebnisseEbene("2021", "03254026", wahlId, 6).map((e) => ({
			id: e.gebietId,
			name: e.titel,
			stimmen: new Map(e.ergebnis.parteien.map((p) => [p.key, p.stimmen])),
		}));
});

afterAll(async () => {
	const { schliesseDb } = await import("../src/lib/db.ts");
	schliesseDb();
	await mock.schliessen();
	aufraeumen(tmp);
});

const summe = (m: Map<string, number>): number =>
	[...m.values()].reduce((a, b) => a + b, 0);

const anteile = (m: Map<string, number>): Map<string, number> => {
	const s = summe(m);
	return new Map([...m].map(([k, v]) => [k, s > 0 ? (100 * v) / s : 0]));
};

/** Mittlerer absoluter Fehler der Stimmenanteile in Prozentpunkten. */
const fehler = (
	schaetzung: Map<string, number>,
	wahrheit: Map<string, number>,
): number => {
	const a = anteile(schaetzung);
	const b = anteile(wahrheit);
	const keys = new Set([...a.keys(), ...b.keys()]);
	let sum = 0;
	for (const k of keys) sum += Math.abs((a.get(k) ?? 0) - (b.get(k) ?? 0));
	return sum / keys.size;
};

const gesamtStimmen = (bs: Bezirk[]): Map<string, number> => {
	const m = new Map<string, number>();
	for (const b of bs)
		for (const [k, v] of b.stimmen) m.set(k, (m.get(k) ?? 0) + v);
	return m;
};

/** Deterministisches Mischen, damit die Läufe wiederholbar sind. */
const mische = <T>(xs: T[], seed: number): T[] => {
	let s = seed;
	const rnd = () => {
		s = (s * 1103515245 + 12345) % 2147483648;
		return s / 2147483648;
	};
	const a = [...xs];
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(rnd() * (i + 1));
		[a[i], a[j]] = [a[j], a[i]];
	}
	return a;
};

/** Auszählverläufe: Dörfer zuerst, große Bezirke zuerst, zufällig. */
const verlaeufe = (bs: Bezirk[]): Bezirk[][] => {
	const urne = bs.filter((b) => !istBriefwahl(b.name));
	const brief = bs.filter((b) => istBriefwahl(b.name));
	const nachGroesse = (a: Bezirk, b: Bezirk) =>
		summe(a.stimmen) - summe(b.stimmen);
	const folgen = [
		[...[...urne].sort(nachGroesse), ...brief],
		[...[...urne].sort((a, b) => nachGroesse(b, a)), ...brief],
	];
	for (let i = 0; i < 10; i++)
		folgen.push([...mische(urne, 97 + i * 31), ...brief]);
	for (let i = 0; i < 5; i++) folgen.push(mische(bs, 41 + i * 17));
	return folgen;
};

/** Baut die Einheiten für einen Auszählstand. */
const stand = (
	aktuell: Bezirk[],
	vorwerte: Map<string, Map<string, number>>,
	ausgezaehlt: Set<string>,
): Einheit[] =>
	aktuell.map((b) => ({
		id: b.id,
		name: b.name,
		briefwahl: istBriefwahl(b.name),
		anteil: ausgezaehlt.has(b.id) ? 1 : 0,
		stimmen: ausgezaehlt.has(b.id) ? b.stimmen : new Map(),
		vorwert: vorwerte.get(b.id),
	}));

const zuordnung = (
	aktuell: Bezirk[],
	vorher: Bezirk[],
): Map<string, Map<string, number>> => {
	const { treffer } = ordneZu(
		aktuell.map((b) => ({ ...b, briefwahl: istBriefwahl(b.name) })),
		vorher.map((v) => ({ name: v.name, stimmen: v.stimmen })),
	);
	const m = new Map<string, Map<string, number>>();
	for (const [a, v] of treffer) m.set(a.id, v);
	return m;
};

describe("schwelle", () => {
	it("verlangt ein Fünftel der erwarteten Schnellmeldungen", () => {
		expect(schwelle(426)).toBe(86);
		expect(schwelle(125)).toBe(25);
	});

	it("verlangt mindestens fünf Meldungen, auch bei kleinen Wahlen", () => {
		expect(schwelle(23)).toBe(5);
		expect(schwelle(12)).toBe(5);
	});

	it("verlangt bei winzigen Wahlgebieten alle Meldungen", () => {
		expect(schwelle(3)).toBe(3);
		expect(schwelle(MINDEST_MELDUNGEN)).toBe(MINDEST_MELDUNGEN);
		expect(schwelle(0)).toBe(0);
	});
});

describe("Zuordnung der Wahlbezirke", () => {
	it("findet alle 23 Nordstemmener Wahlbezirke in der Vergleichswahl wieder", () => {
		const { treffer, uebrig } = ordneZu(
			bezirkeVon(GEMEINDEWAHL).map((b) => ({
				...b,
				briefwahl: istBriefwahl(b.name),
			})),
			bezirkeVon(KREISWAHL).map((v) => ({ name: v.name, stimmen: v.stimmen })),
		);
		expect(treffer.size).toBe(23);
		expect(uebrig).toHaveLength(0);
	});

	it("erkennt die acht Briefwahlbezirke am Namen", () => {
		const brief = bezirkeVon(GEMEINDEWAHL).filter((b) => istBriefwahl(b.name));
		expect(brief).toHaveLength(8);
		expect(brief.every((b) => b.name.includes("Briefwahl"))).toBe(true);
		expect(istBriefwahl("09 - Rössing - DGH")).toBe(false);
	});

	it("ordnet auch bei umbenanntem Wahllokal über die Bezirksnummer zu", () => {
		const aktuell = bezirkeVon(GEMEINDEWAHL).map((b) => ({
			...b,
			name: b.name.replace(/ - [^-]+$/, " - Neues Wahllokal"),
			briefwahl: istBriefwahl(b.name),
		}));
		const { treffer } = ordneZu(
			aktuell,
			bezirkeVon(KREISWAHL).map((v) => ({ name: v.name, stimmen: v.stimmen })),
		);
		expect(treffer.size).toBe(23);
	});
});

/** Namenspaare, die im Bestand wirklich so stehen – 2021 gegen 2016 bzw. 2026. */
describe("Zuordnung über die Schreibweise hinweg", () => {
	const paare = (
		jetzt: string[],
		vorher: string[],
	): Map<string, string | undefined> => {
		const a = jetzt.map((name) => ({ name, briefwahl: istBriefwahl(name) }));
		const v = vorher.map((name) => ({ name, stimmen: new Map([[name, 1]]) }));
		const { treffer } = ordneZu(a, v);
		return new Map(
			a.map((x) => [x.name, [...(treffer.get(x)?.keys() ?? [])][0]]),
		);
	};

	it("findet den Ortsteil wieder, den die Wahlleitung anders herum schreibt", () => {
		const p = paare(
			["06 - Adensen", "07 - Hallerburg", "902 - Briefwahl Adensen"],
			["Nordstemmen/Adensen", "Nordstemmen/Hallerburg", "Briefwahl Adensen"],
		);
		expect(p.get("06 - Adensen")).toBe("Nordstemmen/Adensen");
		expect(p.get("07 - Hallerburg")).toBe("Nordstemmen/Hallerburg");
		expect(p.get("902 - Briefwahl Adensen")).toBe("Briefwahl Adensen");
	});

	it("findet die Bezirksnummer wieder, die einen Namen dazubekommen hat", () => {
		const p = paare(
			["111-01 Hondelage-Nord", "111-02 Hondelage-Mitte"],
			["11101", "11102"],
		);
		expect(p.get("111-01 Hondelage-Nord")).toBe("11101");
		expect(p.get("111-02 Hondelage-Mitte")).toBe("11102");
	});

	it("findet die nackte Nummer wieder, der ein Kürzel vorangestellt wurde", () => {
		const p = paare(["WB 1", "WB 2", "WB 13"], ["1", "2", "13"]);
		expect(p.get("WB 1")).toBe("1");
		expect(p.get("WB 13")).toBe("13");
	});

	it("lässt einen Bezirk lieber ohne Vorwert als ihn zu raten", () => {
		const p = paare(
			["09 - Rössing - DGH", "10 - Rössing - Gaststätte"],
			[
				"Nordstemmen/Rössing - Dorfgem. haus",
				"Nordstemmen/Rössing - Feuerwehrhaus",
			],
		);
		expect([...p.values()].filter(Boolean)).toHaveLength(0);
	});

	it("verwechselt Briefwahl nie mit einer Urne", () => {
		const p = paare(
			["901 - Briefwahl Nordstemmen", "01 - Nordstemmen"],
			["Briefwahl Nordstemmen", "Nordstemmen - Gaststätte"],
		);
		expect(p.get("901 - Briefwahl Nordstemmen")).toBe("Briefwahl Nordstemmen");
		expect(p.get("01 - Nordstemmen")).toBe("Nordstemmen - Gaststätte");
	});
});

describe("rechneHoch – Güte gegenüber dem rohen Zwischenstand", () => {
	for (const [titel, wahl, vorwahl] of [
		["Gemeindewahl (Vorwahl: Kreiswahl)", GEMEINDEWAHL, KREISWAHL],
		["Kreiswahl (Vorwahl: Gemeindewahl)", KREISWAHL, GEMEINDEWAHL],
	] as const) {
		it(`${titel}: schlägt den Zwischenstand ab der Schwelle deutlich`, () => {
			const aktuell = bezirkeVon(wahl);
			const vorwerte = zuordnung(aktuell, bezirkeVon(vorwahl));
			const ende = gesamtStimmen(aktuell);
			const ab = schwelle(aktuell.length);

			let besser = 0;
			let gesamtRoh = 0;
			let gesamtHoch = 0;
			let laeufe = 0;
			let schlimmsterRoh = 0;
			let schlimmsterHoch = 0;
			for (const folge of verlaeufe(aktuell)) {
				for (let n = ab; n < aktuell.length; n++) {
					const fertig = new Set(folge.slice(0, n).map((b) => b.id));
					const roh = gesamtStimmen(aktuell.filter((b) => fertig.has(b.id)));
					const hr = rechneHoch(stand(aktuell, vorwerte, fertig));
					expect(hr).toBeDefined();
					if (!hr) continue;
					const fRoh = fehler(roh, ende);
					const fHoch = fehler(hr.stimmen, ende);
					laeufe++;
					gesamtRoh += fRoh;
					gesamtHoch += fHoch;
					schlimmsterRoh = Math.max(schlimmsterRoh, fRoh);
					schlimmsterHoch = Math.max(schlimmsterHoch, fHoch);
					if (fHoch <= fRoh) besser++;
				}
			}
			expect(gesamtHoch / laeufe).toBeLessThan((gesamtRoh / laeufe) * 0.67);
			expect(schlimmsterHoch).toBeLessThan(schlimmsterRoh);
			expect(besser / laeufe).toBeGreaterThan(0.8);
		});
	}

	it("hält die Sitzverteilung ab der Schwelle nahe am Endergebnis", () => {
		const aktuell = bezirkeVon(GEMEINDEWAHL);
		const vorwerte = zuordnung(aktuell, bezirkeVon(KREISWAHL));
		const ende = gesamtStimmen(aktuell);
		const sitzeVon = (m: Map<string, number>) =>
			new Map(
				hareNiemeyer(
					[...m].map(([key, stimmen]) => ({ key, stimmen })),
					30,
				).map((s) => [s.key, s.sitze]),
			);
		const richtig = sitzeVon(ende);
		let schlimmster = 0;
		for (const folge of verlaeufe(aktuell)) {
			const fertig = new Set(
				folge.slice(0, schwelle(aktuell.length)).map((b) => b.id),
			);
			const hr = rechneHoch(stand(aktuell, vorwerte, fertig));
			if (!hr) continue;
			const geschaetzt = sitzeVon(hr.stimmen);
			let falsch = 0;
			for (const k of new Set([...richtig.keys(), ...geschaetzt.keys()]))
				falsch += Math.abs((richtig.get(k) ?? 0) - (geschaetzt.get(k) ?? 0));
			schlimmster = Math.max(schlimmster, falsch / 2);
		}
		expect(schlimmster).toBeLessThanOrEqual(2);
	});
});

describe("rechneHoch – die Fallstricke", () => {
	it("behält das eigene Profil der Briefwahlbezirke, wenn sie noch fehlen", () => {
		const aktuell = bezirkeVon(GEMEINDEWAHL);
		const vorwerte = zuordnung(aktuell, bezirkeVon(KREISWAHL));
		const urne = aktuell.filter((b) => !istBriefwahl(b.name));
		const fertig = new Set(urne.map((b) => b.id));
		const hr = rechneHoch(stand(aktuell, vorwerte, fertig))!;
		expect(hr.briefwahlGetrennt).toBe(false);

		const ende = anteile(gesamtStimmen(aktuell));
		const nurUrne = anteile(gesamtStimmen(urne));
		const geschaetzt = anteile(hr.stimmen);
		expect(Math.abs(geschaetzt.get("cdu")! - ende.get("cdu")!)).toBeLessThan(
			Math.abs(nurUrne.get("cdu")! - ende.get("cdu")!),
		);
		expect(fehler(hr.stimmen, gesamtStimmen(aktuell))).toBeLessThan(
			fehler(gesamtStimmen(urne), gesamtStimmen(aktuell)),
		);
	});

	it("rechnet Urne und Briefwahl getrennt, sobald beide melden", () => {
		const aktuell = bezirkeVon(GEMEINDEWAHL);
		const vorwerte = zuordnung(aktuell, bezirkeVon(KREISWAHL));
		const fertig = new Set(
			[
				...aktuell.filter((b) => !istBriefwahl(b.name)).slice(0, 5),
				...aktuell.filter((b) => istBriefwahl(b.name)).slice(0, 2),
			].map((b) => b.id),
		);
		expect(
			rechneHoch(stand(aktuell, vorwerte, fertig))?.briefwahlGetrennt,
		).toBe(true);
	});

	it("sprengt die Summe nicht, wenn eine Partei ohne Vorwert antritt", () => {
		const aktuell = bezirkeVon(KREISWAHL);
		const vorwerte = zuordnung(aktuell, bezirkeVon(GEMEINDEWAHL));
		const ende = gesamtStimmen(aktuell);
		const endAnteile = anteile(ende);
		for (const folge of verlaeufe(aktuell)) {
			const fertig = new Set(folge.slice(0, 8).map((b) => b.id));
			const hr = rechneHoch(stand(aktuell, vorwerte, fertig))!;
			expect(summe(hr.stimmen)).toBeGreaterThan(summe(ende) * 0.85);
			expect(summe(hr.stimmen)).toBeLessThan(summe(ende) * 1.15);
			const afd = anteile(hr.stimmen).get("afd") ?? 0;
			expect(afd).toBeGreaterThan(endAnteile.get("afd")! / 2);
			expect(afd).toBeLessThan(endAnteile.get("afd")! * 2);
		}
	});

	it("verkraftet Wahlbezirke ohne Vorwert (Gebietsänderung)", () => {
		const aktuell = bezirkeVon(GEMEINDEWAHL);
		const vorwerte = zuordnung(aktuell, bezirkeVon(KREISWAHL));
		for (const b of aktuell.slice(0, 3)) vorwerte.delete(b.id);
		const ende = gesamtStimmen(aktuell);
		const fertig = new Set(aktuell.slice(0, 8).map((b) => b.id));
		const hr = rechneHoch(stand(aktuell, vorwerte, fertig))!;
		expect(hr).toBeDefined();
		expect(summe(hr.stimmen)).toBeGreaterThan(summe(ende) * 0.8);
		expect(summe(hr.stimmen)).toBeLessThan(summe(ende) * 1.2);
		expect(fehler(hr.stimmen, ende)).toBeLessThan(
			fehler(gesamtStimmen(aktuell.filter((b) => fertig.has(b.id))), ende),
		);
	});

	it("lehnt eine Vergleichswahl ab, deren Parteien nicht passen", () => {
		const aktuell = bezirkeVon(GEMEINDEWAHL);
		const vorwerte = zuordnung(aktuell, bezirkeVon(LANDRATSWAHL));
		expect(vorwerte.size).toBe(23);
		const fertig = new Set(aktuell.slice(0, 8).map((b) => b.id));
		expect(rechneHoch(stand(aktuell, vorwerte, fertig))).toBeUndefined();
	});

	it("rechnet ohne einen einzigen Vorwert gar nicht", () => {
		const aktuell = bezirkeVon(GEMEINDEWAHL);
		const fertig = new Set(aktuell.slice(0, 8).map((b) => b.id));
		expect(rechneHoch(stand(aktuell, new Map(), fertig))).toBeUndefined();
	});

	it("meldet die Abdeckung nach Stimmengewicht, nicht nach Bezirkszahl", () => {
		const aktuell = bezirkeVon(GEMEINDEWAHL);
		const vorwerte = zuordnung(aktuell, bezirkeVon(KREISWAHL));
		const klein = [...aktuell]
			.sort((a, b) => summe(a.stimmen) - summe(b.stimmen))
			.slice(0, 5);
		const hr = rechneHoch(
			stand(aktuell, vorwerte, new Set(klein.map((b) => b.id))),
		)!;
		expect(hr.abdeckung).toBeLessThan(5 / 23);
		expect(hr.basis).toBe(23);
	});
});

describe("Einstufung der Unsicherheit", () => {
	const vieleVerlaeufe = (bs: Bezirk[]): Bezirk[][] => {
		const urne = bs.filter((b) => !istBriefwahl(b.name));
		const brief = bs.filter((b) => istBriefwahl(b.name));
		const nachGroesse = (a: Bezirk, b: Bezirk) =>
			summe(a.stimmen) - summe(b.stimmen);
		const folgen: Bezirk[][] = [
			[...[...urne].sort(nachGroesse), ...brief],
			[...[...urne].sort((a, b) => nachGroesse(b, a)), ...brief],
		];
		for (let i = 0; i < 400; i++)
			folgen.push([...mische(urne, 97 + i * 31), ...brief]);
		for (let i = 0; i < 400; i++) folgen.push(mische(bs, 41 + i * 17));
		return folgen;
	};

	/** Sitze aus Stimmen – der 30er-Rat der Gemeinde Nordstemmen. */
	const sitzeVon = (m: Map<string, number>) =>
		new Map(
			hareNiemeyer(
				[...m].map(([key, stimmen]) => ({ key, stimmen })),
				30,
			).map((s) => [s.key, s.sitze]),
		);

	/** Größte Abweichung, die eine einzelne Partei hatte, in Prozentpunkten. */
	const groesster = (
		schaetzung: Map<string, number>,
		wahrheit: Map<string, number>,
	): number => {
		const a = anteile(schaetzung);
		const b = anteile(wahrheit);
		let m = 0;
		for (const k of new Set([...a.keys(), ...b.keys()]))
			m = Math.max(m, Math.abs((a.get(k) ?? 0) - (b.get(k) ?? 0)));
		return m;
	};

	type Messwert = { p99: number; maxPP: number; maxSitze: number };

	const messe = (n: number, fortschreibung = false): Messwert => {
		const pp: number[] = [];
		let maxSitze = 0;
		for (const [wahl, vorwahl] of [
			[GEMEINDEWAHL, KREISWAHL],
			[KREISWAHL, GEMEINDEWAHL],
		] as const) {
			const aktuell = bezirkeVon(wahl);
			const vorwerte = zuordnung(aktuell, bezirkeVon(vorwahl));
			const ende = gesamtStimmen(aktuell);
			const richtig = sitzeVon(ende);
			for (const folge of vieleVerlaeufe(aktuell)) {
				const fertig = new Set(folge.slice(0, n).map((b) => b.id));
				const schaetzung = fortschreibung
					? gesamtStimmen(aktuell.filter((b) => fertig.has(b.id)))
					: rechneHoch(stand(aktuell, vorwerte, fertig))?.stimmen;
				if (!schaetzung) continue;
				pp.push(groesster(schaetzung, ende));
				const g = sitzeVon(schaetzung);
				let falsch = 0;
				for (const k of new Set([...richtig.keys(), ...g.keys()]))
					falsch += Math.abs((richtig.get(k) ?? 0) - (g.get(k) ?? 0));
				maxSitze = Math.max(maxSitze, falsch / 2);
			}
		}
		pp.sort((a, b) => a - b);
		return {
			p99: pp[Math.floor(0.99 * pp.length)],
			maxPP: pp[pp.length - 1],
			maxSitze,
		};
	};

	it("stuft die Fortschreibung immer als hoch ein", () => {
		expect(unsicherheit(1, 23, true)).toBe("hoch");
		expect(unsicherheit(12, 23, true)).toBe("hoch");
		expect(unsicherheit(22, 23, true)).toBe("hoch");
		expect(unsicherheit(5, 0, false)).toBe("hoch");
	});

	it("stuft nach dem Anteil der erwarteten Schnellmeldungen ein", () => {
		expect(unsicherheit(8, 23, false)).toBe("hoch"); // 0,35
		expect(unsicherheit(9, 23, false)).toBe("mittel"); // 0,39
		expect(unsicherheit(15, 23, false)).toBe("mittel"); // 0,65
		expect(unsicherheit(16, 23, false)).toBe("niedrig"); // 0,70
		expect(unsicherheit(150, 426, false)).toBe("hoch"); // 0,35
		expect(unsicherheit(170, 426, false)).toBe("mittel"); // 0,40
		expect(unsicherheit(300, 426, false)).toBe("niedrig"); // 0,70
	});

	it("legt die Grenze hoch/mittel dorthin, wo der dritte Sitz aufhört", () => {
		expect(8 / 23).toBeLessThan(MITTEL_AB);
		expect(9 / 23).toBeGreaterThan(MITTEL_AB);
		const vorher = messe(8);
		const nachher = messe(9);
		expect(vorher.maxSitze).toBeGreaterThanOrEqual(3);
		expect(nachher.maxSitze).toBeLessThanOrEqual(2);
		expect(vorher.maxPP).toBeGreaterThan(4);
		expect(nachher.maxPP).toBeLessThan(4);
		expect(nachher.p99).toBeLessThan(vorher.p99);
	});

	it("legt die Grenze mittel/niedrig dorthin, wo der zweite Sitz aufhört", () => {
		expect(15 / 23).toBeLessThan(NIEDRIG_AB);
		expect(16 / 23).toBeGreaterThan(NIEDRIG_AB);
		const vorher = messe(15);
		const nachher = messe(16);
		expect(vorher.maxSitze).toBe(2);
		expect(nachher.maxSitze).toBeLessThanOrEqual(1);
		expect(nachher.maxPP).toBeLessThan(2.5);
	});

	it("belegt, warum die Fortschreibung nie besser als hoch wird", () => {
		const hoch = messe(16);
		const fort = messe(16, true);
		expect(hoch.maxSitze).toBe(1);
		expect(fort.maxSitze).toBeGreaterThanOrEqual(2);
		expect(fort.p99).toBeGreaterThan(2 * hoch.p99);
		expect(messe(20, true).maxSitze).toBeGreaterThanOrEqual(2);
	});
});
