/**
 * Der Demo-Wahlabend über den ganzen Weg: Vorlage aus den Archivzahlen,
 * Bezirke tröpfeln herein, und am Ende steht das vollständige Bild.
 *
 * Geprüft wird, was die Generalprobe leisten soll – dass sie den echten Abend
 * nachstellt und nicht bloß Zahlen hinschreibt: Der Auszählstand wächst, der
 * Ticker füllt sich, die Anwendung rechnet unterwegs hoch.
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

const DEMO = "03254026";
const KREIS = "03254000";

const spiele = async (fortschritt: number, zyklusNummer = 7) => {
	const { oeffneDb } = await import("../src/lib/db.ts");
	const { baueVorlage, legeWahlenAn, raeumeDemoTermin, spieleStand } =
		await import("../src/lib/demo-abend.ts");
	const { kreisBySlug } = await import("../src/data/kreise.ts");
	const { terminById } = await import("../src/data/termine.ts");
	const db = oeffneDb();
	const kreis = kreisBySlug("hildesheim")!;
	const termin = terminById("2026")!;
	const behoerde = kreis.behoerden.find((b) => b.ags === DEMO)!;
	const wahlen = baueVorlage(db, kreis, termin, behoerde);
	raeumeDemoTermin(db, termin, behoerde, wahlen);
	legeWahlenAn(db, termin, behoerde, wahlen);
	// Ein Durchlauf, der irgendwann begonnen hat: Die Zeitstempel der Ergebnisse
	// hängen an seinem Zeitplan (eingangsZeit in demo.ts). Der Fortschritt wird
	// dann von Hand gesetzt – der Test will jede Stelle des Abends anfahren
	// können, ohne die Uhr zu stellen.
	const { zyklusVon } = await import("../src/lib/demo.ts");
	const beginn = Date.UTC(2026, 8, 13, 16, 0, 0);
	const geaendert = spieleStand(db, termin, behoerde, wahlen, {
		...zyklusVon(beginn, 600, beginn),
		nummer: zyklusNummer,
		fortschritt,
	});
	return { kreis, termin, behoerde, wahlen, geaendert };
};

/** Auszählstand einer Wahl am Zieltermin, in Schnellmeldungen. */
const standVon = async (
	behoerdeAgs: string,
	wahlId: number,
	gebietId: string,
) => {
	const { oeffneDb } = await import("../src/lib/db.ts");
	return oeffneDb()
		.prepare(
			"SELECT stand_anz, stand_max FROM ergebnisse WHERE termin = '2026' AND behoerde = ? AND wahl_id = ? AND gebiet_id = ?",
		)
		.get(behoerdeAgs, wahlId, gebietId) as
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
	// Die Vorlage: die Archivtermine, aus denen die Demo schöpft. Die
	// Kreisbehörde gehört dazu – Kreistag und Landrat führt nur sie, und der
	// Kreiswahlbereich steht ausschließlich dort.
	// 2026 gehört dazu: Die Ämter des Zieltermins geben vor, was die Probe
	// nachspielt – ohne sie wüsste sie nicht, was gewählt wird.
	for (const id of ["2026", "2021", "2020"])
		await pollTermin(oeffneDb(), terminById(id)!, {
			nurBehoerden: [DEMO, KREIS],
		});
});

afterAll(async () => {
	const { schliesseDb } = await import("../src/lib/db.ts");
	schliesseDb();
	await mock.schliessen();
	aufraeumen(tmp);
});

