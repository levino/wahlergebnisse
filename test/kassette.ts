import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import nock from "nock";

export const KASSETTEN_PFAD = join(
	dirname(fileURLToPath(import.meta.url)),
	"kassetten",
);

export const SCHLUESSEL_MUSTER = /sk-[A-Za-z0-9_-]{12,}/;

type Aufnahmedefinition = {
	scope: string;
	method: string;
	path: string;
	body?: unknown;
	filteringRequestBody?: (koerper: string) => unknown;
};

/**
 * Ohne `KASSETTEN` gilt `lockdown`: Kein Aufruf verlässt den Prozess, und eine
 * Anfrage ohne Aufnahme scheitert laut. `aufnehmen` ergänzt fehlende
 * Kassetten, `neu` verwirft die vorhandenen einmal je Lauf.
 *
 * `update` wäre falsch: Es verwirft die Kassette bei jedem Einlegen, sodass von
 * mehreren Fällen, die sich eine teilen, nur der letzte übrig bliebe.
 */
const modus = (): "record" | "lockdown" =>
	(process.env.KASSETTEN ?? "").trim() === "" ? "lockdown" : "record";

export const nimmtAuf = (): boolean => modus() !== "lockdown";

const verworfen = new Set<string>();

const einmalVerwerfen = (name: string): void => {
	if ((process.env.KASSETTEN ?? "").trim() !== "neu") return;
	if (verworfen.has(name)) return;
	verworfen.add(name);
	rmSync(join(KASSETTEN_PFAD, name), { force: true });
};

/**
 * Wie oft ein Verfahren-und-Pfad in der Kassette vorkommt.
 *
 * `before` bekommt jede Aufnahme einzeln; gezählt werden muss aber über die
 * ganze Kassette, deshalb wird sie vorher gelesen.
 */
const haeufigkeiten = (name: string): Map<string, number> => {
	const datei = join(KASSETTEN_PFAD, name);
	const raus = new Map<string, number>();
	if (!existsSync(datei)) return raus;
	const defs = JSON.parse(readFileSync(datei, "utf8")) as Aufnahmedefinition[];
	for (const d of defs) {
		const marke = `${d.method} ${d.path}`;
		raus.set(marke, (raus.get(marke) ?? 0) + 1);
	}
	return raus;
};

export type Kassette = {
	/** Was die Anwendung wirklich geschickt hat, je Pfad. */
	gesendet: Map<string, string[]>;
	rumpf: (pfad: string, n?: number) => Record<string, unknown>;
	fertig: () => void;
};

export const legeEin = async (
	name: string,
	optionen: { openai?: boolean } = {},
): Promise<Kassette> => {
	if (
		(optionen.openai ?? true) &&
		nimmtAuf() &&
		!SCHLUESSEL_MUSTER.test(process.env.OPENAI_API_KEY ?? "")
	)
		throw new Error(
			"Aufnehmen ohne echten OPENAI_API_KEY schriebe eine Absage in die Kassette",
		);
	einmalVerwerfen(`${name}.json`);
	nock.back.fixtures = KASSETTEN_PFAD;
	nock.back.setMode(modus());

	const gesendet = new Map<string, string[]>();
	const wieOft = haeufigkeiten(`${name}.json`);
	const { nockDone } = await nock.back(`${name}.json`, {
		// Verglichen wird über Verfahren und Pfad, nicht über den
		// Anfragetext: Der trägt den ganzen Moderationskontext, und eine
		// Kassette darf nicht verfallen, weil sich ein Wort daran ändert. Bei
		// mehrfach belegtem Pfad bleibt es beim Text – sonst gewönne immer die
		// erste Aufnahme.
		before: (roh: unknown) => {
			const def = roh as Aufnahmedefinition;
			if (wieOft.get(`${def.method} ${def.path}`) !== 1) return;
			const erwartet = def.body;
			def.filteringRequestBody = (koerper: string) => {
				const liste = gesendet.get(def.path) ?? [];
				liste.push(koerper);
				gesendet.set(def.path, liste);
				return erwartet;
			};
		},
		afterRecord: (defs: unknown[]) => {
			for (const d of defs as Array<Record<string, unknown>>) {
				delete d.reqheaders;
				delete d.badheaders;
			}
			return defs;
		},
	});

	return {
		gesendet,
		rumpf: (pfad, n = 0) => {
			const roh = gesendet.get(pfad)?.[n];
			if (roh === undefined)
				throw new Error(`kein Aufruf an ${pfad} aufgezeichnet`);
			return JSON.parse(roh) as Record<string, unknown>;
		},
		fertig: () => {
			nockDone();
			nock.cleanAll();
		},
	};
};

/** Jede Kassette, die auf der Platte liegt. */
export const kassetten = (): string[] =>
	existsSync(KASSETTEN_PFAD)
		? readdirSync(KASSETTEN_PFAD).filter((n) => n.endsWith(".json"))
		: [];

export const kassetteninhalt = (name: string): string =>
	readFileSync(join(KASSETTEN_PFAD, name), "latin1");
