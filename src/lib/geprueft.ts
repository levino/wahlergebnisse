/**
 * „Zuletzt bei der Wahlleitung nachgefragt" – je Kreis, über Prozessgrenzen.
 *
 * Die Standanzeige sagt „geprüft 18:44". Gemeint ist damit *dieser* Kreis,
 * nicht der letzte Lauf irgendwo in Niedersachsen: Der Poller staffelt die
 * Kreise (siehe `takt.ts`), ein selten abgefragter Kreis sähe sonst frischer
 * aus, als er ist. Bis hierher stand die Angabe in einer Map im Prozess des
 * Pollers, und die Zustellung (`server/live.ts`) lief im selben Prozess.
 *
 * Mit der Trennung von Poller und Auslieferung geht das nicht mehr. Der Weg
 * führt jetzt über die Datenbank, und zwar in der Richtung, die ohne zweiten
 * Schreiber auskommt: **Der Poller schreibt** nach jedem Lauf einen Zeitstempel
 * je angefasstem Kreis in die Meta-Tabelle, **die Web-Pods lesen** ihn.
 *
 * Warum die Meta-Tabelle und keine neue Tabelle: Sie existiert seit jeher, ist
 * ein reiner Schlüssel-Wert-Speicher und braucht damit keine Schema-Änderung –
 * genau die Sorte additive Ergänzung, die während eines rollenden Deploys
 * unschädlich ist (siehe `docs/rollierendes-ausrollen.md`). Ein alter Stand,
 * der diese Schlüssel nicht kennt, übersieht sie einfach.
 */
import type { Db } from "./db.ts";
import { metaSet, transaktion } from "./db.ts";

/** Schlüssel in der Meta-Tabelle: `kreis:<slug>:geholt` → Millisekunden. */
const SCHLUESSEL = (slug: string) => `kreis:${slug}:geholt`;
const MUSTER = "kreis:%:geholt";

/**
 * Wie lange die gelesene Übersicht gilt.
 *
 * Gebraucht wird sie beim Puls der Zustellung (alle 20 s) und beim Zustellen
 * eines neuen Stands. Bei 200 offenen Leitungen wäre eine Abfrage je Leitung
 * Arbeit für nichts – die Antwort ist für alle dieselbe. Fünf Sekunden sind
 * feiner, als die Anzeige auflöst (sie zeigt Minuten).
 */
const GELTUNG_MS = 5_000;

/** Der Poller hält fest, wann er diese Kreise zuletzt angefasst hat. */
export const merkeGeprueft = (
	db: Db,
	kreise: Iterable<string>,
	zeitpunkt: number,
): void => {
	const liste = [...kreise];
	if (liste.length === 0) return;
	// Eine Transaktion statt 38 einzelner Schreibvorgänge: Am Wahlabend
	// passiert das jede Minute, und jeder Commit ist ein fsync auf dem PVC.
	transaktion(db, () => {
		for (const slug of liste) metaSet(db, SCHLUESSEL(slug), String(zeitpunkt));
	});
};

let gemerkt: { bis: number; werte: Map<string, number> } | undefined;

/** Nur für Tests: die gemerkte Übersicht verwerfen. */
export const vergissGeprueft = (): void => {
	gemerkt = undefined;
};

/** Slug → Zeitpunkt der letzten Abfrage (ms), aus der Datenbank. */
export const liesGeprueft = (db: Db): Map<string, number> => {
	const jetzt = Date.now();
	if (gemerkt && gemerkt.bis > jetzt) return gemerkt.werte;
	const zeilen = db
		.prepare("SELECT key, value FROM meta WHERE key LIKE ?")
		.all(MUSTER) as Array<{ key: string; value: string }>;
	const werte = new Map<string, number>();
	for (const { key, value } of zeilen) {
		const slug = key.slice("kreis:".length, -":geholt".length);
		const ms = Number(value);
		if (slug && Number.isFinite(ms)) werte.set(slug, ms);
	}
	gemerkt = { bis: jetzt + GELTUNG_MS, werte };
	return werte;
};
