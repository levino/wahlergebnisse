import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { beurteile, schlimmstes, tagAus } from "../src/lib/ausrollstand.ts";

const KOPF = "f79139388d2c28ba534baf409cc1090fff3f7387";
const ALT = "56210b822a502dbb953db60d2f5ab278546385b6";

describe("Ausrollstand", () => {
	it("meldet nichts, wenn Ausrollzweig und Cluster auf dem Kopf von main stehen", () => {
		const befunde = beurteile({
			main: KOPF,
			zweig: KOPF,
			cluster: [KOPF, KOPF],
			laeuft: false,
		});
		expect(befunde).toEqual([]);
		expect(schlimmstes(befunde)).toBe(0);
	});

	it("ist ein Fehler, wenn der Ausrollzweig zurückhängt und nichts läuft", () => {
		const befunde = beurteile({ main: KOPF, zweig: ALT, laeuft: false });
		expect(schlimmstes(befunde)).toBe(1);
		expect(befunde[0]?.was).toContain("f791393");
		expect(befunde[0]?.was).toContain("56210b8");
	});

	it("ist nur eine Warnung, solange eine Ausrollung läuft", () => {
		const befunde = beurteile({ main: KOPF, zweig: ALT, laeuft: true });
		expect(befunde).toHaveLength(1);
		expect(schlimmstes(befunde)).toBe(0);
	});

	it("meldet getrennt, wenn Argo den eingetragenen Stand noch nicht zieht", () => {
		const befunde = beurteile({
			main: KOPF,
			zweig: KOPF,
			cluster: [ALT, ALT],
			laeuft: false,
		});
		expect(befunde).toHaveLength(1);
		expect(befunde[0]?.stufe).toBe("warnung");
		expect(befunde[0]?.was).toContain("Argo");
	});

	it("nennt beide Stände, wenn der Cluster mitten im Wechsel steht", () => {
		const befunde = beurteile({
			main: KOPF,
			zweig: KOPF,
			cluster: [KOPF, ALT],
			laeuft: false,
		});
		expect(befunde).toHaveLength(1);
		expect(befunde[0]?.was).toContain("56210b8");
	});

	it("meldet einen Halt statt eines Fehlers und verlangt einen Menschen", () => {
		const befunde = beurteile({
			main: KOPF,
			zweig: ALT,
			laeuft: false,
			angehalten: "Ausrollen angehalten.\nZurückgerollt von: f791393…\n",
		});
		expect(befunde).toHaveLength(1);
		expect(befunde[0]?.stufe).toBe("halt");
		expect(schlimmstes(befunde)).toBe(3);
	});

	it("wertet den Rückstand nach einem Zurückrollen nicht zusätzlich als Fehler", () => {
		const befunde = beurteile({
			main: KOPF,
			zweig: ALT,
			laeuft: false,
			angehalten: "Ausrollen angehalten.\n",
		});
		expect(befunde.some((b) => b.stufe === "fehler")).toBe(false);
	});

	it("liest den Bildstand aus dem Overlay, das Argo liest", () => {
		expect(
			tagAus(
				readFileSync("deploy/overlays/production/kustomization.yaml", "utf-8"),
			),
		).toMatch(/^[0-9a-f]{40}$/);
		expect(tagAus("kind: Kustomization\n")).toBe("");
	});
});

describe("Deploy-Workflow", () => {
	const deploy = readFileSync(".github/workflows/deploy.yml", "utf-8");

	it("rollt den Kopf von main aus, nicht den auslösenden Commit", () => {
		expect(deploy).toContain("git rev-parse origin/main");
		expect(deploy).not.toMatch(/STAND:\s*\$\{\{\s*github\.sha/);
	});

	it("stellt keine Läufe in eine Warteschlange, in der sie abgeräumt werden", () => {
		expect(deploy).not.toMatch(/^concurrency:/m);
	});

	it("schreibt keinen Stand zurück, der schon überholt ist", () => {
		expect(deploy).toContain("git merge-base --is-ancestor");
	});

	it("überfährt kein Zurückrollen – vor dem Bauen und vor dem Eintragen", () => {
		const haltstellen = deploy.match(/ANGEHALTEN/g) ?? [];
		expect(haltstellen.length).toBeGreaterThanOrEqual(3);
		expect(deploy).toMatch(/ANLASS\}" != "workflow_dispatch"/);
	});
});

describe("Zurückrollen", () => {
	const zurueck = readFileSync(".github/workflows/zurueckrollen.yml", "utf-8");

	it("hält das automatische Ausrollen an", () => {
		expect(zurueck).toContain("> ANGEHALTEN");
		expect(zurueck).toContain("git add -- deploy ANGEHALTEN");
	});

	it("gibt das Push-Rennen gegen einen laufenden Deploy nicht verloren", () => {
		expect(zurueck).toContain("for versuch in");
	});
});
