import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TERMINE, istAbgeschlossen, istLive } from "../src/data/termine.ts";
import { FIXTURES, aufraeumen, tempVerzeichnis } from "./helfer.ts";
import {
	type MockVotemanager,
	starteMockVotemanager,
} from "./mock-votemanager.ts";

let mock: MockVotemanager;
let tmp: string;

beforeAll(async () => {
	tmp = tempVerzeichnis("wahlen-einfrieren-");
	mock = await starteMockVotemanager(FIXTURES);
});

afterAll(async () => {
	await mock.schliessen();
	aufraeumen(tmp);
	process.env.WAHLEN_ABGESCHLOSSEN = "";
});

const ausfuehren = promisify(execFile);
const poll = (
	args: string[],
	env: Record<string, string>,
): Promise<{ stdout: string; stderr: string }> =>
	ausfuehren(
		process.execPath,
		["--no-warnings", "--experimental-strip-types", "server/poll.ts", ...args],
		{
			encoding: "utf-8",
			env: {
				...process.env,
				VOTEMANAGER_BASIS: mock.url,
				DATABASE_PATH: join(tmp, `${args.join("-")}-${Date.now()}.db`),
				...env,
			},
		},
	);

describe("Ein abgeschlossener Termin", () => {
	it("gilt als abgeschlossen und nicht mehr als live", () => {
		const laufend = TERMINE.find((t) => t.live);
		if (!laufend) throw new Error("Kein laufender Termin im Katalog");
		expect(istAbgeschlossen(laufend)).toBe(false);
		expect(istLive(laufend)).toBe(true);
		process.env.WAHLEN_ABGESCHLOSSEN = laufend.id;
		try {
			expect(istAbgeschlossen(laufend)).toBe(true);
			expect(istLive(laufend)).toBe(false);
		} finally {
			process.env.WAHLEN_ABGESCHLOSSEN = "";
		}
	});

	it("nimmt den Katalog UND die Umgebungsvariable, aber taut nie auf", () => {
		const t = { ...TERMINE[0], abgeschlossen: "2026-09-20T10:00:00.000Z" };
		process.env.WAHLEN_ABGESCHLOSSEN = "";
		try {
			expect(istAbgeschlossen(t)).toBe(true);
		} finally {
			process.env.WAHLEN_ABGESCHLOSSEN = "";
		}
	});

	it("wird nicht mehr abgefragt – keine einzige Anfrage", async () => {
		const vorher = mock.anfragen.length;
		const { stdout } = await poll(["2021"], { WAHLEN_ABGESCHLOSSEN: "2021" });
		expect(stdout).toContain("abgeschlossen");
		expect(mock.anfragen.length - vorher).toBe(0);
	}, 60_000);

	it("lässt sich von Hand trotzdem nachladen (--force)", async () => {
		const vorher = mock.anfragen.length;
		await poll(["2021", "--force", "--behoerde", "03254026"], {
			WAHLEN_ABGESCHLOSSEN: "2021",
		});
		expect(mock.anfragen.length - vorher).toBeGreaterThan(0);
	}, 180_000);
});
