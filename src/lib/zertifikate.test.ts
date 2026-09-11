import { X509Certificate } from "node:crypto";
import { rootCertificates } from "node:tls";
import { describe, expect, it } from "vitest";
import { BENOETIGTE_WURZELN, pruefeWurzelspeicher } from "./zertifikate.ts";

describe("Wurzelspeicher", () => {
	it("bringt alle Wurzeln mit, auf die Wahl-Server angewiesen sind", () => {
		expect(pruefeWurzelspeicher()).toEqual([]);
	});

	it("kennt Sectigo R46 – deshalb erreicht Node Celle, obwohl curl scheitert", () => {
		const r46 = rootCertificates
			.flatMap((pem) => {
				try {
					return [new X509Certificate(pem)];
				} catch {
					return [];
				}
			})
			.find((c) =>
				c.subject.includes("Sectigo Public Server Authentication Root R46"),
			);
		expect(r46, "Sectigo R46 fehlt in Nodes Wurzelspeicher").toBeTruthy();
		if (!r46) return;
		expect(r46.subject).toBe(r46.issuer);
		expect(r46.ca).toBe(true);
		expect(new Date(r46.validTo).getTime()).toBeGreaterThan(Date.now());
	});

	it("begründet jede benötigte Wurzel", () => {
		expect(BENOETIGTE_WURZELN.length).toBeGreaterThan(0);
		for (const w of BENOETIGTE_WURZELN) {
			expect(w.cn.length, w.cn).toBeGreaterThan(5);
			expect(w.warum.length, w.cn).toBeGreaterThan(20);
		}
	});
});
