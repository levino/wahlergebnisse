import type { Ereignis } from "./abfragen.ts";
import type { WahlFolie } from "./dashboard.ts";
import type { FolienStand } from "./meldungen.ts";

export const MODERATION_FASSUNG = 5;

export type ParteiKontext = {
	kurz: string;
	prozent: number;
	/** Veränderung zur Vorwahl in Prozentpunkten. */
	diff?: number;
	sitze?: number;
	sitzeVorher?: number;
};

export type BewerberKontext = {
	name: string;
	partei: string;
	stimmen?: number;
	mandat?: string;
};

export type ListeKontext = { partei: string; namen: string[] };

/** Was das gerade eingegangene Gebiet beigesteuert hat. */
export type GebietsBeitrag = {
	/** Wahlleitung und Gebiet – der Schlüssel des Ereignisses. */
	behoerde: string;
	gebietId: string;
	name: string;
	anz?: number;
	max?: number;
	spitze: Array<{ kurz: string; prozent: number }>;
	wahlbeteiligung?: number;
};

/** So viele führen die Ansage an – Untergrenze, nicht Obergrenze. */
export const SPITZEN_JE_WAHL = 3;

/** Was ein Eingang in einer einzelnen Wahl bewirkt hat. */
export type Wirkung = {
	wahl: string;
	ort: string;
	/** Worum es in dieser Wahl geht – trennt zwei Zuschnitte derselben Wahl. */
	worum?: string;
	anz: number;
	max: number;
	fertig: boolean;
	/** Wer in dieser Wahl vorn liegt – so viele, wie es gibt, höchstens drei. */
	reihenfolge: ParteiKontext[];
	meldungen: string[];
	beitrag?: GebietsBeitrag;
};

/** Ein Gebiet, das eingegangen ist – und alles, was daraus folgt. */
export type EingangsBericht = {
	gebiet: string;
	wirkungen: Wirkung[];
};

/** Eine Wahl, in der sich nichts getan hat. */
export type StilleWahl = {
	wahl: string;
	ort: string;
	worum?: string;
	anz: number;
	max: number;
};

export type WahlKontext = {
	wahl: string;
	ort: string;
	zuschnitt: "eigen" | "wahlbereich" | "kreis";
	/** Worum es auf dieser Folie geht – nur gesetzt, wo der Name nicht reicht. */
	worum?: string;
	beisatz?: string;
	anz: number;
	max: number;
	datenstand: string;
	unsicherheit?: string;
	parteien: ParteiKontext[];
	wahlbeteiligung?: number;
	wahlbeteiligungVorher?: number;
	vergleichTitel?: string;
	bewerber?: BewerberKontext[];
	listen?: ListeKontext[];
	zeitstempel?: string;
	vorher: FolienStand;
	beitraege: GebietsBeitrag[];
	meldungen: string[];
};

export type Schub = {
	behoerde: string;
	termin: string;
	partei?: string;
	/** Was hereingekommen ist – die Gliederung der Nachricht. */
	eingaenge: EingangsBericht[];
	/** Wahlen auf derselben Leinwand, in denen sich nichts getan hat. */
	unveraendert: StilleWahl[];
	/** Der Zustand der berührten Wahlen – Hintergrund, nicht Gliederung. */
	wahlen: WahlKontext[];
	/** Die feste Formulierung – Vorlage und Rückfall zugleich. */
	fest: string;
};

