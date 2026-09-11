import type { Db } from "./db.ts";
import { metaSet, transaktion } from "./db.ts";

/** Schlüssel in der Meta-Tabelle: `kreis:<slug>:geholt` → Millisekunden. */
const SCHLUESSEL = (slug: string) => `kreis:${slug}:geholt`;
const MUSTER = "kreis:%:geholt";

const GELTUNG_MS = 5_000;

/** Der Poller hält fest, wann er diese Kreise zuletzt angefasst hat. */
export const merkeGeprueft = (
	db: Db,
	kreise: Iterable<string>,
	zeitpunkt: number,
): void => {
	const liste = [...kreise];
	if (liste.length === 0) return;
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
