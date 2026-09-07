/**
 * Welche Kreise gerade jemand ansieht – über Prozessgrenzen hinweg.
 *
 * ## Wozu
 *
 * Der Poller fragt einen Kreis, den gerade jemand offen hat, häufiger ab als
 * die übrigen (siehe `takt.ts`: am Wahlabend 60 statt 180 Sekunden). Woher er
 * das weiß, war bisher trivial: Auslieferung und Poller liefen im selben
 * Prozess, ein Seitenaufruf setzte einen Zeitstempel in einer Map.
 *
 * Mit der Trennung (siehe `rolle.ts`) sitzen die Zuschauer in den Web-Pods und
 * der Poller woanders. Die Meldung muss also von den Web-Pods zum Poller –
 * und zwar **ohne einen zweiten Schreiber auf der Datenbank**: SQLite im
 * WAL-Modus verträgt genau einen, und den soll ein Fehler im Code nicht
 * erzeugen können.
 *
 * ## Warum Dateien und kein Endpunkt am Poller
 *
 * Naheliegend wäre ein HTTP-Aufruf der Web-Pods an den Poller. Dagegen
 * sprechen drei Dinge, die am Wahlabend zählen:
 *
 * - Der Poller wird mit `Recreate` ausgerollt, ist also beim Deploy für ein
 *   paar Sekunden gar nicht da. Meldungen in dieser Zeit gingen verloren –
 *   ausgerechnet direkt nach einem Deploy wüsste der Poller nicht mehr, wer
 *   zusieht, und würde den betrachteten Kreis langsamer abfragen.
 * - Es bräuchte einen zweiten Dienst, eine Adresse in der Konfiguration und
 *   eine Antwort auf die Frage, was passiert, wenn sie falsch ist.
 * - Ein fehlgeschlagener Aufruf müsste behandelt werden, ohne die Auslieferung
 *   zu behelligen – also doch wieder ein Puffer.
 *
 * Die Datei kann all das nicht falsch machen: Jeder Prozess schreibt genau
 * **seine eigene** Datei (benannt nach der Pod-Kennung), niemand liest die
 * eines anderen zum Schreiben, und der Poller nimmt beim nächsten Lauf einfach
 * mit, was da ist. Ist er zwischendurch weg, liegt die Meldung weiter im
 * Verzeichnis und gilt beim Start sofort wieder. Zwei Schreiber auf derselben
 * Datei gibt es nicht, ein Sperrverfahren also auch nicht.
 *
 * ## Was drinsteht
 *
 * Nur, was ohnehin schon in der Map stand: je Kreis ein Zeitstempel des
 * letzten Aufrufs. Kein Zähler, keine Kennung, nichts, was einen Besucher
 * wiedererkennt – dieselbe Zurückhaltung wie vorher, nur an anderer Stelle.
 * Kreise, deren Zeitstempel älter ist als `BETRACHTET_S`, fallen beim
 * Schreiben heraus; die Datei bleibt damit klein und veraltet nicht.
 */
