/**
 * Einen Ausgangsbestand ziehen (siehe `docs/ausgangsbestand.md`).
 *
 *   npm run schnappschuss                       ganze Kette: Kopie ziehen, packen, aufräumen
 *   npm run schnappschuss -- --roh              nur die Kopie (VACUUM INTO), nicht packen
 *   npm run schnappschuss -- --packen datei.db  eine fertige Kopie packen
 *   npm run schnappschuss -- --pruefen datei.zst  Gegenprobe: entpacken und ansehen
 *
 * Weitere Angaben:
 *   --db <pfad>      Quelldatenbank (Vorgabe: DATABASE_PATH bzw. ./data/wahlen.db)
 *   --ziel <pfad>    Zieldatei
 *   --stufe <n>      zstd-Stufe (Vorgabe 19)
 *   --herkunft <txt> Notiz, die im Schnappschuss landet
 *
 * **Warum die Zerlegung.** Im Poller-Pod stehen 512 MiB, und `-19` will davon
 * gut 100 MB für sein Fenster – dort ist heute schon ein `gzip -9` am OOM
 * gestorben. Deshalb wird in Produktion nur die Kopie im Pod gezogen
 * (`--roh`), herausgestreamt und **außerhalb** gepackt (`--packen`). Lokal,
 * wo der Speicher nicht gedeckelt ist, macht der Aufruf ohne Schalter beides
 * am Stück.
 *
 * Die Quelle wird immer **nur lesend** geöffnet: Auf dem Volume schreibt der
 * Poller, und ein zweiter Schreiber ist dort das Einzige, was nicht sein darf.
 */
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
	// Gegenprobe vor dem Veröffentlichen: Ein Anhang, der sich nicht entpacken
	// oder nicht öffnen lässt, fiele sonst erst beim Kaltstart einer echten
	// Instanz auf – und dort ist es zu spät.
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
	// Nur packen: Die Kopie liegt schon vor (aus dem Pod herausgestreamt).
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
// Die rohe Kopie ist so groß wie die Datenbank selbst – sie darf nicht neben
// ihr liegen bleiben.
rmSync(zielRoh, { force: true });
console.log(
	`${ziel}: ${mb(gepackt)} (${(bytes / gepackt).toFixed(1)}:1, zstd -${stufe})`,
);
