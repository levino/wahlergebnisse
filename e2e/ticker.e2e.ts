/**
 * „Zuletzt eingegangen“ im Browser: Ein Eintrag berichtet von einem Gebiet –
 * also muss er auch dorthin führen, und im Saal soll an ihm der Name des
 * Wahllokals stehen und nicht bloß „01 - Nordstemmen“.
 */
import { expect, test } from "@playwright/test";
import { STEUERUNG } from "./ports.ts";
import { warteAufDaten } from "./warten.ts";

const steuere = (was: "vorher" | "wahlabend") => fetch(`${STEUERUNG}/${was}`);

type ApiEreignis = { gebiet: string; text: string };
type ApiWahlraum = { id: number; name: string };

test.describe("Ticker", () => {
	test.beforeAll(async () => {
		test.setTimeout(240_000);
		await warteAufDaten("2026");
	});

	test("ein Eintrag führt auf die Seite des gemeldeten Wahlbezirks", async ({
		page,
		request,
	}) => {
		test.setTimeout(120_000);
		await steuere("wahlabend");

		// Warten, bis der Poller die erste Schnellmeldung eines Wahlbezirks hat.
		let gemeldet: ApiEreignis | undefined;
		for (let i = 0; i < 60 && !gemeldet; i++) {
			const r = await request.get(
				"/api/v1/hildesheim/2026/ereignisse?behoerde=nordstemmen&limit=50",
			);
			if (r.ok()) {
				const d = (await r.json()) as { ereignisse: ApiEreignis[] };
				gemeldet = d.ereignisse.find((e) => e.gebiet.startsWith("ebene_6_id_"));
			}
			if (!gemeldet) await new Promise((res) => setTimeout(res, 1000));
		}
		if (!gemeldet) throw new Error("kein Wahlbezirk im Ticker");
		const gebietName = gemeldet.text.split(": ")[0];

		const raeume = (await (
			await request.get("/api/v1/hildesheim/2026/nordstemmen/wahlraeume")
		).json()) as { wahlraeume: ApiWahlraum[] };
		const raum = raeume.wahlraeume.find(
			(w) => `ebene_6_id_${w.id}` === gemeldet?.gebiet,
		);
		expect(raum, `kein Wahlraum zu ${gemeldet.gebiet}`).toBeTruthy();

		await page.goto("/hildesheim/2026/nordstemmen/");
		const eintrag = page.locator(
			`[data-ticker] a[href$="/${gemeldet.gebiet}/"]`,
		);
		await expect(eintrag.first()).toBeVisible({ timeout: 60_000 });
		// Am Eintrag steht das Wahllokal aus dem Wahlraum-Bestand.
		await expect(eintrag.first()).toHaveText(raum?.name ?? "");

		await eintrag.first().click();
		await expect(page).toHaveURL(new RegExp(`/${gemeldet.gebiet}/$`));
		// Die Zielseite zeigt genau das Gebiet, von dem der Eintrag berichtet.
		await expect(page.getByRole("heading", { level: 1 })).toHaveText(
			gebietName,
		);
	});
});
