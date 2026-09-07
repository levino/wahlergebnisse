import { expect, test } from "@playwright/test";
import { warteAufDaten } from "./warten.ts";
import { BASIS } from "./ports.ts";

/**
 * Eine Weiterleitung ansehen, ohne ihr zu folgen. Playwrights request-Kontext
 * wirft bei maxRedirects: 0, deshalb hier das Node-fetch mit redirect:
 * "manual" – so lassen sich Status und Ziel wirklich prüfen.
 */
const ohneFolgen = (pfad: string) =>
	fetch(`${BASIS}${pfad}`, { redirect: "manual" });

/**
 * Der Kreis als erstes Adress-Segment: alte Links bleiben gültig, die Auswahl
 * wird gemerkt, und ein Kreis, den es nicht gibt, führt zur 404 statt in eine
 * Weiterleitungsschleife.
 */
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
			// Das Ziel selbst wird nicht erneut umgeleitet – keine Schleife.
			const ziel = await ohneFolgen(neu);
			expect(ziel.status, neu).toBe(200);
		}
	});

	test("unbekannter Kreis führt zur 404, nicht in die Schleife", async () => {
		expect((await ohneFolgen("/gibtsnicht/2021/")).status).toBe(404);
		expect((await ohneFolgen("/gibtsnicht/")).status).toBe(404);
		expect((await ohneFolgen("/api/v1/gibtsnicht/2021")).status).toBe(404);
	});

	test("ohne Cookie zeigt / die Auswahl, danach den gemerkten Kreis", async ({
		page,
		context,
	}) => {
		await context.clearCookies();
		await page.goto("/");
		await expect(page.getByRole("heading", { level: 1 })).toHaveText(
			/Welchen Kreis/,
		);
		await expect(
			page.getByRole("link", { name: "Hildesheim", exact: true }).first(),
		).toBeVisible();

		// Ein Besuch im Kreis merkt ihn …
		await page.goto("/hildesheim/2021/");
		expect(
			(await context.cookies()).find((c) => c.name === "kreis")?.value,
		).toBe("hildesheim");

		// … und „/“ führt beim nächsten Mal direkt dorthin.
		await page.goto("/");
		expect(new URL(page.url()).pathname).toBe("/hildesheim/");
	});

	test("Umschalter im Kopf nennt den Kreis und führt zu einem anderen", async ({
		page,
	}) => {
		await page.goto("/hildesheim/2021/kreis/kreistag/");
		const umschalter = page.locator("header details");
		await expect(umschalter).toContainText("Hildesheim");
		// Brotkrumen beginnen beim Termin: der Kreis ist keine eigene Ebene.
		const krumen = page.getByLabel("Brotkrumen");
		const erste = krumen.getByRole("link").first();
		await expect(erste).toHaveText("Kommunalwahl 2021");
		await expect(erste).toHaveAttribute("href", "/hildesheim/2021/");

		// Ohne JavaScript benutzbar: das Suchfeld geht als GET an /wechsel.
		await umschalter.locator("summary").click();
		const form = umschalter.locator("form");
		await expect(form).toHaveAttribute("action", "/wechsel");
		await expect(form).toHaveAttribute("method", "get");
	});

	test("Suchfeld führt zum Kreis, ein Tippfehler zur Auswahl", async ({
		page,
	}) => {
		await page.goto("/wechsel?kreis=Nienburg");
		expect(new URL(page.url()).pathname).toBe("/nienburg/");

		// Auch mit gemerktem Kreis darf der Hinweis nicht verschluckt werden.
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
		await expect(page.getByText("keine Ergebnisse vor")).toBeVisible();
		await expect(page.getByText("13. September 2026")).toBeVisible();
		await expect(
			page.getByRole("link", { name: "Anderen Kreis wählen" }),
		).toBeVisible();
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
