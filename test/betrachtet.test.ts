/**
 * Die Meldung „diesen Kreis sieht gerade jemand an“ über Prozessgrenzen.
 *
 * Das ist der Teil des unterbrechungsfreien Ausrollens, der ohne Datenbank
 * auskommen muss: Die Web-Pods dürfen nicht schreiben, der Poller braucht die
 * Angabe trotzdem (src/lib/takt.ts). Geprüft wird deshalb genau das, worauf es
 * ankommt — dass die Meldung ankommt, dass sie mehrere Melder zusammenfasst,
 * und dass ein Pod, den es nicht mehr gibt, den Takt nicht ewig hochhält.
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
	betrachtetVerzeichnis,
	liesBetrachtet,
	starteMelder,
} from "../src/lib/betrachtet.ts";
import { aufraeumen, tempVerzeichnis } from "./helfer.ts";

const tmps: string[] = [];
const verzeichnis = () => {
	const t = tempVerzeichnis("wahlen-betrachtet-");
	tmps.push(t);
	return join(t, "betrachtet");
};

afterEach(() => {
	for (const t of tmps.splice(0)) aufraeumen(t);
});

describe("Betrachtete Kreise zwischen Prozessen", () => {
	test("liegt neben der Datenbank", () => {
		expect(betrachtetVerzeichnis("/data/wahlen.db")).toBe("/data/betrachtet");
	});

	test("was ein Melder schreibt, liest der Poller", () => {
		const dir = verzeichnis();
		const melder = starteMelder({ verzeichnis: dir, id: "web-abc" });
		melder.melde("hildesheim");
		melder.schreibe();

		const gesehen = liesBetrachtet(dir);
		expect([...gesehen.keys()]).toEqual(["hildesheim"]);
		expect(gesehen.get("hildesheim")).toBeGreaterThan(Date.now() - 5_000);
		melder.schliesse();
	});

	test("mehrere Web-Pods werden zusammengefasst, je Kreis der jüngste Wert", () => {
		const dir = verzeichnis();
		const a = starteMelder({ verzeichnis: dir, id: "web-a" });
		const b = starteMelder({ verzeichnis: dir, id: "web-b" });
		a.melde("hildesheim");
		a.melde("goslar");
		a.schreibe();
		const frueh = liesBetrachtet(dir).get("hildesheim") ?? 0;

		b.melde("hildesheim");
		b.melde("peine");
		b.schreibe();

		const gesehen = liesBetrachtet(dir);
		expect([...gesehen.keys()].sort()).toEqual([
			"goslar",
			"hildesheim",
			"peine",
		]);
		// Zwei Pods melden denselben Kreis – gelten soll der spätere Aufruf,
		// sonst fiele ein Kreis aus dem schnellen Takt, den jemand noch ansieht.
		expect(gesehen.get("hildesheim")).toBeGreaterThanOrEqual(frueh);
		a.schliesse();
		b.schliesse();
	});

	test("ein beendeter Pod räumt seine Meldung weg", () => {
		const dir = verzeichnis();
		const melder = starteMelder({ verzeichnis: dir, id: "web-weg" });
		melder.melde("hildesheim");
		melder.schreibe();
		expect(readdirSync(dir)).toHaveLength(1);

		melder.schliesse();
		expect(readdirSync(dir)).toHaveLength(0);
		expect(liesBetrachtet(dir).size).toBe(0);
	});

	test("ein verschwundener Pod fällt nach kurzer Zeit heraus", () => {
		const dir = verzeichnis();
		const melder = starteMelder({ verzeichnis: dir, id: "web-tot" });
		melder.melde("hildesheim");
		melder.schreibe();

		// Ein Pod, den ein SIGKILL erwischt hat, lässt seine Datei liegen. Die
		// darf den Kreis nicht für immer im schnellen Takt halten.
		const spaeter = Date.now() + 10 * 60 * 1000;
		expect(liesBetrachtet(dir, { jetzt: spaeter }).size).toBe(0);
		melder.schliesse();
	});

	test("veraltete Aufrufe fallen beim Schreiben heraus", async () => {
		const dir = verzeichnis();
		// Sehr kurze Frist: Der Aufruf ist beim nächsten Schreiben schon zu alt.
		// Sonst wüchse die Datei eines lange laufenden Pods über den Abend um
		// jeden Kreis, den irgendwann einmal jemand geöffnet hat.
		const melder = starteMelder({
			verzeichnis: dir,
			id: "web-alt",
			betrachtetS: 0.01,
		});
		melder.melde("hildesheim");
		melder.schreibe();
		expect(liesBetrachtet(dir).size).toBe(1);

		await new Promise((f) => setTimeout(f, 30));
		melder.schreibe();
		expect(liesBetrachtet(dir).size).toBe(0);
		melder.schliesse();
	});

	test("Müll im Verzeichnis stört nicht", () => {
		const dir = verzeichnis();
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "halb.json"), '{"stand":', "utf8");
		writeFileSync(join(dir, "fremd.txt"), "egal", "utf8");
		const melder = starteMelder({ verzeichnis: dir, id: "web-ok" });
		melder.melde("goslar");
		melder.schreibe();

		expect([...liesBetrachtet(dir).keys()]).toEqual(["goslar"]);
		melder.schliesse();
	});

	test("ohne Verzeichnis ist die Antwort leer statt ein Fehler", () => {
		// Der Ein-Prozess-Betrieb legt es nie an; der Poller darf daran nicht
		// scheitern.
		const dir = join(verzeichnis(), "gibt-es-nicht");
		expect(existsSync(dir)).toBe(false);
		expect(liesBetrachtet(dir).size).toBe(0);
	});
});
