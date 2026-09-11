import { createReadStream, existsSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
	ANSAGE_FRIST_MS,
	ANSAGE_HOECHSTLAENGE,
	ANSAGE_PFAD,
	ANSAGE_STAND_PFAD,
	type AnsageStand,
	DIENST_STIMMEN,
	istDienstStimme,
} from "../src/lib/ansage.ts";
import {
	ansagePfad,
	dienstBereit,
	erzeugeAnsage,
	istAnsageBehoerde,
	modell,
	protokolliere,
	standardStimme,
} from "../src/lib/ansage-datei.ts";

/** Wie lange die Antwort auf eine neue Aufnahme wartet; am Abend verstellbar. */
const warteMs = (): number => {
	const n = Number(process.env.ANSAGE_WARTE_MS);
	return Number.isFinite(n) && n > 0 ? n : ANSAGE_FRIST_MS;
};

const json = (res: ServerResponse, code: number, rumpf: unknown): void => {
	res.writeHead(code, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store",
	});
	res.end(JSON.stringify(rumpf));
};

const sende = (res: ServerResponse, pfad: string, nurKopf: boolean): void => {
	res.writeHead(200, {
		"content-type": "audio/mpeg",
		"content-length": String(statSync(pfad).size),
		"cache-control": "public, max-age=31536000, immutable",
	});
	if (nurKopf) res.end();
	else createReadStream(pfad).pipe(res);
};

export const handhabeAnsage = (
	req: IncomingMessage,
	res: ServerResponse,
	url: URL,
): boolean => {
	if (url.pathname === ANSAGE_STAND_PFAD) {
		const behoerde = url.searchParams.get("behoerde") ?? "";
		const stand: AnsageStand = {
			verfuegbar: dienstBereit() && istAnsageBehoerde(behoerde),
			modell: modell(),
			standard: standardStimme(),
			stimmen: DIENST_STIMMEN,
		};
		json(res, 200, stand);
		return true;
	}
	if (url.pathname !== ANSAGE_PFAD) return false;
	if (req.method !== "GET" && req.method !== "HEAD") {
		res.writeHead(405, { allow: "GET" }).end();
		return true;
	}
	const text = (url.searchParams.get("text") ?? "").trim();
	const stimme = url.searchParams.get("stimme") || standardStimme();
	const behoerde = url.searchParams.get("behoerde") ?? "";
	if (!text || text.length > ANSAGE_HOECHSTLAENGE) {
		protokolliere(
			`keine Ansage für ${behoerde}: Satz ${text ? `${text.length} Zeichen` : "leer"}`,
		);
		json(res, 400, { fehler: "kein brauchbarer Satz" });
		return true;
	}
	if (!istDienstStimme(stimme)) {
		protokolliere(`keine Ansage für ${behoerde}: Stimme „${stimme}" unbekannt`);
		json(res, 400, { fehler: "unbekannte Stimme" });
		return true;
	}
	const pfad = ansagePfad(text, stimme);
	if (existsSync(pfad)) {
		sende(res, pfad, req.method === "HEAD");
		return true;
	}
	if (!dienstBereit() || !istAnsageBehoerde(behoerde)) {
		protokolliere(
			`keine Ansage für ${behoerde}: ${
				istAnsageBehoerde(behoerde)
					? "kein Schlüssel oder Gegenstelle abgeriegelt"
					: "Wahlleitung ohne Ansagedienst"
			}`,
		);
		json(res, 503, {
			fehler: "kein Ansagedienst für diese Wahlleitung",
			dienst: false,
		});
		return true;
	}
	const frist = warteMs();
	const lauf = erzeugeAnsage(text, stimme);
	const abgelaufen = new Promise<false>((fertig) => {
		setTimeout(() => fertig(false), frist).unref();
	});
	Promise.race([lauf, abgelaufen])
		.then((fertig) => {
			if (fertig && existsSync(pfad)) sende(res, pfad, req.method === "HEAD");
			else {
				// Ist der Riegel bei diesem Versuch gefallen, ist der Dienst weg;
				// sonst läuft die Aufnahme bloß noch.
				const weiter = dienstBereit() && istAnsageBehoerde(behoerde);
				protokolliere(
					weiter
						? `keine Ansage für ${behoerde}: nicht binnen ${frist} ms erzeugt, die Aufnahme läuft weiter`
						: `keine Ansage für ${behoerde}: Gegenstelle abgeriegelt`,
				);
				json(res, 503, {
					fehler: weiter
						? `Aufnahme nicht binnen ${frist} ms fertig`
						: "Ansagedienst abgeriegelt",
					dienst: weiter,
				});
			}
		})
		.catch(() =>
			json(res, 503, { fehler: "Ansage nicht erzeugt", dienst: true }),
		);
	return true;
};
