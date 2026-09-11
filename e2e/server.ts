import { spawn } from "node:child_process";
import {
	type IncomingMessage,
	type ServerResponse,
	createServer,
} from "node:http";
import { join } from "node:path";
import {
	aufraeumen,
	tempVerzeichnis,
	vieleKreiseFixtures,
	wahlabendFuerBehoerde,
	wahlabendMitBezirken,
} from "../test/helfer.ts";
import { kreisBySlug } from "../src/data/kreise.ts";
import { legeBeitragAn } from "../src/lib/beitraege.ts";
import { oeffneDb } from "../src/lib/db.ts";
import { APP_PORT, STEUER_PORT } from "./ports.ts";
import { testUmgebung } from "./umgebung.ts";
import { starteMockVotemanager } from "../test/mock-votemanager.ts";

/** Kreise, in die die Hildesheimer Fixtures gespiegelt werden. */
const WEITERE_KREISE = ["holzminden", "goslar"];

const tmp = tempVerzeichnis("wahlen-e2e-");
const vorher = vieleKreiseFixtures(join(tmp, "vorher"), WEITERE_KREISE);

const abend = vieleKreiseFixtures(
	join(tmp, "wahlabend"),
	WEITERE_KREISE,
).wurzel;
wahlabendFuerBehoerde(abend, "03254026");

const abendMehr = vieleKreiseFixtures(
	join(tmp, "wahlabend-mehr"),
	WEITERE_KREISE,
).wurzel;
wahlabendMitBezirken(
	abendMehr,
	"03254026",
	[3111, 3112, 3113, 3114, 3115, 3116, 3117, 3118, 3119],
);

const abendViele = vieleKreiseFixtures(
	join(tmp, "wahlabend-viele"),
	WEITERE_KREISE,
);
for (const ags of abendViele.melder.values())
	wahlabendFuerBehoerde(abendViele.wurzel, ags);

const mock = await starteMockVotemanager(vorher.wurzel);

/**
 * Ohne Schlüssel bleibt der Ansageweg im Browser-Lauf inert: Kein Aufruf geht
 * nach draußen, und die Leinwand sagt, dass sie still bleibt. Was der Dienst
 * selbst tut, prüfen die Kassetten in `test/ansage-kette.test.ts`.
 */
const ansagen = join(tmp, "ansagen");

/** Alle Behörden, für die es Dateien gibt – mehr braucht der E2E-Lauf nicht. */
const behoerden = [
	"03254000",
	"03254026",
	"03402000",
	...WEITERE_KREISE.flatMap((slug) => [
		kreisBySlug(slug)!.ags,
		vorher.melder.get(slug)!,
	]),
];

const dbDatei = join(tmp, "wahlen.db");

/**
 * Beiträge hinterlegen, ohne dass die Anwendung dafür einen Pfad anbietet.
 *
 * Die Steuerung gehört zum Testaufbau und läuft nirgends sonst; sie schreibt
 * über dasselbe Ablagemodul wie der Poller in dieselbe Datenbank.
 */
const hinterlege = (req: IncomingMessage, res: ServerResponse): void => {
	let roh = "";
	req.on("data", (s) => {
		roh += s;
	});
	req.on("end", () => {
		res.writeHead(200, { "content-type": "application/json" });
		try {
			const angelegt = legeBeitragAn(oeffneDb(dbDatei), JSON.parse(roh));
			res.end(JSON.stringify({ id: angelegt.id }));
		} catch (e) {
			res.end(JSON.stringify({ fehler: (e as Error).message }));
		}
	});
};

const steuerung = createServer((req, res) => {
	const url = new URL(req.url ?? "/", "http://localhost");
	if (url.pathname === "/beitrag") return hinterlege(req, res);
	if (url.pathname === "/wahlabend") mock.setzeWurzel(abend);
	else if (url.pathname === "/wahlabend-mehr") mock.setzeWurzel(abendMehr);
	else if (url.pathname === "/wahlabend-viele")
		mock.setzeWurzel(abendViele.wurzel);
	else if (url.pathname === "/vorher") mock.setzeWurzel(vorher.wurzel);
	res.end("ok");
});
steuerung.listen(STEUER_PORT, "127.0.0.1");

const app = spawn(
	process.execPath,
	["--no-warnings", "--experimental-strip-types", "server/main.ts"],
	{
		stdio: "inherit",
		env: testUmgebung({
			PORT: String(APP_PORT),
			PUBLIC_SITE_URL: "https://wahlergebnisse.example.org",
			HOST: "127.0.0.1",
			DATABASE_PATH: dbDatei,
			VOTEMANAGER_BASIS: mock.url,
			POLL_INTERVAL_SEKUNDEN: "2",
			POLL_INTERVAL_RUHIG_SEKUNDEN: "2",
			POLL_INTERVAL_BETRACHTET_SEKUNDEN: "2",
			POLL_BEHOERDEN: behoerden.join(","),
			POLL_KREISE_PRO_LAUF: "45",
			EXPORT_TOKEN: "e2e-token",
			ANSAGEN_PFAD: ansagen,
		}),
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
