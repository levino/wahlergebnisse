import {
	createReadStream,
	createWriteStream,
	existsSync,
	mkdirSync,
	renameSync,
	rmSync,
	statSync,
} from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pipeline } from "node:stream/promises";
import {
	constants as zlibKonstanten,
	createZstdCompress,
	createZstdDecompress,
} from "node:zlib";
import { DATENSTAND, jetzt, metaGet, metaSet } from "./db.ts";

export const STUFE = 19;

/** Marke im Schnappschuss: wann er gezogen wurde (ISO 8601). */
export const MARKE_ERZEUGT = "schnappschuss:erzeugt";
/** Marke im Schnappschuss: woher er stammt (frei, nur zum Nachsehen). */
export const MARKE_HERKUNFT = "schnappschuss:herkunft";

export const schnappschussPfad = (): string =>
	process.env.WAHLEN_SCHNAPPSCHUSS ?? "/app/schnappschuss/wahlen.db.zst";

/** Die Nebendateien, die zu einer WAL-Datenbank gehören. */
const nebendateien = (pfad: string): string[] => [`${pfad}-wal`, `${pfad}-shm`];

const weg = (pfad: string): void => {
	rmSync(pfad, { force: true });
	for (const n of nebendateien(pfad)) rmSync(n, { force: true });
};

export const erzeugeKopie = (
	quelle: string,
	ziel: string,
	herkunft = "",
): { bytes: number; erzeugt: string } => {
	if (!existsSync(quelle))
		throw new Error(`Keine Datenbank unter ${quelle} gefunden`);
	mkdirSync(dirname(ziel), { recursive: true });
	weg(ziel);
	const db = new DatabaseSync(quelle, { readOnly: true });
	try {
		db.exec("PRAGMA busy_timeout = 30000;");
		db.exec(`VACUUM INTO '${ziel.replace(/'/g, "''")}'`);
	} finally {
		db.close();
	}
	const erzeugt = jetzt();
	const kopie = new DatabaseSync(ziel);
	try {
		metaSet(kopie, MARKE_ERZEUGT, erzeugt);
		if (herkunft) metaSet(kopie, MARKE_HERKUNFT, herkunft);
	} finally {
		kopie.close();
	}
	for (const n of nebendateien(ziel)) rmSync(n, { force: true });
	return { bytes: statSync(ziel).size, erzeugt };
};

/** Datei streamend mit zstd packen. */
export const packe = async (
	quelle: string,
	ziel: string,
	stufe = STUFE,
): Promise<number> => {
	mkdirSync(dirname(ziel), { recursive: true });
	await pipeline(
		createReadStream(quelle),
		createZstdCompress({
			params: { [zlibKonstanten.ZSTD_c_compressionLevel]: stufe },
		}),
		createWriteStream(ziel),
	);
	return statSync(ziel).size;
};

/** Datei streamend entpacken. */
export const entpacke = async (quelle: string, ziel: string): Promise<void> => {
	mkdirSync(dirname(ziel), { recursive: true });
	await pipeline(
		createReadStream(quelle),
		createZstdDecompress(),
		createWriteStream(ziel),
	);
};

/** Was eine Datenbankdatei über sich verrät, ohne dass sie brauchbar sein muss. */
export type Bestand = {
	/** Marke aus einem Schnappschuss, falls die Datei aus einem stammt. */
	erzeugt?: string;
	/** DATENSTAND, auf dem die Ableitungen dieser Datei beruhen. */
	datenstand: number;
	/** Ergebniszeilen insgesamt. 0 heißt: hier ist nichts, was verloren gehen kann. */
	zeilen: number;
};

const LEER: Bestand = { datenstand: 0, zeilen: 0 };

export const bestand = (pfad: string): Bestand => {
	if (!existsSync(pfad)) return LEER;
	let db: DatabaseSync | undefined;
	try {
		db = new DatabaseSync(pfad, { readOnly: true });
		db.exec("PRAGMA busy_timeout = 5000;");
		const zahl = (sql: string, ...p: string[]): number =>
			Number((db?.prepare(sql).get(...p) as { n: number } | undefined)?.n ?? 0);
		return {
			erzeugt: metaGet(db, MARKE_ERZEUGT),
			datenstand: Number(metaGet(db, "datenstand") ?? 0) || 0,
			zeilen: zahl("SELECT COUNT(*) AS n FROM ergebnisse"),
		};
	} catch {
		return LEER;
	} finally {
		db?.close();
	}
};

export type Uebernahme =
	| { art: "kein-schnappschuss" }
	| { art: "behalten"; grund: string }
	| { art: "uebernommen"; bytes: number; erzeugt?: string; datenstand: number };

export const uebernimmSchnappschuss = async ({
	quelle = schnappschussPfad(),
	ziel,
	log = () => {},
}: {
	quelle?: string;
	ziel: string;
	log?: (msg: string) => void;
}): Promise<Uebernahme> => {
	if (!quelle || !existsSync(quelle)) return { art: "kein-schnappschuss" };
	const vorhanden = bestand(ziel);
	const temp = `${ziel}.neu`;
	weg(temp);
	log(`Ausgangsbestand ${quelle} wird entpackt …`);
	await entpacke(quelle, temp);
	const neu = bestand(temp);
	const behalten = (grund: string): Uebernahme => {
		weg(temp);
		log(`Ausgangsbestand ${quelle} bleibt ungenutzt: ${grund}`);
		return { art: "behalten", grund };
	};
	if (vorhanden.zeilen > 0) {
		if (neu.zeilen === 0)
			return behalten("der Schnappschuss enthält keine Ergebnisse");
		if (!vorhanden.datenstand || neu.datenstand <= vorhanden.datenstand)
			return behalten(
				`die vorhandene Datenbank hat eigene Daten (${vorhanden.zeilen} Ergebniszeilen, Datenstand ${vorhanden.datenstand}); der Schnappschuss (${neu.zeilen} Ergebniszeilen, Datenstand ${neu.datenstand}, gezogen am ${neu.erzeugt ?? "unbekannt"}) ist nicht weiter – Abgleich von Hand`,
			);
	}
	weg(ziel);
	renameSync(temp, ziel);
	const bytes = statSync(ziel).size;
	log(
		`Ausgangsbestand übernommen: ${neu.zeilen} Ergebniszeilen, Datenstand ${neu.datenstand}, gezogen am ${neu.erzeugt ?? "unbekannt"} (${(bytes / 1e6).toFixed(0)} MB)`,
	);
	if (neu.datenstand && neu.datenstand < DATENSTAND)
		log(
			`Achtung: Der Ausgangsbestand ist auf Datenstand ${neu.datenstand}, der Code auf ${DATENSTAND} – die Archivtermine werden einmal neu eingelesen. Besser einen frischeren Schnappschuss einbacken (docs/ausgangsbestand.md).`,
		);
	return {
		art: "uebernommen",
		bytes,
		erzeugt: neu.erzeugt,
		datenstand: neu.datenstand,
	};
};
