/**
 * Startet für die Browser-Tests den Mock-votemanager (Fixtures) und den
 * echten App-Server (server/main.ts) mit temporärer Datenbank. Über den
 * Steuer-Endpunkt des Mocks (Port 8098, /wahlabend) schaltet ein Test den
 * Datenstand auf „erste Schnellmeldungen“ um.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { join } from "node:path";
import {
	FIXTURES,
	aufraeumen,
	tempVerzeichnis,
	wahlabendFixtures,
} from "../test/helfer.ts";
import { starteMockVotemanager } from "../test/mock-votemanager.ts";

const tmp = tempVerzeichnis("wahlen-e2e-");
const mock = await starteMockVotemanager(FIXTURES);
const abend = wahlabendFixtures(join(tmp, "wahlabend"));

const steuerung = createServer((req, res) => {
	if (req.url === "/wahlabend") mock.setzeWurzel(abend);
	else if (req.url === "/vorher") mock.setzeWurzel(FIXTURES);
	res.end("ok");
});
steuerung.listen(8098, "127.0.0.1");

const app = spawn(
	process.execPath,
	["--no-warnings", "--experimental-strip-types", "server/main.ts"],
	{
		stdio: "inherit",
		env: {
			...process.env,
			PORT: "8099",
			HOST: "127.0.0.1",
			DATABASE_PATH: join(tmp, "wahlen.db"),
			VOTEMANAGER_BASIS: mock.url,
			POLL_INTERVAL_SEKUNDEN: "2",
			// Der ruhige Takt (Standard 30 Minuten) gilt an Tagen ohne Wahl – in den
			// Tests soll trotzdem sofort nachgeladen werden.
			POLL_INTERVAL_RUHIG_SEKUNDEN: "2",
			// Fixtures gibt es für Landkreis und Nordstemmen; alles andere würde
			// den Start nur verlängern.
			POLL_BEHOERDEN: "03254000,03254026",
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
