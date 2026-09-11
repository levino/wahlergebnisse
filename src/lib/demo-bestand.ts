import { existsSync, renameSync, rmSync, statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { TERMINE, type Termin } from "../data/termine.ts";
import { demoAn } from "./demo.ts";
import { entpacke } from "./schnappschuss.ts";

export const demoBestandPfad = (): string =>
	process.env.WAHLEN_DEMO_BESTAND ?? "/app/daten/demo-bestand.db.zst";

export const probenTermine = (): { ziel: Termin[]; vorwerte: Termin[] } => {
	const ziel = TERMINE.filter((t) => t.live);
	return {
		ziel,
		vorwerte: TERMINE.filter(
			(t) => !t.live && ziel.some((z) => t.datum < z.datum),
		),
	};
};

/** Tabellen, die eine Spalte `termin` haben – alles, was nach Termin gefiltert wird. */
const TERMIN_TABELLEN = [
	"ergebnisse",
	"uebersichten",
	"ereignisse",
	"wahleintraege",
	"wahlen",
	"wahlraeume",
	"wahlvorschlaege",
] as const;

const platzhalter = (n: number) =>
	Array.from({ length: n }, () => "?").join(",");

export const filtereFuerProbe = (pfad: string): Map<string, number> => {
	const { ziel, vorwerte } = probenTermine();
	const zielIds = ziel.map((t) => t.id);
	const vorwertIds = vorwerte.map((t) => t.id);
	const alle = [...zielIds, ...vorwertIds];
	const geloescht = new Map<string, number>();
	const db = new DatabaseSync(pfad);
	try {
		db.exec("PRAGMA busy_timeout = 30000;");
		const weg = (marke: string, sql: string, ...p: string[]) => {
			const n = db.prepare(sql).run(...p).changes;
			if (n) geloescht.set(marke, (geloescht.get(marke) ?? 0) + Number(n));
		};
		weg("dateien", "DELETE FROM dateien");
		weg("laeufe", "DELETE FROM laeufe");
		for (const tabelle of TERMIN_TABELLEN)
			weg(
				`${tabelle}: fremde Termine`,
				`DELETE FROM ${tabelle} WHERE termin NOT IN (${platzhalter(alle.length)})`,
				...alle,
			);
		weg(
			"ergebnisse: Zahlen zum Zieltermin",
			`DELETE FROM ergebnisse WHERE leer = 0 AND termin IN (${platzhalter(zielIds.length)})`,
			...zielIds,
		);
		weg(
			"ereignisse: Ticker zum Zieltermin",
			`DELETE FROM ereignisse WHERE termin IN (${platzhalter(zielIds.length)})`,
			...zielIds,
		);
		if (vorwertIds.length > 0)
			for (const tabelle of ["uebersichten", "wahlvorschlaege"])
				weg(
					`${tabelle}: Vorwert-Termine`,
					`DELETE FROM ${tabelle} WHERE termin IN (${platzhalter(vorwertIds.length)})`,
					...vorwertIds,
				);
		db.exec("VACUUM");
	} finally {
		db.close();
	}
	return geloescht;
};

export const vorwertZeilen = (pfad: string): number => {
	if (!existsSync(pfad)) return 0;
	const ids = probenTermine().vorwerte.map((t) => t.id);
	if (ids.length === 0) return 0;
	let db: DatabaseSync | undefined;
	try {
		db = new DatabaseSync(pfad, { readOnly: true });
		db.exec("PRAGMA busy_timeout = 5000;");
		const r = db
			.prepare(
				`SELECT COUNT(*) AS n FROM ergebnisse WHERE leer = 0 AND termin IN (${platzhalter(ids.length)})`,
			)
			.get(...ids) as { n: number } | undefined;
		return Number(r?.n ?? 0);
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
	const vorhanden = vorwertZeilen(ziel);
	if (vorhanden > 0) {
		const grund = `die Datenbank hat schon ${vorhanden} Vorwert-Ergebnisse`;
		log(`Demo-Bestand ${quelle} bleibt ungenutzt: ${grund}`);
		return { art: "behalten", grund };
	}
	const temp = `${ziel}.neu`;
	for (const p of [temp, `${temp}-wal`, `${temp}-shm`])
		rmSync(p, { force: true });
	log(`Demo-Bestand ${quelle} wird entpackt …`);
	await entpacke(quelle, temp);
	const zeilen = vorwertZeilen(temp);
	if (zeilen === 0) {
		rmSync(temp, { force: true });
		const grund = "der Demo-Bestand enthält selbst keine Vorwerte";
		log(`Demo-Bestand ${quelle} bleibt ungenutzt: ${grund}`);
		return { art: "behalten", grund };
	}
	for (const p of [ziel, `${ziel}-wal`, `${ziel}-shm`])
		rmSync(p, { force: true });
	renameSync(temp, ziel);
	const bytes = statSync(ziel).size;
	log(
		`Demo-Bestand übernommen: ${zeilen} Vorwert-Ergebnisse (${(bytes / 1e6).toFixed(0)} MB) – die Generalprobe hat, woraus sie spielt.`,
	);
	return { art: "uebernommen", bytes, zeilen };
};
