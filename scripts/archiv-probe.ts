import { statSync } from "node:fs";
import { KREISE } from "../src/data/kreise.ts";
import { terminById } from "../src/data/termine.ts";
import { dbPfad, oeffneDb } from "../src/lib/db.ts";
import { pollTermin } from "../src/lib/poll.ts";

const [terminId, kreiseArg, behoerdenArg] = process.argv.slice(2);
const termin = terminById(terminId ?? "2021");
if (!termin) throw new Error(`Unbekannter Termin: ${terminId}`);
const nurKreise = kreiseArg?.split(",").filter(Boolean);
const nurBehoerden = behoerdenArg?.split(",").filter(Boolean);

const db = oeffneDb(dbPfad());
const t0 = Date.now();
const stat = await pollTermin(db, termin, {
	nurKreise,
	nurBehoerden,
	log: (m) => console.log(`  ${m}`),
});
const dauer = (Date.now() - t0) / 1000;

const agsListe = KREISE.filter((k) => !nurKreise || nurKreise.includes(k.slug))
	.flatMap((k) => k.behoerden.map((b) => b.ags))
	.filter((a) => !nurBehoerden || nurBehoerden.includes(a));
const platzhalter = agsListe.map(() => "?").join(", ");
const zahl = (sql: string): number =>
	(db.prepare(sql).get(termin.id, ...agsListe) as { n: number }).n;

console.log(
	`\n=== ${termin.titel} · ${nurKreise?.join(", ") ?? "alle Kreise"}`,
);
console.log(`Anfragen        ${stat.anfragen}`);
console.log(`Fehler          ${stat.fehler.length}`);
for (const f of stat.fehler.slice(0, 10)) console.log(`  ! ${f}`);
console.log(`Dauer           ${dauer.toFixed(1)} s`);
console.log(
	`Behörden        ${zahl(`SELECT COUNT(DISTINCT behoerde) n FROM wahleintraege WHERE termin = ? AND behoerde IN (${platzhalter})`)} von ${agsListe.length}`,
);
console.log(
	`Wahlen          ${zahl(`SELECT COUNT(*) n FROM wahlen WHERE termin = ? AND behoerde IN (${platzhalter})`)}`,
);
console.log(
	`Ergebnisse      ${zahl(`SELECT COUNT(*) n FROM ergebnisse WHERE termin = ? AND behoerde IN (${platzhalter})`)} Gebiete`,
);
console.log(
	`davon mit Sitzen ${zahl(`SELECT COUNT(*) n FROM ergebnisse WHERE termin = ? AND behoerde IN (${platzhalter}) AND json LIKE '%"sitze"%'`)}`,
);
console.log(
	`Wahlvorschläge  ${zahl(`SELECT COUNT(*) n FROM wahlvorschlaege WHERE termin = ? AND behoerde IN (${platzhalter})`)} Listenplätze`,
);
console.log(`Datenbank       ${(statSync(dbPfad()).size / 1e6).toFixed(1)} MB`);

for (const r of db
	.prepare(
		`SELECT behoerde, titel, json_extract(json, '$.sitze.gesamt') AS sitze
		 FROM wahlen WHERE termin = ? AND behoerde IN (${platzhalter})
		 ORDER BY behoerde, wahl_id LIMIT 40`,
	)
	.all(termin.id, ...agsListe) as Array<{
	behoerde: string;
	titel: string;
	sitze: number | null;
}>)
	console.log(
		`  ${r.behoerde}  ${r.titel}${r.sitze ? ` – ${r.sitze} Sitze` : ""}`,
	);
