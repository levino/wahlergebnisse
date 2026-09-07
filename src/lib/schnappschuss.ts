/**
 * Ausgangsbestand: eine fertige Datenbank, mit der eine frische Instanz sofort
 * startet.
 *
 * **Das Problem.** Ein Kaltstart mit leerem Volume kostet rund 63 000 Anfragen
 * an fremde Server und etwa vier Stunden, bis die Archive 2021 vollständig
 * sind. Solange er läuft, zeigt die Seite nichts. Schlimmer: Die Quellen
 * verschwinden. Der Heidekreis hat seine 2021er Dateien bereits entfernt – was
 * einmal geladen war, ist nirgends sonst gesichert. Ein zweiter Kaltstart
 * bekäme diese Zahlen nie wieder.
 *
 * **Die Lösung.** Ein Schnappschuss der Datenbank wird als Anhang eines
 * GitHub-Release veröffentlicht, der Docker-Build backt die im Dockerfile
 * benannte Fassung ins Image, und der Poller entpackt sie beim Start, wenn auf
 * dem Volume noch nichts (Brauchbares) liegt. Kein Download zur Laufzeit, kein
 * Token, kein zusätzlicher Dienst – versioniert über ein einziges `ARG`.
 *
 * **Warum nicht ins Git-Repo.** Rund 70 MB je Fassung, für immer in der
 * Historie; Git LFS hat bei GitHub eine Bandbreitenquote. Ein Release-Anhang
 * kostet nichts davon und lässt sich löschen.
 *
 * **Warum zstd aus `node:zlib` und kein Programm.** Ab Node 22.15 steckt zstd
 * im Kern. Das Image braucht also kein zusätzliches Paket, und beides –
 * Packen wie Entpacken – läuft **streamend**: Es liegt nie mehr als ein Puffer
 * im Speicher, egal wie groß die Datenbank ist. Gemessen komprimiert `-19` den
 * Bestand 11:1 (195 MB → 17 MB).
 *
 * Die Gegenprobe dazu steht in `src/pages/export/wahlen.sqlite.ts`: Dort las
 * der Export die fertige Kopie mit `readFileSync` am Stück ein – bei 750 MB
 * erwarteter Endgröße ist das der Weg in den OOM-Kill.
 */
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
import { TERMINE, istLive } from "../data/termine.ts";
import { DATENSTAND, jetzt, metaGet, metaSet } from "./db.ts";

/**
 * Kompressionsstufe. 19 ist die Stufe, mit der die 11:1 gemessen wurden; sie
 * kostet beim Packen gut 100 MB Arbeitsspeicher und einige Minuten. Das ist
 * genau der Grund, warum der Schnappschuss **nicht** im Poller-Pod gepackt
 * wird (512 MiB Limit, siehe `docs/ausgangsbestand.md`).
 */
export const STUFE = 19;

/** Marke im Schnappschuss: wann er gezogen wurde (ISO 8601). */
export const MARKE_ERZEUGT = "schnappschuss:erzeugt";
/** Marke im Schnappschuss: woher er stammt (frei, nur zum Nachsehen). */
export const MARKE_HERKUNFT = "schnappschuss:herkunft";

/**
 * Wo im Image der eingebackene Ausgangsbestand liegt.
 *
 * Über `WAHLEN_SCHNAPPSCHUSS` umstellbar – so laufen die Tests gegen einen
 * eigenen, und eine Vorschau-Umgebung kann ihn mit einer leeren Angabe ganz
 * abschalten.
 */
export const schnappschussPfad = (): string =>
	process.env.WAHLEN_SCHNAPPSCHUSS ?? "/app/schnappschuss/wahlen.db.zst";

/** Die Nebendateien, die zu einer WAL-Datenbank gehören. */
const nebendateien = (pfad: string): string[] => [`${pfad}-wal`, `${pfad}-shm`];

const weg = (pfad: string): void => {
	rmSync(pfad, { force: true });
	for (const n of nebendateien(pfad)) rmSync(n, { force: true });
};

