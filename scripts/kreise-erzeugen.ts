/**
 * Erzeugt den Kreis- und Behördenkatalog `src/data/kreis-katalog.ts` aus den
 * Rohdaten unter `scripts/quellen/`.
 *
 *   node --experimental-strip-types scripts/kreise-erzeugen.ts
 *
 * Warum ein Skript und nicht ein Download zur Laufzeit: Der Katalog steht in
 * Adressen (`/<kreis>/<termin>/<behoerde>/…`). Er darf sich nicht ändern, weil
 * ein fremder Server gerade anders antwortet. Eingecheckter Code lässt sich
 * lesen, im Diff prüfen und gezielt korrigieren; das Skript macht nur
 * nachvollziehbar, woher er kommt.
 *
 * Quellen (Stand 07.09.2026, siehe scripts/quellen/erhebung.md):
 *   nds-behoerden.json  416 Behörden aus wahlen.votemanager.de/behoerden.json
 *   nds-kreise.json     45 Kreise, je Kreis Wurzel, Schema und 2026er Stand
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HIER = dirname(fileURLToPath(import.meta.url));
const QUELLEN = join(HIER, "quellen");
const ZIEL = join(HIER, "..", "src", "data", "kreis-katalog.ts");

type RohBehoerde = {
	name: string;
	ags: string | null;
	host: string | null;
	url: string;
};

type RohKreis = {
	kreisAgs: string;
	name: string;
	host: string | null;
	basisPfad: string | null;
	termin2026: { angelegt: boolean };
	hinweise?: string;
};

/**
 * Slugs der Kreise – von Hand, weil sie das erste Segment jeder Adresse sind.
 * Abgeleitet aus dem Namen ohne „Landkreis“/„Stadt“, klein und ohne Umlaute;
 * die beiden Doppelungen (Oldenburg, Osnabrück gibt es als Stadt und als
 * Landkreis) bekommen einen Zusatz, damit beide Adressen eindeutig bleiben.
 */
const KREIS_SLUGS: Record<string, string> = {
	"03101000": "braunschweig",
	"03102000": "salzgitter",
	"03103000": "wolfsburg",
	"03151000": "gifhorn",
	"03153000": "goslar",
	"03154000": "helmstedt",
	"03155000": "northeim",
	"03157000": "peine",
	"03158000": "wolfenbuettel",
	"03159000": "goettingen",
	"03241000": "region-hannover",
	"03251000": "diepholz",
	"03252000": "hameln-pyrmont",
	"03254000": "hildesheim",
	"03255000": "holzminden",
	"03256000": "nienburg",
	"03257000": "schaumburg",
	"03351000": "celle",
	"03352000": "cuxhaven",
	"03353000": "harburg",
	"03354000": "luechow-dannenberg",
	"03355000": "lueneburg",
	"03356000": "osterholz",
	"03357000": "rotenburg",
	"03358000": "heidekreis",
	"03359000": "stade",
	"03360000": "uelzen",
	"03361000": "verden",
	"03401000": "delmenhorst",
	"03402000": "emden",
	"03403000": "oldenburg-stadt",
	"03404000": "osnabrueck-stadt",
	"03405000": "wilhelmshaven",
	"03451000": "ammerland",
	"03452000": "aurich",
	"03453000": "cloppenburg",
	"03454000": "emsland",
	"03455000": "friesland",
	"03456000": "grafschaft-bentheim",
	"03457000": "leer",
	"03458000": "oldenburg-land",
	"03459000": "osnabrueck-land",
	"03460000": "vechta",
	"03461000": "wesermarsch",
	"03462000": "wittmund",
};

/**
 * Kurzname des Kreises für Menüs und Titel („Hildesheim“ statt „Landkreis
 * Hildesheim“). Nur dort nötig, wo das bloße Weglassen des Vorsatzes ein
 * schiefes Ergebnis gäbe.
 */
const KREIS_KURZ: Record<string, string> = {
	"03241000": "Region Hannover",
	"03358000": "Heidekreis",
	"03403000": "Oldenburg (Stadt)",
	"03404000": "Osnabrück (Stadt)",
	"03458000": "Oldenburg (Landkreis)",
	"03459000": "Osnabrück (Landkreis)",
};

/**
 * Die 19 Hildesheimer Slugs aus der ersten Fassung der App. Sie stehen seit
 * dem Start in Adressen und dürfen sich nicht ändern; alles andere wird aus
 * dem Namen abgeleitet.
 */
