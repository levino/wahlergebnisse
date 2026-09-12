import { existsSync, rmSync, statSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import {
	filtereFuerProbe,
	probenTermin,
	probenTermine,
	probenZeilen,
} from "../src/lib/demo-bestand.ts";
import {
	STUFE,
	bestand,
	entpacke,
	erzeugeKopie,
	packe,
} from "../src/lib/schnappschuss.ts";

const args = process.argv.slice(2);
const wert = (name: string): string | undefined => {
	const i = args.indexOf(name);
	return i >= 0 ? args[i + 1] : undefined;
};
const roh = args.includes("--roh");
const packenVon = wert("--packen");
const pruefen = wert("--pruefen");
const quelle = wert("--db") ?? process.env.DATABASE_PATH ?? "./data/wahlen.db";
const stufe = Number(wert("--stufe") ?? STUFE);
const mb = (b: number) => `${(b / 1e6).toFixed(1)} MB`;

/** Was in einer fertigen Fassung steht – die Zahlen, an denen die Probe hängt. */
const beschreibe = (pfad: string): string => {
	const b = bestand(pfad);
	return `${b.zeilen} Ergebniszeilen, davon ${probenZeilen(pfad)} zum Probentermin, Datenstand ${b.datenstand}, gezogen am ${b.erzeugt ?? "unbekannt"}`;
};

if (pruefen) {
	const ziel = join(tmpdir(), `demo-bestand-probe-${process.pid}.db`);
	await entpacke(pruefen, ziel);
	const spielbar = probenZeilen(ziel);
	console.log(
		`${pruefen}: ${mb(statSync(ziel).size)} entpackt, ${beschreibe(ziel)}`,
	);
	rmSync(ziel, { force: true });
	if (spielbar === 0) {
		console.error(
			"Keine einzige Zeile zum Probentermin – daraus spielt die Generalprobe nichts.",
		);
		process.exit(1);
	}
	process.exit(0);
}

if (packenVon) {
	if (!existsSync(packenVon)) {
		console.error(`${packenVon} gibt es nicht.`);
		process.exit(1);
	}
	const beschreibung = beschreibe(packenVon);
	const ziel = wert("--ziel") ?? "daten/demo-bestand.db.zst";
	const rohBytes = statSync(packenVon).size;
	const bytes = await packe(packenVon, ziel, stufe);
	console.log(
		`${ziel}: ${mb(bytes)} gepackt aus ${mb(rohBytes)} roh (${(rohBytes / bytes).toFixed(1)}:1, zstd -${stufe}), ${beschreibung}`,
	);
	process.exit(0);
}

const probe = probenTermin();
console.log(
	`Probentermin: ${probe?.id ?? "keiner"} – behalten werden ${probenTermine().length} Termine (er und alles davor)`,
);

const zielRoh = roh
	? (wert("--ziel") ?? `${quelle}.demo-bestand`)
	: `${quelle}.demo-bestand`;
const { bytes: vorherBytes } = erzeugeKopie(
	quelle,
	zielRoh,
	wert("--herkunft") ?? `${hostname()}:${quelle}`,
);
const geloescht = filtereFuerProbe(zielRoh);
for (const [was, n] of geloescht) console.log(`  − ${n} Zeilen  ${was}`);
const nachherBytes = statSync(zielRoh).size;
console.log(
	`Gefilterte Kopie ${zielRoh}: ${mb(nachherBytes)} (aus ${mb(vorherBytes)}), ${beschreibe(zielRoh)}`,
);
if (roh) process.exit(0);

const ziel = wert("--ziel") ?? "daten/demo-bestand.db.zst";
const gepackt = await packe(zielRoh, ziel, stufe);
rmSync(zielRoh, { force: true });
console.log(
	`${ziel}: ${mb(gepackt)} gepackt aus ${mb(nachherBytes)} roh (${(nachherBytes / gepackt).toFixed(1)}:1, zstd -${stufe})`,
);