describe("Vorlage", () => {
	it("nimmt je Amt die jüngste frühere Wahl derselben Wahlleitung", async () => {
		const { wahlen } = await spiele(0);
		const { erkenneWahltyp } = await import("../src/lib/wahltyp.ts");
		const typen = wahlen.map((w) => erkenneWahltyp(w.titel));
		// Rat, Ortsräte und die kreisweiten Wahlen kommen aus 2021 …
		expect(typen).toContain("rat");
		expect(typen).toContain("ortsrat");
		expect(typen).toContain("kreistag");
		// … die Bürgermeisterwahl aus 2020, denn 2021 gab es in Nordstemmen
		// keine. Genau dafür ist die Suche über mehrere Termine da.
		expect(typen).toContain("buergermeister");
		// Ein Amt ist Wahlart **und** Gebiet: Der Rat kommt einmal vor, die
		// Ortsräte je Ortschaft einmal. Nach der Wahlart allein gezählt, blieb
		// von neun Ortsräten einer übrig.
		const aemter = wahlen.map(
			(w) => `${erkenneWahltyp(w.titel)}|${w.gebietTitel}`,
		);
		expect(new Set(aemter).size).toBe(aemter.length);
		expect(typen.filter((t) => t === "ortsrat").length).toBeGreaterThan(1);
		// Stichwahlen spielt die Generalprobe nicht mit: Der Vorwert führt sie
		// mit, auch wo nie eine stattgefunden hat – ob es dazu kommt,
		// entscheidet sich am Wahltag.
		expect(typen.some((t) => t.endsWith("-stichwahl"))).toBe(false);
	});

	it("richtet sich nach den Ämtern des Zieltermins, nicht nach denen von damals", async () => {
		// Was 2026 gewählt wird, ist bekannt: Die Wahlleitungen haben ihre
		// Präsentationen angelegt. Im Landkreis Hildesheim sind es 146 Wahlen,
		// darunter 13 Bürgermeisterwahlen – Alfeld und die Stadt Hildesheim
		// wählen diesmal keinen. Andersherum gedacht (Ämter von 2021, Zahlen
		// von 2021) stünde dort eine Wahl auf der Leinwand, die es nicht gibt.
		const { oeffneDb } = await import("../src/lib/db.ts");
		const { aemterAmZiel, baueVorlage } = await import(
			"../src/lib/demo-abend.ts"
		);
		const { kreisBySlug } = await import("../src/data/kreise.ts");
		const { terminById } = await import("../src/data/termine.ts");
		const { erkenneWahltyp } = await import("../src/lib/wahltyp.ts");
		const db = oeffneDb();
		const kreis = kreisBySlug("hildesheim")!;
		const termin = terminById("2026")!;
		const behoerde = kreis.behoerden.find((b) => b.ags === DEMO)!;

		const aemter = aemterAmZiel(db, termin, behoerde);
		const wahlen = baueVorlage(db, kreis, termin, behoerde);
		// Kein Amt zu viel: Die Probe spielt höchstens, was 2026 geführt wird.
		expect(wahlen.length).toBeLessThanOrEqual(aemter.size);
		// Und die Bürgermeisterwahl ist dabei – ihre Zahlen kommen aus 2020,
		// weil es 2021 in Nordstemmen keine gab.
		expect(wahlen.map((w) => erkenneWahltyp(w.titel))).toContain(
			"buergermeister",
		);
	});

	it("kennt zu jeder Wahl ihre Auszähleinheiten", async () => {
		const { wahlen } = await spiele(0);
		for (const w of wahlen) expect(w.bausteine.length).toBeGreaterThan(0);
	});

	it("gibt jedem Ortsrat die Wahlbezirke seiner Ortschaft und keine fremden", async () => {
		// Die Quelle führte 2021 alle neun Ortsräte Nordstemmens unter einer
		// Wahl-Id. Die Regel „das Wahlgebiet ist die Summe aller Einheiten" gab
		// daraufhin jedem einzelnen Ortsrat alle 22 Wahlbezirke der Gemeinde –
		// auf der Folie stand für Rössing eine 22, wo drei hingehören. Die
		// Zuordnung kommt jetzt aus den Untergebieten der Ortschaft.
		//
		// Deshalb steht hier auch keine 1 mehr in der Erwartung oben: Mahlerten
		// hat genau einen Wahlbezirk, und das ist die Wahrheit über Mahlerten.
		const { wahlen } = await spiele(0);
		const { erkenneWahltyp } = await import("../src/lib/wahltyp.ts");
		const ortsraete = new Map(
			wahlen
				.filter((w) => erkenneWahltyp(w.titel) === "ortsrat")
				.map((w) => [w.gebietTitel.trim(), w]),
		);
		expect(ortsraete.size).toBe(9);
		expect(ortsraete.get("Rössing")?.bausteine.length).toBe(3);
		expect(ortsraete.get("Mahlerten")?.bausteine.length).toBe(1);
		expect(ortsraete.get("Nordstemmen")?.bausteine.length).toBe(6);
		for (const w of ortsraete.values()) {
			// Nur das eigene Gebiet, und das besteht aus den eigenen Einheiten.
			expect(w.gebiete.map((g) => g.gebietId)).toEqual([w.gebietId]);
			expect(w.gebiete[0].meldungen).toBe(w.bausteine.length);
		}
		// Zusammen sind es die Wahlbezirke der Gemeinde – der Rat zählt 23,
		// davon liegt einer (die gemeindeweite Briefwahl) in keiner Ortschaft.
		const rat = wahlen.find((w) => erkenneWahltyp(w.titel) === "rat");
		expect(rat?.bausteine.length).toBe(23);
		const summe = [...ortsraete.values()].reduce(
			(n, w) => n + w.bausteine.length,
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
		// Die Folien stehen alle da – nur eben ohne Zahlen. Das ist der
		// Zustand, den man am Abend als Erstes sieht.
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
		// Kein amtliches Ergebnis, solange gezählt wird – und ab der Schwelle
		// eine Hochrechnung mit Einstufung.
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
					.get("2026") as { n: number }
			).n;
		await spiele(0.2, 11);
		const vorher = zaehle();
		await spiele(0.6, 11);
		expect(zaehle()).toBeGreaterThan(vorher);
	});

	it("weicht von der Vorlage ab, damit sich etwas bewegt", async () => {
		// Ohne Rauschen stünde in jeder Veränderungsspalte „±0,0“ und jeder
		// Durchlauf sähe aus wie der vorige.
		const { kreis, termin, behoerde } = await spiele(1, 3);
		const { wahlKern } = await import("../src/lib/seite.ts");
		const { wahleintraege } = await import("../src/lib/abfragen.ts");
		const rat = wahleintraege(termin.id, behoerde.ags).find(
			(w) => w.typ === "rat",
		)!;
		const m = wahlKern(kreis, termin, behoerde, rat.slug)!;
		const diffs = m.balken.map((b) => b.diff).filter((d) => d !== undefined);
		expect(diffs.length).toBeGreaterThan(0);
		expect(diffs.some((d) => Math.abs(d) > 0.05)).toBe(true);
	});
});