const BESTAND_SLUGS: Record<string, string> = {
	"03254000": "kreis",
	"03254002": "alfeld",
	"03254003": "algermissen",
	"03254005": "bad-salzdetfurth",
	"03254008": "bockenem",
	"03254011": "diekholzen",
	"03254014": "elze",
	"03254017": "giesen",
	"03254020": "harsum",
	"03254021": "hildesheim",
	"03254022": "holle",
	"03254026": "nordstemmen",
	"03254028": "sarstedt",
	"03254029": "schellerten",
	"03254032": "soehlde",
	"03254042": "freden",
	"03254044": "lamspringe",
	"03254045": "sibbesse",
	"032545406": "leinebergland",
};

/**
 * Kreise, deren Präsentation für den 13.09.2026 nicht benutzbar ist. Der
 * Termin-Index der Region Hannover nennt den Termin zwar, das Verzeichnis
 * liefert aber 404 (siehe erhebung.md); die übrigen ergeben sich schon aus
 * `termin2026.angelegt`. Sie stehen trotzdem im Katalog, damit die Anwendung
 * sie benennen kann statt sie zu verschweigen.
 */
const NICHT_VORHANDEN = new Set(["03241000"]);

/**
 * Warum ein Kreis nichts hergibt – in einem Satz, den die Seite anzeigen kann.
 * Die `hinweise` aus der Erhebung sind Notizen für Entwickler; hier steht,
 * was jemand liest, der den Kreis aufruft.
 */
const HINWEIS: Record<string, string> = {
	"03102000":
		"Für den 13. September 2026 ist keine Präsentation angelegt. Die eigene Instanz der Stadt antwortet nicht, der Spiegel beim KDO endet 2022.",
	"03103000":
		"Die Stadt betreibt keine erreichbare Wahlpräsentation; der letzte Stand beim KDO ist von 2022.",
	"03241000":
		"Der Termin steht im Verzeichnis der Region, die Daten dazu fehlen aber noch (404).",
	"03351000": "Der Landkreis benutzt keinen votemanager.",
	"03353000":
		"Für den 13. September 2026 ist keine Präsentation angelegt; der letzte Stand ist von Juni 2024.",
	"03358000":
		"Für den 13. September 2026 ist keine Präsentation angelegt; der letzte Stand ist von Februar 2025.",
	"03360000": "Der Landkreis benutzt keinen votemanager.",
};

/**
 * Wurzeln, die in `behoerden.json` falsch stehen. Der Heidekreis ist der
 * einzige Fall: Für alle 13 Behörden nennt die Liste `/BEHKK2021/<ags>/`, was
 * 404 liefert; richtig ist die Host-Wurzel.
 */
const WURZEL_KORREKTUR: Record<string, string> = {
	"https://wahlen-heidekreis.de/BEHKK2021/": "https://wahlen-heidekreis.de/",
};

/**
 * Kurznamen einzelner Behörden, wo der abgeleitete irreführend wäre: Die
 * Region Hannover und die Landeshauptstadt hießen sonst beide „Hannover“.
 */
const BEHOERDE_KURZ: Record<string, string> = {
	"03241000": "Region Hannover",
};

const entitaeten = (s: string): string =>
	s
		.replace(/&auml;/g, "ä")
		.replace(/&ouml;/g, "ö")
		.replace(/&uuml;/g, "ü")
		.replace(/&Auml;/g, "Ä")
		.replace(/&Ouml;/g, "Ö")
		.replace(/&Uuml;/g, "Ü")
		.replace(/&szlig;/g, "ß")
		.replace(/&amp;/g, "&");

/** Vorsätze, die im Slug nichts verloren haben – „Stadt Alfeld“ → „alfeld“. */
const VORSATZ =
	/^(Landkreis|Landeshauptstadt|Hansestadt|Inselgemeinde|Nordseebad|Bergstadt|Samtgemeinde|Gemeinde|Flecken|Stadt|Region)\s+/i;

/** Name → Slug: klein, ASCII, Bindestriche, ohne Vorsatz und Klammerzusätze. */
export const slugAusName = (name: string): string =>
	entitaeten(name)
		.replace(VORSATZ, "")
		.replace(/\(.*?\)/g, " ")
		.replace(/,.*$/, "")
		.toLowerCase()
		.replace(/ä/g, "ae")
		.replace(/ö/g, "oe")
		.replace(/ü/g, "ue")
		.replace(/ß/g, "ss")
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");

