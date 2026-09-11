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
import { RIEGEL_PFAD } from "../src/lib/ansage.ts";
import { OPENAI_BASIS_VORGABE } from "../src/lib/ansage-datei.ts";
import { PLATZHALTER_SCHLUESSEL } from "./aufnahmen.ts";
import { APP_PORT, STEUER_PORT } from "./ports.ts";
import { starteMockVotemanager } from "../test/mock-votemanager.ts";
import { starteMockOpenai } from "./mock-openai.ts";

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
		openai.zuruecksetzen();
		rmSync(ansagen, { recursive: true, force: true });
		// Der Riegel lebt im App-Prozess und gilt dort für die ganze
		// Laufzeit. Ohne dieses Zurücksetzen nimmt ein einziger Test mit
		// abgewiesenem Schlüssel allen späteren den Ansagedienst weg.
		void fetch(`http://127.0.0.1:${APP_PORT}${RIEGEL_PFAD}`)
			.catch(() => undefined)
			.finally(() => res.end("ok"));
		return;
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
			PUBLIC_SITE_URL: "https://wahlergebnisse.example.org",
			HOST: "127.0.0.1",
			DATABASE_PATH: join(tmp, "wahlen.db"),
			VOTEMANAGER_BASIS: mock.url,
			POLL_INTERVAL_SEKUNDEN: "2",
			POLL_INTERVAL_RUHIG_SEKUNDEN: "2",
			POLL_INTERVAL_BETRACHTET_SEKUNDEN: "2",
			POLL_BEHOERDEN: behoerden.join(","),
			POLL_KREISE_PRO_LAUF: "45",
			EXPORT_TOKEN: "e2e-token",
			OPENAI_BASIS: `${openai.url}/v1`,
			OPENAI_API_KEY: PLATZHALTER_SCHLUESSEL,
			ANSAGEN_PFAD: ansagen,
			// Öffnet `RIEGEL_PFAD`, damit ein Test mit abgewiesenem Schlüssel
			// nicht allen späteren den Ansagedienst nimmt.
			WAHLEN_TESTGRIFF: "1",
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
