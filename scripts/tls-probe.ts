/**
 * Prüft die Zertifikatsketten aller Hosts, die in `kreise.ts` stehen.
 *
 *   node --experimental-strip-types scripts/tls-probe.ts
 *
 * Warum es das gibt: Ein Abruf, der fehlschlägt, sagt für sich genommen nicht,
 * ob die Daten fehlen oder ob nur die Verbindung nicht zustande kommt. Genau
 * diese Verwechslung hat dazu geführt, dass für mehrere Kreise „keine
 * Ergebnisse“ behauptet wurde, obwohl es welche gibt: `curl` brach mit HTTP 000
 * ab, weil ein Server die Kette unvollständig ausliefert, und niemand hat
 * hinter den Fehlschlag geschaut.
 *
 * Das Skript trennt beides und prüft dabei mit **Nodes** Wurzelspeicher – dem,
 * unter dem der Poller wirklich läuft. Er ist nicht derselbe wie der des
 * Betriebssystems: `wahl.landkreis-celle.de` scheitert an `curl` und gelingt
 * aus Node heraus (siehe src/lib/zertifikate.ts).
 *
 * Es läuft nicht in der CI – es geht ins offene Netz und dient der Erhebung von
 * Hand.
 */
import { connect } from "node:tls";
import { KREISE, wurzelVon } from "../src/data/kreise.ts";
import { pruefeWurzelspeicher } from "../src/lib/zertifikate.ts";

type Lage = "ok" | "kette-unvollstaendig" | "kein-anschluss";

const pruefe = (host: string): Promise<string | null> =>
	new Promise((fertig) => {
		const s = connect(
			{ host, port: 443, servername: host, timeout: 15_000 },
			() => {
				const fehler = s.authorized
					? null
					: (s.authorizationError ?? "unbekannt");
				s.destroy();
				fertig(fehler === null ? null : String(fehler));
			},
		);
		s.on("error", (e: Error) => {
			s.destroy();
			fertig(`VERBINDUNG: ${e.message}`);
		});
		s.on("timeout", () => {
			s.destroy();
			fertig("VERBINDUNG: timeout");
		});
	});

const fehlend = pruefeWurzelspeicher();
if (fehlend.length)
	console.log(
		`ACHTUNG: ${fehlend.length} benötigte Wurzel(n) fehlen im Speicher:\n` +
			fehlend.map((w) => `   ${w.cn} – ${w.warum}`).join("\n"),
	);

// Behörden-Wurzeln und amtliche Fundstellen zusammen: Beide sind Adressen, auf
// die sich die Anwendung verlässt – die einen zum Abfragen, die anderen zum
// Verlinken. Ein toter Link ist genauso schlecht wie ein toter Abruf.
const hosts = new Set<string>();
for (const k of KREISE) {
	for (const b of k.behoerden) hosts.add(new URL(wurzelVon(k, b)).host);
	for (const q of k.quellen ?? []) hosts.add(new URL(q.url).host);
}

console.log(`${hosts.size} Hosts aus ${KREISE.length} Kreisen\n`);

const zusammen: Record<Lage, string[]> = {
	ok: [],
	"kette-unvollstaendig": [],
	"kein-anschluss": [],
};

for (const host of [...hosts].sort()) {
	const fehler = await pruefe(host);
	if (fehler === null) zusammen.ok.push(host);
	else if (fehler.startsWith("VERBINDUNG:"))
		zusammen["kein-anschluss"].push(`${host}  (${fehler})`);
	else zusammen["kette-unvollstaendig"].push(`${host}  (${fehler})`);
}

for (const [lage, liste] of Object.entries(zusammen)) {
	console.log(`\n== ${lage}: ${liste.length}`);
	// „ok“ ist der Normalfall und interessiert nur als Zahl.
	if (lage !== "ok") for (const z of liste) console.log(`   ${z}`);
}
