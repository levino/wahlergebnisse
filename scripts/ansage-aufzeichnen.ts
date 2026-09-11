import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { AUFNAHMEN_PFAD } from "../e2e/aufnahmen.ts";
import { ENV_DATEI, uebernimmEnvDatei } from "./umgebung.ts";

/**
 * Kein Browser-Test ruft die Gegenstelle mehr: Der Client fordert weder
 * Moderation noch Aufnahme an, er holt hinterlegte Pakete. Sobald der Poller
 * erzeugt, gehört hier der Lauf hinein, der ihn dabei mitschneidet.
 */
const TESTE: string[] = [];

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

const uebernommen = uebernimmEnvDatei();
if (uebernommen.length > 0)
	console.log(`${ENV_DATEI} gelesen: ${uebernommen.join(", ")}`);

if (TESTE.length === 0) {
	console.log(
		"Nichts aufzuzeichnen: Kein Browser-Test ruft die Gegenstelle. Die vorhandenen Aufnahmen bleiben unberührt.",
	);
	process.exit(0);
}

const schluessel = process.env.OPENAI_API_KEY?.trim() ?? "";
if (!schluessel) {
	console.error(
		`OPENAI_API_KEY fehlt – weder in der Umgebung noch in ${ENV_DATEI}. Ohne echten Schlüssel gibt es nichts aufzuzeichnen.`,
	);
	process.exit(2);
}

rmSync(AUFNAHMEN_PFAD, { recursive: true, force: true });

console.log("1/3 Mitschnitt: die Folge läuft mit offener Gegenstelle …");
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