/**
 * Konsistente Kopie einer laufenden Datenbank.
 *
 * `VACUUM INTO` schreibt eine in sich stimmige, zugleich aufgeräumte Datei –
 * ohne die Quelle anzufassen. Genau deshalb wird sie **nur lesend** geöffnet:
 * Auf dem Volume schreibt der Poller, und ein zweiter Schreiber ist das eine,
 * was es dort nicht geben darf (siehe `docs/rollierendes-ausrollen.md`). Eine
 * nur lesende Verbindung darf `VACUUM INTO` trotzdem – geprüft, und in
 * `test/schnappschuss.test.ts` festgehalten.
 *
 * Die Marken landen anschließend in der **Kopie**, nicht im Original: Der
 * Schnappschuss weiß dadurch, wann er gezogen wurde, und das Produktivsystem
 * merkt von der Sicherung nichts.
 */
export const erzeugeKopie = (
	quelle: string,
	ziel: string,
	herkunft = "",
): { bytes: number; erzeugt: string } => {
	if (!existsSync(quelle))
		throw new Error(`Keine Datenbank unter ${quelle} gefunden`);
	mkdirSync(dirname(ziel), { recursive: true });
	// `VACUUM INTO` bricht ab, wenn die Zieldatei schon da ist.
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
	// Das `-wal`, das die Kopie beim Schreiben der Marken angelegt hat, gehört
	// nicht in den Schnappschuss: Es macht die Datei größer und wäre beim
	// Entpacken ein loses Ende. `close()` räumt es normalerweise selbst weg –
	// aber nur normalerweise.
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
	/** Ergebniszeilen zu Terminen, die noch laufen – die stehen in keinem Schnappschuss. */
	live: number;
};

const LEER: Bestand = { datenstand: 0, zeilen: 0, live: 0 };

/**
 * Eine Datenbankdatei ansehen, ohne sie zu verändern.
 *
 * Alles, was dabei schiefgehen kann – die Datei ist leer, halb geschrieben,
 * kein SQLite –, bedeutet dasselbe: Es steht nichts drin, das zu schützen
 * wäre. Deshalb der leere Bestand statt einer Ausnahme.
 */
export const bestand = (pfad: string): Bestand => {
	if (!existsSync(pfad)) return LEER;
	let db: DatabaseSync | undefined;
	try {
		db = new DatabaseSync(pfad, { readOnly: true });
		db.exec("PRAGMA busy_timeout = 5000;");
		const zahl = (sql: string, ...p: string[]): number =>
			Number((db?.prepare(sql).get(...p) as { n: number } | undefined)?.n ?? 0);
		const liveIds = TERMINE.filter(istLive).map((t) => t.id);
		return {
			erzeugt: metaGet(db, MARKE_ERZEUGT),
			datenstand: Number(metaGet(db, "datenstand") ?? 0) || 0,
			zeilen: zahl("SELECT COUNT(*) AS n FROM ergebnisse"),
			live: liveIds.length
				? zahl(
						`SELECT COUNT(*) AS n FROM ergebnisse WHERE termin IN (${liveIds.map(() => "?").join(",")})`,
						...liveIds,
					)
				: 0,
		};
	} catch {
		return LEER;
	} finally {
		db?.close();
	}
};