/**
 * Kurzname für Karten und Menüs: Vorsatz und amtlicher Klammerzusatz fallen
 * weg – „Stadt Alfeld (Leine)“ steht in einer Tabellenspalte als „Alfeld“.
 */
const kurzAusName = (name: string): string =>
	entitaeten(name)
		.replace(VORSATZ, "")
		.replace(/\s*\(.*?\)\s*$/, "")
		.trim() || entitaeten(name);

type Art = "kreis" | "stadt" | "gemeinde" | "samtgemeinde";

const artAusName = (name: string, istKreis: boolean): Art => {
	if (istKreis) return "kreis";
	const n = entitaeten(name);
	if (/^Samtgemeinde\b/i.test(n)) return "samtgemeinde";
	if (/^(Stadt|Landeshauptstadt|Hansestadt|Bergstadt|Nordseebad)\b/i.test(n))
		return "stadt";
	return "gemeinde";
};

/**
 * Gebietsschlüssel und Wurzel einer Behörde aus ihrer URL.
 *
 * Der Schlüssel steht in `behoerden.json` nur bei Gemeinden im Feld `ags`;
 * bei den 107 Samtgemeinden ist er neunstellig und ausschließlich in der URL
 * zu finden (`https://votemanager.kdo.de/033555401/index.html`). Deshalb wird
 * er grundsätzlich aus der URL gelesen.
 */
const ausUrl = (url: string): { ags: string; wurzel: string } | undefined => {
	const m = url.match(/^(.*\/)(\d{8,9})\/(?:index\.html)?$/);
	if (!m) return undefined;
	const wurzel = WURZEL_KORREKTUR[m[1]] ?? m[1];
	return { ags: m[2], wurzel };
};

/** Die ersten fünf Stellen sind der Kreis – bei acht wie bei neun Stellen. */
const kreisVon = (ags: string): string => `${ags.slice(0, 5)}000`;

const roh = <T>(datei: string): T =>
	JSON.parse(readFileSync(join(QUELLEN, datei), "utf8")) as T;

const behoerdenRoh = roh<RohBehoerde[]>("nds-behoerden.json");
const kreiseRoh = roh<RohKreis[]>("nds-kreise.json");

// --- Behörden je Kreis einsortieren ---

type Fertig = {
	ags: string;
	slug: string;
	name: string;
	kurz: string;
	art: Art;
	wurzel: string;
};

const nachKreis = new Map<string, Fertig[]>();
const uebersprungen: string[] = [];
const dubletten: string[] = [];

for (const b of behoerdenRoh) {
	const zerlegt = ausUrl(b.url);
	if (!zerlegt) {
		uebersprungen.push(`${entitaeten(b.name)} (${b.url})`);
		continue;
	}
	const { ags, wurzel } = zerlegt;
	const kreisAgs = kreisVon(ags);
	// „Land Niedersachsen“ (03000000) ist keine Wahlbehörde im Sinne der App.
	if (kreisAgs === "03000000") continue;
	const name = entitaeten(b.name);
	const liste = nachKreis.get(kreisAgs) ?? [];
	// Zwei Schlüssel kommen in der Behördenliste doppelt vor, jeweils einmal
	// richtig und einmal als Gemeinde etikettiert (031515404 Isenbüttel,
	// 032565411 Weser-Aue). Neunstellige Schlüssel gehören zu Samtgemeinden;
	// daran lässt sich der richtige Eintrag erkennen.
	const schonDa = liste.find((x) => x.ags === ags);
	if (schonDa) {
		const passt = (n: string) =>
			(ags.length === 9) === /^Samtgemeinde\b/i.test(n);
		if (!passt(name) || passt(schonDa.name)) {
			dubletten.push(`${name} (${ags}, verworfen)`);
			continue;
		}
		dubletten.push(`${schonDa.name} (${ags}, verworfen)`);
		liste.splice(liste.indexOf(schonDa), 1);
	}
	liste.push({
		ags,
		slug: "",
		name,
		kurz: BEHOERDE_KURZ[ags] ?? kurzAusName(name),
		art: artAusName(name, ags === kreisAgs),
		wurzel,
	});
	nachKreis.set(kreisAgs, liste);
}

// --- Slugs vergeben ---