export const MODERATION_ANWEISUNG = [
	"Du hast am Wahlabend im Saal das Mikrofon. Hinter dir läuft eine Leinwand",
	"mit den Zwischenständen, und gerade sind neue Zahlen eingegangen.",
	"",
	"HÖCHSTENS 90 WÖRTER. Vier bis sechs Sätze am Stück, ohne Absatz.",
	"",
	"Die Leinwand zeigt die Zahlen, und alle sehen sie. Du liest sie nicht vor.",
	"Du sagst, was sie bedeuten: wie es steht, wer sich abgesetzt hat, wie viel",
	"noch aussteht.",
	"",
	"IM SAAL SITZEN LEUTE AUS ALLEN LAGERN. Wo du ein Ergebnis besprichst,",
	"nennst du mindestens die ersten drei beim Namen: wer vorn liegt, wer",
	"dahinter, wer auf Platz drei. Eine Ansage, die nur den Sieger kennt, ist",
	"für die meisten im Saal uninteressant. Drei ist die Untergrenze, nicht die",
	"Obergrenze – wo es sich anbietet, kommt der Vierte dazu oder wer stark",
	"zugelegt oder verloren hat. Die Reihenfolge steht im Kontext unter",
	"„Reihenfolge“, vollständig im Zustandsteil.",
	"",
	"Stehen mehrere Wahlen im Kontext, ist das **ein** Ereignis: Ein Wahllokal",
	"hat ausgezählt, und derselbe Stimmzettelstapel zählt in den Ortsrat, den",
	"Gemeinderat, den Kreiswahlbereich und den Kreistag zugleich. Erzähl es als",
	"ein Ereignis mit seinen Folgen, nie als Aufzählung Wahl für Wahl.",
	"",
	"SO:",
	"„Aus Rössing sind neue Zahlen da, und der Ortsrat ist komplett: Die CDU",
	"liegt dort vorn, die SPD folgt, dahinter die Grünen. Im Gemeinderat zieht",
	"die CDU an der SPD vorbei, die Grünen halten Platz drei – aber erst 16 von",
	"23 Wahlbezirken sind ausgezählt. Am Kreistag ändert das nichts.“",
	"",
	"SO NICHT:",
	"„Die CDU kommt auf 45,3 Prozent und damit vier Sitze, die SPD auf 40,2",
	"Prozent und drei Sitze, die Grünen auf 7,1 Prozent und einen Sitz. Die",
	"Wahlbeteiligung liegt bei 63,8 Prozent. In Nordstemmen sind 16 von 23",
	"Wahlbezirken ausgezählt …“",
	"Das ist eine Liste. Drei Namen gehören hinein, drei Zahlenreihen nicht.",
	"",
	"Regeln:",
	"- Namen kosten nichts, Zahlen sind knapp: höchstens drei Zahlen in der",
	"  ganzen Ansage, der Auszählstand („16 von 23“) zählt als eine. Für die",
	"  Plätze dahinter reicht das Wort – „knapp dahinter“, „auf Platz drei“,",
	"  „abgeschlagen“. Prozente und Sitze der Reihe nach aufzuzählen ist",
	"  verboten.",
	"- Stehen nur zwei Bewerber im Kontext, nennst du zwei. Einen dritten",
	"  erfindest du nie, und keinen, der dort nicht steht.",
	"- Wo ausgezählt ist, sagst du, dass es feststeht. Wo erst ein Teil da ist,",
	"  sagst du das ebenso deutlich – „nach 16 von 23 Wahlbezirken“, nie „das",
	"  Ergebnis steht fest“.",
	"- DER BESTIMMTE ARTIKEL BEHAUPTET VOLLSTÄNDIGKEIT. „Die Ergebnisse der",
	"  Kreistagswahl liegen vor“ heißt im Deutschen: alle, fertig, nichts",
	"  fehlt. Solange auch nur ein Wahlbezirk aussteht, ist dieser Satz falsch,",
	"  selbst bei 99 Prozent. Sag stattdessen „weitere Ergebnisse“, „ein",
	"  weiterer Teil“, „neue Zahlen aus …“, „noch mehr Wahlbezirke“ – unbestimmt",
	"  oder mit Mengenwort. Dasselbe gilt für „das Ergebnis“, „der Kreistag",
	"  steht fest“, „ausgezählt ist“ ohne Einschränkung.",
	"- Erst bei 100 Prozent darfst du bestimmt werden, und dann sagst du es",
	"  ausdrücklich: „das vollständige Ergebnis“, „alle Wahlbezirke sind",
	"  ausgezählt“. Ob du dort bist, steht im Kontext beim Auszählstand – rate",
	"  es nicht. Im Zweifel unbestimmt.",
	"- Über Wahlen, an denen sich nichts geändert hat, sagst du nichts –",
	"  höchstens einen Nebensatz („am Kreistag ändert das nichts“).",
	"- Wie weit ausgezählt ist, gehört hinein. „Erst 30 Prozent“ hält die",
	"  Spannung, wo eine nackte Zahl sie nimmt.",
	"- Nur was im Kontext steht: keine erfundene Zahl, kein erfundener Name,",
	"  kein erfundener Trend. Vergleiche mit einer früheren Wahl nur, wo der",
	"  Kontext sie zu genau dieser Wahl nennt.",
	"- Jede Zahl gehört zu genau einer Wahl. Nenne sie nur zu der, unter der",
	"  sie im Kontext steht – der Auszählstand des Kreiswahlbereichs ist nicht",
	"  der des Kreistags.",
	"- Spannung ja, Bewertung nein. Dass es knapp ist, darfst du sagen; wer",
	"  gewinnen wird, nicht. Keine Prognose, kein Lob.",
	"- Die Partei des Zuschauers darfst du beim Namen nennen, aber nicht loben.",
	"- Fang nicht jedes Mal gleich an.",
	"- Gesprochene Sprache, kurze Hauptsätze, Prozentzeichen als Wort",
	"  „Prozent“. Keine Aufzählung, keine Überschrift, keine Klammern, keine",
	"  Emojis, keine Regieanweisungen.",
	"",
	"Antworte nur mit dem, was du sprichst. HÖCHSTENS 90 WÖRTER.",
].join("\n");

