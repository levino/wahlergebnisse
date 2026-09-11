/**
 * Startet für die Browser-Tests den Mock-votemanager (Fixtures) und den
 * echten App-Server (server/main.ts) mit temporärer Datenbank. Über den
 * Steuer-Endpunkt des Mocks (siehe ports.ts, /wahlabend) schaltet ein Test den
 * Datenstand auf „erste Schnellmeldungen“ um.
 *
 * Der Datenstand umfasst **mehrere Kreise**: Fixtures gibt es nur für den
 * Landkreis Hildesheim, sie werden für zwei weitere Kreise gespiegelt (siehe
 * test/helfer.ts). Ein vierter Kreis (Peine) bleibt ohne jede Präsentation und
 * muss trotzdem tragen.
 *
 * Vier Datenstände, vier Schalter:
 *   /vorher          alles leer
 *   /wahlabend       nur Nordstemmen meldet, 2 von 23 (unter der Schwelle:
 *                    noch keine Sitzverteilung)
 *   /wahlabend-mehr  Nordstemmen bei 9 von 23 – jetzt wird hochgerechnet
 *   /wahlabend-viele nur die gespiegelten Kreise melden, alle gleichzeitig
 *
 * Dazu die Gegenstelle des Ansagedienstes (`mock-openai.ts`), die aus der
 * Konserve antwortet:
 *   /ansage/anfragen        was sie gesehen hat, und was ihr fehlte
 *   /ansage/zuruecksetzen   Zähler und erzeugte Dateien auf null
 *   /ansage/ausfall?status= sie weist ab, z. B. mit 401
 *
 * Getrennt, damit sich die Tests nicht in die Quere kommen: Ein Kreis, der
 * zweimal von „leer“ auf „gemeldet“ springt, bekommt auch zwei
 * Ticker-Einträge – für den Poller richtig, für einen Test verwirrend.
 */
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import {
	aufraeumen,
	tempVerzeichnis,
	vieleKreiseFixtures,
	wahlabendFuerBehoerde,
	wahlabendMitBezirken,
} from "../test/helfer.ts";
import { kreisBySlug } from "../src/data/kreise.ts";
import { OPENAI_BASIS_VORGABE } from "../src/lib/ansage-datei.ts";
import { APP_PORT, STEUER_PORT } from "./ports.ts";
import { starteMockVotemanager } from "../test/mock-votemanager.ts";
import { starteMockOpenai } from "./mock-openai.ts";

/** Kreise, in die die Hildesheimer Fixtures gespiegelt werden. */
const WEITERE_KREISE = ["holzminden", "goslar"];

const tmp = tempVerzeichnis("wahlen-e2e-");
const vorher = vieleKreiseFixtures(join(tmp, "vorher"), WEITERE_KREISE);

// Nur Nordstemmen meldet – der Stand, den der Ein-Kreis-Test erwartet.
const abend = vieleKreiseFixtures(
	join(tmp, "wahlabend"),
	WEITERE_KREISE,
).wurzel;
wahlabendFuerBehoerde(abend, "03254026");

// Weiter im Abend: neun der 23 Wahlbezirke – über der Schwelle, ab der eine
// Sitzverteilung gezeigt wird.
const abendMehr = vieleKreiseFixtures(
	join(tmp, "wahlabend-mehr"),
	WEITERE_KREISE,
).wurzel;
wahlabendMitBezirken(
	abendMehr,
	"03254026",
	[3111, 3112, 3113, 3114, 3115, 3116, 3117, 3118, 3119],
);

// Nur die gespiegelten Kreise melden, alle auf einmal.
const abendViele = vieleKreiseFixtures(
	join(tmp, "wahlabend-viele"),
	WEITERE_KREISE,
);
for (const ags of abendViele.melder.values())
	wahlabendFuerBehoerde(abendViele.wurzel, ags);

const mock = await starteMockVotemanager(vorher.wurzel);

/**
 * Die Gegenstelle des Ansagedienstes – aus der Konserve.
 *
 * Mit `ANSAGE_AUFZEICHNEN=1` und einem echten Schlüssel schneidet derselbe
 * Dienst mit, statt nur wiederzugeben; so entstehen die Aufnahmen
 * (`scripts/ansage-aufzeichnen.ts`). Ohne das geht nichts nach außen.
 */
const echterSchluessel = process.env.OPENAI_API_KEY?.trim() ?? "";
const ansagen = join(tmp, "ansagen");
const openai = await starteMockOpenai(
	process.env.ANSAGE_AUFZEICHNEN === "1" && echterSchluessel
		? {
				aufzeichnen: {
					basis: process.env.OPENAI_AUFNAHME_BASIS ?? OPENAI_BASIS_VORGABE,
					schluessel: echterSchluessel,
				},
			}
		: {},
);

