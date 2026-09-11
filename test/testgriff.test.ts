import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RIEGEL_PFAD } from "../src/lib/ansage.ts";
import { aufraeumen, tempVerzeichnis } from "./helfer.ts";

const alleDateien = (wurzel: string): string[] =>
	readdirSync(wurzel, { withFileTypes: true, recursive: true })
		.filter((e) => e.isFile())
		.map((e) => join(e.parentPath ?? wurzel, e.name));

describe("der Testgriff", () => {
	it("kommt in keinem Manifest vor", () => {
		const treffer = alleDateien("deploy").filter((p) =>
			readFileSync(p, "utf-8").includes("WAHLEN_TESTGRIFF"),
		);
		expect(treffer).toEqual([]);
	});

	it("steht im Abbild nicht und in der CI nur für die Browser-Tests", () => {
		expect(readFileSync("Dockerfile", "utf-8")).not.toContain(
			"WAHLEN_TESTGRIFF",
		);
		const gesetzt = alleDateien("e2e").filter((p) =>
			readFileSync(p, "utf-8").includes('WAHLEN_TESTGRIFF: "1"'),
		);
		expect(gesetzt).toEqual(["e2e/server.ts"]);
	});
});

describe("der Riegel-Pfad", () => {
	let schliessen: (() => Promise<void>) | undefined;

	afterEach(async () => {
		await schliessen?.();
		schliessen = undefined;
		delete process.env.WAHLEN_TESTGRIFF;
	});

	const starte = async (): Promise<string> => {
		vi.resetModules();
		const { handhabeAnsage } = await import("../server/ansage.ts");
		const server = createServer((req, res) => {
			const url = new URL(req.url ?? "/", "http://localhost");
			if (!handhabeAnsage(req, res, url)) res.writeHead(404).end();
		});
		await new Promise<void>((f) => server.listen(0, "127.0.0.1", f));
		schliessen = () => new Promise<void>((f) => server.close(() => f()));
		return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
	};

	it("gibt es ohne den Griff nicht", async () => {
		const tmp = tempVerzeichnis("wahlen-testgriff-");
		process.env.ANSAGEN_PFAD = join(tmp, "ansagen");
		delete process.env.WAHLEN_TESTGRIFF;
		const url = await starte();
		expect((await fetch(`${url}${RIEGEL_PFAD}`)).status).toBe(404);
		aufraeumen(tmp);
	});

	it("öffnet den Riegel, wenn der Griff gesetzt ist", async () => {
		const tmp = tempVerzeichnis("wahlen-testgriff-");
		process.env.ANSAGEN_PFAD = join(tmp, "ansagen");
		process.env.WAHLEN_TESTGRIFF = "1";
		const url = await starte();
		const antwort = await fetch(`${url}${RIEGEL_PFAD}`);
		expect(antwort.status).toBe(200);
		expect(await antwort.json()).toEqual({ riegel: "offen" });
		aufraeumen(tmp);
	});
});
