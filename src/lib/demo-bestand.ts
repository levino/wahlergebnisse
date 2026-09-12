import { existsSync, renameSync, rmSync, statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { PROBEN_TERMIN, TERMINE, type Termin } from "../data/termine.ts";
import { demoAn } from "./demo.ts";
import { entpacke } from "./schnappschuss.ts";

export const demoBestandPfad = (): string =>
	process.env.WAHLEN_DEMO_BESTAND ?? "/app/daten/demo-bestand.db.zst";

/**
 * Die unverfälschten Zahlen des Probentermins.
 *
 * Die Probe schreibt ihren Abend in `ergebnisse` – unter denselben Schlüssel,
 * aus dem sie ihn baut. Ohne eine zweite Ablage wäre die Vorlage nach dem
 * ersten Takt überschrieben und nach einem Neustart verloren.
 */
export const QUELLE_SCHEMA = `
CREATE TABLE IF NOT EXISTS demo_quelle (
  termin TEXT NOT NULL, behoerde TEXT NOT NULL, wahl_id INTEGER NOT NULL, gebiet_id TEXT NOT NULL,
  ebene INTEGER NOT NULL, titel TEXT NOT NULL, stand_max INTEGER, json TEXT NOT NULL,
  PRIMARY KEY (termin, behoerde, wahl_id, gebiet_id)
);
CREATE INDEX IF NOT EXISTS demo_quelle_ebene ON demo_quelle (termin, behoerde, wahl_id, ebene);
`;

export const probenTermin = (): Termin | undefined =>
	TERMINE.find((t) => t.id === PROBEN_TERMIN);

/** Die Termine, die eine Probeninstanz überhaupt kennt – der Probentermin und alles davor. */
export const probenTermine = (): Termin[] => {
	const probe = probenTermin();
	return probe ? TERMINE.filter((t) => t.datum <= probe.datum) : [];
};

/** Tabellen, die nach Termin gefiltert werden. */
const TERMIN_TABELLEN = [
	"ergebnisse",
	"wahleintraege",
	"wahlen",
	"wahlraeume",
] as const;

/**
 * Tabellen, die aus dem eingecheckten Bestand ganz herausfallen.
 *
 * `dateien` ist der HTTP-Zwischenspeicher des Pollers, `laeufe` sein
 * Protokoll – die Probe fragt niemanden ab. `uebersichten` tragen echte
 * Zahlen und stünden neben den simulierten. `ereignisse` ist der Ticker: Der
 * fängt leer an. `wahlvorschlaege` sind nur Listenplätze, aber die größte
 * Tabelle im Bestand und für den Wahlabend entbehrlich.
 */
const GANZ_WEG = [
	"dateien",
	"laeufe",
	"uebersichten",
	"wahlvorschlaege",
	"ereignisse",
] as const;

const platzhalter = (n: number) =>
	Array.from({ length: n }, () => "?").join(",");

export const filtereFuerProbe = (pfad: string): Map<string, number> => {
	const behalten = probenTermine().map((t) => t.id);
	if (behalten.length === 0)
		throw new Error(`Termin ${PROBEN_TERMIN} ist unbekannt`);
	const geloescht = new Map<string, number>();
	const db = new DatabaseSync(pfad);
	try {
		db.exec("PRAGMA busy_timeout = 30000;");
		const weg = (marke: string, sql: string, ...p: string[]) => {
			const n = db.prepare(sql).run(...p).changes;
			if (n) geloescht.set(marke, (geloescht.get(marke) ?? 0) + Number(n));
		};
		for (const tabelle of GANZ_WEG) weg(tabelle, `DELETE FROM ${tabelle}`);
		for (const tabelle of TERMIN_TABELLEN)
			weg(
				`${tabelle}: spätere und fremde Termine`,
				`DELETE FROM ${tabelle} WHERE termin NOT IN (${platzhalter(behalten.length)})`,
				...behalten,
			);
		db.exec("VACUUM");
	} finally {
		db.close();
	}
	return geloescht;
};

/** Wie viele Zahlen die Probe aus dieser Datei spielen kann. */
export const probenZeilen = (pfad: string): number => {
	if (!existsSync(pfad)) return 0;
	const probe = probenTermin();
	if (!probe) return 0;
	let db: DatabaseSync | undefined;
	try {
		db = new DatabaseSync(pfad, { readOnly: true });
		db.exec("PRAGMA busy_timeout = 5000;");
		const zahl = (sql: string): number => {
			try {
				return Number(
					(db?.prepare(sql).get(probe.id) as { n: number } | undefined)?.n ?? 0,
				);
			} catch {
				return 0;
			}
		};
		return (
			zahl(
				"SELECT COUNT(*) AS n FROM ergebnisse WHERE leer = 0 AND termin = ?",
			) + zahl("SELECT COUNT(*) AS n FROM demo_quelle WHERE termin = ?")
		);
	} catch {
		return 0;
	} finally {
		db?.close();
	}
};

export type DemoUebernahme =
	| { art: "keine-probe" }
	| { art: "kein-bestand" }
	| { art: "behalten"; grund: string }
	| { art: "uebernommen"; bytes: number; zeilen: number };

export const uebernimmDemoBestand = async ({
	quelle = demoBestandPfad(),
	ziel,
	log = () => {},
}: {
	quelle?: string;
	ziel: string;
	log?: (msg: string) => void;
}): Promise<DemoUebernahme> => {
	if (!demoAn()) return { art: "keine-probe" };
	if (!quelle || !existsSync(quelle)) return { art: "kein-bestand" };
	const vorhanden = probenZeilen(ziel);
	if (vorhanden > 0) {
		const grund = `die Datenbank hat schon ${vorhanden} Zeilen zum Probentermin`;
		log(`Demo-Bestand ${quelle} bleibt ungenutzt: ${grund}`);
		return { art: "behalten", grund };
	}
	const temp = `${ziel}.neu`;
	for (const p of [temp, `${temp}-wal`, `${temp}-shm`])
		rmSync(p, { force: true });
	log(`Demo-Bestand ${quelle} wird entpackt …`);
	await entpacke(quelle, temp);
	const zeilen = probenZeilen(temp);
	if (zeilen === 0) {
		rmSync(temp, { force: true });
		const grund =
			"der Demo-Bestand enthält selbst keine Zahlen zum Probentermin";
		log(`Demo-Bestand ${quelle} bleibt ungenutzt: ${grund}`);
		return { art: "behalten", grund };
	}
	for (const p of [ziel, `${ziel}-wal`, `${ziel}-shm`])
		rmSync(p, { force: true });
	renameSync(temp, ziel);
	const bytes = statSync(ziel).size;
	log(
		`Demo-Bestand übernommen: ${zeilen} Ergebniszeilen zum Probentermin (${(bytes / 1e6).toFixed(0)} MB) – die Generalprobe hat, woraus sie spielt.`,
	);
	return { art: "uebernommen", bytes, zeilen };
};
