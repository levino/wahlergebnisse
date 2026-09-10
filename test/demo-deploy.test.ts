/**
 * Die beiden Deployments am Manifest geprüft.
 *
 * Der teuerste Fehler wäre nicht, dass die Demo nicht läuft, sondern dass
 * eines von beidem falsch steht: der Demo-Schalter in der Produktion (dann
 * ersetzt eine Simulation die echten Zahlen) oder nur beim Poller statt auch
 * bei den Web-Pods (dann sähe die Demo echt aus und trüge kein Banner). Beides
 * fiele an einem Wahlabend auf, und dann ist es zu spät.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const lies = (pfad: string) => readFileSync(pfad, "utf-8");

const DEMO = "deploy/overlays/demo";

describe("Demo-Overlay", () => {
	it("setzt den Schalter in beiden Rollen", () => {
		const env = lies(`${DEMO}/demo-env.yaml`);
		// Ein Abschnitt je Deployment, und in beiden der Schalter.
		const teile = env.split("---");
		expect(teile).toHaveLength(2);
		for (const t of teile) {
			expect(t).toContain("kind: Deployment");
			expect(t).toContain("WAHLEN_DEMO");
		}
		expect(env).toContain("wahlergebnisse-poller");
		// Das Web-Deployment heißt schlicht "wahlergebnisse".
		expect(env).toMatch(/name: wahlergebnisse\s*$/m);
	});

	it("nennt beide Deployments mit dem Namespace der Vorlage", () => {
		// Patches greifen, bevor `namespace:` alles umschreibt – ohne die
		// Angabe fänden sie ihr Ziel nicht, und kustomize bricht ab.
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
		// Die Middleware-Referenz trägt den Namespace als Text; `namespace:`
		// zieht sie nicht mit.
		expect(ingress).toContain("wahlergebnisse-demo-redirect-https");
	});

	it("nimmt den Export-Token nicht mit", () => {
		expect(lies(`${DEMO}/ohne-export-token.yaml`)).toContain("$patch: delete");
		expect(lies(`${DEMO}/kustomization.yaml`)).toContain(
			"ohne-export-token.yaml",
		);
	});
});

describe("Produktion", () => {
	it("kennt den Demo-Schalter nicht", () => {
		// Er steht nur im Demo-Overlay. Fände er sich hier, liefe die echte
		// Seite als Simulation.
		for (const datei of [
			"deploy/base/deployment-poller.yaml",
			"deploy/base/deployment-web.yaml",
			"deploy/overlays/production/kustomization.yaml",
		])
			expect(lies(datei)).not.toContain("WAHLEN_DEMO");
	});
});
