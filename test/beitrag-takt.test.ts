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
let betrachtet: typeof import("../src/lib/betrachtet.ts");
let stand: typeof import("../src/lib/stand.ts");

beforeAll(async () => {
	tmp = tempVerzeichnis("paket-takt-");
	process.env.DATABASE_PATH = join(tmp, "wahlen.db");
	mock = await starteMockVotemanager(FIXTURES);
	process.env.VOTEMANAGER_BASIS = mock.url;
	const { oeffneDb } = await import("../src/lib/db.ts");
	const { pollTermin } = await import("../src/lib/poll.ts");
	const { terminById } = await import("../src/data/termine.ts");
	const db = oeffneDb();
	for (const id of ["2021", "2020"])
		await pollTermin(db, terminById(id)!, {
			nurBehoerden: [NORDSTEMMEN, KREIS],
		});
	betrachtet = await import("../src/lib/betrachtet.ts");
	stand = await import("../src/lib/stand.ts");
}, 120_000);

afterAll(async () => {
	await mock.schliessen();
	aufraeumen(tmp);
});

describe("wer betrachtet wird", () => {
	it("meldet Topics je Wahlleitung und Partei über das Volume", () => {
		// Web-Pods schreiben, der Poller liest – auf dem gemeinsamen Volume.
		const verzeichnis = join(tmp, "betrachtet");
		const melder = betrachtet.starteMelder({ verzeichnis, id: "pod-a" });
		melder.meldeTopic("hildesheim/03254026");
		melder.meldeTopic("hildesheim/03254026#cdu");
		melder.schreibe();
		const gelesen = betrachtet.liesTopics(verzeichnis);
		expect([...gelesen.keys()].sort()).toEqual([
			"hildesheim/03254026",
			"hildesheim/03254026#cdu",
		]);
		melder.schliesse();
	});

	it("führt Topics zweier Pods zusammen", () => {
		const verzeichnis = join(tmp, "betrachtet-zwei");
		const a = betrachtet.starteMelder({ verzeichnis, id: "pod-a" });
		const b = betrachtet.starteMelder({ verzeichnis, id: "pod-b" });
		a.meldeTopic("hildesheim/03254026");
		b.meldeTopic("hildesheim/03254000#spd");
		a.schreibe();
		b.schreibe();
		expect(betrachtet.liesTopics(verzeichnis).size).toBe(2);
		a.schliesse();
		b.schliesse();
	});

	it("vergisst ein Topic, das niemand mehr offen hat", () => {
		const verzeichnis = join(tmp, "betrachtet-alt");
		const melder = betrachtet.starteMelder({ verzeichnis, id: "pod-a" });
		melder.meldeTopic("hildesheim/03254026");
		melder.schreibe();
		const spaeter = Date.now() + 60 * 60 * 1000;
		expect(betrachtet.liesTopics(verzeichnis, { jetzt: spaeter }).size).toBe(0);
		melder.schliesse();
	});

	it("trennt Topic und Partei so, wie der Poller sie wieder zusammensetzt", () => {
		const kreis = { slug: "hildesheim" } as never;
		expect(stand.topicName({ kreis, behoerde: "03254026" })).toBe(
			"hildesheim/03254026",
		);
		expect(stand.topicName({ kreis, behoerde: "03254026" }, "cdu")).toBe(
			"hildesheim/03254026#cdu",
		);
	});

	it("nimmt nur Parteischlüssel an, die wie welche aussehen", () => {
		expect(stand.parteiKeyAus("cdu")).toBe("cdu");
		expect(stand.parteiKeyAus("GRÜNE")).toBeUndefined();
		expect(stand.parteiKeyAus("../../etc/passwd")).toBeUndefined();
		expect(stand.parteiKeyAus("a#b")).toBeUndefined();
		expect(stand.parteiKeyAus("")).toBeUndefined();
		expect(stand.parteiKeyAus(null)).toBeUndefined();
	});
});
