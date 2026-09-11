import { TERMINE, istAbgeschlossen, terminById } from "../src/data/termine.ts";
import { dbPfad, oeffneDb } from "../src/lib/db.ts";
import { pollTermin, terminVollstaendig } from "../src/lib/poll.ts";

const args = process.argv.slice(2);
const force = args.includes("--force");
const bIdx = args.indexOf("--behoerde");
const nurBehoerden = bIdx >= 0 ? [args[bIdx + 1]] : undefined;
const ids = args.filter((a) => /^\d{4}(?:-\d{2}-\d{2})?$/.test(a));
const termine = ids.length
	? ids
			.map((id) => terminById(id))
			.filter((t): t is NonNullable<typeof t> => Boolean(t))
	: TERMINE;

const db = oeffneDb(dbPfad());
for (const termin of termine) {
	if (istAbgeschlossen(termin) && !force) {
		console.log(
			`${termin.id}: abgeschlossen (amtliches Endergebnis), wird nicht mehr abgefragt – mit --force trotzdem`,
		);
		continue;
	}
	if (
		!termin.live &&
		!force &&
		terminVollstaendig(db, termin) &&
		!nurBehoerden
	) {
		console.log(
			`${termin.id}: bereits vollständig geladen (Archiv), überspringe – mit --force erneut laden`,
		);
		continue;
	}
	const t0 = Date.now();
	const stat = await pollTermin(db, termin, {
		force,
		nurBehoerden,
		log: (m) => console.log(m),
	});
	console.log(
		`${termin.id}: ${stat.anfragen} Anfragen, ${stat.geaendert} Änderungen, ${stat.fehler.length} Fehler in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
	);
}
