/**
 * Eine Gegenstelle mit fester Antwort – kein Sprachdienst, kein Geld.
 *
 * Für das Zusammenspiel ist gleichgültig, *was* in der Aufnahme steht; nur,
 * *dass* eine entsteht, abgelegt, angekündigt, abgeholt und abgespielt wird.
 * Deshalb steht hier keine Aufzeichnung und keine Wiedergabe, sondern auf
 * jede Anfrage dieselbe Antwort. `OPENAI_BASIS` leitet beide Aufrufe des
 * Servers hierher – Textmodell wie Sprachdienst.
 */
import { type Server, createServer } from "node:http";

/**
 * Der Satz, den das Textmodell hier immer sagt.
 *
 * Ohne Ziffern, damit `pruefeAntwort` ihn nicht als erfundene Zahl verwirft:
 * Geprüft werden soll der Weg, nicht die Prüfung.
 */
export const FESTER_SATZ = "Aus Nordstemmen liegen neue Ergebnisse vor.";

/** Ein paar stille MPEG-Rahmen – genug, um eine Datei zu sein. */
const RAHMEN = Buffer.concat([
	Buffer.from([0xff, 0xfb, 0x90, 0x64]),
	Buffer.alloc(413),
]);

export const FESTE_AUFNAHME = Buffer.concat(
	Array.from({ length: 8 }, () => RAHMEN),
);

export type Aufrufe = { moderation: number; stimme: number };

export type Gegenstelle = {
	url: string;
	aufrufe: () => Aufrufe;
	schliessen: () => Promise<void>;
};

export const starteGegenstelle = async (): Promise<Gegenstelle> => {
	const gezaehlt: Aufrufe = { moderation: 0, stimme: 0 };
	const dienst: Server = createServer((req, res) => {
		req.resume();
		req.on("end", () => {
			const pfad = new URL(req.url ?? "/", "http://localhost").pathname;
			if (pfad.endsWith("/chat/completions")) {
				gezaehlt.moderation++;
				res.writeHead(200, { "content-type": "application/json" });
				res.end(
					JSON.stringify({
						choices: [{ message: { content: FESTER_SATZ } }],
					}),
				);
				return;
			}
			if (pfad.endsWith("/audio/speech")) {
				gezaehlt.stimme++;
				res.writeHead(200, {
					"content-type": "audio/mpeg",
					"content-length": String(FESTE_AUFNAHME.length),
				});
				res.end(FESTE_AUFNAHME);
				return;
			}
			res.writeHead(404, { "content-type": "application/json" });
			res.end(JSON.stringify({ fehler: `unbekannter Pfad ${pfad}` }));
		});
	});
	await new Promise<void>((fertig) => dienst.listen(0, "127.0.0.1", fertig));
	const { port } = dienst.address() as { port: number };
	return {
		url: `http://127.0.0.1:${port}`,
		aufrufe: () => ({ ...gezaehlt }),
		schliessen: () => new Promise((f) => dienst.close(() => f())),
	};
};
