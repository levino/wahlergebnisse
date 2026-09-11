import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { type Server, createServer } from "node:http";
import { join } from "node:path";
import {
	AUFNAHMEN_PFAD,
	type Anfragekern,
	type Aufnahme,
	MODERATION_PFAD,
	STIMME_PFAD,
	aufnahmeSchluessel,
	kernAus,
	lies,
	verfaelschungFuer,
} from "./aufnahmen.ts";

export type Protokollzeile = {
	art: Aufnahme["art"] | "unbekannt";
	schluessel: string;
	bekannt: boolean;
};

export type Aufzeichnung = {
	/** Die echte Gegenstelle – die Vorgabe steht in `ansage-datei.ts`. */
	basis: string;
	schluessel: string;
	verzeichnis?: string;
};

export type MockOpenai = {
	url: string;
	port: number;
	/** Jede Anfrage, die hereinkam – der Test zählt damit die Aufrufe. */
	anfragen: Protokollzeile[];
	/** Anfragen ohne Aufnahme, mit Text zum Nachsehen. */
	unbekannte: string[];
	zuruecksetzen: () => void;
	/** Gegenstelle fällt aus: jede Anfrage bekommt diesen Status. 0 = wieder gut. */
	setzeAusfall: (status: number) => void;
	schliessen: () => Promise<void>;
};

const rumpfVon = (req: import("node:http").IncomingMessage): Promise<string> =>
	new Promise((f) => {
		let roh = "";
		req.on("data", (s) => {
			roh += s;
		});
		req.on("end", () => f(roh));
	});

const lautScheitern = (kern: Anfragekern, schluessel: string): string => {
	const zeilen = [
		"",
		"================= AUFNAHME FEHLT =================",
		`Die Gegenstelle kennt diese Anfrage nicht: ${kern.art} / ${schluessel}`,
		`Modell: ${kern.modell}${kern.stimme ? ` | Stimme: ${kern.stimme}` : ""}`,
		`Text: ${kern.text.slice(0, 400)}`,
		"Neu aufnehmen: OPENAI_API_KEY=… npm run ansage-aufzeichnen",
		"==================================================",
		"",
	].join("\n");
	console.error(zeilen);
	return zeilen;
};

