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
	/**
	 * Topic → Zeitpunkt des letzten Aufrufs.
	 *
	 * Feiner als `kreise`: Wahlleitung und eingestellte Partei. Der Poller
	 * erzeugt nur für Topics, die hier stehen – für einen Kreis allein ließe
	 * sich weder die richtige Wahlleitung noch die richtige Partei bestimmen.
	 */
	topics?: Record<string, number>;
};

const SCHREIBABSTAND_MS = 15_000;

const HOECHSTALTER_MS = 4 * SCHREIBABSTAND_MS;

/** Ab wann eine liegengebliebene Datei gelöscht wird. */
const AUFRAEUMEN_AB_MS = 30 * 60 * 1000;

export type Melder = {
	/** Ein Kreis wurde gerade angesehen. */
	melde: (kreisSlug: string) => void;
	/** Ein Topic wird gerade betrachtet – Wahlleitung samt Partei. */
	meldeTopic: (topic: string) => void;
	/** Sofort schreiben (Tests; sonst erledigt es die Uhr). */
	schreibe: () => void;
	/** Uhr anhalten und die eigene Datei entfernen. */
	schliesse: () => void;
};

const dateiName = (id: string) => `${id.replace(/[^A-Za-z0-9_.-]/g, "_")}.json`;

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
	const topics = new Map<string, number>();
	let offen = false;
	let geschrieben = 0;

	const schreibe = () => {
		const jetzt = Date.now();
		for (const [slug, zeit] of kreise)
			if (jetzt - zeit > frist) kreise.delete(slug);
		for (const [name, zeit] of topics)
			if (jetzt - zeit > frist) topics.delete(name);
		const meldung: Meldung = {
			stand: jetzt,
			kreise: Object.fromEntries(kreise),
			topics: Object.fromEntries(topics),
		};
		try {
			mkdirSync(opt.verzeichnis, { recursive: true });
			writeFileSync(vorlaeufig, JSON.stringify(meldung), "utf8");
			renameSync(vorlaeufig, ziel);
			offen = false;
			geschrieben = jetzt;
		} catch {}
	};

	const melde = (kreisSlug: string) => {
		kreise.set(kreisSlug, Date.now());
		offen = true;
	};

	const meldeTopic = (topic: string) => {
		topics.set(topic, Date.now());
		offen = true;
	};

	schreibe();

	const uhr = setInterval(() => {
		if (offen || (kreise.size > 0 && Date.now() - geschrieben >= abstand))
			schreibe();
	}, abstand);
	uhr.unref?.();

	return {
		melde,
		meldeTopic,
		schreibe,
		schliesse: () => {
			clearInterval(uhr);
			try {
				rmSync(ziel, { force: true });
				rmSync(vorlaeufig, { force: true });
			} catch {
				/* dann räumt es der Poller weg */
			}
		},
	};
};

type LeseOpt = { hoechstalterMs?: number; jetzt?: number };

const zusammenAus = (
	verzeichnis: string,
	feld: (m: Meldung) => Record<string, number> | undefined,
	opt: LeseOpt,
): Map<string, number> => {
	const jetzt = opt.jetzt ?? Date.now();
	const hoechstalter = opt.hoechstalterMs ?? HOECHSTALTER_MS;
	const zusammen = new Map<string, number>();
	let dateien: string[];
	try {
		dateien = readdirSync(verzeichnis);
	} catch {
		return zusammen;
	}
	for (const name of dateien) {
		if (!name.endsWith(".json")) continue;
		const pfad = join(verzeichnis, name);
		let meldung: Meldung;
		try {
			meldung = JSON.parse(readFileSync(pfad, "utf8")) as Meldung;
		} catch {
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
		for (const [schluessel, zeit] of Object.entries(feld(meldung) ?? {})) {
			if (typeof zeit !== "number") continue;
			const alt = zusammen.get(schluessel);
			if (alt === undefined || zeit > alt) zusammen.set(schluessel, zeit);
		}
	}
	return zusammen;
};

export const liesBetrachtet = (
	verzeichnis: string,
	opt: LeseOpt = {},
): Map<string, number> => zusammenAus(verzeichnis, (m) => m.kreise, opt);

/** Topics, die gerade jemand offen hat – Wahlleitung samt Partei. */
export const liesTopics = (
	verzeichnis: string,
	opt: LeseOpt = {},
): Map<string, number> => zusammenAus(verzeichnis, (m) => m.topics, opt);
