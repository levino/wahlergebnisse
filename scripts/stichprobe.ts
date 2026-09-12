import { terminById } from "../src/data/termine.ts";
import {
	BEFUND_UEBERSCHRIFT,
	type Befundart,
	QUELLENART_KURZ,
	QUELLENART_TEXT,
	type Quellenart,
	HOECHSTZAHL_ANFRAGEN,
	STANDARD_API,
	laufe,
	rueckgabewert,
} from "../src/lib/stichprobe.ts";

const args = process.argv.slice(2);
const wert = (name: string): string | undefined => {
	const i = args.indexOf(name);
	return i >= 0 ? args[i + 1] : undefined;
};
const liste = (name: string): string[] | undefined =>
	wert(name)
		?.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
const zahl = (name: string, vorgabe: number): number => {
	const v = wert(name);
	const n = v === undefined ? Number.NaN : Number(v);
	return Number.isFinite(n) ? n : vorgabe;
};

const terminId = wert("--termin") ?? "2026";
const termin = terminById(terminId);
if (!termin) {
	console.error(`Unbekannter Termin: ${terminId}`);
	process.exit(1);
}

const alsJson = args.includes("--json");

const bericht = await laufe({
	termin,
	api: wert("--api") ?? STANDARD_API,
	umfang: zahl("--umfang", 8),
	saat: wert("--saat") === undefined ? undefined : zahl("--saat", 0),
	kreise: liste("--kreis"),
	behoerden: liste("--behoerde"),
	wahlenJeLeitung: zahl("--wahlen", 1),
	fehlendePruefen: zahl("--fehlende-pruefen", 5),
	mitOpenData: !args.includes("--ohne-open-data"),
	hoechstzahl: zahl("--anfragen", HOECHSTZAHL_ANFRAGEN),
	log: alsJson ? undefined : (z) => console.log(z),
});

const REIHENFOLGE: Befundart[] = [
	"fehlt-bei-uns",
	"fehlt-bei-der-quelle",
	"abweichung",
	"landesamt-verzug",
	"fehlt-bei-uns-leer",
	"fehlt-bei-uns-ungeprueft",
	"fehlt-bei-der-quelle-ungeprueft",
	"quelle-unverlinkt",
	"quelle-leer",
	"unerreichbar",
];

if (alsJson) {
	console.log(JSON.stringify(bericht, null, 2));
} else {
	const alle = bericht.ziehungen.flatMap((z) => z.befunde);
	for (const art of REIHENFOLGE) {
		const dazu = alle.filter((b) => b.art === art);
		if (!dazu.length) continue;
		console.log(`\n## ${BEFUND_UEBERSCHRIFT[art]} (${dazu.length})`);
		for (const b of dazu.slice(0, 40)) {
			const wo = [b.kreis, b.behoerde, b.wahl, b.gebiet]
				.filter(Boolean)
				.join("/");
			console.log(`  [${QUELLENART_KURZ[b.gegen]}] ${wo} – ${b.text}`);
			if (b.quelle) console.log(`    ${b.quelle}`);
		}
		if (dazu.length > 40) console.log(`  … und ${dazu.length - 40} weitere`);
	}
	const z = bericht.zusammenfassung;
	console.log(
		`\nTermin ${bericht.termin}: ${z.ziehungen} Wahlleitungen gezogen, ${z.verglichen} Gebiete Zahl für Zahl verglichen, ${bericht.anfragen} Anfragen (Saat ${bericht.saat}).`,
	);
	if (bericht.landesamt.basis)
		console.log(
			`Landesamt für Statistik (${bericht.landesamt.basis}): ${bericht.landesamt.abgeglichen} Gebiete abgeglichen.`,
		);
	const gegen = new Set(alle.map((b) => b.gegen));
	for (const art of gegen)
		console.log(
			`  ${QUELLENART_KURZ[art as Quellenart]}: ${QUELLENART_TEXT[art as Quellenart]}`,
		);
	console.log(
		`Fehlt bei uns: ${z["fehlt-bei-uns"]} (mit Zahlen), ${z["fehlt-bei-uns-leer"]} (noch ohne Zahlen), ${z["fehlt-bei-uns-ungeprueft"]} (nicht nachgeschlagen). ` +
			`Fehlt bei der Wahlleitung: ${z["fehlt-bei-der-quelle"]} (${z["fehlt-bei-der-quelle-ungeprueft"]} nicht nachgeschlagen). Abweichende Zahlen: ${z.abweichung}. ` +
			`Quelle hat nichts: ${z["quelle-leer"]}. Nicht erreichbar: ${z.unerreichbar}.`,
	);
}

process.exit(rueckgabewert(bericht));