/**
 * Innerhalb eines Kreises muss jeder Slug einmalig sein; zwischen Kreisen
 * nicht, dort steht der Kreis davor. Kollidiert ein abgeleiteter Slug (zwei
 * Orte gleichen Namens, meist Stadt und Samtgemeinde), bekommt der zweite die
 * Art als Zusatz, danach eine laufende Nummer.
 */
const vergibSlugs = (kreisAgs: string, liste: Fertig[]): void => {
	const belegt = new Set<string>();
	// Erst die festgeschriebenen, damit sie sich gegen abgeleitete durchsetzen.
	for (const b of liste) {
		const fest = BESTAND_SLUGS[b.ags];
		if (fest) {
			b.slug = fest;
			belegt.add(fest);
		}
	}
	for (const b of liste.sort((x, y) => x.ags.localeCompare(y.ags))) {
		if (b.slug) continue;
		// Die Kreisbehörde heißt überall „kreis“ – so steht sie in jedem Kreis
		// an derselben Stelle, auch bei den kreisfreien Städten.
		let kandidat = b.ags === kreisAgs ? "kreis" : slugAusName(b.name);
		if (!kandidat) kandidat = b.ags;
		const basis = kandidat;
		if (belegt.has(kandidat)) {
			// Die Art unterscheidet nur, wenn sie sich unterscheidet: Stadt und
			// Samtgemeinde gleichen Namens werden so lesbar getrennt, zwei Städte
			// gleichen Namens brauchen dagegen eine Nummer.
			const gleicheArt = liste.some(
				(o) =>
					o !== b &&
					o.slug !== "" &&
					slugAusName(o.name) === basis &&
					o.art === b.art,
			);
			kandidat = gleicheArt ? `${basis}-2` : `${basis}-${b.art}`;
		}
		let n = 2;
		while (belegt.has(kandidat)) kandidat = `${basis}-${n++}`;
		b.slug = kandidat;
		belegt.add(kandidat);
	}
	// Nach Gebietsschlüssel – dieselbe Reihenfolge wie in der ersten Fassung
	// und dieselbe, in der votemanager die Behörden führt. Wie sie auf einer
	// Seite erscheinen, entscheidet die Anzeige, nicht der Katalog.
	liste.sort((x, y) => x.ags.localeCompare(y.ags));
};

// --- Kreise zusammenbauen ---

type FertigerKreis = {
	slug: string;
	ags: string;
	name: string;
	kurz: string;
	basis: string;
	vorhanden: boolean;
	hinweis?: string;
	behoerden: Fertig[];
};

const kreise: FertigerKreis[] = [];

for (const k of kreiseRoh.sort((a, b) =>
	a.kreisAgs.localeCompare(b.kreisAgs),
)) {
	const slug = KREIS_SLUGS[k.kreisAgs];
	if (!slug) throw new Error(`Kein Slug für Kreis ${k.kreisAgs} (${k.name})`);
	const liste = nachKreis.get(k.kreisAgs) ?? [];
	vergibSlugs(k.kreisAgs, liste);
	const name = entitaeten(k.name);
	// Die Wurzel steht im Katalog ohne den Termin-Teil: `basisPfad` ist eine
	// Vorlage („…/{termin}/{ags}/“), der Poller setzt Termin und Behörde
	// selbst ein. Fehlt sie (Celle, Uelzen: kein votemanager), nehmen wir die
	// häufigste – abgefragt wird der Kreis ohnehin nicht.
	const basis =
		k.basisPfad?.split("{termin}")[0] ??
		liste[0]?.wurzel ??
		"https://votemanager.kdo.de/";
	const vorhanden =
		k.termin2026.angelegt &&
		liste.length > 0 &&
		!NICHT_VORHANDEN.has(k.kreisAgs);
	kreise.push({
		slug,
		ags: k.kreisAgs,
		name,
		kurz: KREIS_KURZ[k.kreisAgs] ?? kurzAusName(name),
		basis,
		vorhanden,
		hinweis: vorhanden ? undefined : HINWEIS[k.kreisAgs],
		behoerden: liste,
	});
}

// --- Prüfungen, bevor irgendetwas geschrieben wird ---

for (const k of kreise)
	if (!k.vorhanden && !k.hinweis)
		throw new Error(`Kein Hinweis für den Kreis ohne Präsentation: ${k.slug}`);

