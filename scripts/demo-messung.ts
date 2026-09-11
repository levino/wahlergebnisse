/**
 * Was die Generalprobe kostet – gemessen statt behauptet.
 *
 *   node --experimental-strip-types --expose-gc scripts/demo-messung.ts
 *   node --experimental-strip-types --expose-gc scripts/demo-messung.ts --runden 10
 *   node --experimental-strip-types --expose-gc scripts/demo-messung.ts --kreis region-hannover
 *
 * Gemessen wird an einer echten Datenbank, gefüllt wie in den Tests:
 * Mock-votemanager auf die Fixtures, dann `pollTermin` für 2026, 2021 und
 * 2020. Damit ein ganzer Kreis zu messen ist und nicht leere Ordner, bekommt
 * jede Wahlleitung des Kreises die Hildesheimer Dateien (`demoKreisFixtures`
 * in test/helfer.ts).
 *
 * Ausgegeben werden je Fall: Vorlagenbau, ein Takt (`spieleStand`), ein Takt
 * ohne Änderung und der Speicher, den die Vorlagen halten. Ohne `--expose-gc`
 * ist die Speicherzeile wertlos.
 *
 * Das Skript schreibt nur in ein temporäres Verzeichnis und fragt nichts im
 * Netz ab.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Behoerde } from "../src/data/behoerden.ts";
import { kreisBySlug } from "../src/data/kreise.ts";
import type { Kreis } from "../src/data/kreise.ts";
import { terminById } from "../src/data/termine.ts";
import type { Termin } from "../src/data/termine.ts";
import { oeffneDb, schliesseDb } from "../src/lib/db.ts";
import {
	type DemoWahl,
	baueVorlage,
	legeWahlenAn,
	raeumeDemoTermin,
	spieleStand,
} from "../src/lib/demo-abend.ts";
import { zyklusVon } from "../src/lib/demo.ts";
import { pollTermin } from "../src/lib/poll.ts";
import { demoKreisFixtures } from "../test/helfer.ts";
import { starteMockVotemanager } from "../test/mock-votemanager.ts";

const zahl = (name: string, vorgabe: number): number => {
	const i = process.argv.indexOf(`--${name}`);
	if (i < 0) return vorgabe;
	const n = Number.parseInt(process.argv[i + 1] ?? "", 10);
	return Number.isFinite(n) && n > 0 ? n : vorgabe;
};

const RUNDEN = zahl("runden", 5);

/** Der Kreis, an dem gemessen wird (`--kreis region-hannover`). */
const KREIS_SLUG =
	process.argv[process.argv.indexOf("--kreis") + 1]?.startsWith("-") ===
		false && process.argv.includes("--kreis")
		? process.argv[process.argv.indexOf("--kreis") + 1]
		: "hildesheim";

/** Speicherstand nach dem Aufräumen. */
const gc = (globalThis as { gc?: () => void }).gc;
const heap = (): number => {
	gc?.();
	gc?.();
	return process.memoryUsage().heapUsed;
};

