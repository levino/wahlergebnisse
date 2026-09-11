import { existsSync } from "node:fs";
import { join } from "node:path";

export const ENV_DATEI = ".env";

/** Die Namen, die aus der Datei dazugekommen sind – nie ihre Werte. */
export const uebernimmEnvDatei = (
	verzeichnis: string = process.cwd(),
): string[] => {
	const pfad = join(verzeichnis, ENV_DATEI);
	if (!existsSync(pfad)) return [];
	const vorher = new Set(Object.keys(process.env));
	process.loadEnvFile(pfad);
	return Object.keys(process.env).filter((name) => !vorher.has(name));
};
