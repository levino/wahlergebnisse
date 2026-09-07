import type { APIRoute } from "astro";
import { dbPfad, oeffneDb } from "../../lib/db.ts";
import { readFileSync, rmSync } from "node:fs";

export const prerender = false;

/**
 * Sicherung: konsistente Kopie der SQLite-Datei zum Herunterladen.
 * Nur mit EXPORT_TOKEN (Env) – ohne gesetztes Token ist der Abruf deaktiviert.
 *   curl -H "Authorization: Bearer $EXPORT_TOKEN" https://wahlergebnisse.levinkeller.de/export/wahlen.sqlite -o wahlen.sqlite
 */
export const GET: APIRoute = ({ request }) => {
	const token = process.env.EXPORT_TOKEN;
	const auth = request.headers.get("authorization") ?? "";
	if (!token || auth !== `Bearer ${token}`)
		return new Response("Nicht erlaubt", { status: token ? 403 : 404 });
	const db = oeffneDb();
	const ziel = `${dbPfad()}.export`;
	// `VACUUM INTO` legt die Datei an und bricht ab, wenn sie schon da ist
	// („output file already exists“). Ohne dieses Aufräumen ließe sich der
	// Export je Prozessleben genau einmal abrufen; beim zweiten Mal käme ein
	// Fehler statt einer Sicherung. Aufgefallen in der Wahlabend-Probe.
	rmSync(ziel, { force: true });
	db.exec(`VACUUM INTO '${ziel.replace(/'/g, "''")}'`);
	const body = readFileSync(ziel);
	// Im Speicher liegt die Kopie jetzt; auf dem Volume soll sie nicht liegen
	// bleiben – das wäre eine zweite Datenbank in voller Größe.
	rmSync(ziel, { force: true });
	return new Response(body, {
		headers: {
			"content-type": "application/vnd.sqlite3",
			"content-disposition": `attachment; filename="wahlen-${new Date().toISOString().slice(0, 10)}.sqlite"`,
			"cache-control": "no-store",
		},
	});
};