const ZUSCHNITT_TEXT: Record<WahlKontext["zuschnitt"], string> = {
	eigen: "eigenes Gebiet der Wahlleitung",
	wahlbereich: "Kreiswahlbereich",
	kreis: "ganzer Landkreis",
};

const pz = (n: number): string => `${n.toFixed(1).replace(".", ",")} Prozent`;

const anteil = (anz: number, max: number): string =>
	max > 0 ? `${Math.round((anz / max) * 100)} Prozent` : "unbekannt";

const parteiZeile = (p: ParteiKontext): string => {
	const teile = [`${p.kurz} ${pz(p.prozent)}`];
	if (p.diff !== undefined)
		teile.push(
			`${p.diff > 0 ? "+" : p.diff < 0 ? "-" : "±"}${Math.abs(p.diff).toFixed(1).replace(".", ",")} zur Vorwahl`,
		);
	if (p.sitze !== undefined)
		teile.push(
			p.sitzeVorher !== undefined
				? `${p.sitze} Sitze (vorher ${p.sitzeVorher})`
				: `${p.sitze} Sitze`,
		);
	return teile.join(", ");
};

const vorherZeile = (v: FolienStand): string => {
	const parteien = (v.parteien ?? [])
		.map((p) => `${p.key} ${pz(p.prozent)} auf Platz ${p.platz}`)
		.join("; ");
	return [
		`${v.anz} von ${v.max} Wahlbezirken`,
		v.spitze ? `vorn: ${v.spitze}` : "",
		parteien,
	]
		.filter(Boolean)
		.join(" | ");
};

/** Was das Gebiet selbst zeigt – ohne seinen Namen, der darüber steht. */
const beitragDetail = (b: GebietsBeitrag): string =>
	[
		b.spitze.map((s) => `${s.kurz} ${pz(s.prozent)}`).join(", "),
		b.wahlbeteiligung !== undefined
			? `Wahlbeteiligung ${pz(b.wahlbeteiligung)}`
			: "",
	]
		.filter(Boolean)
		.join(" – ");

