import { DatabaseSync } from "node:sqlite";
import { KATALOG } from "../src/data/kreis-katalog.ts";
import { gliederungFuer } from "../src/data/wahlgliederungen.ts";
import {
	type Bestand,
	type Fall,
	type Messung,
	bericht,
	bestandAus,
	kreistagszahlenAus,
	pruefeAbdeckung,
} from "../src/lib/abdeckung.ts";

const args = process.argv.slice(2);
const wert = (name: string): string | undefined => {
	const i = args.indexOf(name);
	return i >= 0 ? args[i + 1] : undefined;
};

const terminId = wert("--termin") ?? "2026";
/** Termin, dessen amtliche Kreistagszahlen den Katalog nachrechnen. */
const massTermin = wert("--mass") ?? "2021";
const vergleichId = wert("--vergleich");
const api = wert("--api");
const dbPfad = wert("--db") ?? process.env.DATABASE_PATH;
const nurFall = wert("--fall") as Fall | undefined;
const zeilen = Number(wert("--zeilen") ?? 25);

const verzeichnis = gliederungFuer(terminId);
if (!verzeichnis) {
	console.error(
		`Für den Termin ${terminId} gibt es kein Verzeichnis unter src/data/wahlgliederung/.`,
	);
	process.exit(1);
}
const vergleich = vergleichId ? gliederungFuer(vergleichId) : undefined;
if (vergleichId && !vergleich) {
	console.error(`Für den Vergleichstermin ${vergleichId} gibt es keines.`);
	process.exit(1);
}

const ausApi = async (basis: string): Promise<Bestand> => {
	const wahlen = new Map<string, Set<string>>();
	const gebiete = new Map<string, Set<string>>();
	const wahlbezirke = new Map<string, number>();
	const hol = async <T>(pfad: string): Promise<T | undefined> => {
		const r = await fetch(`${basis}${pfad}`, {
			signal: AbortSignal.timeout(90000),
		});
		return r.ok ? ((await r.json()) as T) : undefined;
	};
	for (const k of KATALOG) {
		const antwort = await hol<{
			wahlen: Array<{ behoerde: { ags: string }; slug: string }>;
		}>(`/${k.slug}/${terminId}/wahlen`);
		for (const w of antwort?.wahlen ?? []) {
			const s = wahlen.get(w.behoerde.ags) ?? new Set<string>();
			s.add(w.slug);
			wahlen.set(w.behoerde.ags, s);
		}
		for (const b of k.behoerden) {
			const raeume = await hol<{ wahlraeume: Array<{ wahlbezirk: string }> }>(
				`/${k.slug}/${terminId}/${b.slug}/wahlraeume`,
			);
			if (raeume)
				wahlbezirke.set(
					b.ags,
					new Set(raeume.wahlraeume.map((r) => r.wahlbezirk)).size,
				);
		}
		const kreistag = wahlen.get(k.ags)?.has("kreistag");
		if (!kreistag) continue;
		const g = await hol<{ gebiete: Array<{ gebiet: { id: string } }> }>(
			`/${k.slug}/${terminId}/kreis/kreistag/gebiete`,
		);
		if (g)
			gebiete.set(
				`${k.ags}/kreistag`,
				new Set(g.gebiete.map((x) => x.gebiet.id)),
			);
		process.stderr.write(".");
	}
	process.stderr.write("\n");
	return { wahlen, gebiete, wahlbezirke };
};

const db = api
	? undefined
	: new DatabaseSync(dbPfad ?? "./data/wahlen.db", { readOnly: true });

const bestand = db
	? bestandAus(db, terminId)
	: await ausApi((api as string).replace(/\/$/, ""));

const messung: Messung | undefined = db
	? { termin: massTermin, zahlen: kreistagszahlenAus(db, massTermin) }
	: undefined;
if (!messung)
	console.error(
		`Ohne Datenbank kein Maßstab: die Vollständigkeit des Katalogs bleibt für ${massTermin} ungeprüft.`,
	);
else if (messung.zahlen.size === 0)
	console.error(
		`Zum Messtermin ${massTermin} liegt keine einzige Kreistagswahl vor: die Vollständigkeit des Katalogs bleibt ungeprüft.`,
	);

const befunde = pruefeAbdeckung({
	verzeichnis,
	vergleich,
	bestand,
	katalog: KATALOG,
	messung,
}).filter((b) => !nurFall || b.fall === nurFall);
const b = bericht(terminId, befunde);

const UEBERSCHRIFT: Record<Fall, string> = {
	anwendung: "Veröffentlicht, aber von uns nicht abgebildet – unser Fehler",
	wahlleitung: "Von der Wahlleitung nicht veröffentlicht – keine Lücke bei uns",
	verzeichnis:
		"Die Anwendung führt mehr als das Verzeichnis – Verzeichnis nachziehen",
	messung: "Die Probe entscheidet nicht – der Maßstab hat selbst Lücken",
};

console.log(
	`Termin ${terminId}${vergleich ? ` gegen ${vergleich.termin}` : ""}, Katalog gemessen an ${massTermin}: ${b.gesamt} Befunde ` +
		`(${b.jeFall.anwendung} Anwendung, ${b.jeFall.wahlleitung} Wahlleitung, ${b.jeFall.verzeichnis} Verzeichnis, ${b.jeFall.messung} Messung)`,
);
for (const fall of [
	"anwendung",
	"wahlleitung",
	"verzeichnis",
	"messung",
] as Fall[]) {
	const liste = befunde.filter((x) => x.fall === fall);
	if (!liste.length) continue;
	console.log(`\n## ${UEBERSCHRIFT[fall]} (${liste.length})`);
	const jeEbene = new Map<string, typeof liste>();
	for (const x of liste) {
		const l = jeEbene.get(x.ebene) ?? [];
		l.push(x);
		jeEbene.set(x.ebene, l);
	}
	for (const [ebene, xs] of [...jeEbene].sort(
		(a, c) => c[1].length - a[1].length,
	)) {
		console.log(`  ${ebene}: ${xs.length}`);
		for (const x of xs.slice(0, zeilen))
			console.log(`    ${x.kreis} – ${x.text}`);
		if (xs.length > zeilen)
			console.log(`    … und ${xs.length - zeilen} weitere`);
	}
}
process.exit(b.jeFall.anwendung > 0 ? 1 : 0);
