import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIXTURES, aufraeumen, tempVerzeichnis } from "./helfer.ts";
import {
	type MockVotemanager,
	starteMockVotemanager,
} from "./mock-votemanager.ts";

const NORDSTEMMEN = "03254026";
const KREIS = "03254000";

let tmp: string;
let mock: MockVotemanager;
let dbPfad: string;

beforeAll(async () => {
	tmp = tempVerzeichnis("poller-folien-");
	dbPfad = join(tmp, "wahlen.db");
	mock = await starteMockVotemanager(FIXTURES);
	process.env.VOTEMANAGER_BASIS = mock.url;
	process.env.DATABASE_PATH = dbPfad;
	const { oeffneDb, schliesseDb } = await import("../src/lib/db.ts");
	const { pollTermin } = await import("../src/lib/poll.ts");
	const { terminById } = await import("../src/data/termine.ts");
	for (const id of ["2021", "2020"])
		await pollTermin(oeffneDb(), terminById(id)!, {
			nurBehoerden: [NORDSTEMMEN, KREIS],
		});
	schliesseDb();
}, 120_000);

afterAll(async () => {
	await mock.schliessen();
	aufraeumen(tmp);
});

/**
 * Das Folienmodell in einem Prozess bauen, den Vite nie gesehen hat – so
 * läuft der Poller.
 */
const imNacktenNode = (quelltext: string) =>
	spawnSync(
		process.execPath,
		[
			"--experimental-strip-types",
			"--no-warnings",
			"--input-type=module",
			"-e",
			quelltext,
		],
		{
			encoding: "utf8",
			env: { ...process.env, DATABASE_PATH: dbPfad },
			cwd: new URL("..", import.meta.url).pathname,
		},
	);

describe("das Folienmodell außerhalb von Astro", () => {
	it("lässt sich in nacktem Node laden", () => {
		const lauf = imNacktenNode(
			'await import("./src/lib/dashboard.ts"); console.log("geladen");',
		);
		expect(lauf.stderr).toBe("");
		expect(lauf.stdout.trim()).toBe("geladen");
		expect(lauf.status).toBe(0);
	});

	it("baut dort ein vollständiges Dashboard aus der Datenbank", () => {
		const lauf = imNacktenNode(`
			const { ladeDashboard } = await import("./src/lib/dashboard.ts");
			const { wahleintraege } = await import("./src/lib/abfragen.ts");
			const { kreisBySlug } = await import("./src/data/kreise.ts");
			const { terminById } = await import("./src/data/termine.ts");
			const kreis = kreisBySlug("hildesheim");
			const termin = terminById("2021");
			const behoerde = kreis.behoerden.find((b) => b.ags === "${NORDSTEMMEN}");
			const modell = ladeDashboard(
				kreis,
				termin,
				behoerde,
				wahleintraege(termin.id, behoerde.ags),
			);
			const wahlfolien = modell.folien.filter((f) => f.art === "wahl");
			console.log(JSON.stringify({
				folien: modell.folien.length,
				wahlen: wahlfolien.length,
				erste: wahlfolien[0]?.wahl,
				balken: wahlfolien[0]?.balken.length,
			}));
		`);
		expect(lauf.stderr).toBe("");
		expect(lauf.status).toBe(0);
		const raus = JSON.parse(lauf.stdout.trim());
		expect(raus.wahlen).toBeGreaterThan(1);
		expect(raus.erste).toBeTruthy();
		expect(raus.balken).toBeGreaterThan(0);
	});

	it("zieht dabei keine Geodaten in den Importgraphen", () => {
		// Ein `import.meta.glob` oder ein JSON-Import ohne Attribut bringt den
		// Prozess zum Stehen; `geo.ts` trägt beides.
		const lauf = imNacktenNode(
			'await import("./src/lib/dashboard.ts"); console.log("ok");',
		);
		expect(lauf.stderr).not.toContain("import attribute");
		expect(lauf.stderr).not.toContain("import.meta.glob");
		expect(lauf.status).toBe(0);

		const mitGeo = imNacktenNode('await import("./src/lib/geo.ts");');
		expect(mitGeo.status).not.toBe(0);
	});
});