const mb = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(2)} MB`;
const ms = (n: number): string => `${n.toFixed(1)} ms`;

/** Median statt Mittelwert: Ein einzelner Ausreißer soll die Zahl nicht tragen. */
const median = (werte: number[]): number => {
	const s = [...werte].sort((a, b) => a - b);
	return s.length % 2
		? s[(s.length - 1) / 2]
		: (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

const dauer = <T>(fn: () => T): [T, number] => {
	const t0 = performance.now();
	const r = fn();
	return [r, performance.now() - t0];
};

type Fall = {
	name: string;
	kreis: Kreis;
	termin: Termin;
	behoerden: Behoerde[];
};

const messe = (fall: Fall): void => {
	const db = oeffneDb();
	// Einmal vorbereiten wie der Poller beim ersten Takt – gehört nicht in die
	// Messung.
	const vorbereitet = fall.behoerden.map((behoerde) => {
		const wahlen = baueVorlage(db, fall.kreis, fall.termin, behoerde);
		if (wahlen.length > 0) {
			raeumeDemoTermin(db, fall.termin, behoerde, wahlen);
			legeWahlenAn(db, fall.termin, behoerde, wahlen);
		}
		return { behoerde, wahlen };
	});
	const mitInhalt = vorbereitet.filter((v) => v.wahlen.length > 0);
	const aemter = mitInhalt.reduce((n, v) => n + v.wahlen.length, 0);
	const lokale = mitInhalt.reduce(
		(n, v) => n + v.wahlen.reduce((m, w) => m + w.lokale.length, 0),
		0,
	);
	const zeilen = mitInhalt.reduce(
		(n, v) => n + v.wahlen.reduce((m, w) => m + w.zeilen.length, 0),
		0,
	);

	// Vorlagenbau
	const bauZeiten: number[] = [];
	for (let i = 0; i < RUNDEN; i++) {
		const [, t] = dauer(() => {
			for (const { behoerde } of vorbereitet)
				baueVorlage(db, fall.kreis, fall.termin, behoerde);
		});
		bauZeiten.push(t);
	}

	// Speicher: was die Vorlagen halten, wenn man sie behält.
	const vorher = heap();
	const gehalten: DemoWahl[][] = vorbereitet.map(({ behoerde }) =>
		baueVorlage(db, fall.kreis, fall.termin, behoerde),
	);
	const nachher = heap();
	// Referenz bis nach der Messung halten, sonst räumt der Sammler sie weg.
	const behalten = gehalten.reduce((n, w) => n + w.length, 0);

	// Ein Takt mitten im Abend, in einem Durchlauf, der vor fünf Minuten
	// begonnen hat: `spieleStand` erkennt an der Schreibzeit, ob eine Zeile aus
	// diesem Durchlauf stammt, und mit einem Nullpunkt in der Zukunft käme diese
	// Abkürzung nie zum Zug.
	const nullpunkt = Date.now() - 100 * 600_000 - 300_000;
	const grundZyklus = zyklusVon(Date.now(), 600, nullpunkt);
	const taktZeiten: number[] = [];
	let geaendert = 0;
	for (let i = 0; i < RUNDEN; i++) {
		const zyklus = { ...grundZyklus, nummer: 100, fortschritt: 0.3 + i * 0.02 };
		const [n, t] = dauer(() => {
			let g = 0;
			for (const { behoerde, wahlen } of mitInhalt)
				g += spieleStand(db, fall.termin, behoerde, wahlen, zyklus);
			return g;
		});
		taktZeiten.push(t);
		if (i > 0) geaendert += n;
	}
	// Und derselbe Takt noch einmal, ohne dass sich etwas geändert hat: was
	// allein das Nachsehen kostet.
	const stillZyklus = {
		...grundZyklus,
		nummer: 100,
		fortschritt: 0.3 + (RUNDEN - 1) * 0.02,
	};
	const stillZeiten: number[] = [];
	for (let i = 0; i < RUNDEN; i++) {
		const [, t] = dauer(() => {
			for (const { behoerde, wahlen } of mitInhalt)
				spieleStand(db, fall.termin, behoerde, wahlen, stillZyklus);
		});
		stillZeiten.push(t);
	}

	console.log(`\n## ${fall.name}`);
	console.log(
		`   ${mitInhalt.length} Wahlleitung(en) mit Inhalt, ${aemter} Ämter, ${lokale} Wahllokale, ${zeilen} Ergebniszeilen je Takt (${behalten} Ämter gehalten)`,
	);
	console.log(
		`   Vorlagenbau  Median ${ms(median(bauZeiten))}   Spanne ${ms(Math.min(...bauZeiten))} … ${ms(Math.max(...bauZeiten))}`,
	);
	console.log(
		`   Takt         Median ${ms(median(taktZeiten))}   Spanne ${ms(Math.min(...taktZeiten))} … ${ms(Math.max(...taktZeiten))}   (${Math.round(geaendert / Math.max(1, RUNDEN - 1))} geänderte Zeilen je Takt)`,
	);
	console.log(`   Takt ohne Änderung  Median ${ms(median(stillZeiten))}`);
	console.log(
		`   Vorlagen im Speicher  ${mb(nachher - vorher)}${gc ? "" : "  (ohne --expose-gc unbrauchbar)"}`,
	);
	if (aemter > 0)
		console.log(
			`   Hochgerechnet auf 400 Wahlleitungen dieser Größe: ${mb(((nachher - vorher) / Math.max(1, mitInhalt.length)) * 400)}`,
		);
};

const main = async (): Promise<void> => {
	if (!gc)
		console.warn(
			"Hinweis: ohne --expose-gc sind die Speicherzahlen nicht belastbar.",
		);
	const tmp = mkdtempSync(join(tmpdir(), "demo-messung-"));
	const kreis = kreisBySlug(KREIS_SLUG);
	if (!kreis) throw new Error(`Unbekannter Kreis: ${KREIS_SLUG}`);
	const mock = await starteMockVotemanager(
		demoKreisFixtures(join(tmp, "votemanager"), [kreis.slug]),
	);
	process.env.VOTEMANAGER_BASIS = mock.url;
	process.env.DATABASE_PATH = join(tmp, "wahlen.db");
	try {
		const db = oeffneDb();
		const t0 = performance.now();
		for (const id of ["2026", "2021", "2020"])
			await pollTermin(db, terminById(id)!, {
				nurBehoerden: kreis.behoerden.map((b) => b.ags),
			});
		console.log(
			`Kreis ${kreis.slug}: Datenbank gefüllt in ${ms(performance.now() - t0)} (${mock.anfragen.length} Anfragen an den Mock)`,
		);
		const ergebnisZeilen = (
			db.prepare("SELECT COUNT(*) AS n FROM ergebnisse").get() as { n: number }
		).n;
		console.log(`Ergebniszeilen in der Datenbank: ${ergebnisZeilen}`);

		const termin = terminById("2026")!;
		const kreisBehoerde = kreis.behoerden.find((b) => b.ags === kreis.ags)!;
		const gemeinde = kreis.behoerden.find((b) => b.art !== "kreis")!;
		messe({
			name: `Eine Wahlleitung (${gemeinde.kurz}: Rat, Ortsräte, Bürgermeister)`,
			kreis,
			termin,
			behoerden: [gemeinde],
		});
		messe({
			name: `Eine Wahlleitung (${kreisBehoerde.kurz}: Kreistag und Landrat)`,
			kreis,
			termin,
			behoerden: [kreisBehoerde],
		});
		messe({
			name: `Alle Wahlleitungen des Kreises (${kreis.behoerden.length})`,
			kreis,
			termin,
			behoerden: kreis.behoerden,
		});
	} finally {
		schliesseDb();
		await mock.schliessen();
		rmSync(tmp, { recursive: true, force: true });
	}
};

await main();
