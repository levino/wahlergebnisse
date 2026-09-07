import { expect, test } from "@playwright/test";
import { warteAufDaten } from "./warten.ts";

/** Die öffentliche API über HTTP – so, wie andere sie benutzen würden. */
test.describe("Offene API", () => {
	test.beforeAll(async () => {
		test.setTimeout(240_000);
		await warteAufDaten("2021");
	});

	test("Einstieg nennt Pfade, Lizenzen und den MCP-Endpunkt", async ({
		request,
	}) => {
		const r = await request.get("/api/v1/");
		expect(r.ok()).toBeTruthy();
		expect(r.headers()["access-control-allow-origin"]).toBe("*");
		const d = await r.json();
		expect(d.pfade.gebiete).toContain("format=json|csv");
		expect(d.pfade.gebiete).toContain("{kreis}");
		expect(d.kreise.map((k: { slug: string }) => k.slug)).toContain(
			"hildesheim",
		);
		// Absolute Adressen müssen die öffentliche Seite nennen, nicht die
		// interne des Servers hinter dem Proxy (stand zeitweise auf localhost).
		expect(d.mcp).toMatch(/^https?:\/\/[^/]+\/mcp$/);
		expect(d.mcp).not.toContain("localhost");
		// PUBLIC_SITE_URL des Testservers – so wirkt die Angabe aus dem Deployment
		expect(d.mcp).toBe("https://wahlergebnisse.example.org/mcp");
		expect(d.openapi).not.toContain("localhost");
		expect(d.pfade.wahl).not.toContain("localhost");
		expect(d.lizenz.geodaten).toContain("BKG");
		expect(d.termine.map((t: { id: string }) => t.id)).toEqual([
			"2026",
			"2021",
			"2020",
		]);
	});

	test("OpenAPI beschreibt die Endpunkte", async ({ request }) => {
		const d = await (await request.get("/api/v1/openapi.json")).json();
		expect(d.openapi).toBe("3.1.0");
		expect(d.servers[0].url).not.toContain("localhost");
		expect(Object.keys(d.paths)).toContain(
			"/{kreis}/{termin}/{behoerde}/{wahl}/gebiete",
		);
		expect(d.components.schemas.KreisParam.name).toBe("kreis");
		expect(d.components.schemas.Ergebnis.properties.kennzahlen).toBeTruthy();
	});

	test("Ergebnis, Gebiete und CSV liefern zusammenpassende Zahlen", async ({
		request,
	}) => {
		const wahl = await (
			await request.get("/api/v1/hildesheim/2021/kreis/kreistag")
		).json();
		expect(wahl.ergebnis.stand.vollstaendig).toBe(true);
		expect(wahl.ergebnis.sitze.gesamt).toBe(64);
		const cdu = wahl.ergebnis.parteien.find(
			(p: { key: string }) => p.key === "cdu",
		);
		expect(cdu).toMatchObject({ stimmen: 116658, sitze: 19 });

		const gemeinden = await (
			await request.get(
				"/api/v1/hildesheim/2021/kreis/kreistag/gebiete?ebene=gemeinde",
			)
		).json();
		expect(gemeinden.anzahl).toBe(18);
		const summe = gemeinden.gebiete.reduce(
			(a: number, g: { parteien: Array<{ key: string; stimmen: number }> }) =>
				a + (g.parteien.find((p) => p.key === "cdu")?.stimmen ?? 0),
			0,
		);
		expect(summe).toBe(cdu.stimmen);

		const csv = await request.get(
			"/api/v1/hildesheim/2021/kreis/kreistag/gebiete?ebene=gemeinde&format=csv",
		);
		expect(csv.headers()["content-type"]).toContain("text/csv");
		expect(csv.headers()["content-disposition"]).toContain(
			"wahlergebnisse-2021-kreis-kreistag",
		);
		const text = await csv.text();
		expect(text.split("\n")[0]).toContain("partei_kurz;partei_name");
		expect(text).toContain("Gemeinde Nordstemmen;gemeinde");
	});

	test("Einzelnes Wahllokal und Wahlraum-Liste", async ({ request }) => {
		const g = await (
			await request.get(
				"/api/v1/hildesheim/2021/nordstemmen/rat/gebiete/ebene_6_id_3119",
			)
		).json();
		expect(g.gebiet).toMatchObject({
			name: "09 - Rössing - DGH",
			ebene: "wahlbezirk",
		});
		expect(g.kennzahlen.waehler).toBe(268);
		const w = await (
			await request.get("/api/v1/hildesheim/2021/nordstemmen/wahlraeume")
		).json();
		expect(w.anzahl).toBe(15);
		expect(w.wahlraeume[0]).toMatchObject({
			ortsteil: "Nordstemmen",
			barrierefrei: true,
		});
	});

	test("Geodaten als GeoJSON, wahlweise je Kreis", async ({ request }) => {
		const r = await request.get("/api/v1/geo/gemeinden.geojson?kreis=03254");
		const d = await r.json();
		expect(d.type).toBe("FeatureCollection");
		expect(d.features).toHaveLength(20);
		expect(r.headers()["x-quelle"]).toContain("BKG");
		// Ohne Kreis kommt ganz Niedersachsen
		const alle = await (
			await request.get("/api/v1/geo/gemeinden.geojson")
		).json();
		expect(alle.features.length).toBeGreaterThan(900);
		// Ein Kreis ohne Ortsteildaten liefert eine leere Sammlung, keinen Fehler
		const ohne = await request.get("/api/v1/geo/ortsteile.geojson?kreis=03453");
		expect(ohne.status()).toBe(200);
		expect((await ohne.json()).features).toHaveLength(0);
		expect(
			(await request.get("/api/v1/geo/gemeinden.geojson?kreis=abc")).status(),
		).toBe(400);
		expect((await request.get("/api/v1/geo/gibtsnicht.geojson")).status()).toBe(
			404,
		);
	});

	test("ETag spart Übertragungen, Fehler erklären sich", async ({
		request,
	}) => {
		const r = await request.get("/api/v1/termine");
		const etag = r.headers().etag;
		expect(etag).toBeTruthy();
		const r2 = await request.get("/api/v1/termine", {
			headers: { "if-none-match": etag },
		});
		expect(r2.status()).toBe(304);

		const falsch = await request.get("/api/v1/hildesheim/1999");
		expect(falsch.status()).toBe(404);
		const d = await falsch.json();
		expect(d.fehler.titel).toBe("Unbekannter Wahltermin");
		expect(d.fehler.moeglich).toContain("2021");

		// Ein Segment, das weder Kreis noch Termin ist, führt zur sauberen 404
		// und nicht in die Weiterleitungsschleife.
		const falscherKreis = await request.get("/api/v1/gibtsnicht");
		expect(falscherKreis.status()).toBe(404);
		expect((await falscherKreis.json()).fehler.titel).toBe("Unbekannter Kreis");

		const falscheWahl = await request.get(
			"/api/v1/hildesheim/2021/nordstemmen/gibtsnicht",
		);
		expect(falscheWahl.status()).toBe(404);
		expect((await falscheWahl.json()).fehler.moeglich).toContain(
			"ortsrat-roessing",
		);
	});

	test("Doku-Seite verlinkt OpenAPI und MCP", async ({ page }) => {
		await page.goto("/api");
		await expect(page.getByRole("heading", { level: 1 })).toHaveText(
			"Offene API",
		);
		await expect(page.getByRole("link", { name: "OpenAPI 3.1" })).toBeVisible();
		await expect(page.getByText("/mcp")).toBeVisible();
	});
});

