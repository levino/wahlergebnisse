import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
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

type RohArchiv2021 = {
	kreisAgs: string;
	name: string;
	kommunalwahl2021: {
		name: string;
		url: string;
		ordner: string | null;
		/** Gegenprobe: Liegt die Präsentation auch da, wo der Index sie nennt? */
		geprueft?: { schema: "v22" | "v26" | null };
	} | null;
};

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

const KREIS_KURZ: Record<string, string> = {
	"03241000": "Region Hannover",
	"03358000": "Heidekreis",
	"03403000": "Oldenburg (Stadt)",
	"03404000": "Osnabrück (Stadt)",
	"03458000": "Oldenburg (Landkreis)",
	"03459000": "Osnabrück (Landkreis)",
};

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

const NICHT_VORHANDEN = new Set(["03241000"]);

const HINWEIS: Record<string, string> = {
	"03102000":
		"Die Stadt hat ihre Wahlpräsentation für den 13. September 2026 noch nicht freigeschaltet – sie stellt sie erst am Wahlabend an. Sobald sie liefert, erscheinen die Zahlen auch hier.",
	"03241000":
		"Der Termin steht im Verzeichnis der Region, die Daten dazu fehlen aber noch (404). Die Landeshauptstadt hat ihren Teil bereits freigeschaltet.",
	"03351000":
		"Der Landkreis veröffentlicht seine Ergebnisse in einem eigenen System statt im votemanager; angebunden ist es hier nicht.",
	"03353000":
		"Für den 13. September 2026 ist keine Präsentation angelegt; der letzte Stand ist von Juni 2024.",
	"03358000":
		"Für den 13. September 2026 ist noch keine Präsentation angelegt; der letzte Stand ist die Bundestagswahl 2025.",
	"03360000":
		"Der Landkreis veröffentlicht seine Ergebnisse in einem eigenen System statt im votemanager; angebunden ist es hier nicht.",
};

const STILLGELEGT: Record<string, string> = {
	"03153007":
		"Stadt Langelsheim, alte Instanz – die Kommunalwahl 2026 liegt unter 03153019",
};

const WURZEL_KORREKTUR: Record<string, string> = {
	"https://wahlen-heidekreis.de/BEHKK2021/": "https://wahlen-heidekreis.de/",
	"http://wahlen.kreis-hi.de/wahlen/": "https://wahlen.kreis-hi.de/wahlen/",
	"https://votemanager.kdo.de/{ags}/": "https://votemanager.kdo.de/",
	"https://www.salzgitter.de/wahlen/ergebnisse/":
		"https://wahlen.salzgitter.de/ergebnisse/",
	"https://wahlergebnis.hannover-stadt.de/":
		"https://wahlergebnis.hannover.gov.de/",
};

const BASIS_KORREKTUR: Record<string, string> = {
	"03102000": "https://wahlen.salzgitter.de/ergebnisse/",
	"03103000": "https://wahlen.wolfsburg.de/",
};

const TERMIN_2026_ANGELEGT = new Set(["03103000"]);

const AMTLICHE_QUELLEN: Record<
	string,
	Array<{ url: string; titel: string }>
