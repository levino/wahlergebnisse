import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const lies = (pfad: string) => readFileSync(pfad, "utf-8");

const DEMO = "deploy/overlays/demo";

describe("Demo-Overlay", () => {
	it("setzt den Schalter in beiden Rollen", () => {
		const env = lies(`${DEMO}/demo-env.yaml`);
		const teile = env.split("---");
		expect(teile).toHaveLength(2);
		for (const t of teile) {
			expect(t).toContain("kind: Deployment");
			expect(t).toContain("WAHLEN_DEMO");
		}
		expect(env).toContain("wahlergebnisse-poller");
		expect(env).toMatch(/name: wahlergebnisse\s*$/m);
	});

	it("nennt beide Deployments mit dem Namespace der Vorlage", () => {
		for (const datei of [
			"demo-env.yaml",
			"ingress.yaml",
			"ohne-export-token.yaml",
		])
			for (const block of lies(`${DEMO}/${datei}`).split("---"))
				if (block.includes("metadata:"))
					expect(block).toContain("namespace: wahlergebnisse");
	});

	it("führt eine eigene Adresse und einen eigenen Namespace", () => {
		const k = lies(`${DEMO}/kustomization.yaml`);
		expect(k).toContain("namespace: wahlergebnisse-demo");
		const ingress = lies(`${DEMO}/ingress.yaml`);
		expect(ingress).toContain("demo.wahlergebnisse.levinkeller.de");
		expect(ingress).toContain("wahlergebnisse-demo-redirect-https");
	});

	it("nimmt den Export-Token nicht mit", () => {
		expect(lies(`${DEMO}/ohne-export-token.yaml`)).toContain("$patch: delete");
		expect(lies(`${DEMO}/kustomization.yaml`)).toContain(
			"ohne-export-token.yaml",
		);
	});
});

describe("Beide Overlays", () => {
	const tag = (datei: string): string | undefined =>
		lies(datei).match(/newTag:\s*(\S+)/)?.[1];

	it("tragen denselben Bildstand", () => {
		const produktion = tag("deploy/overlays/production/kustomization.yaml");
		expect(produktion).toBeTruthy();
		expect(tag(`${DEMO}/kustomization.yaml`)).toBe(produktion);
	});

	it("werden von der CI gemeinsam gesetzt", () => {
		const deploy = lies(".github/workflows/deploy.yml");
		expect(deploy).toContain("for overlay in production demo");
	});
});

describe("Produktion", () => {
	it("kennt den Demo-Schalter nicht", () => {
		for (const datei of [
			"deploy/base/deployment-poller.yaml",
			"deploy/base/deployment-web.yaml",
			"deploy/overlays/production/kustomization.yaml",
		])
			expect(lies(datei)).not.toContain("WAHLEN_DEMO");
	});
});
