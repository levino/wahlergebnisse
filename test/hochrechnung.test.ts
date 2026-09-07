/**
 * Hochrechnung, geprüft an den echten Wahlbezirksergebnissen der Kommunalwahl
 * 2021 in Nordstemmen (23 Wahlbezirke: 15 Urnen-, 8 Briefwahlbezirke).
 *
 * Ein Paar aus zwei echten Wahlen: Für die eine Wahl gilt die andere als
 * „Vorwahl“. Gemeindewahl und Kreiswahl fanden am selben Tag in denselben
 * Wahlbezirken statt, unterscheiden sich in den Stimmenanteilen aber deutlich
 * (Die Unabhängigen 10,2 % zu 4,9 %) – und in der einen Richtung treten AfD
 * und Piraten als Parteien ohne Vorwert auf. Damit lässt sich messen, was die
 * Rechnung taugt, ohne Zahlen zu erfinden.
 */
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIXTURES, aufraeumen, tempVerzeichnis } from "./helfer.ts";
import {
	type MockVotemanager,
	starteMockVotemanager,
} from "./mock-votemanager.ts";
import {
	MINDEST_MELDUNGEN,
	type Einheit,
	istBriefwahl,
	ordneZu,
	rechneHoch,
	schwelle,
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
		// Kreistagswahl 2021: 426 Wahlbezirke
		expect(schwelle(426)).toBe(86);
		expect(schwelle(125)).toBe(25);
	});

	it("verlangt mindestens fünf Meldungen, auch bei kleinen Wahlen", () => {
		// Ein Fünftel von 23 wären 5 – der Boden bindet hier nicht
		expect(schwelle(23)).toBe(5);
		// Ein Fünftel von 12 wären 3; so wenige tragen keine Rechnung
		expect(schwelle(12)).toBe(5);
	});

	it("verlangt bei winzigen Wahlgebieten alle Meldungen", () => {
		// Ortsrat mit zwei bis fünf Wahlbezirken: erst zum Schluss Sitze
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
			// So etwas passiert real: Das Wahllokal zieht um, die Nummer bleibt.
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

describe("rechneHoch – Güte gegenüber dem rohen Zwischenstand", () => {
	// Beide Richtungen des Wahlpaars; in der zweiten sind AfD und Piraten
	// Parteien ohne Vorwert.
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
			// Im Mittel mindestens ein Drittel besser …
			expect(gesamtHoch / laeufe).toBeLessThan((gesamtRoh / laeufe) * 0.67);
			// … und auch im schlechtesten Lauf nicht schlechter …
			expect(schlimmsterHoch).toBeLessThan(schlimmsterRoh);
			// … und in der großen Mehrheit der Einzelläufe im Vorteil.
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
		// Bei 5 von 23 Wahlbezirken höchstens zwei der 30 Sitze anders vergeben
		// (roher Zwischenstand: bis zu vier).
		expect(schlimmster).toBeLessThanOrEqual(2);
	});
});

describe("rechneHoch – die Fallstricke", () => {
	it("behält das eigene Profil der Briefwahlbezirke, wenn sie noch fehlen", () => {
		// Realer Wahlabend: alle Urnenbezirke sind ausgezählt, die Briefwahl
		// meldet zuletzt. In Nordstemmen wählt die Briefwahl deutlich anders –
		// CDU 32,4 % gegenüber 28,6 % an der Urne.
		const aktuell = bezirkeVon(GEMEINDEWAHL);
		const vorwerte = zuordnung(aktuell, bezirkeVon(KREISWAHL));
		const urne = aktuell.filter((b) => !istBriefwahl(b.name));
		const fertig = new Set(urne.map((b) => b.id));
		const hr = rechneHoch(stand(aktuell, vorwerte, fertig))!;
		expect(hr.briefwahlGetrennt).toBe(false);

		const ende = anteile(gesamtStimmen(aktuell));
		const nurUrne = anteile(gesamtStimmen(urne));
		const geschaetzt = anteile(hr.stimmen);
		// Die Schätzung liegt für die CDU näher am Endergebnis als der reine
		// Urnenstand – das Briefwahlprofil ist berücksichtigt.
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
		// Vorwahl Gemeindewahl → AfD und Piraten haben keinen Vorwert.
		const aktuell = bezirkeVon(KREISWAHL);
		const vorwerte = zuordnung(aktuell, bezirkeVon(GEMEINDEWAHL));
		const ende = gesamtStimmen(aktuell);
		const endAnteile = anteile(ende);
		for (const folge of verlaeufe(aktuell)) {
			const fertig = new Set(folge.slice(0, 8).map((b) => b.id));
			const hr = rechneHoch(stand(aktuell, vorwerte, fertig))!;
			// Die Gesamtstimmenzahl bleibt in einem plausiblen Rahmen …
			expect(summe(hr.stimmen)).toBeGreaterThan(summe(ende) * 0.85);
			expect(summe(hr.stimmen)).toBeLessThan(summe(ende) * 1.15);
			// … und die Partei ohne Vorwert bekommt einen brauchbaren Anteil
			// statt null oder einem Vielfachen.
			const afd = anteile(hr.stimmen).get("afd") ?? 0;
			expect(afd).toBeGreaterThan(endAnteile.get("afd")! / 2);
			expect(afd).toBeLessThan(endAnteile.get("afd")! * 2);
		}
	});

	it("verkraftet Wahlbezirke ohne Vorwert (Gebietsänderung)", () => {
		const aktuell = bezirkeVon(GEMEINDEWAHL);
		const vorwerte = zuordnung(aktuell, bezirkeVon(KREISWAHL));
		// Drei Bezirke gab es 2021 so nicht – sie sind neu zugeschnitten.
		for (const b of aktuell.slice(0, 3)) vorwerte.delete(b.id);
		const ende = gesamtStimmen(aktuell);
		const fertig = new Set(aktuell.slice(0, 8).map((b) => b.id));
		const hr = rechneHoch(stand(aktuell, vorwerte, fertig))!;
		expect(hr).toBeDefined();
		expect(summe(hr.stimmen)).toBeGreaterThan(summe(ende) * 0.8);
		expect(summe(hr.stimmen)).toBeLessThan(summe(ende) * 1.2);
		// Auch mit Lücken noch besser als der rohe Zwischenstand
		expect(fehler(hr.stimmen, ende)).toBeLessThan(
			fehler(gesamtStimmen(aktuell.filter((b) => fertig.has(b.id))), ende),
		);
	});

	it("lehnt eine Vergleichswahl ab, deren Parteien nicht passen", () => {
		// Die Landratswahl ist eine Personenwahl: Dort stehen Bewerber, keine
		// Listen. Als Vorlage taugt sie nicht – dann lieber gar nicht rechnen
		// und den Zwischenstand als solchen ausweisen.
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
		// Die fünf kleinsten Bezirke sind ein Fünftel der Bezirke, aber viel
		// weniger als ein Fünftel der Stimmen.
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