> = {
	"03102000": [
		{
			url: "https://www.salzgitter.de/rathaus/wahlen/kommunalwahl_obwahl2026.php",
			titel: "Kommunal- und OB-Wahl 2026 bei der Stadt Salzgitter",
		},
		{
			url: "https://wahlen.salzgitter.de/ergebnisse/Wahl-2021-09-12/03102000/praesentation/index.html",
			titel: "Kommunalwahl 2021: Rat, Ortsräte und OB-Wahl",
		},
	],
	"03241000": [
		{
			url: "https://wahlergebnisse.region-hannover.de/03241000/index.html",
			titel: "Wahlergebnisse der Region Hannover",
		},
		{
			url: "https://wahlergebnis.hannover.gov.de/03241001/index.html",
			titel: "Wahlergebnisse der Landeshauptstadt Hannover",
		},
	],
	"03351000": [
		{
			url: "https://landkreis-celle.de/",
			titel:
				"Ergebnisse 2026 am Wahlsonntag auf landkreis-celle.de (Ankündigung der Wahlleitung)",
		},
		{
			url: "https://wahl.landkreis-celle.de/ivu/kreis2021_celle/ergebnisse.html",
			titel: "Kreiswahl 2021 im Landkreis Celle",
		},
		{
			url: "https://wahl.landkreis-celle.de/ivu/kreis_wiederholung_2022/ergebnisse.html",
			titel: "Wiederholungswahl der Kreiswahl 2022",
		},
		{
			url: "https://www.landkreis-celle.de/Verwaltung-Politik/Verwaltung/Landratsb%C3%BCro/Wahlen/",
			titel: "Wahlen beim Landkreis Celle (Übersicht)",
		},
	],
	"03353000": [
		{
			url: "https://votemanager.kdo.de/03353000/index.html",
			titel: "Wahlergebnisse des Landkreises Harburg",
		},
	],
	"03358000": [
		{
			url: "https://wahlen-heidekreis.de/KW2021/20210912/03358000/praesentation/index.html",
			titel: "Kommunalwahl 2021 im Heidekreis",
		},
		{
			url: "https://wahlen-heidekreis.de/03358000/index.html",
			titel: "Wahlergebnisse des Heidekreises (Übersicht)",
		},
	],
	"03360000": [
		{
			url: "https://wahlen.landkreis-uelzen.de/kw2021/kt/ergebnisse.html",
			titel: "Kreistagswahl 2021 im Landkreis Uelzen",
		},
	],
};

const NACHGETRAGEN: Array<{ name: string; ags: string; wurzel: string }> = [
	{
		name: "Stadt Wolfsburg",
		ags: "03103000",
		wurzel: "https://wahlen.wolfsburg.de/",
	},
	{
		name: "Landkreis Harburg",
		ags: "03353000",
		wurzel: "https://votemanager.kdo.de/",
	},
];

const BEKANNTE_TERMINE: Record<string, string> = {
	"2026-09-13": "2026",
	"2021-09-12": "2021",
	"2020-09-13": "2020",
};

const KREISWEITE_TERMINE = new Set(["2026", "2021"]);

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

const behoerdenRoh = [
	...roh<RohBehoerde[]>("nds-behoerden.json"),
	...NACHGETRAGEN.map((b) => ({
		name: b.name,
		ags: b.ags,
		host: new URL(b.wurzel).host,
		url: `${b.wurzel}${b.ags}/index.html`,
	})),
];
const kreiseRoh = roh<RohKreis[]>("nds-kreise.json");
const archivRoh = roh<RohArchiv2021[]>("nds-termine-2021.json");

const archiveJeKreis = new Map<string, string[]>();
const angekuendigtOhneDaten: string[] = [];
for (const a of archivRoh) {
	const abrufbar = Boolean(a.kommunalwahl2021?.geprueft?.schema);
	if (a.kommunalwahl2021 && !abrufbar)
		angekuendigtOhneDaten.push(`${a.name} (${a.kreisAgs})`);
	if (abrufbar) archiveJeKreis.set(a.kreisAgs, ["2021"]);
}

type RohVorwertEintrag = {
	amt: string;
	datum: string;
	datumString: string;
	ordner: string;
	layout: "v22" | "v26";
	terminNamen: string[];
	wahlen: string[];
	stichwahl: boolean;
	mehrdeutig: boolean;
	stichwahlTag?: string;
};

type RohVorwert = {
	kreis: string;
	ags: string;
	name: string;
	index: string;
	termin2026: boolean;
	aemter2026: string[];
	vorwerte: RohVorwertEintrag[];
	ohneVorwert: string[];
	verschwunden: Array<{ datum: string; ordner: string; namen: string[] }>;
};

