/**
 * CLI: einen Termin (oder alle) einmal abgleichen.
 *   node server/poll.ts            → alle Termine (Archiv-Termine nur, wenn noch nicht vollständig)
 *   node server/poll.ts 2026       → nur diesen Termin
 *   node server/poll.ts 2021 --force --behoerde 03254026
 */
import { TERMINE, istAbgeschlossen, terminById } from "../src/data/termine.ts";
import { dbPfad, oeffneDb } from "../src/lib/db.ts";
import { pollTermin, terminVollstaendig } from "../src/lib/poll.ts";

const args = process.argv.slice(2);
const force = args.includes("--force");
const bIdx = args.indexOf("--behoerde");
const nurBehoerden = bIdx >= 0 ? [args[bIdx + 1]] : undefined;
// Termin-Ids sind entweder ein Jahr ("2021") oder ein Wahltag ("2019-05-26"):
// Die Vorwerte der Direktwahlen tragen den Tag, weil es je Jahr mehrere gibt.
// Ohne die zweite Form wäre `poll.ts 2019-05-26` still durchgefallen und hätte
// statt eines Termins alle abgeglichen.
const ids = args.filter((a) => /^\d{4}(?:-\d{2}-\d{2})?$/.test(a));
const termine = ids.length
	? ids
			.map((id) => terminById(id))
			.filter((t): t is NonNullable<typeof t> => Boolean(t))
	: TERMINE;

const db = oeffneDb(dbPfad());
for (const termin of termine) {
	// Eingefroren: Das Ergebnis ist amtlich, die Quelle wird nicht mehr
	// angefasst (docs/ausgangsbestand.md). `--force` hebt das auf – von Hand
	// nachzuladen muss möglich bleiben, von allein passieren darf es nicht.
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
