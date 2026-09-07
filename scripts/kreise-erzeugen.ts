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
 *   nds-behoerden.json     416 Behörden aus wahlen.votemanager.de/behoerden.json
 *   nds-kreise.json        45 Kreise, je Kreis Wurzel, Schema und 2026er Stand
 *   nds-termine-2021.json  je Kreis der Eintrag zum 12.09.2021 aus dem
 *                          Termin-Index der Kreisbehörde, mit der Gegenprobe,
 *                          ob die Präsentation auch abrufbar ist – daraus
 *                          entsteht `archive`, also wo es die Kommunalwahl
 *                          2021 wirklich gibt
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

/**
 * Stillgelegte Präsentationen: Behörden, die in `behoerden.json` noch stehen,
 * deren Instanz aber keine Kommunalwahl 2026 mehr führt – während dieselbe
 * Behörde unter einem zweiten Schlüssel weiterläuft.
 *
 * Bisher genau ein Fall. Der Landkreis Goslar führt „Stadt Langelsheim“
 * zweimal: `03153007` ist die alte Instanz (ihr Termin-Index endet mit der
 * Bundestagswahl 2025, für den 13.09.2026 liefert sie 404), `03153019` trägt
 * den vollständigen Bestand. Beide im Katalog zu lassen kostet doppelt: Die
 * Adresse `/goslar/2026/langelsheim/` wäre eine Sackgasse, und die Seite, die
 * jemand sucht, versteckte sich hinter dem krummen `langelsheim-2`. Deshalb
 * fällt der stillgelegte Schlüssel heraus – der arbeitende bekommt den
 * schlichten Slug, und der Kreis führt jede Stadt genau einmal auf.
 *
 * Die Regel für weitere Fälle: Ein Schlüssel gehört hierher, wenn eine zweite
 * Behörde desselben Namens im selben Kreis den aktuellen Termin führt und er
 * selbst nicht. Nicht hierher gehören Behörden, die den Termin schlicht noch
 * nicht angelegt haben – die bleiben sichtbar und werden als „liegt nicht
 * vor“ ausgewiesen.
 */
const STILLGELEGT: Record<string, string> = {
	"03153007":
		"Stadt Langelsheim, alte Instanz – die Kommunalwahl 2026 liegt unter 03153019",
};

/**
 * Wurzeln, die in den Quellen falsch oder ungünstig stehen.
 *
 * Der Heidekreis: Für alle 13 Behörden nennt die Liste `/BEHKK2021/<ags>/`,
 * was 404 liefert; richtig ist die Host-Wurzel.
 *
 * Hildesheim: Die Erhebung notiert http. Derselbe Server beantwortet
 * Verzeichnisse darüber mit 403, über https mit 200 – und das Zertifikat ist
 * gültig. Es gibt keinen Grund für die unverschlüsselte Verbindung.
 *
 * Harburg: `basisPfad` der Erhebung enthält den Platzhalter `{ags}` an einer
 * Stelle, an der die Wurzel schon zu Ende ist. Ungefährlich, solange der Kreis
 * nicht abgefragt wird – aber er soll ja abgefragt werden, sobald er liefert.
 *
 * Salzgitter: `behoerden.json` nennt `www.salzgitter.de/wahlen/ergebnisse/`.
 * Diese Adresse antwortet mit 302 auf einen Pfad, der ins Leere läuft – daher
 * die Notiz „antwortet nicht“. Die Präsentation liegt auf dem Wahl-Host der
 * Stadt; nur der Rechnername ist ein anderer.
 */
const WURZEL_KORREKTUR: Record<string, string> = {
	"https://wahlen-heidekreis.de/BEHKK2021/": "https://wahlen-heidekreis.de/",
	"http://wahlen.kreis-hi.de/wahlen/": "https://wahlen.kreis-hi.de/wahlen/",
	"https://votemanager.kdo.de/{ags}/": "https://votemanager.kdo.de/",
	"https://www.salzgitter.de/wahlen/ergebnisse/":
		"https://wahlen.salzgitter.de/ergebnisse/",
};

