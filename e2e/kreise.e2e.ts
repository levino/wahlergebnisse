import { expect, test } from "@playwright/test";
import { warteAufDaten } from "./warten.ts";
import { BASIS } from "./ports.ts";

const ohneFolgen = (pfad: string) =>
	fetch(`${BASIS}${pfad}`, { redirect: "manual" });

test.describe("Kreis in der Adresse", () => {
	test.beforeAll(async () => {
		test.setTimeout(240_000);
		await warteAufDaten("2021");
	});

	test("alte Adressen leiten dauerhaft nach Hildesheim", async () => {
		const faelle: Array<[string, string]> = [
			["/2021/", "/hildesheim/2021/"],
			["/2021/kreis/kreistag/", "/hildesheim/2021/kreis/kreistag/"],
			[
				"/2021/nordstemmen/rat/ebene_6_id_3119/",
				"/hildesheim/2021/nordstemmen/rat/ebene_6_id_3119/",
			],
			["/api/v1/2021/kreis/kreistag", "/api/v1/hildesheim/2021/kreis/kreistag"],
			[
				"/api/v1/2026/ereignisse?limit=5",
				"/api/v1/hildesheim/2026/ereignisse?limit=5",
			],
		];
		for (const [alt, neu] of faelle) {
			const r = await ohneFolgen(alt);
			expect(r.status, alt).toBe(301);
			expect(r.headers.get("location"), alt).toBe(neu);
			const ziel = await ohneFolgen(neu);
			expect(ziel.status, neu).toBe(200);
		}
	});

	test("unbekannter Kreis führt zur 404, nicht in die Schleife", async () => {
		expect((await ohneFolgen("/gibtsnicht/2021/")).status).toBe(404);
		expect((await ohneFolgen("/gibtsnicht/")).status).toBe(404);
		expect((await ohneFolgen("/api/v1/gibtsnicht/2021")).status).toBe(404);
	});

	test("/ zeigt immer die Auswahl, auch nach einem Kreisbesuch", async ({
		page,
		context,
	}) => {
		await page.goto("/");
		await expect(page.getByRole("heading", { level: 1 })).toHaveText(
			/Welchen Kreis/,
		);
		await expect(
			page.getByRole("link", { name: "Hildesheim", exact: true }).first(),
		).toBeVisible();

		await page.goto("/hildesheim/2021/");
		expect((await context.cookies()).map((c) => c.name)).not.toContain("kreis");

		await page.goto("/");
		expect(new URL(page.url()).pathname).toBe("/");
		await expect(page.getByRole("heading", { level: 1 })).toHaveText(
			/Welchen Kreis/,
		);
	});

	test("Umschalter im Kopf nennt den Kreis und führt zu einem anderen", async ({
		page,
	}) => {
		await page.goto("/hildesheim/2021/kreis/kreistag/");
		const umschalter = page.locator("header details");
		await expect(umschalter).toContainText("Hildesheim");
		const krumen = page.getByLabel("Brotkrumen");
		const erste = krumen.getByRole("link").first();
		await expect(erste).toHaveText("Kommunalwahl 2021");
		await expect(erste).toHaveAttribute("href", "/hildesheim/2021/");

		await umschalter.locator("summary").click();
		const form = umschalter.locator("form");
		await expect(form).toHaveAttribute("action", "/wechsel");
		await expect(form).toHaveAttribute("method", "get");
	});

	test("Umschalter bleibt beim Seitentausch offen", async ({ page }) => {
		await page.goto("/hildesheim/2021/kreis/kreistag/");
		const umschalter = page.locator("header details");
		await umschalter.locator("summary").click();
		await expect(umschalter).toHaveJSProperty("open", true);

		const suche = umschalter.locator('input[name="kreis"]');
		await suche.fill("Nienbu");
		await expect(suche).toBeFocused();

		await page.evaluate(() => {
			const a = document.createElement("a");
			a.href = `${location.pathname}?stand=2`;
			document.body.append(a);
			a.click();
		});
		await expect(page).toHaveURL(/stand=2/);

		await expect(umschalter).toHaveJSProperty("open", true);
		await expect(umschalter.locator("form")).toBeVisible();
		await expect(suche).toHaveValue("Nienbu");
		await expect(suche).toBeFocused();
	});

	test("Umschalter zeigt nach dem Kreiswechsel den neuen Kreis – und ist zu", async ({
		page,
	}) => {
		await page.goto("/hildesheim/2021/kreis/kreistag/");
		const umschalter = page.locator("header details");
		await umschalter.locator("summary").click();
		await expect(umschalter).toHaveJSProperty("open", true);

		await umschalter
			.getByRole("link", { name: "Nienburg", exact: true })
			.click();
		await expect(page).toHaveURL(/\/nienburg\/$/);
		await expect(umschalter.locator("summary")).toContainText("Nienburg");
		await expect(umschalter.locator("summary")).not.toContainText("Hildesheim");
		await expect(umschalter).toHaveJSProperty("open", false);
	});

	test("Suchfeld führt zum Kreis, ein Tippfehler zur Auswahl", async ({
		page,
	}) => {
		await page.goto("/wechsel?kreis=Nienburg");
		expect(new URL(page.url()).pathname).toBe("/nienburg/");

		await page.goto("/wechsel?kreis=Quatsch");
		expect(new URL(page.url()).pathname).toBe("/");
		await expect(page.getByText("ist kein Kreis")).toBeVisible();
	});

	test("Kreis ohne Präsentation erklärt sich, statt leer zu bleiben", async ({
		page,
	}) => {
		await page.goto("/salzgitter/");
		await expect(page.getByRole("heading", { level: 1 })).toHaveText(
			"Stadt Salzgitter",
		);
		await expect(page.getByText("liegen hier nicht vor")).toBeVisible();
		await expect(page.getByText("13. September 2026")).toBeVisible();
		await expect(
			page.getByRole("link", { name: "Anderen Kreis wählen" }),
		).toBeVisible();
	});

	test("Kreis ohne eigene Zahlen verweist auf die amtliche Quelle", async ({
		page,
	}) => {
		await page.goto("/heidekreis/");
		await expect(page.getByRole("heading", { level: 1 })).toHaveText(
			"Heidekreis",
		);
		const quelle = page.getByRole("link", {
			name: "Kommunalwahl 2021 im Heidekreis",
		});
		await expect(quelle).toBeVisible();
		await expect(quelle).toHaveAttribute(
			"href",
			"https://wahlen-heidekreis.de/KW2021/20210912/03358000/praesentation/index.html",
		);
		await expect(quelle).toHaveAttribute("rel", /noopener/);

		await page.goto("/salzgitter/");
		await expect(
			page.getByRole("link", {
				name: "Kommunal- und OB-Wahl 2026 bei der Stadt Salzgitter",
			}),
		).toHaveAttribute(
			"href",
			"https://www.salzgitter.de/rathaus/wahlen/kommunalwahl_obwahl2026.php",
		);
	});

	test("Celle und Uelzen stehen als angebunden da, nicht als Fundstellen-Liste", async ({
		page,
	}) => {
		for (const slug of ["celle", "uelzen"]) {
			await page.goto(`/${slug}/`);
			await expect(page.getByRole("heading", { level: 1 })).toHaveText(
				"Kommunalwahl 2026",
			);
			await expect(page.getByText("liegen hier nicht vor")).toHaveCount(0);
		}
	});

	test("Schnittstelle kennt die Kreise", async ({ request }) => {
		const r = await request.get("/api/v1/kreise");
		expect(r.ok()).toBeTruthy();
		const kreise = (await r.json()).kreise as Array<{
			slug: string;
			vorhanden: boolean;
		}>;
		expect(kreise.some((k) => k.slug === "hildesheim")).toBeTruthy();

		const einer = await request.get("/api/v1/hildesheim");
		expect(einer.ok()).toBeTruthy();
		expect((await einer.json()).slug).toBe("hildesheim");

		const ueberblick = await request.get("/api/v1/hildesheim/2021");
		expect(ueberblick.ok()).toBeTruthy();
		expect((await ueberblick.json()).kreis.slug).toBe("hildesheim");
	});
});
