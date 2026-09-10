/**
 * Der Demo-Bestand: die Daten, aus denen die Generalprobe schöpft – klein
 * genug, um im Repo zu liegen.
 *
 * **Das Problem.** Die Probe spielt einen Wahlabend aus den Zahlen der jeweils
 * letzten Wahl nach (`src/lib/demo-abend.ts`). Ohne diese Vorwerte kann sie
 * gar nichts: `baueVorlage` findet keine Ämter, `demoSchritt` schreibt nichts,
 * und die Leinwand bleibt leer. Bisher kamen sie aus dem Ausgangsbestand –
 * einem 70-MB-Anhang eines GitHub-Release, den der Docker-Build lädt
 * (`docs/ausgangsbestand.md`). Das ist für die Produktion richtig, für die
 * Probe aber eine Abhängigkeit zu viel: Wer das Release löscht oder ohne
 * Ausgangsbestand baut (`SCHNAPPSCHUSS=keiner`), hat eine Generalprobe, die
 * nichts probt.
 *
 * **Die Lösung.** Eine gefilterte, gepackte Fassung derselben Datenbank liegt
 * eingecheckt im Repo (`daten/demo-bestand.db.zst`, erzeugt von
 * `scripts/demo-bestand.ts`). Findet der Poller in der Generalprobe keine
 * Vorwerte, übernimmt er sie von dort. Kein Download, kein Release, kein
 * Token – die Probe steht auf eigenen Füßen.
 *
 * **Was drin ist und was nicht.** Drin: der Live-Termin als reine Struktur
 * (die Ämter, die die Wahlleitungen für 2026 angelegt haben – ohne Zahlen) und
 * die Ergebnisse der Vorwert-Termine, landesweit. Draußen: die Tabelle
 * `dateien` (der HTTP-Zwischenspeicher des Pollers – die Probe fragt nichts
 * ab), die Laufprotokolle und alles, was nur die Archivseiten lesen. Das ist
 * der Unterschied zwischen 470 MB und dem, was hier übrig bleibt.
 *
 * **Die Zahlen sind echt.** Es sind die amtlichen Ergebnisse früherer Wahlen
 * mit echten Bewerberinnen und Bewerbern. Erfunden ist allein, dass sie am
 * 13.09.2026 noch einmal so ausfielen – und das Rauschen, das die Probe
 * darüberlegt (`src/lib/demo.ts`).
 */
