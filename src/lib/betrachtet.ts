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

const SCHREIBABSTAND_MS = 15_000;

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

	schreibe();

	const uhr = setInterval(() => {
		if (offen || (kreise.size > 0 && Date.now() - geschrieben >= abstand))
			schreibe();
	}, abstand);
	uhr.unref?.();

	return {
		melde,
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
		for (const [slug, zeit] of Object.entries(meldung.kreise ?? {})) {
			if (typeof zeit !== "number") continue;
			const alt = zusammen.get(slug);
			if (alt === undefined || zeit > alt) zusammen.set(slug, zeit);
		}
	}
	return zusammen;
};
