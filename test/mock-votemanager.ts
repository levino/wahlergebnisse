/**
 * Mock der votemanager-Wahlpräsentation für Tests: liefert die Fixtures
 * unter test/fixtures/votemanager (oder einem beliebigen Wurzelverzeichnis)
 * so aus, wie es der Apache des Landkreises tut – inklusive Autoindex-
 * Listing für Verzeichnisse, ETag und Last-Modified. Über `setzeWurzel()`
 * lässt sich der Datenstand während eines Tests umschalten (Wahlabend-
 * Simulation), `anfragen` zählt die Zugriffe.
 */
import { createReadStream, existsSync, readdirSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join, normalize } from "node:path";

export type MockVotemanager = {
	url: string;
	port: number;
	anfragen: string[];
	setzeWurzel: (dir: string) => void;
	schliessen: () => Promise<void>;
};

const listingHtml = (urlPfad: string, dir: string): string => {
	const zeilen = readdirSync(dir)
		.sort()
		.map((name) => {
			const st = statSync(join(dir, name));
			const mtime = st.mtime.toISOString().slice(0, 16).replace("T", " ");
			const groesse = st.isDirectory()
				? "-"
				: st.size > 1024
					? `${Math.round(st.size / 1024)}K`
					: String(st.size);
			const href = st.isDirectory() ? `${name}/` : name;
			return `<tr><td valign="top"><img src="/icons/unknown.gif" alt="[   ]"></td><td><a href="${href}">${href}</a></td><td align="right">${mtime}  </td><td align="right"> ${groesse}</td><td>&nbsp;</td></tr>`;
		})
		.join("\n");
	return `<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 3.2 Final//EN">\n<html><head><title>Index of ${urlPfad}</title></head><body><h1>Index of ${urlPfad}</h1><table>\n${zeilen}\n</table></body></html>`;
};

export const starteMockVotemanager = (
	wurzel: string,
	port = 0,
): Promise<MockVotemanager> =>
	new Promise((resolve) => {
		let root = wurzel;
		const anfragen: string[] = [];
		const server: Server = createServer((req, res) => {
			const url = new URL(req.url ?? "/", "http://localhost");
			anfragen.push(url.pathname);
			// URLs sehen so aus: /wahlen/20210912/03254026/api/praesentation/termin.json
			const rel = normalize(decodeURIComponent(url.pathname)).replace(
				/^\/wahlen\//,
				"/",
			);
			const datei = join(root, rel);
			if (!datei.startsWith(root) || !existsSync(datei)) {
				res.writeHead(404, { "content-type": "text/html; charset=iso-8859-1" });
				res.end(
					"<html><head><title>404 Not Found</title></head><body><h1>Not Found</h1></body></html>",
				);
				return;
			}
			const st = statSync(datei);
			if (st.isDirectory()) {
				res.writeHead(200, { "content-type": "text/html;charset=UTF-8" });
				res.end(listingHtml(url.pathname, datei));
				return;
			}
			const etag = `"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
			if (req.headers["if-none-match"] === etag) {
				res.writeHead(304, { etag });
				res.end();
				return;
			}
			res.writeHead(200, {
				"content-type": datei.endsWith(".json")
					? "application/json"
					: datei.endsWith(".csv")
						? "text/csv"
						: "text/plain",
				etag,
				"last-modified": st.mtime.toUTCString(),
			});
			createReadStream(datei).pipe(res);
		});
		server.listen(port, "127.0.0.1", () => {
			const p = (server.address() as { port: number }).port;
			resolve({
				url: `http://127.0.0.1:${p}/wahlen`,
				port: p,
				anfragen,
				setzeWurzel: (dir) => {
					root = dir;
				},
				schliessen: () => new Promise((r) => server.close(() => r())),
			});
		});
	});
