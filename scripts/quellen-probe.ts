/**
 * Ruft jede amtliche Fundstelle aus dem Katalog ab und meldet Status und Größe.
 *
 *   node --experimental-strip-types scripts/quellen-probe.ts
 *
 * Diese Links sind das Einzige, was ein Kreis ohne eigene Zahlen anzubieten
 * hat. Ein toter Link wäre dort schlimmer als keiner – er sähe aus wie eine
 * Auskunft und wäre keine. Deshalb sind sie belegt, und deshalb lässt sich der
 * Beleg wiederholen.
 *
 * Nicht in der CI: Es geht ins offene Netz und hängt von fremden Servern ab.
 */
import { KREISE } from "../src/data/kreise.ts";

let schlecht = 0;
let geprueft = 0;

for (const k of KREISE) {
	if (!k.quellen?.length) continue;
	console.log(`\n${k.name} (${k.slug}, vorhanden: ${k.vorhanden})`);
	for (const q of k.quellen) {
		geprueft++;
		try {
			const r = await fetch(q.url, {
				redirect: "follow",
				signal: AbortSignal.timeout(25_000),
			});
			const groesse = (await r.arrayBuffer()).byteLength;
			// Eine Weiterleitung ist in Ordnung, solange am Ende etwas steht;
			// eine Fehlerseite mit 200 erkennt man an der Winzigkeit.
			const gut = r.ok && groesse > 500;
			if (!gut) schlecht++;
			console.log(
				`  ${gut ? "OK  " : "FEHL"} ${r.status} ${String(groesse).padStart(7)} B  ${q.titel}\n       ${q.url}`,
			);
		} catch (e) {
			schlecht++;
			console.log(
				`  FEHL ${(e as Error).message}  ${q.titel}\n       ${q.url}`,
			);
		}
	}
}

console.log(`\n${geprueft} Fundstellen geprüft, ${schlecht} zu beanstanden`);
if (schlecht) process.exitCode = 1;
