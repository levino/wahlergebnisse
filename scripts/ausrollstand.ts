import { execFileSync } from "node:child_process";
import {
	type Befund,
	beurteile,
	kurz,
	type Lage,
	schlimmstes,
	tagAus,
} from "../src/lib/ausrollstand.ts";

const hat = (name: string) => process.argv.includes(`--${name}`);

const lauf = (
	befehl: string,
	argumente: readonly string[],
	frist = 30_000,
): string =>
	execFileSync(befehl, [...argumente], {
		encoding: "utf-8",
		timeout: frist,
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();

const vielleicht = (
	befehl: string,
	argumente: readonly string[],
	frist?: number,
): string | undefined => {
	try {
		return lauf(befehl, argumente, frist);
	} catch {
		return undefined;
	}
};

const mainKopf = (): string => {
	lauf("git", ["fetch", "--no-tags", "--quiet", "origin", "main"]);
	return lauf("git", ["rev-parse", "FETCH_HEAD"]);
};

const zweigStand = (): string => {
	lauf("git", ["fetch", "--no-tags", "--quiet", "origin", "ausgerollt"]);
	return tagAus(
		lauf("git", [
			"show",
			"FETCH_HEAD:deploy/overlays/production/kustomization.yaml",
		]),
	);
};

const laeuftEineAusrollung = (): boolean | undefined => {
	const roh = vielleicht("gh", [
		"run",
		"list",
		"--repo",
		"levino/wahlergebnisse",
		"--workflow",
		"deploy.yml",
		"--limit",
		"15",
		"--json",
		"status",
	]);
	if (!roh) return undefined;
	try {
		const laeufe = JSON.parse(roh) as { status: string }[];
		return laeufe.some((l) => l.status !== "completed");
	} catch {
		return undefined;
	}
};

const clusterStaende = (): string[] | undefined => {
	const roh = vielleicht(
		"ssh",
		[
			"-o",
			"BatchMode=yes",
			"-o",
			"ConnectTimeout=8",
			"srv",
			"sudo kubectl -n wahlergebnisse get deploy -o jsonpath='{range .items[*]}{.spec.template.spec.containers[0].image}{\"\\n\"}{end}'",
		],
		40_000,
	);
	if (roh === undefined) return undefined;
	const staende = roh
		.split("\n")
		.map((z) => z.trim())
		.filter(Boolean)
		.map((bild) => bild.split(":").at(-1) ?? "");
	return staende.length > 0 ? staende : undefined;
};

const nochNichtDraussen = (zweig: string, main: string): string[] =>
	vielleicht("git", ["log", "--oneline", "--max-count=10", `${zweig}..${main}`])
		?.split("\n")
		.filter(Boolean) ?? [];

let main: string;
let zweig: string;
try {
	main = mainKopf();
	zweig = zweigStand();
} catch (e) {
	console.error(`Ausrollstand nicht feststellbar: ${(e as Error).message}`);
	process.exit(2);
}
if (!main || !zweig) {
	console.error(
		"Ausrollstand nicht feststellbar: kein Kopf von main oder kein newTag auf ausgerollt.",
	);
	process.exit(2);
}

const cluster = hat("ohne-cluster") ? undefined : clusterStaende();
const laufend = laeuftEineAusrollung();
const lage: Lage = { main, zweig, cluster, laeuft: laufend === true };
const befunde: Befund[] = beurteile(lage);
const offen = main === zweig ? [] : nochNichtDraussen(zweig, main);

if (hat("json")) {
	console.log(
		JSON.stringify(
			{ ...lage, laufAbfragbar: laufend !== undefined, offen, befunde },
			null,
			2,
		),
	);
} else {
	const teile = [
		`main ${kurz(main)}`,
		`eingetragen ${kurz(zweig)}`,
		cluster
			? `Cluster ${[...new Set(cluster)].map(kurz).join("+")}`
			: undefined,
	].filter(Boolean);
	console.log(`Ausrollstand · ${teile.join(" · ")}`);
	if (laufend === undefined)
		console.log(
			"Warnung: laufende Deploy-Läufe nicht abfragbar – gewertet, als liefe keine.",
		);
	if (cluster === undefined && !hat("ohne-cluster"))
		console.log("Hinweis: kein Cluster-Zugang, nur main gegen Ausrollzweig.");
	if (befunde.length === 0) console.log("Deckt sich.");
	for (const b of befunde)
		console.log(`${b.stufe === "fehler" ? "FEHLER " : "Warnung"} ${b.was}`);
	for (const zeile of offen) console.log(`   nicht draußen: ${zeile}`);
	if (schlimmstes(befunde) === 1)
		console.log("   → gh workflow run deploy.yml --ref main");
}

process.exit(schlimmstes(befunde));