/**
 * Darf der Schnappschuss diese vorhandene Datei ersetzen?
 *
 * Die Grundregel ist absolut: **Es wird nie etwas überschrieben, das nur hier
 * steht.** Der Ausgangsbestand ist ein Startkapital, kein Wiederherstellen aus
 * einer Sicherung. Am Wahlabend eine Datenbank mit Live-Zahlen gegen einen
 * Schnappschuss von letzter Woche zu tauschen, wäre der teuerste denkbare
 * Fehler – und er passierte lautlos.
 *
 * Deshalb genau zwei Fälle:
 *
 *  1. **Nichts da.** Keine Ergebniszeile – frisches Volume, abgebrochener
 *     erster Lauf, angelegte aber leere Datei. Nichts zu verlieren.
 *  2. **Selbst aus einem Schnappschuss und seitdem nichts Eigenes.** Die Datei
 *     trägt die Marke eines älteren Schnappschusses und hat zu den laufenden
 *     Terminen keine einzige Zeile. Dann steht in ihr nichts, was im neueren
 *     Schnappschuss nicht auch stünde.
 *
 * Alles andere – ein Bestand, den der Poller selbst zusammengetragen hat,
 * oder einer mit Live-Zahlen – bleibt stehen. Was ihm zum Archiv fehlt, holt
 * der Poller nach; das dauert, kostet aber nichts Unwiederbringliches.
 */
const ersetzbar = (vorhanden: Bestand): string | undefined =>
	vorhanden.zeilen === 0
		? undefined
		: vorhanden.erzeugt && vorhanden.live === 0
			? undefined
			: `die vorhandene Datenbank hat eigene Daten (${vorhanden.zeilen} Ergebniszeilen, davon ${vorhanden.live} zu laufenden Terminen)`;

export type Uebernahme =
	| { art: "kein-schnappschuss" }
	| { art: "behalten"; grund: string }
	| { art: "uebernommen"; bytes: number; erzeugt?: string; datenstand: number };

/**
 * Den eingebackenen Ausgangsbestand übernehmen, wenn er gebraucht wird.
 *
 * Läuft **vor** `oeffneDb` und nur im Poller: Die Web-Pods öffnen nur lesend
 * und dürfen an der Datei nichts tun. Danach greift der übliche Weg – das
 * Schema wird ergänzt, `migriereDatenstand` sieht den Datenstand, den der
 * Schnappschuss mitbringt, und liest bei Bedarf nach. Der Schnappschuss
 * umgeht diese Prüfung also nicht, er tritt nur an die Stelle eines leeren
 * Volumes.
 *
 * Entpackt wird nach `<ziel>.neu` und erst dann umbenannt. Ein Abbruch
 * mittendrin hinterlässt damit keine halbe Datenbank, sondern nur eine Datei,
 * die beim nächsten Anlauf überschrieben wird.
 */
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
	const grund = ersetzbar(vorhanden);
	if (grund) {
		log(`Ausgangsbestand ${quelle} bleibt ungenutzt: ${grund}`);
		return { art: "behalten", grund };
	}
	const temp = `${ziel}.neu`;
	weg(temp);
	log(`Ausgangsbestand ${quelle} wird entpackt …`);
	await entpacke(quelle, temp);
	const neu = bestand(temp);
	// Ein Schnappschuss mit älterem DATENSTAND darf eine Datei, die schon
	// weiter ist, nicht zurückwerfen: Seine abgeleiteten Zeilen stammen aus
	// einer anderen Generation, und `migriereDatenstand` setzt den Stand nie
	// herab – die Datei behielte also alte Ableitungen unter neuer Nummer.
	// (Auf ein leeres Volume darf er trotzdem, dort ist er die Verbesserung.)
	const zurueck =
		vorhanden.zeilen > 0 && neu.datenstand < vorhanden.datenstand
			? `Datenstand ${neu.datenstand} < ${vorhanden.datenstand}`
			: vorhanden.erzeugt &&
				neu.erzeugt &&
				neu.erzeugt <= vorhanden.erzeugt &&
				`nicht neuer (${neu.erzeugt} ≤ ${vorhanden.erzeugt})`;
	if (zurueck) {
		weg(temp);
		log(`Ausgangsbestand ${quelle} bleibt ungenutzt: ${zurueck}`);
		return { art: "behalten", grund: zurueck };
	}
	if (neu.zeilen === 0 && vorhanden.zeilen > 0) {
		weg(temp);
		const leer = "der Schnappschuss enthält keine Ergebnisse";
		log(`Ausgangsbestand ${quelle} bleibt ungenutzt: ${leer}`);
		return { art: "behalten", grund: leer };
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