import { existsSync, renameSync, rmSync, statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { TERMINE, type Termin } from "../data/termine.ts";
import { demoAn } from "./demo.ts";
import { entpacke } from "./schnappschuss.ts";

/**
 * Wo im Image der eingecheckte Demo-Bestand liegt.
 *
 * Über `WAHLEN_DEMO_BESTAND` umstellbar – so laufen die Tests gegen einen
 * eigenen, und eine Umgebung kann ihn mit einer leeren Angabe abschalten.
 */
export const demoBestandPfad = (): string =>
	process.env.WAHLEN_DEMO_BESTAND ?? "/app/daten/demo-bestand.db.zst";

/**
 * Die Termine, um die es der Probe geht.
 *
 * Maßgeblich ist `termin.live` aus dem Katalog und **nicht** `istLive`: Die
 * Probe spielt genau den Termin nach, den `demoSchritt` sucht, und der ist der
 * laufende – auch dann, wenn `WAHLEN_ABGESCHLOSSEN` ihn irgendwo eingefroren
 * hat. Ein Bestand, der je nach Umgebungsvariable anders ausfiele, wäre ein
 * Bestand, dem man nicht ansieht, was in ihm steckt.
 *
 * Die Vorwerte sind alle älteren Termine: Welcher davon für ein Amt zählt,
 * entscheidet die Probe je Wahlleitung selbst (`vorwertTermine` in
 * `demo-abend.ts`), und sie sieht dafür alle an.
 */
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

/**
 * Eine Kopie auf das eindampfen, was die Generalprobe liest.
 *
 * Arbeitet **auf der Kopie**, nie auf einer laufenden Datenbank – deshalb
 * nimmt die Funktion einen Pfad und keine offene Verbindung. Was hier gelöscht
 * wird und warum:
 *
 *  - **`dateien`** – der HTTP-Zwischenspeicher des Pollers (Rohdateien samt
 *    ETag, 70 MB). Die Probe fragt keinen fremden Server ab; sie braucht ihn
 *    nicht einmal, um ihn zu übergehen.
 *  - **`laeufe`** – die Laufprotokolle der Produktion. Sie würden in der Probe
 *    einen „letzten Lauf" ausweisen, den es dort nie gab: falsche Auskunft,
 *    kein Nutzen.
 *  - **fremde Termine** – was weder Ziel noch Vorwert ist, liest niemand.
 *  - **Zahlen zum Live-Termin** – der Zieltermin bleibt als *Struktur* stehen
 *    (die angelegten Ämter), aber ohne eine einzige Ergebniszeile mit Inhalt.
 *    Hat eine Wahlleitung dort schon etwas veröffentlicht, wären das echte
 *    Zahlen zum 13.09.2026 – in einer Simulation nicht von den erfundenen zu
 *    unterscheiden. Die leeren Zeilen bleiben: „Es wird gewählt, und es liegt
 *    nichts vor" ist die Wahrheit über ein Amt um 18 Uhr.
 *  - **`ereignisse` zum Live-Termin** – der Ticker fängt beim leeren Saal an.
 *  - **`uebersichten` und `wahlvorschlaege` der Vorwert-Termine** – zusammen
 *    130 MB, und die Probe liest beides nur zum angezeigten Termin, also zum
 *    Zieltermin (`uebersichten`/`listenplaetze` in `abfragen.ts`). Was davon
 *    zu 2021 gehört, trägt allein die Archivseiten der Demo-Instanz.
 *
 * Was bleibt: die Ergebnisse der Vorwerte (daraus baut die Probe ihre
 * Vorlage), ihre Wahleinträge (daraus die Ämter) und die Wahlräume – die
 * braucht sie für die Kreiswahlbereiche, und zwar ausdrücklich die von 2021
 * (`RUECKFALL_TERMIN` in `wahlbereiche.ts`).
 */
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
		// Erst jetzt schrumpft die Datei: SQLite gibt gelöschte Seiten nicht von
		// selbst zurück, ohne VACUUM bliebe sie so groß wie vorher.
		db.exec("VACUUM");
	} finally {
		db.close();
	}
	return geloescht;
};

/**
 * Wie viele Vorwert-Ergebnisse in dieser Datei stehen.
 *
 * Das ist die eine Zahl, an der die Probe hängt: Ist sie null, findet
 * `baueVorlage` kein einziges Amt und die Generalprobe zeigt einen leeren
 * Saal, der auch leer bleibt. Alles, was beim Nachsehen schiefgehen kann –
 * die Datei fehlt, ist halb geschrieben, ist kein SQLite –, bedeutet
 * dasselbe: keine Vorwerte.
 */
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

/**
 * Den eingecheckten Demo-Bestand übernehmen, wenn die Probe ihn braucht.
 *
 * Läuft **nur in der Generalprobe** und **nur im Poller**, direkt nach
 * `uebernimmSchnappschuss` und vor `oeffneDb`. Die Reihenfolge ist die
 * Aussage: Ist ein Ausgangsbestand eingebacken, gilt der – er ist der
 * vollständige. Der Demo-Bestand ist der Boden darunter, kein Ersatz.
 *
 * **Die Bedingung ist eng gewählt.** Übernommen wird nur, wenn in der Datei
 * keine einzige Vorwert-Ergebniszeile steht. Dann kann die Probe dort nichts
 * gespielt haben (`baueVorlage` gibt ohne Vorwerte eine leere Liste zurück,
 * und ohne die schreibt `demoSchritt` keine Zeile), es ist also auch nichts
 * zu verlieren. Steht auch nur ein Vorwert da, bleibt die Datei – in der
 * Produktion greift ohnehin schon `demoAn()` davor.
 *
 * Entpackt wird nach `<ziel>.neu` und erst dann umbenannt: Ein Abbruch
 * mittendrin hinterlässt keine halbe Datenbank.
 */
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
