import { createReadStream, rmSync } from "node:fs";
import { Readable } from "node:stream";
import type { APIRoute } from "astro";
import { dbPfad } from "../../lib/db.ts";
import { erzeugeKopie } from "../../lib/schnappschuss.ts";

export const prerender = false;

export const GET: APIRoute = ({ request }) => {
	const token = process.env.EXPORT_TOKEN;
	const auth = request.headers.get("authorization") ?? "";
	if (!token || auth !== `Bearer ${token}`)
		return new Response("Nicht erlaubt", { status: token ? 403 : 404 });
	const ziel = `${dbPfad()}.export`;
	erzeugeKopie(dbPfad(), ziel, "export");
	const strom = createReadStream(ziel);
	strom.on("close", () => rmSync(ziel, { force: true }));
	return new Response(Readable.toWeb(strom) as ReadableStream, {
		headers: {
			"content-type": "application/vnd.sqlite3",
			"content-disposition": `attachment; filename="wahlen-${new Date().toISOString().slice(0, 10)}.sqlite"`,
			"cache-control": "no-store",
		},
	});
};