import {
	mkdirSync,
	readFileSync,
	readdirSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { BETRACHTET_S } from "./takt.ts";

/** Verzeichnis neben der Datenbank, in dem die Meldungen liegen. */
export const betrachtetVerzeichnis = (dbPfad: string): string =>
	join(dirname(dbPfad), "betrachtet");

/** Inhalt einer Meldedatei. */
type Meldung = {
	/** Wann diese Datei zuletzt geschrieben wurde (ms seit Epoche). */
	stand: number;
	/** Kreis-Slug → Zeitpunkt des letzten Aufrufs (ms seit Epoche). */
	kreise: Record<string, number>;
};

/**
 * Wie oft ein Web-Pod seine Datei neu schreibt.
 *
 * Der Poller sieht am Wahlabend jede Minute nach; häufiger zu schreiben bringt
 * nichts. Seltener wäre riskant: Ein Pod, dessen Datei zu alt ist, gilt als
 * verschwunden (siehe `HOECHSTALTER_MS`).
 */
const SCHREIBABSTAND_MS = 15_000;

/**
 * Ab wann die Datei eines Pods nicht mehr gilt.
 *
 * Ein Pod, der beim Ausrollen verschwindet, räumt seine Datei im Regelfall
 * selbst weg (`schliesse()`), aber eben nicht bei jedem Ende – ein `SIGKILL`
 * nach abgelaufener Gnadenfrist lässt sie liegen. Vier Schreibabstände Nachsicht
 * überstehen einen ausgelasteten Knoten, halten aber niemanden künstlich am
 * Leben.
 */
const HOECHSTALTER_MS = 4 * SCHREIBABSTAND_MS;

/** Ab wann eine liegengebliebene Datei gelöscht wird. */
const AUFRAEUMEN_AB_MS = 30 * 60 * 1000;

export type Melder = {
	/** Ein Kreis wurde gerade angesehen. */
	melde: (kreisSlug: string) => void;
	/** Sofort schreiben (Tests; sonst erledigt es die Uhr). */
	schreibe: () => void;
	/** Uhr anhalten und die eigene Datei entfernen. */
	schliesse: () => void;
};

const dateiName = (id: string) => `${id.replace(/[^A-Za-z0-9_.-]/g, "_")}.json`;

/**
 * Meldet dem Poller, welche Kreise dieser Prozess gerade ausliefert.
 *
 * Schreibt höchstens alle `SCHREIBABSTAND_MS` und nur, wenn sich etwas geändert
 * hat – oder wenn die letzte Datei so alt wird, dass sie als verschwunden
 * gälte. Fehler beim Schreiben werden geschluckt: Ein volles Volume darf die
 * Auslieferung nicht anhalten, es kostet nur den schnelleren Takt.
 */
export const starteMelder = (opt: {
	verzeichnis: string;
	/** Kennung dieses Prozesses – in Kubernetes der Pod-Name. */
	id: string;
	abstandMs?: number;
	betrachtetS?: number;
}): Melder => {
	const abstand = opt.abstandMs ?? SCHREIBABSTAND_MS;
	const frist = (opt.betrachtetS ?? BETRACHTET_S) * 1000;
	const ziel = join(opt.verzeichnis, dateiName(opt.id));
	const vorlaeufig = `${ziel}.neu`;
	const kreise = new Map<string, number>();
	let offen = false;
	let geschrieben = 0;

	const schreibe = () => {
		const jetzt = Date.now();
		for (const [slug, zeit] of kreise)
			if (jetzt - zeit > frist) kreise.delete(slug);
		const meldung: Meldung = {
			stand: jetzt,
			kreise: Object.fromEntries(kreise),
		};
		try {
			mkdirSync(opt.verzeichnis, { recursive: true });
			// Erst daneben schreiben, dann umbenennen: Der Poller darf nie eine
			// halb geschriebene Datei zu sehen bekommen. `rename` ist auf einem
			// Dateisystem atomar.
			writeFileSync(vorlaeufig, JSON.stringify(meldung), "utf8");
			renameSync(vorlaeufig, ziel);
			offen = false;
			geschrieben = jetzt;
		} catch {
			// Nicht schlimm genug, um die Auslieferung zu stören.
		}
	};

	const melde = (kreisSlug: string) => {
		kreise.set(kreisSlug, Date.now());
		offen = true;
	};

	// Die erste Datei sofort, damit ein frischer Pod nicht erst nach einer
	// Viertelminute mitzählt.
	schreibe();

	const uhr = setInterval(() => {
		// Auch ohne neue Aufrufe: Solange dieser Pod Zuschauer hat, muss seine
		// Datei jung bleiben, sonst gilt sie dem Poller als verwaist.
		if (offen || (kreise.size > 0 && Date.now() - geschrieben >= abstand))
			schreibe();
	}, abstand);
	uhr.unref?.();

	return {
		melde,
		schreibe,
		schliesse: () => {
			clearInterval(uhr);
			// Aufräumen beim geordneten Ende – der Poller soll nicht noch
			// minutenlang einem Pod hinterherlaufen, den es nicht mehr gibt.
			try {
				rmSync(ziel, { force: true });
				rmSync(vorlaeufig, { force: true });
			} catch {
				/* dann räumt es der Poller weg */
			}
		},
	};
};

/**
 * Was die Web-Pods gemeldet haben, zu einer Sicht zusammengefasst.
 *
 * Je Kreis gilt der jüngste Zeitstempel über alle Pods. Zu alte Dateien werden
 * übergangen (ein Pod, den es nicht mehr gibt) und irgendwann gelöscht.
 */
export const liesBetrachtet = (
	verzeichnis: string,
	opt: { hoechstalterMs?: number; jetzt?: number } = {},
): Map<string, number> => {
	const jetzt = opt.jetzt ?? Date.now();
	const hoechstalter = opt.hoechstalterMs ?? HOECHSTALTER_MS;
	const zusammen = new Map<string, number>();
	let dateien: string[];
	try {
		dateien = readdirSync(verzeichnis);
	} catch {
		// Kein Verzeichnis heißt: kein Web-Pod hat je gemeldet. Kein Fehler –
		// im Ein-Prozess-Betrieb entsteht es nie.
		return zusammen;
	}
	for (const name of dateien) {
		if (!name.endsWith(".json")) continue;
		const pfad = join(verzeichnis, name);
		let meldung: Meldung;
		try {
			meldung = JSON.parse(readFileSync(pfad, "utf8")) as Meldung;
		} catch {
			// Halb geschrieben oder Müll – beim nächsten Lauf ist sie ganz.
			continue;
		}
		const alter = jetzt - (meldung.stand ?? 0);
		if (alter > AUFRAEUMEN_AB_MS) {
			try {
				rmSync(pfad, { force: true });
			} catch {
				/* beim nächsten Mal */
			}
			continue;
		}
		if (alter > hoechstalter) continue;
		for (const [slug, zeit] of Object.entries(meldung.kreise ?? {})) {
			if (typeof zeit !== "number") continue;
			const alt = zusammen.get(slug);
			if (alt === undefined || zeit > alt) zusammen.set(slug, zeit);
		}
	}
	return zusammen;
};
