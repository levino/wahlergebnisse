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
 * Drei Datenstände, drei Schalter:
 *   /vorher          alles leer
 *   /wahlabend       nur Nordstemmen meldet (der Ein-Kreis-Fall)
 *   /wahlabend-viele nur die gespiegelten Kreise melden, alle gleichzeitig
 *
 * Getrennt, damit sich die Tests nicht in die Quere kommen: Ein Kreis, der
 * zweimal von „leer“ auf „gemeldet“ springt, bekommt auch zwei
 * Ticker-Einträge – für den Poller richtig, für einen Test verwirrend.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { join } from "node:path";
import {
	aufraeumen,
	tempVerzeichnis,
	vieleKreiseFixtures,
	wahlabendFuerBehoerde,
} from "../test/helfer.ts";
import { kreisBySlug } from "../src/data/kreise.ts";
import { APP_PORT, STEUER_PORT } from "./ports.ts";
import { starteMockVotemanager } from "../test/mock-votemanager.ts";

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

// Nur die gespiegelten Kreise melden, alle auf einmal.
const abendViele = vieleKreiseFixtures(
	join(tmp, "wahlabend-viele"),
	WEITERE_KREISE,
);
for (const ags of abendViele.melder.values())
	wahlabendFuerBehoerde(abendViele.wurzel, ags);

const mock = await starteMockVotemanager(vorher.wurzel);

/** Alle Behörden, für die es Dateien gibt – mehr braucht der E2E-Lauf nicht. */
const behoerden = [
	"03254000",
	"03254026",
	...WEITERE_KREISE.flatMap((slug) => [
		kreisBySlug(slug)!.ags,
		vorher.melder.get(slug)!,
	]),
];

const steuerung = createServer((req, res) => {
	if (req.url === "/wahlabend") mock.setzeWurzel(abend);
	else if (req.url === "/wahlabend-viele") mock.setzeWurzel(abendViele.wurzel);
	else if (req.url === "/vorher") mock.setzeWurzel(vorher.wurzel);
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
		},
	},
);

const stop = async () => {
	app.kill("SIGTERM");
	steuerung.close();
	await mock.schliessen();
	aufraeumen(tmp);
	process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
app.on("exit", (code) => {
	steuerung.close();
	mock.schliessen();
	process.exit(code ?? 0);
});