const vorwerteRoh = roh<RohVorwert[]>("nds-vorwerte.json");

/** Wie ein Amt im Titel eines Termins heißt – als Wortstamm vor „wahlen“. */
const AMT_STAMM: Record<string, string> = {
	landrat: "Landrats",
	kreistag: "Kreistags",
	buergermeister: "Bürgermeister",
	rat: "Rats",
	ortsrat: "Ortsrats",
};

/** Reihenfolge im Titel: von der Kreisebene nach unten. */
const AMT_REIHE = ["landrat", "kreistag", "buergermeister", "rat", "ortsrat"];

const MONATE = [
	"Januar",
	"Februar",
	"März",
	"April",
	"Mai",
	"Juni",
	"Juli",
	"August",
	"September",
	"Oktober",
	"November",
	"Dezember",
];

/** "2019-05-26" → "26. Mai 2019" */
const langesDatum = (iso: string): string => {
	const [j, m, t] = iso.split("-");
	return `${Number(t)}. ${MONATE[Number(m) - 1]} ${j}`;
};

/** ["Landrats", "Bürgermeister"] → "Landrats- und Bürgermeisterwahlen" */
const wahlenTitel = (staemme: string[]): string => {
	if (staemme.length === 1) return `${staemme[0]}wahlen`;
	const vorn = staemme.slice(0, -1).map((s) => `${s}-`);
	return `${vorn.join(", ")} und ${staemme[staemme.length - 1]}wahlen`;
};