const kreisSlugs = new Set(kreise.map((k) => k.slug));
if (kreisSlugs.size !== kreise.length)
	throw new Error("Doppelte Kreis-Slugs im Katalog");
for (const k of kreise) {
	const s = new Set(k.behoerden.map((b) => b.slug));
	if (s.size !== k.behoerden.length)
		throw new Error(`Doppelte Behörden-Slugs in ${k.slug}`);
	for (const b of k.behoerden) {
		if (!/^[a-z0-9-]+$/.test(b.slug))
			throw new Error(`Untauglicher Slug ${b.slug} in ${k.slug}`);
		const fest = BESTAND_SLUGS[b.ags];
		if (fest && fest !== b.slug)
			throw new Error(`Bestands-Slug ${fest} verloren (${b.ags} → ${b.slug})`);
	}
}
const bestandGefunden = kreise
	.flatMap((k) => k.behoerden)
	.filter((b) => BESTAND_SLUGS[b.ags]).length;
if (bestandGefunden !== Object.keys(BESTAND_SLUGS).length)
	throw new Error(
		`Nur ${bestandGefunden} von ${Object.keys(BESTAND_SLUGS).length} Bestands-Behörden wiedergefunden`,
	);

// --- Ausgabe ---

const z = (s: string) => JSON.stringify(s);

const behoerdeCode = (b: Fertig, kreisBasis: string): string => {
	const felder = [
		`ags: ${z(b.ags)}`,
		`slug: ${z(b.slug)}`,
		`name: ${z(b.name)}`,
		`kurz: ${z(b.kurz)}`,
		`art: ${z(b.art)}`,
	];
	// Die Wurzel gehört zur Behörde: In drei Kreisen liegen Kreisbehörde und
	// Gemeinden auf verschiedenen Hosts. Notiert wird sie nur, wo sie von der
	// des Kreises abweicht.
	if (b.wurzel !== kreisBasis) felder.push(`wurzel: ${z(b.wurzel)}`);
	return `\t\t\t{ ${felder.join(", ")} },`;
};

const kreisCode = (k: FertigerKreis): string => {
	const kopf = [
		`\t\tslug: ${z(k.slug)},`,
		`\t\tags: ${z(k.ags)},`,
		`\t\tname: ${z(k.name)},`,
		`\t\tkurz: ${z(k.kurz)},`,
		`\t\tbasis: ${z(k.basis)},`,
		`\t\tvorhanden: ${k.vorhanden},`,
	];
	if (k.hinweis) kopf.push(`\t\thinweis: ${z(k.hinweis)},`);
	const behoerden = k.behoerden.length
		? `\t\tbehoerden: [\n${k.behoerden.map((b) => behoerdeCode(b, k.basis)).join("\n")}\n\t\t],`
		: "\t\tbehoerden: [],";
	return `\t{\n${kopf.join("\n")}\n${behoerden}\n\t},`;
};

const anzahlBehoerden = kreise.reduce((s, k) => s + k.behoerden.length, 0);
const anzahlVorhanden = kreise.filter((k) => k.vorhanden).length;

const code = `/**
 * Kreis- und Behördenkatalog Niedersachsens – ERZEUGT, nicht von Hand ändern.
 *
 * Quelle: scripts/quellen/ (Abzug vom 07.09.2026),
 * Erzeuger: scripts/kreise-erzeugen.ts, Beschreibung: scripts/quellen/erhebung.md.
 *
 * ${kreise.length} Kreise mit ${anzahlBehoerden} Behörden, davon ${anzahlVorhanden} Kreise mit einer
 * benutzbaren Präsentation für den 13.09.2026.
 *
 * Die Typen und alle Zugriffe stehen in kreise.ts bzw. behoerden.ts; hier
 * liegen nur die Daten.
 */
import type { Kreis } from "./kreise.ts";

export const KATALOG: Kreis[] = [
${kreise.map(kreisCode).join("\n")}
];
`;

writeFileSync(ZIEL, code);
console.log(
	`${ZIEL}: ${kreise.length} Kreise, ${anzahlBehoerden} Behörden, ${anzahlVorhanden} mit Präsentation`,
);
if (dubletten.length)
	console.log(`Doppelte Schlüssel bereinigt: ${dubletten.join(", ")}`);
if (uebersprungen.length)
	console.log(
		`Übersprungen (keine auswertbare Adresse): ${uebersprungen.join(", ")}`,
	);
