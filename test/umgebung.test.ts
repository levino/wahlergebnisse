import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ENV_DATEI, uebernimmEnvDatei } from "../scripts/umgebung.ts";
import { aufraeumen, tempVerzeichnis } from "./helfer.ts";

const AUS_DATEI = "schluessel-aus-der-datei";
const AUS_UMGEBUNG = "schluessel-aus-der-umgebung";

const verzeichnisse: string[] = [];

const neuesVerzeichnis = (): string => {
	const tmp = tempVerzeichnis("wahlen-umgebung-");
	verzeichnisse.push(tmp);
	return tmp;
};

const mitEnvDatei = (inhalt: string): string => {
	const tmp = neuesVerzeichnis();
	writeFileSync(join(tmp, ENV_DATEI), inhalt);
	return tmp;
};

afterEach(() => {
	for (const d of verzeichnisse.splice(0)) aufraeumen(d);
	delete process.env.OPENAI_API_KEY;
});

describe("uebernimmEnvDatei", () => {
	it("holt OPENAI_API_KEY aus der Datei, wenn die Umgebung ihn nicht kennt", () => {
		delete process.env.OPENAI_API_KEY;
		const tmp = mitEnvDatei(`OPENAI_API_KEY=${AUS_DATEI}\n`);
		expect(uebernimmEnvDatei(tmp)).toContain("OPENAI_API_KEY");
		expect(process.env.OPENAI_API_KEY).toBe(AUS_DATEI);
	});

	it("lässt der Umgebung den Vortritt", () => {
		process.env.OPENAI_API_KEY = AUS_UMGEBUNG;
		const tmp = mitEnvDatei(`OPENAI_API_KEY=${AUS_DATEI}\n`);
		expect(uebernimmEnvDatei(tmp)).not.toContain("OPENAI_API_KEY");
		expect(process.env.OPENAI_API_KEY).toBe(AUS_UMGEBUNG);
	});

	it("nennt nur Namen und nie Werte", () => {
		delete process.env.OPENAI_API_KEY;
		const tmp = mitEnvDatei(`OPENAI_API_KEY=${AUS_DATEI}\n`);
		expect(uebernimmEnvDatei(tmp).join(" ")).not.toContain(AUS_DATEI);
	});

	it("kommt ohne Datei aus", () => {
		expect(uebernimmEnvDatei(neuesVerzeichnis())).toEqual([]);
	});

	it("liest eine Datei, die das Repository nie sieht", () => {
		expect(readFileSync(".gitignore", "utf8").split(/\r?\n/)).toContain(
			ENV_DATEI,
		);
	});
});
