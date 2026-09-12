import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const WURZEL = resolve(new URL("..", import.meta.url).pathname);
const DIENST = "src/lib/ansage-datei.ts";

const dateien = (dir: string): string[] =>
	readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
		const pfad = join(dir, e.name);
		return e.isDirectory()
			? dateien(pfad)
			: /\.(ts|tsx|astro|mjs)$/.test(e.name)
				? [pfad]
				: [];
	});

const bezuege = (pfad: string): string[] =>
	[
		...readFileSync(pfad, "utf8").matchAll(
			/(?:from|import)\s*\(?\s*["'](\.[^"']+)["']/g,
		),
	].map((t) => t[1]);

const aufloesen = (von: string, spez: string): string | undefined => {
	const roh = resolve(dirname(von), spez);
	for (const kandidat of [
		roh,
		`${roh}.ts`,
		`${roh}.astro`,
		join(roh, "index.ts"),
	])
		if (existsSync(kandidat) && statSync(kandidat).isFile()) return kandidat;
	return undefined;
};

/** Alles, was der Astro-Bau von den Seiten aus in sein Bündel zieht. */
const ausSeitenErreichbar = (): Set<string> => {
	const offen = dateien(join(WURZEL, "src/pages"));
	const gesehen = new Set(offen);
	while (offen.length > 0) {
		const pfad = offen.pop() as string;
		for (const spez of bezuege(pfad)) {
			const ziel = aufloesen(pfad, spez);
			if (!ziel || gesehen.has(ziel)) continue;
			gesehen.add(ziel);
			offen.push(ziel);
		}
	}
	return gesehen;
};

describe("der Ansagedienst lebt in einem einzigen Modulraum", () => {
	it("hängt an keiner Astro-Seite", () => {
		// Der Astro-Bau bündelt seinen eigenen Modulgraphen: Eine Seite, die den
		// Dienst lädt, bekommt eine zweite Ausgabenbremse und einen zweiten
		// Riegel im selben Prozess – die Grenzen aus dem Deployment gälten dann
		// doppelt, ohne dass es jemand sieht.
		const erreichbar = [...ausSeitenErreichbar()].map((p) =>
			relative(WURZEL, p),
		);
		expect(erreichbar).not.toContain(DIENST);
	});

	it("findet die Seiten, über die es wacht", () => {
		const erreichbar = ausSeitenErreichbar();
		expect(erreichbar.size).toBeGreaterThan(20);
		expect([...erreichbar].map((p) => relative(WURZEL, p))).toContain(
			"src/lib/dashboard.ts",
		);
	});
});
