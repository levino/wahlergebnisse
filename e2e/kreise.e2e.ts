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

		// Früher merkte ein Cookie den Kreis und "/" leitete ein Jahr lang
		// dorthin um. Wer über "/" einstieg, landete unversehens in einem
		// fremden Kreis – ohne Weg zurück und ohne dessen Archivtermine.
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

	test("Umschalter bleibt beim Seitentausch offen", async ({ page }) => {
		// Am Wahlabend tauscht die Live-Zustellung alle paar Minuten den
		// Seiteninhalt aus (Layout.astro ruft dafür navigate()). Klappte der
		// Umschalter dabei zu, wäre er genau an dem Abend unbenutzbar, an dem
		// er gebraucht wird: Alle paar Minuten kämen neue Zahlen und rissen
		// einem das Menü unter der Hand weg.
		await page.goto("/hildesheim/2021/kreis/kreistag/");
		const umschalter = page.locator("header details");
		await umschalter.locator("summary").click();
		await expect(umschalter).toHaveJSProperty("open", true);

		// Halb getippte Suche mit dem Cursor mittendrin – auch das soll den
		// Tausch überstehen, sonst tippt man dieselben Buchstaben zum dritten
		// Mal.
		const suche = umschalter.locator('input[name="kreis"]');
		await suche.fill("Nienbu");
		await expect(suche).toBeFocused();

		// Ein echter Wechsel des Routers, keine Attrappe: dieselbe Seite mit
		// anderer Abfrage – genau das, was die Zustellung auslöst.
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
		// Die Kehrseite des Mitnehmens: Bliebe das Menü über *jeden* Tausch
		// stehen, nennte es nach einem Kreiswechsel weiter den alten Kreis und
		// hinge dazu noch offen im Bild. Der Persist-Name trägt deshalb den
		// Kreis-Slug – hier steht, dass das auch wirkt.
		await page.goto("/hildesheim/2021/kreis/kreistag/");
		const umschalter = page.locator("header details");
		await umschalter.locator("summary").click();
		await expect(umschalter).toHaveJSProperty("open", true);

		await umschalter
			.getByRole("link", { name: "Nienburg", exact: true })
			.click();
		await expect(page).toHaveURL(/\/nienburg\/$/);
		// Im Kopf steht der Kreis, in dem man jetzt ist – die Liste darunter
		// führt weiter alle 45, Hildesheim eingeschlossen.
		await expect(umschalter.locator("summary")).toContainText("Nienburg");
		await expect(umschalter.locator("summary")).not.toContainText("Hildesheim");
		await expect(umschalter).toHaveJSProperty("open", false);
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
		await expect(page.getByText("liegen hier nicht vor")).toBeVisible();
		await expect(page.getByText("13. September 2026")).toBeVisible();
		await expect(
			page.getByRole("link", { name: "Anderen Kreis wählen" }),
		).toBeVisible();
	});

	test("Kreis ohne eigene Zahlen verweist auf die amtliche Quelle", async ({
		page,
	}) => {
		// Der Kern der Sache: Für Celle wurde behauptet, es gebe keine
		// Ergebnisse – dabei hatte nur niemand nachgesehen. Die Seite darf
		// deshalb nicht bei „liegt nicht vor“ stehen bleiben, sondern muss
		// dorthin führen, wo die Zahlen tatsächlich stehen.
		await page.goto("/celle/");
		await expect(page.getByRole("heading", { level: 1 })).toHaveText(
			"Landkreis Celle",
		);
		const quelle = page.getByRole("link", {
			name: "Kreiswahl 2021 im Landkreis Celle",
		});
		await expect(quelle).toBeVisible();
		await expect(quelle).toHaveAttribute(
			"href",
			"https://wahl.landkreis-celle.de/ivu/kreis2021_celle/ergebnisse.html",
		);
		// Fremde Seite: neues Ziel, kein Zugriff auf unser Fenster.
		await expect(quelle).toHaveAttribute("rel", /noopener/);

		// Uelzen ebenso – beide standen für „gibt es nicht“.
		await page.goto("/uelzen/");
		await expect(
			page.getByRole("link", {
				name: "Kreistagswahl 2021 im Landkreis Uelzen",
			}),
		).toHaveAttribute(
			"href",
			"https://wahlen.landkreis-uelzen.de/kw2021/kt/ergebnisse.html",
		);
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
