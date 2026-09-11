import { existsSync, rmSync, statSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
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
const heute = new Date().toISOString().slice(0, 10);
const mb = (b: number) => `${(b / 1e6).toFixed(1)} MB`;

if (pruefen) {
	const ziel = join(tmpdir(), `schnappschuss-probe-${process.pid}.db`);
	await entpacke(pruefen, ziel);
	const b = bestand(ziel);
	console.log(
		`${pruefen}: ${mb(statSync(ziel).size)} entpackt, ${b.zeilen} Ergebniszeilen, Datenstand ${b.datenstand}, gezogen am ${b.erzeugt ?? "unbekannt"}`,
	);
	rmSync(ziel, { force: true });
	if (b.zeilen === 0) {
		console.error(
			"Keine einzige Ergebniszeile – das ist kein Ausgangsbestand.",
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
	const b = bestand(packenVon);
	const ziel = wert("--ziel") ?? `${packenVon}.zst`;
	const roh_bytes = statSync(packenVon).size;
	const bytes = await packe(packenVon, ziel, stufe);
	console.log(
		`${ziel}: ${mb(bytes)} (aus ${mb(roh_bytes)}, ${(roh_bytes / bytes).toFixed(1)}:1), ${b.zeilen} Ergebniszeilen, Datenstand ${b.datenstand}, gezogen am ${b.erzeugt ?? "unbekannt"}`,
	);
	process.exit(0);
}

const zielRoh = roh
	? (wert("--ziel") ?? `${quelle}.schnappschuss`)
	: `${quelle}.schnappschuss`;
const { bytes, erzeugt } = erzeugeKopie(
	quelle,
	zielRoh,
	wert("--herkunft") ?? `${hostname()}:${quelle}`,
);
const b = bestand(zielRoh);
console.log(
	`Kopie ${zielRoh}: ${mb(bytes)}, ${b.zeilen} Ergebniszeilen, Datenstand ${b.datenstand}, gezogen am ${erzeugt}`,
);
if (roh) process.exit(0);

const ziel = wert("--ziel") ?? `wahlen-${heute}.db.zst`;
const gepackt = await packe(zielRoh, ziel, stufe);
rmSync(zielRoh, { force: true });
console.log(
	`${ziel}: ${mb(gepackt)} (${(bytes / gepackt).toFixed(1)}:1, zstd -${stufe})`,
);