/**
 * Kreis-Wurzeln, die die Erhebung ganz verfehlt hat – je Kreis, nicht je
 * Adresse.
 *
 * `WURZEL_KORREKTUR` greift über die *Zeichenkette* aus den Quellen und taugt
 * deshalb nur, wo die falsche Adresse für sich steht. Salzgitter und Wolfsburg
 * tragen beide die Sammeladresse `votemanager.kdo.de`, die dutzende andere
 * Kreise zu Recht benutzen – hier muss der Kreis den Ausschlag geben.
 *
 * Warum überhaupt: Die Erhebung hat für beide Städte nur den KDO-Spiegel und
 * `behoerden.json` befragt. Der Spiegel endet 2022, in `behoerden.json` steht
 * für Wolfsburg gar nichts und für Salzgitter eine Adresse, die 302 auf einen
 * toten Pfad umleitet – daraus wurde „betreibt keine erreichbare
 * Wahlpräsentation“. Beide Städte betreiben aber sehr wohl eine, nur auf dem
 * eigenen Host, den niemand abgefragt hat (geprüft am 07.09.2026):
 *
 *   wahlen.wolfsburg.de/03103000/api/termine.json                  200, 1 647 B
 *   wahlen.salzgitter.de/ergebnisse/03102000/api/termine.json      200, 2 125 B
 *
 * Das ist die Lehre aus dem Fall: Ein Fehlschlag gegen *eine* Adresse belegt
 * nicht, dass es die Daten nicht gibt.
 */
const BASIS_KORREKTUR: Record<string, string> = {
	"03102000": "https://wahlen.salzgitter.de/ergebnisse/",
	"03103000": "https://wahlen.wolfsburg.de/",
};

/**
 * Kreise, deren Termin zum 13.09.2026 die Erhebung als „nicht angelegt“ notiert
 * hat, weil sie am falschen Host nachgesehen hat.
 *
 * Wolfsburg führt den Termin in seinem Index und liefert die Präsentation
 * bereits aus (geprüft am 07.09.2026):
 *
 *   wahlen.wolfsburg.de/20260913/03103000/daten/api/termin.json    200, 3 740 B
 *
 * Damit ist der Kreis ganz normal abfragbar – er gehört nicht in die Liste der
 * Kreise, für die wir nichts haben.
 */
const TERMIN_2026_ANGELEGT = new Set(["03103000"]);

