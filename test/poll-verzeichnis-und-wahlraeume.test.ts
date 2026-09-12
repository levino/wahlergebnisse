import {
	cpSync,
	existsSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { join, normalize } from "node:path";
import nock from "nock";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { FIXTURES, aufraeumen, tempVerzeichnis } from "./helfer.ts";

const HOST = "http://127.0.0.1:9199";
const WURZEL = `${HOST}/wahlen/`;
const AGS = "03254026";
const MARKE = "listing:127.0.0.1:9199";
const WAHL_27 = `20210912/${AGS}/api/praesentation/wahl_27`;

const LEERES_VERZEICHNIS = `<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 3.2 Final//EN">
<html><head><title>Index of /wahlen</title></head><body><h1>Index of /wahlen</h1><table>
<tr><th valign="top"><img src="/icons/blank.gif" alt="[ICO]"></th><th><a href="?C=N;O=D">Name</a></th><th><a href="?C=M;O=A">Last modified</a></th><th><a href="?C=S;O=A">Size</a></th></tr>
<tr><th colspan="4"><hr></th></tr>
<tr><td valign="top"><img src="/icons/back.gif" alt="[PARENTDIR]"></td><td><a href="/wahlen/">Parent Directory</a></td><td>&nbsp;</td><td align="right">  - </td></tr>
<tr><th colspan="4"><hr></th></tr>
</table></body></html>`;

const VERBOTEN = `<html><head><title>403 Forbidden</title></head><body><h1>Forbidden</h1></body></html>`;

type Verzeichnis = "leer" | "verboten";

let tmp: string;
const angefragt: string[] = [];

const legeAn = (wurzel: string, verzeichnis: Verzeichnis): void => {
	nock(HOST)
		.persist()
		.get(/.*/)
		.reply((pfad: string) => {
			angefragt.push(pfad);
			if (pfad.endsWith("/"))
				return verzeichnis === "leer"
					? [200, LEERES_VERZEICHNIS, { "content-type": "text/html" }]
					: [403, VERBOTEN, { "content-type": "text/html" }];
			const datei = join(
				wurzel,
				normalize(decodeURIComponent(pfad)).replace(/^\/wahlen\//, "/"),
			);
			if (
				!datei.startsWith(wurzel) ||
				!existsSync(datei) ||
				statSync(datei).isDirectory()
			)
				return [404, "<html><body>Not Found</body></html>"];
			return [
				200,
				readFileSync(datei, "utf-8"),
				{ "content-type": "application/json" },
			];
		});
};

const verzeichnisAnfragen = (ab = 0): string[] =>
	angefragt.slice(ab).filter((p) => p.endsWith("/"));

const neueDb = async (name: string) => {
	const { schliesseDb, oeffneDb } = await import("../src/lib/db.ts");
	schliesseDb();
	process.env.DATABASE_PATH = join(tmp, `${name}.db`);
	return oeffneDb();
};

const lauf = async (db: Awaited<ReturnType<typeof neueDb>>) => {
	const { pollTermin } = await import("../src/lib/poll.ts");
	const { terminById } = await import("../src/data/termine.ts");
	const stat = await pollTermin(db, terminById("2021")!, {
		nurBehoerden: [AGS],
	});
	expect(stat.fehler).toEqual([]);
	return stat;
};

const bezirke = async () => {
	const { wahleintraege, ergebnisseEbene } = await import(
		"../src/lib/abfragen.ts"
	);
	const rat = wahleintraege("2021", AGS).find((w) => w.typ === "rat")!;
	return ergebnisseEbene("2021", AGS, rat.wahlId, 6).map((e) => e.gebietId);
};

const ohneUebersichten = (wurzel: string): void => {
	const ordner = join(wurzel, WAHL_27);
	for (const name of readdirSync(ordner))
		if (name.startsWith("uebersicht_"))
			writeFileSync(
				join(ordner, name),
				JSON.stringify({
					zeitstempel: "08.04.2022 12:43",
					has_geografik: false,
				}),
			);
};

beforeAll(() => {
	tmp = tempVerzeichnis("wahlen-verzeichnis-");
	process.env.VOTEMANAGER_BASIS = WURZEL;
	nock.disableNetConnect();
});

afterEach(() => {
	nock.cleanAll();
	angefragt.length = 0;
});

afterAll(async () => {
	const { schliesseDb } = await import("../src/lib/db.ts");
	schliesseDb();
	nock.cleanAll();
	nock.enableNetConnect();
	aufraeumen(tmp);
});

describe("Verzeichnismarke je Host", () => {
	it("sperrt den Host nicht, wenn das Verzeichnis mit 200 und ohne Einträge antwortet", async () => {
		legeAn(FIXTURES, "leer");
		const db = await neueDb("leeres-verzeichnis");
		const { metaGet } = await import("../src/lib/db.ts");

		await lauf(db);
		expect(verzeichnisAnfragen()).not.toEqual([]);
		expect(JSON.parse(metaGet(db, MARKE) ?? "null")).toMatchObject({
			status: 200,
		});
		expect(await bezirke()).toContain("ebene_6_id_3119");

		const vorher = angefragt.length;
		await lauf(db);
		expect(verzeichnisAnfragen(vorher)).not.toEqual([]);
	});

	it("sperrt den Host, wenn er das Verzeichnis mit 403 verweigert", async () => {
		legeAn(FIXTURES, "verboten");
		const db = await neueDb("verbotenes-verzeichnis");
		const { metaGet } = await import("../src/lib/db.ts");

		await lauf(db);
		expect(verzeichnisAnfragen()).not.toEqual([]);
		expect(JSON.parse(metaGet(db, MARKE) ?? "null")).toMatchObject({
			status: 403,
		});

		const vorher = angefragt.length;
		await lauf(db);
		expect(verzeichnisAnfragen(vorher)).toEqual([]);
	});

	it("übergeht die alte Marke „nein“ aus dem Bestand", async () => {
		legeAn(FIXTURES, "leer");
		const db = await neueDb("alte-marke");
		const { metaSet, metaGet } = await import("../src/lib/db.ts");
		metaSet(db, MARKE, "nein");

		await lauf(db);
		expect(verzeichnisAnfragen()).not.toEqual([]);
		expect(metaGet(db, MARKE)).not.toBe("nein");
	});
});

describe("Wahlbezirke aus der Wahlraum-Übersicht", () => {
	it("holt die Wahlbezirke, wenn weder Verzeichnis noch Übersicht sie nennen", async () => {
		const quelle = join(tmp, "ohne-uebersicht");
		cpSync(FIXTURES, quelle, { recursive: true });
		ohneUebersichten(quelle);
		legeAn(quelle, "verboten");
		const db = await neueDb("aus-wahlraeumen");

		await lauf(db);
		const gefunden = await bezirke();
		expect(gefunden).toHaveLength(15);
		expect(gefunden).toContain("ebene_6_id_3111");
		expect(gefunden).toContain("ebene_6_id_3125");
		expect(gefunden).not.toContain("ebene_6_id_4084");

		const vorher = angefragt.length;
		const zweiter = await lauf(db);
		expect(zweiter.geaendert).toBe(0);
		expect(
			angefragt.slice(vorher).filter((p) => p.includes("/ergebnis_ebene_6_")),
		).toEqual([]);
	});

	it("speichert keinen Wahlbezirk, dessen Ergebnisdatei fehlt", async () => {
		const quelle = join(tmp, "ohne-3116");
		cpSync(FIXTURES, quelle, { recursive: true });
		ohneUebersichten(quelle);
		rmSync(join(quelle, WAHL_27, "ergebnis_ebene_6_id_3116_0.json"));
		legeAn(quelle, "verboten");
		const db = await neueDb("fehlende-datei");

		await lauf(db);
		const gefunden = await bezirke();
		expect(gefunden).toHaveLength(14);
		expect(gefunden).not.toContain("ebene_6_id_3116");
	});
});