/** Alle Behörden, für die es Dateien gibt – mehr braucht der E2E-Lauf nicht. */
const behoerden = [
	"03254000",
	"03254026",
	// Emden: die einzige kreisfreie Stadt in den Fixtures – dort ist die
	// Kreisbehörde zugleich die einzige Behörde.
	"03402000",
	...WEITERE_KREISE.flatMap((slug) => [
		kreisBySlug(slug)!.ags,
		vorher.melder.get(slug)!,
	]),
];

const steuerung = createServer((req, res) => {
	const url = new URL(req.url ?? "/", "http://localhost");
	if (url.pathname === "/wahlabend") mock.setzeWurzel(abend);
	else if (url.pathname === "/wahlabend-mehr") mock.setzeWurzel(abendMehr);
	else if (url.pathname === "/wahlabend-viele")
		mock.setzeWurzel(abendViele.wurzel);
	else if (url.pathname === "/vorher") mock.setzeWurzel(vorher.wurzel);
	else if (url.pathname === "/ansage/anfragen") {
		res.writeHead(200, { "content-type": "application/json" });
		res.end(
			JSON.stringify({
				anfragen: openai.anfragen,
				unbekannte: openai.unbekannte,
			}),
		);
		return;
	} else if (url.pathname === "/ansage/zuruecksetzen") {
		// Auch die erzeugten Dateien weg: Sonst zählte ein Test den Aufruf
		// nicht mehr, den ein früherer schon bezahlt hat.
		openai.zuruecksetzen();
		rmSync(ansagen, { recursive: true, force: true });
	} else if (url.pathname === "/ansage/ausfall")
		openai.setzeAusfall(Number(url.searchParams.get("status") ?? 0) || 0);
	res.end("ok");
});
steuerung.listen(STEUER_PORT, "127.0.0.1");

const app = spawn(
	process.execPath,
	["--no-warnings", "--experimental-strip-types", "server/main.ts"],
	{
		stdio: "inherit",
		env: {
			...process.env,
			PORT: String(APP_PORT),
			// Wie in Produktion: Der Server steht hinter einem Proxy und kennt seine
			// öffentliche Adresse nur aus dieser Angabe.
			PUBLIC_SITE_URL: "https://wahlergebnisse.example.org",
			HOST: "127.0.0.1",
			DATABASE_PATH: join(tmp, "wahlen.db"),
			VOTEMANAGER_BASIS: mock.url,
			POLL_INTERVAL_SEKUNDEN: "2",
			// Der ruhige Takt (Standard 30 Minuten) gilt an Tagen ohne Wahl – in den
			// Tests soll trotzdem sofort nachgeladen werden.
			POLL_INTERVAL_RUHIG_SEKUNDEN: "2",
			// Und derselbe kurze Takt für den Kreis, den gerade jemand ansieht.
			// Ohne das gilt für ihn der Standard von 15 Minuten, und ausgerechnet
			// die geöffnete Seite bekäme nichts mehr nachgeliefert.
			POLL_INTERVAL_BETRACHTET_SEKUNDEN: "2",
			// Nur die Behörden mit Dateien; alles andere würde den Start nur
			// verlängern.
			POLL_BEHOERDEN: behoerden.join(","),
			// Im Test soll jeder Lauf alle Kreise mitnehmen: Der Deckel
			// verteilt in Produktion einen Rückstand über mehrere Minuten,
			// hier würde er den Test nur zäh und wackelig machen.
			POLL_KREISE_PRO_LAUF: "45",
			EXPORT_TOKEN: "e2e-token",
			// Die Gegenstelle des Ansagedienstes zeigt auf die Konserve. Der
			// Schlüssel ist ein Platzhalter: Er entscheidet nur darüber, ob der
			// Dienst überhaupt als vorhanden gilt, und geht an niemanden hinaus.
			OPENAI_BASIS: `${openai.url}/v1`,
			OPENAI_API_KEY: "sk-e2e-platzhalter",
			ANSAGEN_PFAD: ansagen,
		},
	},
);

const stop = async () => {
	app.kill("SIGTERM");
	steuerung.close();
	await mock.schliessen();
	await openai.schliessen();
	aufraeumen(tmp);
	process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
app.on("exit", (code) => {
	steuerung.close();
	mock.schliessen();
	openai.schliessen();
	process.exit(code ?? 0);
});
