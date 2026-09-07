import { createReadStream, rmSync } from "node:fs";
import { Readable } from "node:stream";
import type { APIRoute } from "astro";
import { dbPfad } from "../../lib/db.ts";
import { erzeugeKopie } from "../../lib/schnappschuss.ts";

export const prerender = false;

/**
 * Sicherung: konsistente Kopie der SQLite-Datei zum Herunterladen.
 * Nur mit EXPORT_TOKEN (Env) – ohne gesetztes Token ist der Abruf deaktiviert.
 *   curl -H "Authorization: Bearer $EXPORT_TOKEN" https://wahlergebnisse.levinkeller.de/export/wahlen.sqlite -o wahlen.sqlite
 *
 * Dieselbe Kopie zieht `scripts/schnappschuss.ts` für den Ausgangsbestand
 * (`src/lib/schnappschuss.ts`), deshalb steht das `VACUUM INTO` dort und nicht
 * mehr hier. Zwei Dinge sind dabei besser geworden:
 *
 *   - **Nur lesend.** `erzeugeKopie` öffnet die Datei selbst und lesend; der
 *     Abruf funktioniert damit auch in einem Web-Pod, der gar nicht schreiben
 *     darf. Vorher lief er über `oeffneDb()` und wäre dort in eine Ausnahme
 *     gelaufen.
 *   - **Streamend.** Vorher ging die Kopie mit `readFileSync` am Stück in den
 *     Speicher. Bei den erwarteten 750 MB Endgröße ist das der OOM-Kill des
 *     Pods – ausgerechnet beim Versuch, die Daten zu retten.
 */
export const GET: APIRoute = ({ request }) => {
	const token = process.env.EXPORT_TOKEN;
	const auth = request.headers.get("authorization") ?? "";
	if (!token || auth !== `Bearer ${token}`)
		return new Response("Nicht erlaubt", { status: token ? 403 : 404 });
	const ziel = `${dbPfad()}.export`;
	erzeugeKopie(dbPfad(), ziel, "export");
	const strom = createReadStream(ziel);
	// Auf dem Volume soll die Kopie nicht liegen bleiben – das wäre eine zweite
	// Datenbank in voller Größe. Weg damit, sobald sie gelesen ist; auch wenn
	// der Abruf mittendrin abbricht (`close` kommt in beiden Fällen).
	strom.on("close", () => rmSync(ziel, { force: true }));
	return new Response(Readable.toWeb(strom) as ReadableStream, {
		headers: {
			"content-type": "application/vnd.sqlite3",
			"content-disposition": `attachment; filename="wahlen-${new Date().toISOString().slice(0, 10)}.sqlite"`,
			"cache-control": "no-store",
		},
	});
};
