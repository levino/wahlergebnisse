import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const E2E = "e2e";

const spawnende = (): string[] =>
	readdirSync(E2E)
		.filter((n) => n.endsWith(".ts"))
		.filter((n) =>
			readFileSync(join(E2E, n), "utf8").includes("server/main.ts"),
		);

describe("Browser-Tests rufen keinen bezahlten Dienst", () => {
	it("findet die Dateien, die einen Server starten", () => {
		expect(spawnende().length).toBeGreaterThan(0);
	});

	it("nimmt jedem gestarteten Server die Gegenstelle", () => {
		// Der Poller erzeugt Moderationsbeiträge und ruft dafür OpenAI. Wer
		// `...process.env` durchreicht und eine `.env` im Baum hat, bezahlt
		// echte Aufrufe für einen Testlauf. Entweder es gibt keinen Schlüssel
		// oder die Gegenstelle zeigt auf die Konserve.
		for (const name of spawnende()) {
			const text = readFileSync(join(E2E, name), "utf8");
			const entschaerft =
				/OPENAI_API_KEY:\s*""/.test(text) || /OPENAI_BASIS:/.test(text);
			expect(entschaerft, `${name} startet einen Server ohne Riegel`).toBe(
				true,
			);
		}
	});
});