/** MCP über Streamable HTTP: initialisieren, Werkzeuge auflisten, aufrufen. */
test.describe("MCP", () => {
	const rpc = async (
		request: import("@playwright/test").APIRequestContext,
		method: string,
		params?: unknown,
		id: number | string = 1,
	) => {
		const r = await request.post("/mcp", {
			headers: {
				accept: "application/json, text/event-stream",
				"content-type": "application/json",
			},
			data: { jsonrpc: "2.0", id, method, params },
		});
		expect(r.ok()).toBeTruthy();
		return await r.json();
	};

	test("initialize meldet Werkzeuge und Hinweise", async ({ request }) => {
		const d = await rpc(request, "initialize", {
			protocolVersion: "2025-06-18",
			capabilities: {},
			clientInfo: { name: "e2e", version: "1" },
		});
		expect(d.result.serverInfo.name).toBe("wahlen-hildesheim");
		expect(d.result.capabilities.tools).toBeTruthy();
		expect(d.result.instructions).toContain("Landkreis Hildesheim");
	});

	test("tools/list beschreibt alle Werkzeuge mit Schema", async ({
		request,
	}) => {
		const d = await rpc(request, "tools/list", {}, 2);
		const namen = d.result.tools.map((t: { name: string }) => t.name);
		expect(namen).toEqual([
			"wahltermine",
			"ueberblick",
			"behoerden",
			"wahlen",
			"ergebnis",
			"gebiete",
			"ticker",
			"wahllokale",
			"vergleich",
		]);
		const ergebnis = d.result.tools.find(
			(t: { name: string }) => t.name === "ergebnis",
		);
		expect(ergebnis.inputSchema.required).toEqual([
			"termin",
			"behoerde",
			"wahl",
		]);
		expect(ergebnis.inputSchema.properties.behoerde.enum).toContain(
			"nordstemmen",
		);
	});

	test("tools/call liefert Ergebnisse und verständliche Fehler", async ({
		request,
	}) => {
		const ergebnis = await rpc(
			request,
			"tools/call",
			{
				name: "ergebnis",
				arguments: { termin: "2021", behoerde: "nordstemmen", wahl: "rat" },
			},
			3,
		);
		const daten = JSON.parse(ergebnis.result.content[0].text);
		expect(daten.ergebnis.sitze.gesamt).toBe(30);
		expect(
			daten.ergebnis.parteien.find((p: { key: string }) => p.key === "cdu")
				.sitze,
		).toBe(9);

		const csv = await rpc(
			request,
			"tools/call",
			{
				name: "gebiete",
				arguments: {
					termin: "2021",
					behoerde: "nordstemmen",
					wahl: "rat",
					ebene: "ortsteil",
					format: "csv",
				},
			},
			4,
		);
		expect(csv.result.content[0].text).toContain("gebiet_name;ebene");

		const vergleich = await rpc(
			request,
			"tools/call",
			{
				name: "vergleich",
				arguments: {
					termin: "2021",
					vergleichsTermin: "2021",
					behoerde: "kreis",
					wahl: "kreistag",
				},
			},
			5,
		);
		const v = JSON.parse(vergleich.result.content[0].text);
		expect(
			v.parteien.find((p: { key: string }) => p.key === "cdu").veraenderung,
		).toBe(0);

		const kaputt = await rpc(
			request,
			"tools/call",
			{
				name: "ergebnis",
				arguments: {
					termin: "2021",
					behoerde: "nordstemmen",
					wahl: "gibtsnicht",
				},
			},
			6,
		);
		expect(kaputt.result.isError).toBe(true);
		expect(kaputt.result.content[0].text).toContain("gibt es bei");

		const unbekannt = await rpc(
			request,
			"tools/call",
			{ name: "quatsch", arguments: {} },
			7,
		);
		expect(unbekannt.result.isError).toBe(true);
	});
});
