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

describe("Die Bremsen sind die einzige Ausgabengrenze", () => {
	const ROLLEN = [
		{ name: "Web", datei: WEB, jeMinute: 30, jeStunde: 200 },
		{ name: "Poller", datei: POLLER, jeMinute: 5, jeStunde: 30 },
	];

	const replikate = (datei: string): number =>
		Number(lies(datei).match(/^\s*replicas:\s*(\d+)/m)?.[1]);

	const jePod = (datei: string, name: string): number | undefined => {
		const treffer = lies(datei).match(
			new RegExp(`name: ${name}\\s*\\n\\s*value: "(\\d+)"`),
		);
		return treffer ? Number(treffer[1]) : undefined;
	};

	const BREMSEN = [
		"ANSAGEN_JE_MINUTE",
		"ANSAGEN_JE_STUNDE",
		"MODERATIONEN_JE_MINUTE",
		"MODERATIONEN_JE_STUNDE",
	];

	describe.each(ROLLEN)("$name", (rolle) => {
		it("kennt seine Replikatzahl", () => {
			expect(replikate(rolle.datei)).toBeGreaterThan(0);
		});

		it.each(BREMSEN)("setzt %s ausdrücklich", (name) => {
			// Die Vorgabe im Code gilt je Prozess; wer sich auf sie verlässt,
			// bekommt bei zwei Pods die doppelte Grenze, ohne es zu sehen.
			expect(jePod(rolle.datei, name)).toBeGreaterThan(0);
		});

		it("hält die Summe über alle Pods bei der gewollten Grenze", () => {
			const n = replikate(rolle.datei);
			expect((jePod(rolle.datei, "ANSAGEN_JE_MINUTE") ?? 0) * n).toBe(
				rolle.jeMinute,
			);
			expect((jePod(rolle.datei, "ANSAGEN_JE_STUNDE") ?? 0) * n).toBe(
				rolle.jeStunde,
			);
		});

		it("bremst die Moderation nicht lockerer als die Aufnahme", () => {
			// Eine Moderation zieht eine Aufnahme nach sich. Wäre sie freier,
			// liefe sie gegen eine Grenze, die erst dahinter greift.
			const n = replikate(rolle.datei);
			for (const spanne of ["MINUTE", "STUNDE"])
				expect(
					(jePod(rolle.datei, `MODERATIONEN_JE_${spanne}`) ?? 0) * n,
				).toBeLessThanOrEqual(
					(jePod(rolle.datei, `ANSAGEN_JE_${spanne}`) ?? 0) * n,
				);
		});
	});

	it("deckelt die Ausgaben eines ganzen Abends auf einen bezahlbaren Betrag", () => {
		// Eine Aufnahme kostet rund einen Cent. Seit der Dienst allen
		// Wahlleitungen offensteht, ist das hier die einzige harte Grenze.
		const jeStunde = ROLLEN.reduce(
			(summe, r) =>
				summe + (jePod(r.datei, "ANSAGEN_JE_STUNDE") ?? 0) * replikate(r.datei),
			0,
		);
		expect(jeStunde).toBeLessThanOrEqual(250);
		// Und sie muss reichen: Ein ganzer Abend Nordstemmen sind rund 100
		// Aufnahmen, die Generalprobe spielt ihn stündlich.
		expect(jeStunde).toBeGreaterThanOrEqual(150);
	});
});
