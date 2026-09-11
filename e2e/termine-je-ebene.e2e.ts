import { expect, test } from "@playwright/test";
import { BASIS } from "./ports.ts";
import { warteAufDaten } from "./warten.ts";

const ohneFolgen = (pfad: string) =>
	fetch(`${BASIS}${pfad}`, { redirect: "manual" });

const warteAufNordstemmen2020 = async (sekunden = 180): Promise<void> => {
	for (let i = 0; i < sekunden; i++) {
		try {
			const r = await fetch(
				`${BASIS}/api/v1/hildesheim/2020/wahlen?behoerde=nordstemmen`,
			);
			if (r.ok && (await r.json()).anzahl > 0) return;
		} catch {
			/* Server startet noch */
		}
		await new Promise((res) => setTimeout(res, 1000));
	}
	throw new Error("Die Bürgermeisterwahl Nordstemmen 2020 kam nicht an");
};

test.describe("Termine je Ebene", () => {
	test.beforeAll(async () => {
		test.setTimeout(240_000);
		await warteAufDaten("2021");
	});

	test("die Kopfzeile des Kreises zeigt keine Gemeinde-Wahltage", async ({
		page,
	}) => {
		await page.goto("/hildesheim/");
		const termine = page.getByLabel("Wahltermine");
		await expect(
			termine.getByRole("link", { name: /Kommunalwahl 2026/ }),
		).toHaveCount(1);
		await expect(
			termine.getByRole("link", { name: /Kommunalwahl 2021/ }),
		).toHaveCount(1);
		await expect(
			termine.getByRole("link", { name: /Nordstemmen/ }),
		).toHaveCount(0);
		await expect(termine.getByRole("link")).toHaveCount(2);

		await page.goto("/hildesheim/2021/");
		await expect(page.getByLabel("Wahltermine").getByRole("link")).toHaveCount(
			2,
		);
	});

	test("die Kopfzeile einer Gemeinde zeigt ihre eigenen Wahltage", async ({
		page,
	}) => {
		await page.goto("/hildesheim/2021/nordstemmen/");
		const termine = page.getByLabel("Wahltermine");
		await expect(termine.getByRole("link")).toHaveCount(3);
		const bm = termine.getByRole("link", { name: /Nordstemmen 2020/ });
		await expect(bm).toHaveCount(1);
		await expect(bm).toHaveAttribute("href", "/hildesheim/2020/nordstemmen/");
		await bm.click();
		await expect(page).toHaveURL(/\/hildesheim\/2020\/nordstemmen\/$/);
		await expect(page.getByRole("heading", { level: 1 })).toHaveText(
			"Gemeinde Nordstemmen",
		);

		await page.goto("/hildesheim/2021/algermissen/");
		await expect(
			page.getByLabel("Wahltermine").getByRole("link", { name: /2020/ }),
		).toHaveCount(0);
		expect((await ohneFolgen("/hildesheim/2020/algermissen/")).status).toBe(
			404,
		);
	});

	test("die Kreis-Terminseite eines Gemeinde-Wahltags führt zur Wahlleitung", async () => {
		const r = await ohneFolgen("/hildesheim/2020/");
		expect(r.status).toBe(302);
		expect(r.headers.get("location")).toBe("/hildesheim/2020/nordstemmen/");
		expect((await ohneFolgen("/hildesheim/2020/nordstemmen/")).status).toBe(
			200,
		);

		expect((await ohneFolgen("/goslar/2019-05-26/")).status).toBe(404);
		expect((await ohneFolgen("/goslar/2019-05-26/bad-harzburg/")).status).toBe(
			200,
		);
		expect((await ohneFolgen("/emsland/2019-05-26/")).status).toBe(200);
	});

	test("die Schnittstelle trennt kreisweite Termine von denen der Wahlleitungen", async ({
		request,
	}) => {
		test.setTimeout(240_000);
		await warteAufNordstemmen2020();
		const kreis = await (await request.get("/api/v1/hildesheim")).json();
		expect(kreis.termine.map((t: { id: string }) => t.id)).toEqual([
			"2026",
			"2021",
		]);
		const ns = kreis.behoerden.find(
			(b: { slug: string }) => b.slug === "nordstemmen",
		);
		expect(ns.termine).toEqual(["2020"]);
		expect(
			kreis.behoerden.find((b: { slug: string }) => b.slug === "algermissen")
				.termine,
		).toEqual(["2023-03-05"]);

		const kreisweit = await request.get("/api/v1/hildesheim/2020");
		expect(kreisweit.status()).toBe(404);
		const fehler = (await kreisweit.json()).fehler;
		expect(fehler.hinweis).toContain("nordstemmen");
		expect(fehler.moeglich).toEqual(["2026", "2021"]);

		const wahlen = await request.get(
			"/api/v1/hildesheim/2020/wahlen?behoerde=nordstemmen",
		);
		expect(wahlen.status()).toBe(200);
		expect(
			(await wahlen.json()).wahlen.map((w: { slug: string }) => w.slug),
		).toContain("buergermeister");
		const erg = await request.get(
			"/api/v1/hildesheim/2020/nordstemmen/buergermeister",
		);
		expect(erg.status()).toBe(200);
		expect(
			(
				await request.get("/api/v1/hildesheim/2020/algermissen/buergermeister")
			).status(),
		).toBe(404);
	});

	test("MCP nennt kreisweite Wahltage und die einzelner Wahlleitungen getrennt", async ({
		request,
	}) => {
		const r = await request.post("/mcp", {
			headers: {
				accept: "application/json, text/event-stream",
				"content-type": "application/json",
			},
			data: {
				jsonrpc: "2.0",
				id: 1,
				method: "tools/call",
				params: {
					name: "wahltermine",
					arguments: { kreis: "hildesheim" },
				},
			},
		});
		expect(r.ok()).toBeTruthy();
		const roh = await r.text();
		const zeile = roh
			.split("\n")
			.find((z) => z.startsWith("data:") || z.startsWith("{"));
		const d = JSON.parse(zeile!.replace(/^data:\s*/, ""));
		const inhalt = JSON.parse(d.result.content[0].text);
		expect(inhalt.termine.map((t: { id: string }) => t.id)).toEqual([
			"2026",
			"2021",
		]);
		expect(
			inhalt.weitereTermine.map(
				(t: { id: string; nurBei: string[] }) => `${t.id}:${t.nurBei}`,
			),
		).toContain("2020:nordstemmen");
	});
});
