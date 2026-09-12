import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const lies = (pfad: string) => readFileSync(pfad, "utf-8");

const OVERLAYS = [
	{ name: "Produktion", ingress: "deploy/base/ingress.yaml" },
	{ name: "Demo", ingress: "deploy/overlays/demo/ingress.yaml" },
];

const WEB = "deploy/base/deployment-web.yaml";
const POLLER = "deploy/base/deployment-poller.yaml";

describe.each(OVERLAYS)("$name: der Ingress", (o) => {
	it("führt jeden Pfad ohne Rate-Limit über eine Regel", () => {
		// Kein Endpunkt nimmt noch Text entgegen und erzeugt daraus eine
		// bezahlte Aufnahme. Ein eigener Ingress mit Rate-Limit hätte keinen
		// Pfad mehr, den er bewachen könnte.
		const pfade = [...lies(o.ingress).matchAll(/path:\s*(\S+)/g)].map(
			(t) => t[1],
		);
		expect(pfade).toEqual(["/"]);
		expect(lies(o.ingress)).not.toContain("rateLimit");
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