/** Der häufigste Wert – für Ordner und Schema, wo die Behörden abweichen. */
const haeufigster = (werte: string[]): string => {
	const zaehler = new Map<string, number>();
	for (const w of werte) zaehler.set(w, (zaehler.get(w) ?? 0) + 1);
	return [...zaehler].sort(
		(a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
	)[0][0];
};

type VorwertTermin = {
	id: string;
	titel: string;
	datum: string;
	ordner: string;
	layout: "v22" | "v26";
	beschreibung: string;
};

/** Wahltag → alle Vorwert-Einträge dieses Tages, über alle Behörden. */
const jeDatum = new Map<string, Array<RohVorwertEintrag & { b: RohVorwert }>>();
for (const b of vorwerteRoh)
	for (const v of b.vorwerte) {
		const liste = jeDatum.get(v.datum) ?? [];
		liste.push({ ...v, b });
		jeDatum.set(v.datum, liste);
	}

const vorwertTermine: VorwertTermin[] = [];
/** Behörden-AGS → Termin-Ids, die nur bei dieser Behörde vorliegen. */
const archiveJeBehoerde = new Map<string, string[]>();
const mehrdeutige: string[] = [];

for (const [datum, eintraege] of [...jeDatum].sort()) {
	const id = BEKANNTE_TERMINE[datum] ?? datum;
	const strittig = eintraege.filter((e) => e.mehrdeutig);
	if (strittig.length) {
		for (const e of strittig)
			mehrdeutige.push(`${e.b.ags} ${e.b.name} ${datum} → ${e.ordner}`);
		continue;
	}
	if (KREISWEITE_TERMINE.has(id)) continue;
	const behoerden = new Set(eintraege.map((e) => e.b.ags));
	for (const ags of behoerden) {
		const liste = archiveJeBehoerde.get(ags) ?? [];
		if (!liste.includes(id)) liste.push(id);
		archiveJeBehoerde.set(ags, liste);
	}
	if (Object.values(BEKANNTE_TERMINE).includes(id)) continue;
	const aemter = AMT_REIHE.filter((a) => eintraege.some((e) => e.amt === a));
	const zahlen = aemter
		.map((a) => {
			const n = eintraege.filter((e) => e.amt === a).length;
			return `${AMT_STAMM[a]}wahl in ${n === 1 ? "einer Wahlleitung" : `${n} Wahlleitungen`}`;
		})
		.join(", ");
	vorwertTermine.push({
		id,
		titel: `${wahlenTitel(aemter.map((a) => AMT_STAMM[a]))} ${langesDatum(datum)}`,
		datum,
		ordner: haeufigster(eintraege.map((e) => e.ordner)),
		layout: haeufigster(eintraege.map((e) => e.layout)) as "v22" | "v26",
		beschreibung: `${zahlen} – die letzte Wahl dieser Ämter und damit ihr Vergleichswert.`,
	});
}

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
const stillgelegt: string[] = [];

for (const b of behoerdenRoh) {
	const zerlegt = ausUrl(b.url);
	if (!zerlegt) {
		uebersprungen.push(`${entitaeten(b.name)} (${b.url})`);
		continue;
	}
	const { ags, wurzel } = zerlegt;
	const kreisAgs = kreisVon(ags);
	if (kreisAgs === "03000000") continue;
	if (STILLGELEGT[ags]) {
		stillgelegt.push(`${entitaeten(b.name)} (${ags}): ${STILLGELEGT[ags]}`);
		continue;
	}
	const name = entitaeten(b.name);
	const liste = nachKreis.get(kreisAgs) ?? [];
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

const vergibSlugs = (kreisAgs: string, liste: Fertig[]): void => {
	const belegt = new Set<string>();
	for (const b of liste) {
		const fest = BESTAND_SLUGS[b.ags];
		if (fest) {
			b.slug = fest;
			belegt.add(fest);
		}
	}
	for (const b of liste.sort((x, y) => x.ags.localeCompare(y.ags))) {
		if (b.slug) continue;
		let kandidat = b.ags === kreisAgs ? "kreis" : slugAusName(b.name);
		if (!kandidat) kandidat = b.ags;
		const basis = kandidat;
		if (belegt.has(kandidat)) {
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
	liste.sort((x, y) => x.ags.localeCompare(y.ags));
};

type FertigerKreis = {
	slug: string;
	ags: string;
	name: string;
	kurz: string;
	basis: string;
	vorhanden: boolean;
	hinweis?: string;
	quellen?: Array<{ url: string; titel: string }>;
	archive?: string[];
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
	const rohBasis =
		k.basisPfad?.split("{termin}")[0] ??
		liste[0]?.wurzel ??
		"https://votemanager.kdo.de/";
	const basis =
		BASIS_KORREKTUR[k.kreisAgs] ?? WURZEL_KORREKTUR[rohBasis] ?? rohBasis;
	const vorhanden =
		(k.termin2026.angelegt || TERMIN_2026_ANGELEGT.has(k.kreisAgs)) &&
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
		quellen: AMTLICHE_QUELLEN[k.kreisAgs],
		archive: archiveJeKreis.get(k.kreisAgs),
		behoerden: liste,
	});
}

for (const k of kreise)
	if (!k.vorhanden && !k.hinweis)
		throw new Error(`Kein Hinweis für den Kreis ohne Präsentation: ${k.slug}`);

for (const k of kreise)
	if (!k.vorhanden && !k.quellen?.length)
		throw new Error(
			`Keine amtliche Quelle für den Kreis ohne Präsentation: ${k.slug} – bitte in AMTLICHE_QUELLEN nachtragen (mit belegtem Abruf)`,
		);

const kreisSlugs = new Set(kreise.map((k) => k.slug));
if (kreisSlugs.size !== kreise.length)
	throw new Error("Doppelte Kreis-Slugs im Katalog");
for (const k of kreise) {
	const s = new Set(k.behoerden.map((b) => b.slug));
	if (s.size !== k.behoerden.length)
		throw new Error(`Doppelte Behörden-Slugs in ${k.slug}`);
	const namen = new Set(k.behoerden.map((b) => b.name.toLowerCase()));
	if (namen.size !== k.behoerden.length)
		throw new Error(
			`Zwei Behörden gleichen Namens in ${k.slug} – gehört eine davon nach STILLGELEGT?`,
		);
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

const z = (s: string) => JSON.stringify(s);

const behoerdeCode = (b: Fertig, kreisBasis: string): string => {
	const felder = [
		`ags: ${z(b.ags)}`,
		`slug: ${z(b.slug)}`,
		`name: ${z(b.name)}`,
		`kurz: ${z(b.kurz)}`,
		`art: ${z(b.art)}`,
	];
	if (b.wurzel !== kreisBasis) felder.push(`wurzel: ${z(b.wurzel)}`);
	const archive = archiveJeBehoerde.get(b.ags);
	if (archive?.length)
		felder.push(`archive: [${[...archive].sort().map(z).join(", ")}]`);
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
	if (k.quellen?.length)
		kopf.push(
			`\t\tquellen: [\n${k.quellen
				.map((q) => `\t\t\t{ url: ${z(q.url)}, titel: ${z(q.titel)} },`)
				.join("\n")}\n\t\t],`,
		);
	if (k.archive?.length)
		kopf.push(`\t\tarchive: [${k.archive.map(z).join(", ")}],`);
	const behoerden = k.behoerden.length
		? `\t\tbehoerden: [\n${k.behoerden.map((b) => behoerdeCode(b, k.basis)).join("\n")}\n\t\t],`
		: "\t\tbehoerden: [],";
	return `\t{\n${kopf.join("\n")}\n${behoerden}\n\t},`;
};

const anzahlBehoerden = kreise.reduce((s, k) => s + k.behoerden.length, 0);
const anzahlVorhanden = kreise.filter((k) => k.vorhanden).length;
const anzahlArchiv2021 = kreise.filter((k) =>
	k.archive?.includes("2021"),
).length;

const code = `/**
 * Kreis- und Behördenkatalog Niedersachsens – ERZEUGT, nicht von Hand ändern.
 *
 * Quelle: scripts/quellen/ (Abzug vom 07.09.2026),
 * Erzeuger: scripts/kreise-erzeugen.ts, Beschreibung: scripts/quellen/erhebung.md.
 *
 * ${kreise.length} Kreise mit ${anzahlBehoerden} Behörden, davon ${anzahlVorhanden} Kreise mit einer
 * benutzbaren Präsentation für den 13.09.2026 und ${anzahlArchiv2021} mit der
 * Kommunalwahl 2021 im Archiv.
 *
 * \`vorhanden\` ist die Ausgangsannahme vom Tag des Abzugs, nicht die Wahrheit:
 * Wer später freischaltet, wird vom Poller bemerkt (siehe src/lib/poll.ts).
 *
 * Die Typen und alle Zugriffe stehen in kreise.ts bzw. behoerden.ts; hier
 * liegen nur die Daten.
 */
import type { Kreis } from "./kreise.ts";

export const KATALOG: Kreis[] = [
${kreise.map(kreisCode).join("\n")}
];
`;

const terminCode = (t: VorwertTermin): string =>
	[
		"\t{",
		`\t\tid: ${z(t.id)},`,
		`\t\ttitel: ${z(t.titel)},`,
		`\t\tdatum: ${z(t.datum)},`,
		`\t\tordner: ${z(t.ordner)},`,
		`\t\tlayout: ${z(t.layout)},`,
		"\t\tlive: false,",
		`\t\tbeschreibung:\n\t\t\t${z(t.beschreibung)},`,
		"\t},",
	].join("\n");

const anzahlZuordnungen = [...archiveJeBehoerde.values()].reduce(
	(s, l) => s + l.length,
	0,
);

const terminDatei = `/**
 * Vorwerte der Direktwahlen – ERZEUGT, nicht von Hand ändern.
 *
 * Quelle: scripts/quellen/nds-vorwerte.json,
 * Erzeuger: scripts/kreise-erzeugen.ts, Beschreibung: scripts/quellen/vorwerte.md.
 *
 * ${vorwertTermine.length} Termine mit ${anzahlZuordnungen} Zuordnungen zu ${archiveJeBehoerde.size} Behörden.
 *
 * **Wozu.** Die Seite stellt jedes Ergebnis neben die jeweils passende frühere
 * Wahl. Für Räte, Kreistage und Ortsräte ist das überall die Kommunalwahl vom
 * 12.09.2021 – die laufen im gemeinsamen Takt. Bürgermeister, Oberbürgermeister
 * und Landräte nicht: Ihre Amtszeiten sind eigene, und die letzte Wahl liegt je
 * nach Kommune 2013, 2019, 2022 oder 2025. Ohne diese Termine stünde neben der
 * Bürgermeisterwahl 2026 entweder gar nichts oder – schlimmer – die Ratswahl
 * 2021, also eine Zahl, die nichts mit ihr zu tun hat.
 *
 * **Warum je Behörde und nicht je Kreis.** Weil so ein Wahltag fast nie einen
 * ganzen Kreis betrifft: Am 26.05.2019 hat der Landkreis Emsland seinen Landrat
 * gewählt und acht seiner Gemeinden zusätzlich ihren Bürgermeister, die übrigen
 * keine einzige Wahl. Welche Behörde welchen Termin führt, steht deshalb in
 * \`Behoerde.archive\` im Kreiskatalog.
 *
 * Ordner und Schema sind hier die **Vorgabe** – der häufigste Wert unter den
 * Behörden dieses Tages. Wo eine abweicht (Duderstadt führt seine Termine als
 * \`Wahl-2019-09-01\`), löst der Poller den Fundort aus ihrem eigenen
 * Termin-Index auf, so wie bei jedem anderen Termin auch.
 */
import type { Termin } from "./termine.ts";

export const VORWERT_TERMINE: Termin[] = [
${vorwertTermine.map(terminCode).join("\n")}
];
`;

const TERMIN_ZIEL = join(HIER, "..", "src", "data", "vorwert-termine.ts");
writeFileSync(ZIEL, code);
writeFileSync(TERMIN_ZIEL, terminDatei);

const biome = join(HIER, "..", "node_modules", ".bin", "biome");
if (existsSync(biome)) {
	const r = spawnSync(biome, ["format", "--write", ZIEL, TERMIN_ZIEL], {
		encoding: "utf8",
	});
	if (r.status !== 0)
		console.log(`Formatieren fehlgeschlagen: ${r.stderr ?? r.error?.message}`);
} else {
	console.log(
		"biome nicht gefunden – bitte `npx @biomejs/biome format --write` von Hand laufen lassen",
	);
}

console.log(
	`${ZIEL}: ${kreise.length} Kreise, ${anzahlBehoerden} Behörden, ${anzahlVorhanden} mit Präsentation, ${anzahlArchiv2021} mit Archiv 2021`,
);
console.log(
	`${TERMIN_ZIEL}: ${vorwertTermine.length} Termine, ${anzahlZuordnungen} Zuordnungen zu ${archiveJeBehoerde.size} Behörden`,
);
if (mehrdeutige.length)
	console.log(
		`Verworfen, weil das Datum im Index auf zwei Ordner zeigt: ${mehrdeutige.join("; ")}`,
	);
if (dubletten.length)
	console.log(`Doppelte Schlüssel bereinigt: ${dubletten.join(", ")}`);
if (stillgelegt.length)
	console.log(`Stillgelegt, nicht aufgenommen: ${stillgelegt.join("; ")}`);
if (uebersprungen.length)
	console.log(
		`Übersprungen (keine auswertbare Adresse): ${uebersprungen.join(", ")}`,
	);
if (angekuendigtOhneDaten.length)
	console.log(
		`Kommunalwahl 2021 im Index angekündigt, aber nicht abrufbar: ${angekuendigtOhneDaten.join(", ")}`,
	);