const wahlBlock = (w: WahlKontext): string => {
	const zeilen: string[] = [
		`WAHL: ${w.wahl} ${w.ort}`,
		`Zuschnitt: ${ZUSCHNITT_TEXT[w.zuschnitt]}${w.beisatz ? `, Gemeinden: ${w.beisatz}` : ""}`,
		...(w.worum ? [`Darum geht es hier: ${w.worum}`] : []),
		`Auszählstand jetzt: ${w.anz} von ${w.max} Wahlbezirken, ${anteil(w.anz, w.max)}`,
		`Vorher auf der Leinwand: ${vorherZeile(w.vorher)}`,
		`Datenstand: ${w.datenstand}${w.unsicherheit ? ` (${w.unsicherheit})` : ""}`,
	];
	if (w.parteien.length > 0)
		zeilen.push(`Jetzt: ${w.parteien.map(parteiZeile).join("; ")}`);
	if (w.wahlbeteiligung !== undefined)
		zeilen.push(
			`Wahlbeteiligung: ${pz(w.wahlbeteiligung)}${
				w.wahlbeteiligungVorher !== undefined
					? ` (Vorwahl ${pz(w.wahlbeteiligungVorher)})`
					: ""
			}`,
		);
	if (w.vergleichTitel) zeilen.push(`Vorwahl: ${w.vergleichTitel}`);
	if (w.bewerber?.length)
		zeilen.push(
			`Bewerber: ${w.bewerber
				.map((k) =>
					[
						k.name,
						k.partei,
						k.stimmen !== undefined ? `${k.stimmen} Stimmen` : "",
						k.mandat ?? "",
					]
						.filter(Boolean)
						.join(" "),
				)
				.join("; ")}`,
		);
	if (w.listen?.length)
		zeilen.push(
			`Listen: ${w.listen.map((l) => `${l.partei} – ${l.namen.join(", ")}`).join("; ")}`,
		);
	return zeilen.join("\n");
};

const standSatz = (w: {
	anz: number;
	max: number;
	fertig?: boolean;
}): string =>
	w.fertig
		? `jetzt ${w.anz} von ${w.max} – vollständig ausgezählt`
		: `jetzt ${w.anz} von ${w.max} (${anteil(w.anz, w.max)})`;

/** So viele, wie es gibt: Treten nur zwei an, bleiben es zwei. */
const spitzenAus = (w: {
	parteien: readonly ParteiKontext[];
}): ParteiKontext[] => w.parteien.slice(0, SPITZEN_JE_WAHL);

const wirkungZeile = (w: Wirkung): string => {
	const zeilen = [`  ${w.wahl} ${w.ort}: ${standSatz(w)}`];
	if (w.worum) zeilen.push(`    darum geht es hier: ${w.worum}`);
	if (w.reihenfolge.length > 0)
		zeilen.push(
			`    Reihenfolge: ${w.reihenfolge.map(parteiZeile).join("; ")}`,
		);
	const dort = w.beitrag ? beitragDetail(w.beitrag) : "";
	if (dort) zeilen.push(`    dort: ${dort}`);
	for (const m of w.meldungen) zeilen.push(`    erzählenswert: ${m}`);
	return zeilen.join("\n");
};

const eingangBlock = (e: EingangsBericht): string =>
	[`Eingegangen: ${e.gebiet}`, ...e.wirkungen.map(wirkungZeile)].join("\n");

const stilleZeile = (w: StilleWahl): string =>
	`${w.wahl} ${w.ort}${w.worum ? `, ${w.worum},` : ""} steht bei ${w.anz} von ${w.max}`;

export const EINBLENDER_MARKE =
	"Das steht gerade als Einblender auf der Leinwand, du liest es nicht vor: ";

export const kontextText = (schub: Schub): string => {
	const ohneGebiet = schub.wahlen.filter((w) => w.beitraege.length === 0);
	const zeilen = [
		schub.partei
			? `Der Zuschauer hat „${schub.partei}“ als seine Partei eingestellt.`
			: "Der Zuschauer hat keine eigene Partei eingestellt.",
		`${EINBLENDER_MARKE}${schub.fest}`,
		"",
		"DAS EREIGNIS. Hereingekommen ist ein Gebiet, und daraus folgt in mehreren",
		"Wahlen etwas Verschiedenes. So gliederst du auch deine Ansage: erst was da",
		"ist, dann was es wo bewirkt hat.",
	];
	for (const e of schub.eingaenge) zeilen.push(eingangBlock(e));
	if (ohneGebiet.length > 0) {
		zeilen.push("Verändert, ohne dass ein einzelnes Gebiet dahintersteht:");
		for (const w of ohneGebiet)
			zeilen.push(
				wirkungZeile({
					wahl: w.wahl,
					ort: w.ort,
					anz: w.anz,
					max: w.max,
					fertig: w.max > 0 && w.anz >= w.max,
					reihenfolge: spitzenAus(w),
					meldungen: w.meldungen,
				}),
			);
	}
	if (schub.unveraendert.length > 0)
		zeilen.push(
			`Dort hat sich nichts geändert: ${schub.unveraendert.map(stilleZeile).join("; ")}`,
		);
	zeilen.push(
		"",
		"ZUSTAND DER WAHLEN. Zahlen und Namen zum Nachschlagen – nicht die",
		"Gliederung deiner Ansage.",
		...schub.wahlen.map(wahlBlock),
	);
	return zeilen.join("\n");
};

