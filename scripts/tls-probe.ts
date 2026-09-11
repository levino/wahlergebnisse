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
	if (lage !== "ok") for (const z of liste) console.log(`   ${z}`);
}
