/**
 * Die Aufnahmen für die Browser-Tests erneuern – einmal mit echtem Schlüssel.
 *
 * Danach läuft die ganze Folge ohne einen Aufruf nach außen: Die CI bezahlt
 * keine Inferenz, und trotzdem geht jeder Test den vollen Weg bis zur
 * Gegenstelle.
 *
 * **Warum das hier einen Testlauf steuert, statt selbst zwei Aufrufe zu
 * stellen.** Der Schlüssel einer Aufnahme ist der Inhalt der Anfrage – bei der
 * Moderation also der ganze Kontext, den der Server aus den Fixtures
 * zusammenträgt, Zeile für Zeile. Eine von Hand nachgebaute „typische"
 * Anfrage träfe ihn nie, und die Wiedergabe fände nichts. Also läuft die Folge
 * einmal mit offener Gegenstelle: Was der Server dabei fragt, wird
 * mitgeschnitten (`e2e/mock-openai.ts`) – und genau danach fragt er beim
 * nächsten Mal wieder.
 *
 * Aufruf:  OPENAI_API_KEY=sk-… npm run ansage-aufzeichnen
 */
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { AUFNAHMEN_PFAD } from "../e2e/aufnahmen.ts";

const TESTE = ["e2e/ansage-aufnahme.e2e.ts", "e2e/ansage-ausfall.e2e.ts"];

const lauf = (aufzeichnen: boolean): number =>
	spawnSync(
		process.execPath,
		["scripts/freie-ports.mjs", "npx", "playwright", "test", ...TESTE],
		{
			stdio: "inherit",
			env: aufzeichnen
				? { ...process.env, ANSAGE_AUFZEICHNEN: "1" }
				: { ...process.env, ANSAGE_AUFZEICHNEN: "0", OPENAI_API_KEY: "" },
		},
	).status ?? 1;

/**
 * Der Zugangsschlüssel steht im `authorization`-Kopf und nie im Rumpf – aber
 * geprüft wird es trotzdem. Ein Geheimnis, das einmal im Repository liegt,
 * liegt für immer darin.
 */
const pruefeAufSchluessel = (schluessel: string): void => {
	const gefunden = readdirSync(AUFNAHMEN_PFAD).filter((name) =>
		readFileSync(join(AUFNAHMEN_PFAD, name)).includes(schluessel),
	);
	if (gefunden.length > 0)
		throw new Error(
			`Der Zugangsschlüssel steht in ${gefunden.join(", ")} – nicht einchecken, Aufnahmen verwerfen.`,
		);
	console.log("geprüft: kein Zugangsschlüssel in den Aufnahmen");
};

const schluessel = process.env.OPENAI_API_KEY?.trim() ?? "";
if (!schluessel) {
	console.error(
		"OPENAI_API_KEY fehlt. Ohne echten Schlüssel gibt es nichts aufzuzeichnen.",
	);
	process.exit(2);
}

// Von vorn: Eine Aufnahme, nach der niemand mehr fragt, fiele sonst nie auf.
rmSync(AUFNAHMEN_PFAD, { recursive: true, force: true });

console.log("1/3 Mitschnitt: die Folge läuft mit offener Gegenstelle …");
// Der Ausgang zählt hier nicht: Der erste Durchgang bildet erst, wogegen er
// prüfen soll. Grün werden muss die Gegenprobe.
lauf(true);

console.log("2/3 Aufnahmen prüfen …");
pruefeAufSchluessel(schluessel);
console.log(
	`${readdirSync(AUFNAHMEN_PFAD).filter((n) => n.endsWith(".json")).length} Aufnahmen in ${AUFNAHMEN_PFAD}`,
);

console.log("3/3 Gegenprobe: dieselbe Folge aus der Konserve …");
const code = lauf(false);
console.log(
	code === 0
		? "Aufnahmen erneuert; die Folge läuft ohne einen Aufruf nach außen."
		: "Gegenprobe rot – die Aufnahmen tragen die Tests noch nicht.",
);
process.exit(code);