const ZAHL = /\d+(?:[.,]\d+)?/g;

const normiere = (roh: string): string => String(Number(roh.replace(",", ".")));

export const zahlenIm = (text: string): string[] =>
	(text.match(ZAHL) ?? []).map(normiere);

export const erlaubteZahlen = (kontext: string): Set<string> => {
	const raus = new Set<string>();
	for (const roh of kontext.match(ZAHL) ?? []) {
		const n = Number(roh.replace(",", "."));
		if (!Number.isFinite(n)) continue;
		raus.add(String(n));
		raus.add(String(Math.trunc(n)));
		raus.add(String(Math.round(n)));
	}
	return raus;
};

export const erfundeneZahlen = (antwort: string, kontext: string): string[] => {
	const erlaubt = erlaubteZahlen(kontext);
	return zahlenIm(antwort).filter((z) => !erlaubt.has(z));
};

/** Ein abgeschnittener Satz wird nicht gesprochen, der Rest davor schon. */
export const bisZumLetztenSatz = (text: string): string => {
	if (/[.!?…][»“”"'‘’]?$/.test(text)) return text;
	const schnitt = Math.max(
		text.lastIndexOf("."),
		text.lastIndexOf("!"),
		text.lastIndexOf("?"),
		text.lastIndexOf("…"),
	);
	return schnitt > 0 ? text.slice(0, schnitt + 1) : "";
};

export const pruefeAntwort = (
	roh: string,
	kontext: string,
): { satz: string } | { fehler: string } => {
	const satz = bisZumLetztenSatz(
		roh
			.trim()
			.replace(/^[„“"'»]+|[“”"'«]+$/g, "")
			.replace(/\s+/g, " ")
			.trim(),
	);
	if (!satz) return { fehler: "kein vollständiger Satz" };
	const erfunden = erfundeneZahlen(satz, kontext);
	if (erfunden.length > 0)
		return { fehler: `Zahlen ohne Deckung: ${erfunden.join(", ")}` };
	return { satz };
};

/** Der Gebietsname aus dem Ereignistext: alles vor dem ersten Doppelpunkt. */
export const gebietsName = (text: string): string => {
	const i = text.indexOf(": ");
	return (i === -1 ? text : text.slice(0, i)).trim();
};

/**
 * Die Eingänge eines Schubs, nach Gebiet gebündelt.
 *
 * Ein Wahllokal zählt für Ortsrat, Gemeinderat und Bürgermeister zugleich und
 * erzeugt darum je Wahl ein Ereignis. Gebündelt wird über `behoerde:gebietId`
 * und nicht über den Namen: Dieselbe Urne heißt in der Ortsratswahl
 * „Adensen - 01 - …" und in der Gemeinderatswahl „01 - …". Über Wahlleitungen
 * hinweg wird nicht gebündelt – der Kreis führt zum Kreistag Gemeindezeilen
 * und keine Wahllokale.
 */
export const eingaengeAus = (
	wahlen: readonly WahlKontext[],
): EingangsBericht[] => {
	const nach = new Map<string, { namen: string[]; wirkungen: Wirkung[] }>();
	for (const w of wahlen)
		for (const b of w.beitraege) {
			const schluessel = `${b.behoerde}:${b.gebietId}`;
			const da = nach.get(schluessel) ?? { namen: [], wirkungen: [] };
			if (b.name) da.namen.push(b.name);
			da.wirkungen.push({
				wahl: w.wahl,
				ort: w.ort,
				worum: w.worum,
				anz: w.anz,
				max: w.max,
				fertig: w.max > 0 && w.anz >= w.max,
				reihenfolge: spitzenAus(w),
				meldungen: w.meldungen,
				beitrag: b,
			});
			nach.set(schluessel, da);
		}
	return [...nach.values()]
		.filter((g) => g.namen.length > 0)
		.map((g) => ({
			// Der kürzeste Titel ist der ohne Ortschafts-Vorsatz.
			gebiet: [...g.namen].sort((a, b) => a.length - b.length)[0],
			wirkungen: g.wirkungen,
		}));
};

export const beitraegeAus = (
	ereignisse: readonly Ereignis[],
	folie: WahlFolie,
	vorher: FolienStand,
): GebietsBeitrag[] => {
	if (folie.quelle.gebietId) return [];
	const wieviele = Math.max(0, folie.anz - vorher.anz);
	if (wieviele === 0) return [];
	const eigen = folie.quelle.eigeneGebiete
		? new Set(folie.quelle.eigeneGebiete)
		: undefined;
	return ereignisse
		.filter(
			(e) =>
				e.behoerde === folie.quelle.behoerde &&
				e.wahlId === folie.quelle.wahlId &&
				e.gebietId !== folie.quelle.gesamtGebietId &&
				(!eigen || eigen.has(e.gebietId)),
		)
		.slice(0, wieviele)
		.map((e) => ({
			behoerde: e.behoerde,
			gebietId: e.gebietId,
			name: gebietsName(e.text),
			anz: e.daten.anz,
			max: e.daten.max,
			spitze: (e.daten.spitze ?? []).map((s) => ({
				kurz: s.kurz,
				prozent: s.prozent,
			})),
			wahlbeteiligung: e.daten.wahlbeteiligung,
		}));
};

/** Eine Folie so ausführlich, wie das Modell sie braucht. */
/**
 * Worum es auf dieser Folie geht.
 *
 * Auf einem Gemeinde-Dashboard stehen zwei Kreistagsfolien nebeneinander und
 * heißen beide „Kreistagswahl". Sie zeigen aber Verschiedenes: der Kreis die
 * Sitzverteilung, der Wahlbereich die Reihenfolge der Bewerber. Ohne diesen
 * Unterschied verklebt die Ansage beide zu einem Satz.
 */
export const worumEsGeht = (folie: WahlFolie): string | undefined => {
	if (folie.zuschnitt === "wahlbereich")
		return `wer aus ${folie.ort} in den Kreistag einzieht, also die Reihenfolge der Bewerber – nicht die Sitzverteilung`;
	if (folie.zuschnitt === "kreis")
		return folie.sitze
			? "die Sitzverteilung, über den ganzen Landkreis gerechnet"
			: "das Ergebnis im ganzen Landkreis";
	return undefined;
};

export const wahlKontext = (
	folie: WahlFolie,
	vorher: FolienStand,
	meldungen: string[],
	beitraege: GebietsBeitrag[],
): WahlKontext => {
	const sitzeVon = (key: string) =>
		folie.sitze?.verteilung.find((v) => v.key === key);
	return {
		wahl: folie.wahl,
		ort: folie.ort,
		zuschnitt: folie.zuschnitt,
		worum: worumEsGeht(folie),
		beisatz: folie.beisatz,
		anz: folie.anz,
		max: folie.max,
		datenstand: [folie.datenstand.titel, folie.datenstand.text]
			.filter(Boolean)
			.join(" – "),
		unsicherheit: folie.datenstand.unsicherheit
			? `Unsicherheit ${folie.datenstand.unsicherheit}`
			: undefined,
		parteien: folie.balken.map((b) => ({
			kurz: b.name,
			prozent: b.prozent,
			diff: b.diff,
			sitze: sitzeVon(b.key)?.sitze ?? b.sitze,
			sitzeVorher: sitzeVon(b.key)?.vorher,
		})),
		wahlbeteiligung: folie.wahlbeteiligung,
		wahlbeteiligungVorher: folie.wahlbeteiligungVorher,
		vergleichTitel: folie.vergleichTitel,
		bewerber: folie.kandidaten?.map((k) => ({
			name: k.name,
			partei: k.partei,
			stimmen: k.stimmen,
			mandat: k.mandat,
		})),
		listen: folie.listen?.map((l) => ({
			partei: l.partei,
			namen: l.kandidaten.map((k) => k.name),
		})),
		zeitstempel: folie.zeitstempel,
		vorher,
		beitraege,
		meldungen,
	};
};