/**
 * Wo eine Wahlleitung ihre Ergebnisse selbst veröffentlicht.
 *
 * Für jeden Kreis, dessen Zahlen hier nicht ankommen. Der Anlass ist ein
 * Fehler, den diese Anwendung gemacht hat: Sie hat schlicht behauptet, für
 * Celle und Uelzen gebe es keine Ergebnisse – dabei hatte nur niemand
 * nachgesehen. Beide veröffentlichen seit Jahren, nur nicht im votemanager.
 *
 * Jeder Eintrag ist mit einem Abruf belegt (Status und Größe in
 * scripts/quellen/erhebung.md). Lieber kein Link als ein falscher: Wo nichts
 * geprüft ist, steht hier nichts.
 */
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
			url: "https://wahlergebnis.hannover-stadt.de/03241001/index.html",
			titel: "Wahlergebnisse der Landeshauptstadt Hannover",
		},
	],
	"03351000": [
		// Für den 13.09.2026 nennt die Wahlseite des Landkreises keine Adresse,
		// sondern kündigt an: "Aktuelle Ergebnisse am Wahl-Sonntag auf
		// https://landkreis-celle.de". Dieser Verweis steht deshalb zuerst –
		// am Wahlabend ist er der einzige, der weiterhilft.
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

/**
 * Behörden, die in `behoerden.json` fehlen, deren Präsentation es aber gibt.
 *
 * Zwei Kreisbehörden stehen nicht in der bundesweiten Liste, antworten auf
 * ihrem Termin-Index aber mit 200 (geprüft am 07.09.2026): Stadt Wolfsburg und
 * Landkreis Harburg. Ohne sie hätte Wolfsburg überhaupt keine Adresse und
 * Harburg keine Kreisbehörde – und beide Kreise könnten nie von selbst
 * auftauchen, weil es nichts gäbe, wo man nachsehen könnte. Genau darum stehen
 * sie hier.
 *
 * Wolfsburg liegt dabei **nicht** auf dem KDO-Spiegel, wie zunächst notiert,
 * sondern auf dem eigenen Host `wahlen.wolfsburg.de` – dort steht der
 * 13.09.2026 im Index und die Präsentation ist bereits abrufbar, während der
 * Spiegel 2022 endet.
 */
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

/**
 * Archivtermine, die nicht aus einem Kreis-Index folgen.
 *
 * Die Bürgermeisterwahl Nordstemmen 2020 ist eine Wahl einer einzigen
 * Gemeinde; im Termin-Index des Landkreises Hildesheim steht sie nicht. Sie
 * ist eingelesen und soll dort angeboten werden.
 */
const ARCHIV_EXTRA: Record<string, string[]> = { "03254000": ["2020"] };

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

/**
 * Kreis-AGS → Archivtermine, die dort vorliegen.
 *
 * Der Eintrag im Termin-Index reicht nicht: Der Heidekreis kündigt den
 * 12.09.2021 an, hat die Dateien aber nicht mehr (beide Schemata 404). Ein
 * Termin, der angeboten wird und nichts zeigt, ist schlimmer als keiner –
 * deshalb zählt nur, was die Gegenprobe bestätigt hat.
 */
const archiveJeKreis = new Map<string, string[]>();
const angekuendigtOhneDaten: string[] = [];
for (const a of archivRoh) {
	const abrufbar = Boolean(a.kommunalwahl2021?.geprueft?.schema);
	if (a.kommunalwahl2021 && !abrufbar)
		angekuendigtOhneDaten.push(`${a.name} (${a.kreisAgs})`);
	const ids = [
		...(abrufbar ? ["2021"] : []),
		...(ARCHIV_EXTRA[a.kreisAgs] ?? []),
	];
	if (ids.length) archiveJeKreis.set(a.kreisAgs, ids);
}

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
const stillgelegt: string[] = [];

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
	if (STILLGELEGT[ags]) {
		stillgelegt.push(`${entitaeten(b.name)} (${ags}): ${STILLGELEGT[ags]}`);
		continue;
	}
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
	// Die Wurzel steht im Katalog ohne den Termin-Teil: `basisPfad` ist eine
	// Vorlage („…/{termin}/{ags}/“), der Poller setzt Termin und Behörde
	// selbst ein. Fehlt sie (Celle, Uelzen: kein votemanager), nehmen wir die
	// häufigste – abgefragt wird der Kreis ohnehin nicht.
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
		// Die Fundstelle bleibt auch dann stehen, wenn der Kreis liefert: Sie
		// ist die Quellenangabe zu unseren Zahlen, nicht nur ein Ersatz für
		// fehlende. Angezeigt wird sie dort, wo sie gebraucht wird.
		quellen: AMTLICHE_QUELLEN[k.kreisAgs],
		archive: archiveJeKreis.get(k.kreisAgs),
		behoerden: liste,
	});
}

// --- Prüfungen, bevor irgendetwas geschrieben wird ---

for (const k of kreise)
	if (!k.vorhanden && !k.hinweis)
		throw new Error(`Kein Hinweis für den Kreis ohne Präsentation: ${k.slug}`);

// Die Mindestzusage: Wo wir nichts anzubieten haben, sagen wir wenigstens, wo
// es die Zahlen gibt. Ein Kreis ohne Fundstelle wäre ein Rückfall in genau den
// Fehler, der diese Tabelle veranlasst hat – deshalb bricht der Erzeuger ab,
// statt eine Seite auszuliefern, die nur „liegt nicht vor“ sagt.
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

writeFileSync(ZIEL, code);
console.log(
	`${ZIEL}: ${kreise.length} Kreise, ${anzahlBehoerden} Behörden, ${anzahlVorhanden} mit Präsentation, ${anzahlArchiv2021} mit Archiv 2021`,
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