describe("Die Meldungen tröpfeln", () => {
	it("lässt die Wahlen einer Wahlleitung nicht im Gleichschritt vorrücken", async () => {
		// Vorher wurden die Einheiten gemischt und bei `fortschritt · Anzahl`
		// abgeschnitten: Jede Wahl stand damit im selben Augenblick bei
		// demselben Anteil, und weil der Takt die Wahlleitungen reihum bedient,
		// sprang eine beim Drankommen gleich um mehrere Einheiten. Auf der
		// Leinwand hieß das: Stille, dann ein Schwall.
		const { behoerde, wahlen } = await spiele(0.5, 21);
		// Verglichen werden Wahlen mit **gleich vielen** Einheiten: Im
		// Gleichschritt stünden die zwangsläufig bei derselben Zahl, denn die
		// hing allein an Fortschritt und Anzahl.
		const jeGroesse = new Map<number, Set<number>>();
		for (const w of wahlen) {
			const s = await standVon(behoerde.ags, w.wahlId, w.gebietId);
			if (s?.stand_anz == null) continue;
			const menge = jeGroesse.get(w.bausteine.length) ?? new Set<number>();
			menge.add(s.stand_anz);
			jeGroesse.set(w.bausteine.length, menge);
		}
		expect(jeGroesse.size).toBeGreaterThan(0);
		expect([...jeGroesse.values()].some((m) => m.size > 1)).toBe(true);
	});

	it("kommt in Klumpen und Lücken herein, nicht gleichmäßig", async () => {
		// Der Abend eines einzelnen Amtes, in Schritten abgefahren: Manche
		// Schritte bringen mehrere Einheiten, andere gar keine. Gleichmäßig
		// verteilt käme in jedem Schritt (fast) dieselbe Zahl.
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
		expect(staende[staende.length - 1]).toBe(rat.bausteine.length);
		// Nicht jeder Schritt gleich groß – und mindestens einer deutlich über
		// dem gleichmäßigen Mittel.
		expect(new Set(schritte).size).toBeGreaterThan(2);
		expect(Math.max(...schritte)).toBeGreaterThan(
			rat.bausteine.length / schritte.length,
		);
	});

	it("bleibt zustandslos: derselbe Augenblick, derselbe Stand", async () => {
		// Zwei Anfragen im selben Moment müssen denselben Abend sehen – und ein
		// zweiter Aufruf darf nichts Neues schreiben, sonst liefe der Ticker
		// über. Geprüft ohne das Aufräumen aus `spiele`: Der zweite Aufruf soll
		// auf den Stand des ersten treffen, so wie im Takt des Pollers.
		//
		// Der Durchlauf liegt dafür in der **Vergangenheit** und ist mit seiner
		// Nummer stimmig (so, wie `zyklusVon` ihn liefert): Nur dann greift die
		// Abkürzung in `spieleStand`, die an der Schreibzeit erkennt, dass eine
		// Zeile aus diesem Durchlauf stammt.
		const { baueVorlage, spieleStand } = await import(
			"../src/lib/demo-abend.ts"
		);
		const { zyklusVon } = await import("../src/lib/demo.ts");
		const { oeffneDb } = await import("../src/lib/db.ts");
		const { kreisBySlug } = await import("../src/data/kreise.ts");
		const { terminById } = await import("../src/data/termine.ts");
		const db = oeffneDb();
		const kreis = kreisBySlug("hildesheim")!;
		const termin = terminById("2026")!;
		const behoerde = kreis.behoerden.find((b) => b.ags === DEMO)!;
		const wahlen = baueVorlage(db, kreis, termin, behoerde);
		const { raeumeDemoTermin, legeWahlenAn } = await import(
			"../src/lib/demo-abend.ts"
		);
		raeumeDemoTermin(db, termin, behoerde, wahlen);
		legeWahlenAn(db, termin, behoerde, wahlen);
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
		// Und eine frisch gebaute Vorlage führt zum selben Ergebnis – der Abend
		// hängt an der Uhr, nicht an dem, was ein Prozess sich gemerkt hat.
		const frisch = baueVorlage(db, kreis, termin, behoerde);
		expect(spieleStand(db, termin, behoerde, frisch, zyklus)).toBe(0);
		// Der nächste Durchlauf dagegen bringt neues Rauschen – gleicher
		// Auszählstand hin oder her, hier darf nichts übersprungen werden.
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
		// Der Wahlbereich B umfasst Elze und Nordstemmen – nicht den Kreis. Auf
		// der Leinwand steht dort, wer aus *dieser* Gegend in den Kreistag
		// kommt; die Namen und Stimmen müssen deshalb aus diesen Gemeinden
		// stammen. Vorher fiel die Simulation für dieses Gebiet auf „alle
		// Bausteine" zurück, und die Folie zeigte kreisweite Bewerber mit
		// kreisweiten Stimmen – plausibel aussehend und komplett falsch.
		const { oeffneDb } = await import("../src/lib/db.ts");
		const { baueVorlage } = await import("../src/lib/demo-abend.ts");
		const { kreisBySlug } = await import("../src/data/kreise.ts");
		const { terminById } = await import("../src/data/termine.ts");
		const db = oeffneDb();
		const kreis = kreisBySlug("hildesheim")!;
		const termin = terminById("2026")!;
		const kreisBehoerde = kreis.behoerden.find((b) => b.ags === kreis.ags)!;
		const wahlen = baueVorlage(db, kreis, termin, kreisBehoerde);
		const { erkenneWahltyp } = await import("../src/lib/wahltyp.ts");
		// „Kreiswahl – Landkreis Hildesheim" heißt sie in der Quelle; die Art
		// erkennt die Anwendung, der Titel wechselt je Wahlleitung.
		const kreistag = wahlen.find((w) => erkenneWahltyp(w.titel) === "kreistag");
		if (!kreistag)
			throw new Error(
				`Kreistagswahl fehlt in der Vorlage (gefunden: ${wahlen.map((w) => w.titel).join(", ") || "nichts"})`,
			);

		const bereich = kreistag.gebiete.find((g) => /^B$/.test(g.titel.trim()));
		if (!bereich) throw new Error("Wahlbereich B fehlt in der Vorlage");
		// Das Gesamtgebiet zählt alle Einheiten – der Wahlbereich nur seine.
		expect(bereich.bausteinIds.size).toBeGreaterThan(0);
		expect(bereich.bausteinIds.size).toBeLessThan(kreistag.bausteine.length);
	});

	it("zählt Schnellmeldungen und nicht Gebietszeilen", async () => {
		// Beim Kreistag führt die Kreisbehörde keine Wahlbezirke: Ihre
		// Auszähleinheiten sind die Gemeinden. „4 von 18" wäre für einen Kreis
		// mit 426 Schnellmeldungen trotzdem eine sinnlose Zahl – und für den
		// Wahlbereich B (Elze und Nordstemmen zusammen 37) genauso.
		const { oeffneDb } = await import("../src/lib/db.ts");
		const { alleErgebnisse } = await import("../src/lib/abfragen.ts");
		const { baueVorlage, legeWahlenAn, raeumeDemoTermin, spieleStand } =
			await import("../src/lib/demo-abend.ts");
		const { zyklusVon } = await import("../src/lib/demo.ts");
		const { kreisBySlug } = await import("../src/data/kreise.ts");
		const { terminById } = await import("../src/data/termine.ts");
		const { erkenneWahltyp } = await import("../src/lib/wahltyp.ts");
		const db = oeffneDb();
		const kreis = kreisBySlug("hildesheim")!;
		const termin = terminById("2026")!;
		const behoerde = kreis.behoerden.find((b) => b.ags === KREIS)!;
		const wahlen = baueVorlage(db, kreis, termin, behoerde);
		raeumeDemoTermin(db, termin, behoerde, wahlen);
		legeWahlenAn(db, termin, behoerde, wahlen);
		const beginn = Date.UTC(2026, 8, 13, 16, 0, 0);
		spieleStand(db, termin, behoerde, wahlen, {
			...zyklusVon(beginn, 600, beginn),
			nummer: 3,
			fortschritt: 1,
		});

		const kreistag = wahlen.find(
			(w) => erkenneWahltyp(w.titel) === "kreistag",
		)!;
		const zeilen = alleErgebnisse(termin.id, KREIS, kreistag.wahlId);
		const gesamt = zeilen.find((z) => z.gebietId === kreistag.gebietId);
		const bereich = zeilen.find((z) => /^B$/.test(z.titel.trim()));
		// Der ganze Kreis: dreistellig, nicht 18. Der Wahlbereich: ein Bruchteil
		// davon, aber deutlich mehr als seine zwei Gemeinden.
		expect(gesamt?.ergebnis.stand.max ?? 0).toBeGreaterThan(100);
		expect(bereich?.ergebnis.stand.max ?? 0).toBeGreaterThan(20);
		expect(bereich?.ergebnis.stand.max ?? 0).toBeLessThan(
			gesamt?.ergebnis.stand.max ?? 0,
		);
		// Vollständig ausgezählt heißt: alle Schnellmeldungen da.
		expect(gesamt?.ergebnis.stand.anz).toBe(gesamt?.ergebnis.stand.max);
	});
});