export const starteMockOpenai = (
	optionen: { verzeichnis?: string; aufzeichnen?: Aufzeichnung } = {},
): Promise<MockOpenai> =>
	new Promise((fertig) => {
		const verzeichnis = optionen.verzeichnis ?? AUFNAHMEN_PFAD;
		const aufnahmen = lies(verzeichnis);
		const anfragen: Protokollzeile[] = [];
		const unbekannte: string[] = [];
		let ausfall = 0;

		const sende = (
			res: import("node:http").ServerResponse,
			a: Aufnahme,
		): void => {
			if (a.art === "stimme" && a.datei) {
				const daten = readFileSync(join(verzeichnis, a.datei));
				res.writeHead(200, {
					"content-type": "audio/mpeg",
					"content-length": String(daten.length),
				});
				res.end(daten);
				return;
			}
			res.writeHead(200, { "content-type": "application/json" });
			res.end(JSON.stringify(a.antwort));
		};

		const zeichneAuf = async (
			kern: Anfragekern,
			schluessel: string,
			rumpf: string,
		): Promise<Aufnahme> => {
			const auf = optionen.aufzeichnen as Aufzeichnung;
			const ziel = auf.verzeichnis ?? verzeichnis;
			const ihrPfad = kern.art === "stimme" ? STIMME_PFAD : MODERATION_PFAD;
			const antwort = await fetch(`${auf.basis}${ihrPfad}`, {
				method: "POST",
				headers: {
					authorization: `Bearer ${auf.schluessel}`,
					"content-type": "application/json",
				},
				body: rumpf,
			});
			if (!antwort.ok)
				throw new Error(
					`Gegenstelle antwortet ${antwort.status}: ${(await antwort.text()).slice(0, 300)}`,
				);
			let herkunft = `aufgezeichnet ${new Date().toISOString().slice(0, 10)} gegen ${auf.basis}`;
			mkdirSync(ziel, { recursive: true });
			let a: Aufnahme;
			if (kern.art === "stimme") {
				a = { ...kern, schluessel, herkunft, datei: `${schluessel}.mp3` };
				writeFileSync(
					join(ziel, `${schluessel}.mp3`),
					Buffer.from(await antwort.arrayBuffer()),
				);
			} else {
				const daten = (await antwort.json()) as {
					choices?: Array<{ message?: { content?: string } }>;
				};
				const verfaelschung = verfaelschungFuer(kern);
				const nachricht = daten.choices?.[0]?.message;
				if (verfaelschung && nachricht) {
					nachricht.content = verfaelschung.satz;
					herkunft = `${herkunft} – Satz ausgetauscht (erfundene Zahl), siehe VERFAELSCHUNGEN in e2e/aufnahmen.ts`;
				}
				a = { ...kern, schluessel, herkunft, antwort: daten };
			}
			writeFileSync(
				join(ziel, `${schluessel}.json`),
				`${JSON.stringify(a, null, "\t")}\n`,
			);
			aufnahmen.set(schluessel, a);
			console.log(`aufgezeichnet: ${kern.art} / ${schluessel}`);
			return a;
		};

		const server: Server = createServer((req, res) => {
			void (async () => {
				const pfad = new URL(req.url ?? "/", "http://localhost").pathname;
				const rumpf = await rumpfVon(req);
				if (ausfall) {
					anfragen.push({ art: "unbekannt", schluessel: "", bekannt: false });
					res.writeHead(ausfall, { "content-type": "application/json" });
					res.end(
						JSON.stringify({
							error: { message: "Ausfall der Gegenstelle (Testfall)" },
						}),
					);
					return;
				}
				let kern: Anfragekern | undefined;
				try {
					kern = kernAus(pfad, JSON.parse(rumpf));
				} catch {
					kern = undefined;
				}
				if (!kern) {
					anfragen.push({ art: "unbekannt", schluessel: "", bekannt: false });
					unbekannte.push(`fremder Pfad: ${pfad}`);
					console.error(`Gegenstelle: fremder Pfad ${pfad}`);
					res.writeHead(404, { "content-type": "application/json" });
					res.end(JSON.stringify({ error: { message: "unbekannter Pfad" } }));
					return;
				}
				const schluessel = aufnahmeSchluessel(kern);
				const da = aufnahmen.get(schluessel);
				if (da) {
					anfragen.push({ art: kern.art, schluessel, bekannt: true });
					sende(res, da);
					return;
				}
				anfragen.push({ art: kern.art, schluessel, bekannt: false });
				if (optionen.aufzeichnen) {
					try {
						sende(res, await zeichneAuf(kern, schluessel, rumpf));
					} catch (e) {
						console.error(`Aufzeichnen misslungen: ${(e as Error).message}`);
						res.writeHead(502, { "content-type": "application/json" });
						res.end(
							JSON.stringify({ error: { message: (e as Error).message } }),
						);
					}
					return;
				}
				unbekannte.push(lautScheitern(kern, schluessel));
				res.writeHead(502, { "content-type": "application/json" });
				res.end(
					JSON.stringify({
						error: { message: "keine Aufnahme zu dieser Anfrage" },
					}),
				);
			})();
		});

		server.listen(0, "127.0.0.1", () => {
			const port = (server.address() as { port: number }).port;
			fertig({
				url: `http://127.0.0.1:${port}`,
				port,
				anfragen,
				unbekannte,
				zuruecksetzen: () => {
					anfragen.length = 0;
					unbekannte.length = 0;
				},
				setzeAusfall: (status) => {
					ausfall = status;
				},
				schliessen: () => new Promise<void>((f) => server.close(() => f())),
			});
		});
	});
