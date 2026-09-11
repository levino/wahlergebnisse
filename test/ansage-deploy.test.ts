import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const lies = (pfad: string) => readFileSync(pfad, "utf-8");

const teile = (pfad: string): string[] =>
	lies(pfad)
		.split(/^---$/m)
		.map((t) => t.trim())
		.filter(Boolean);

const vonArt = (pfad: string, art: string): string[] =>
	teile(pfad).filter((t) => new RegExp(`^kind: ${art}$`, "m").test(t));

const OVERLAYS = [
	{
		name: "Produktion",
		ingress: "deploy/base/ingress.yaml",
		praefix: "wahlergebnisse",
	},
	{
		name: "Demo",
		ingress: "deploy/overlays/demo/ingress.yaml",
		praefix: "wahlergebnisse-demo",
	},
];

const WEB = "deploy/base/deployment-web.yaml";
const POLLER = "deploy/base/deployment-poller.yaml";

describe.each(OVERLAYS)("$name: der Ansage-Pfad ist gedrosselt", (o) => {
	const ansageIngress = (): string => {
		const treffer = vonArt(o.ingress, "Ingress").filter((t) =>
			t.includes("path: /api/ansage"),
		);
		expect(treffer).toHaveLength(1);
		return treffer[0];
	};

	it("führt einen eigenen Ingress für /api/ansage", () => {
		// Die Middleware-Annotation gilt je Ingress, nicht je Pfad. Ohne
		// eigenes Objekt läge das Limit auf der ganzen Seite oder nirgends.
		expect(ansageIngress()).toContain("path: /api/ansage");
	});

	it("hängt das Rate-Limit an diesen Ingress", () => {
		const referenzen = ansageIngress().match(
			/router\.middlewares:\s*(\S+)/,
		)?.[1];
		expect(referenzen).toBeTruthy();
		expect(referenzen?.split(",")).toContain(
			`${o.praefix}-ratelimit-ansage@kubernetescrd`,
		);
	});

	it("leitet auch diesen Pfad auf HTTPS um", () => {
		const referenzen = ansageIngress().match(
			/router\.middlewares:\s*(\S+)/,
		)?.[1];
		expect(referenzen?.split(",")).toContain(
			`${o.praefix}-redirect-https@kubernetescrd`,
		);
	});

	it("bringt die Middleware mit, auf die er zeigt", () => {
		const mw = vonArt(o.ingress, "Middleware").filter((t) =>
			/name: ratelimit-ansage/.test(t),
		);
		expect(mw).toHaveLength(1);
		expect(mw[0]).toContain("rateLimit:");
		// Ohne Zahlen wäre das Objekt eine Attrappe.
		expect(Number(mw[0].match(/average:\s*(\d+)/)?.[1])).toBeGreaterThan(0);
		expect(Number(mw[0].match(/burst:\s*(\d+)/)?.[1])).toBeGreaterThan(0);
	});

	it("lässt einen vollen Saal hinter einer Adresse durch", () => {
		// Alle Zuschauer im Saal können hinter derselben Mobilfunkadresse
		// hängen; das Limit trifft sie dann gemeinsam. Je Schub fallen zwei
		// Anfragen an (Moderation und Aufnahme).
		const mw = vonArt(o.ingress, "Middleware").find((t) =>
			/name: ratelimit-ansage/.test(t),
		);
		const average = Number(mw?.match(/average:\s*(\d+)/)?.[1]);
		expect(mw).toContain("period: 1m");
		expect(average).toBeGreaterThanOrEqual(100);
	});
});

describe("Der Ansagedienst läuft nur für bezahlte Wahlleitungen", () => {
	// Ohne Wert sagt `istAnsageBehoerde` zu jeder Wahlleitung ja, und ein
	// fremder Aufruf prägt eine bezahlte Aufnahme.
	it.each([WEB, POLLER])("ist in %s gesetzt und nicht leer", (datei) => {
		const wert = lies(datei).match(
			/name: ANSAGE_BEHOERDEN\s*\n\s*value:\s*"([^"]*)"/,
		)?.[1];
		expect(wert).toBeTruthy();
		expect(wert?.split(",").filter(Boolean).length).toBeGreaterThan(0);
	});

	it("nennt die Kreisbehörde und Nordstemmen", () => {
		const wert =
			lies(WEB).match(
				/name: ANSAGE_BEHOERDEN\s*\n\s*value:\s*"([^"]*)"/,
			)?.[1] ?? "";
		expect(wert.split(",")).toEqual(
			expect.arrayContaining(["03254000", "03254026"]),
		);
	});

	it("gilt überall, wo der Schlüssel liegt", () => {
		// Beide Rollen bekommen OPENAI_API_KEY; beide brauchen den Riegel.
		for (const datei of [WEB, POLLER]) {
			const text = lies(datei);
			if (text.includes("OPENAI_API_KEY"))
				expect(text).toContain("ANSAGE_BEHOERDEN");
		}
	});
});

describe("Die Bremsen rechnen mit der Replikatzahl", () => {
	const replikate = Number(lies(WEB).match(/^\s*replicas:\s*(\d+)/m)?.[1]);

	it("kennt die Zahl der Web-Pods", () => {
		expect(replikate).toBeGreaterThan(0);
	});

	it.each([
		"ANSAGEN_JE_MINUTE",
		"ANSAGEN_JE_STUNDE",
		"MODERATIONEN_JE_MINUTE",
		"MODERATIONEN_JE_STUNDE",
	])("setzt %s ausdrücklich", (name) => {
		// Die Vorgabe im Code gilt je Prozess. Bei zwei Pods wäre die
		// wirksame Grenze das Doppelte der dokumentierten.
		expect(lies(WEB)).toContain(`name: ${name}`);
	});

	it("deckelt die Aufnahmen über alle Pods auf eine bezahlbare Zahl", () => {
		const jeMinute = Number(
			lies(WEB).match(/name: ANSAGEN_JE_MINUTE\s*\n\s*value: "(\d+)"/)?.[1],
		);
		const jeStunde = Number(
			lies(WEB).match(/name: ANSAGEN_JE_STUNDE\s*\n\s*value: "(\d+)"/)?.[1],
		);
		// Eine Aufnahme kostet rund einen Cent; die Summe über alle Pods ist
		// das, was eine Stunde höchstens kosten kann.
		expect(jeStunde * replikate).toBeLessThanOrEqual(200);
		// Und sie muss reichen: Ein ganzer Abend Nordstemmen sind rund 100
		// Aufnahmen, die Generalprobe spielt ihn stündlich.
		expect(jeStunde * replikate).toBeGreaterThanOrEqual(150);
		expect(jeMinute * replikate).toBeGreaterThanOrEqual(20);
	});
});
