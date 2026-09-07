/**
 * Prüfungen am Wurzelspeicher – ohne Netz.
 *
 * Sie halten die Erkenntnis fest, die einen ganzen Umbau erspart hat: Der
 * TLS-Abbruch bei Celle ist ein Problem der Kommandozeilenwerkzeuge, nicht der
 * Laufzeit. Fällt einer dieser Tests, hat sich das geändert – und dann ist die
 * richtige Meldung „nicht erreichbar“, nicht „keine Daten“.
 */
import { X509Certificate } from "node:crypto";
import { rootCertificates } from "node:tls";
import { describe, expect, it } from "vitest";
import { BENOETIGTE_WURZELN, pruefeWurzelspeicher } from "./zertifikate.ts";

describe("Wurzelspeicher", () => {
	it("bringt alle Wurzeln mit, auf die Wahl-Server angewiesen sind", () => {
		// Der eigentliche Wächter. Solange er grün ist, braucht diese Anwendung
		// kein zusätzliches Zertifikat und kein NODE_EXTRA_CA_CERTS.
		expect(pruefeWurzelspeicher()).toEqual([]);
	});

	it("kennt Sectigo R46 – deshalb erreicht Node Celle, obwohl curl scheitert", () => {
		// wahl.landkreis-celle.de liefert die Kette nur bis zum Zwischen-
		// zertifikat R36 aus. Debians ca-certificates kennt dessen Aussteller
		// nicht (curl: HTTP 000), Nodes eingebauter Speicher schon – ein echter
		// Abruf aus Node ergab 200 und 46 221 Bytes.
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
		// Es ist die Wurzel selbst, nicht das gegenquittierte Zwischenglied.
		expect(r46.subject).toBe(r46.issuer);
		expect(r46.ca).toBe(true);
		expect(new Date(r46.validTo).getTime()).toBeGreaterThan(Date.now());
	});

	it("begründet jede benötigte Wurzel", () => {
		// Ein Eintrag ohne Begründung wäre eine Behauptung. Wer hier etwas
		// hinzufügt, sagt auch, welcher Host daran hängt.
		expect(BENOETIGTE_WURZELN.length).toBeGreaterThan(0);
		for (const w of BENOETIGTE_WURZELN) {
			expect(w.cn.length, w.cn).toBeGreaterThan(5);
			expect(w.warum.length, w.cn).toBeGreaterThan(20);
		}
	});
});
