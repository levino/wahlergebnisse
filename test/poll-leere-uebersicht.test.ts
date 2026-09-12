import { cpSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIXTURES, aufraeumen, tempVerzeichnis } from "./helfer.ts";
import {
	type MockVotemanager,
	starteMockVotemanager,
} from "./mock-votemanager.ts";

let mock: MockVotemanager;
let tmp: string;
let wahl27: string;

const BEZIRK = "ebene_6_id_3119";
const GESAMT = "ebene_3_id_14";

beforeAll(async () => {
	tmp = tempVerzeichnis("wahlen-leere-uebersicht-");
	const quelle = join(tmp, "votemanager");
	cpSync(FIXTURES, quelle, { recursive: true });
	wahl27 = join(quelle, "20210912/03254026/api/praesentation/wahl_27");
	mock = await starteMockVotemanager(quelle, 0, { listing: false });
	process.env.VOTEMANAGER_BASIS = mock.url;
	process.env.DATABASE_PATH = join(tmp, "wahlen.db");
});

afterAll(async () => {
	const { schliesseDb } = await import("../src/lib/db.ts");
	schliesseDb();
	await mock.schliessen();
	aufraeumen(tmp);
});

const lauf = async () => {
	const { oeffneDb } = await import("../src/lib/db.ts");
	const { pollTermin } = await import("../src/lib/poll.ts");
	const { terminById } = await import("../src/data/termine.ts");
	const stat = await pollTermin(oeffneDb(), terminById("2021")!, {
		nurBehoerden: ["03254026"],
	});
	expect(stat.fehler).toEqual([]);
	return stat;
};

const stempel = async (gebietId: string) => {
	const { ergebnis } = await import("../src/lib/abfragen.ts");
	const { wahleintraege } = await import("../src/lib/abfragen.ts");
	const rat = wahleintraege("2021", "03254026").find((w) => w.typ === "rat")!;
	return ergebnis("2021", "03254026", rat.wahlId, gebietId)?.ergebnis
		.zeitstempel;
};

const setzeZeitstempel = (datei: string, wert: string): void => {
	const pfad = join(wahl27, datei);
	const roh = JSON.parse(readFileSync(pfad, "utf-8")) as {
		zeitstempel: string;
	};
	roh.zeitstempel = wert;
	writeFileSync(pfad, JSON.stringify(roh));
};

/** Die Wahlleitung veröffentlicht die Präsentation neu, ohne Übersichtstabellen. */
const neueVeroeffentlichung = (wert: string): void => {
	for (const name of readdirSync(wahl27))
		if (name.startsWith("uebersicht_"))
			writeFileSync(
				join(wahl27, name),
				JSON.stringify({ zeitstempel: wert, has_geografik: false }),
			);
	setzeZeitstempel(`ergebnis_${GESAMT}_0.json`, wert);
	setzeZeitstempel(`ergebnis_${BEZIRK}_0.json`, wert);
};

describe("Poller bei leeren Übersichten", () => {
	it("holt die Untergebiete mit, wenn sich das Gesamtgebiet ändert", async () => {
		await lauf();
		expect(await stempel(BEZIRK)).toBe("2022-04-08T12:43:00+02:00");

		neueVeroeffentlichung("09.04.2022 07:15");
		const vorher = mock.anfragen.length;
		await lauf();

		expect(
			mock.anfragen.slice(vorher).filter((p) => p.endsWith(`${BEZIRK}_0.json`)),
		).not.toEqual([]);
		expect(await stempel(GESAMT)).toBe("2022-04-09T07:15:00+02:00");
		expect(await stempel(BEZIRK)).toBe("2022-04-09T07:15:00+02:00");
	});

	it("fragt die Untergebiete nicht erneut an, solange das Gesamtgebiet steht", async () => {
		const vorher = mock.anfragen.length;
		const stat = await lauf();
		expect(stat.geaendert).toBe(0);
		expect(
			mock.anfragen.slice(vorher).filter((p) => p.endsWith(`${BEZIRK}_0.json`)),
		).toEqual([]);
	});
});
