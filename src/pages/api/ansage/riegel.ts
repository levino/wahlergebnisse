import type { APIRoute } from "astro";
import {
	oeffneRiegel,
	protokolliere,
	setzeBremseZurueck,
} from "../../../lib/ansage-datei.ts";

export const prerender = false;

/**
 * Der Moderationsweg läuft im gebündelten Astro-Server, der Ansageweg im
 * nackten Node-Prozess; jeder hält seine eigene Modulinstanz und damit seinen
 * eigenen Riegel. Der Griff in `server/ansage.ts` erreicht diesen hier nicht.
 */
export const GET: APIRoute = () => {
	if (process.env.WAHLEN_TESTGRIFF !== "1")
		return new Response("nicht vorhanden", { status: 404 });
	oeffneRiegel();
	setzeBremseZurueck();
	protokolliere("Riegel und Bremse der Moderation zurückgesetzt (Testgriff)");
	return new Response(JSON.stringify({ riegel: "offen" }), {
		status: 200,
		headers: { "content-type": "application/json; charset=utf-8" },
	});
};
