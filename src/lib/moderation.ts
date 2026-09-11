/**
 * Der Kontext, aus dem das Sprachmodell die Ansage formuliert – und die
 * Prüfung, die seine Antwort bestehen muss.
 *
 * Rein und ohne Node, ohne DOM, ohne Netz: Was hier steht, ist die Regel und
 * nicht der Aufruf. Der Aufruf steht in `ansage-datei.ts`, das Zusammentragen
 * der Folien in `pages/api/ansage/moderation.ts`.
 */
import type { Ereignis } from "./abfragen.ts";
import { ANSAGE_HOECHSTLAENGE, type ModerationAnfrage } from "./ansage.ts";
import type { WahlFolie } from "./dashboard.ts";
import type { FolienStand } from "./meldungen.ts";

export const MODERATION_FASSUNG = 1;

/** Ein Satz, höchstens zwei – im Saal hört niemand einem Absatz zu. */
export const SAETZE_HOECHSTENS = 2;

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
	name: string;
	anz?: number;
	max?: number;
	spitze: Array<{ kurz: string; prozent: number }>;
	wahlbeteiligung?: number;
};

export type WahlKontext = {
	wahl: string;
	ort: string;
	zuschnitt: "eigen" | "wahlbereich" | "kreis";
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
	wahlen: WahlKontext[];
	/** Die feste Formulierung – Vorlage und Rückfall zugleich. */
	fest: string;
};

export const MODERATION_ANWEISUNG = [
	"Du hast am Wahlabend im Saal das Mikrofon. Vorne läuft eine Leinwand mit",
	"den Zwischenständen, und gerade sind neue Zahlen eingegangen.",
	"",
	"So sprichst du:",
	"- Erst ein kurzer Auftakt, damit die Leute aufhorchen, dann die Nachricht.",
	"  Etwa: „Da kommen gerade neue Ergebnisse rein, ich schaue mal – Rössing",
	"  hat ausgezählt.“",
	"- Ein Satz, höchstens zwei. Kein Absatz, keine Aufzählung, keine",
	"  Überschrift, keine Klammern, keine Emojis.",
	"- Gesprochene Sprache. Zahlen als Ziffern, Prozentzeichen als Wort",
	"  „Prozent“.",
	"- Kommen mehrere Meldungen zusammen, fasst du sie zu einer zusammen,",
	"  statt sie aufzuzählen.",
	"",
	"Woran du dich hältst:",
	"- Du sagst nur, was im Kontext steht. Keine Zahl, kein Name, kein Trend,",
	"  der dort nicht steht. Im Zweifel weniger sagen.",
	"- Keine Bewertung von Parteien oder Personen, keine Prognose, kein",
	"  Ausblick auf den weiteren Abend.",
	"- Eine Ursache nennst du nur, wenn der Kontext sie hergibt – also wenn ein",
	"  eingegangenes Gebiet die Veränderung erklärt. Sonst berichtest du,",
	"  statt zu erklären.",
	"- Die Partei des Zuschauers darfst du beim Namen nennen, aber nicht loben.",
	"",
	"Du antwortest ausschließlich mit dem Satz, den du sprechen würdest.",
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

const beitragZeile = (b: GebietsBeitrag): string => {
	const spitze = b.spitze.map((s) => `${s.kurz} ${pz(s.prozent)}`).join(", ");
	return [
		b.name,
		spitze,
		b.wahlbeteiligung !== undefined
			? `Wahlbeteiligung ${pz(b.wahlbeteiligung)}`
			: "",
	]
		.filter(Boolean)
		.join(" – ");
};

const wahlBlock = (w: WahlKontext): string => {
	const zeilen: string[] = [
		`WAHL: ${w.wahl} ${w.ort} (${ZUSCHNITT_TEXT[w.zuschnitt]}${w.beisatz ? `: ${w.beisatz}` : ""})`,
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
	if (w.beitraege.length > 0)
		zeilen.push(
			`Neu eingegangen: ${w.beitraege.map(beitragZeile).join(" | ")}`,
		);
	if (w.meldungen.length > 0)
		zeilen.push(`Das ist erzählenswert: ${w.meldungen.join(" | ")}`);
	return zeilen.join("\n");
};

export const kontextText = (schub: Schub): string =>
	[
		schub.partei
			? `Der Zuschauer hat „${schub.partei}“ als seine Partei eingestellt.`
			: "Der Zuschauer hat keine eigene Partei eingestellt.",
		`Feste Formulierung, die du ersetzt: ${schub.fest}`,
		"",
		...schub.wahlen.map(wahlBlock),
	].join("\n");

const ZAHL = /\d+(?:[.,]\d+)?/g;

const normiere = (roh: string): string => String(Number(roh.replace(",", ".")));

export const zahlenIm = (text: string): string[] =>
	(text.match(ZAHL) ?? []).map(normiere);

/**
 * Welche Zahlen die Antwort nennen darf: alles, was im Kontext steht – und
 * dazu die gerundete Fassung jeder Kommazahl. „34,1 Prozent“ als „34 Prozent“
 * zu sprechen ist dieselbe Regel, nach der die feste Ansage rundet, und keine
 * erfundene Zahl.
 */
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

const saetze = (text: string): number =>
	text.split(/[.!?](?:\s|$)/).filter((t) => t.trim().length > 0).length;

/**
 * Die Antwort, wie sie gesprochen wird – oder `undefined`, wenn sie den Test
 * nicht besteht. Dann gilt die feste Formulierung.
 */
export const pruefeAntwort = (
	roh: string,
	kontext: string,
	hoechstlaenge: number,
): { satz: string } | { fehler: string } => {
	const satz = roh
		.trim()
		.replace(/^[„“"'»]+|[“”"'«]+$/g, "")
		.replace(/\s+/g, " ")
		.trim();
	if (!satz) return { fehler: "leere Antwort" };
	if (satz.length > hoechstlaenge)
		return { fehler: `${satz.length} Zeichen – zu lang` };
	if (saetze(satz) > SAETZE_HOECHSTENS)
		return { fehler: `${saetze(satz)} Sätze – zu viel für den Saal` };
	const erfunden = erfundeneZahlen(satz, kontext);
	if (erfunden.length > 0)
		return { fehler: `Zahlen ohne Deckung: ${erfunden.join(", ")}` };
	return { satz };
};

/**
 * Was das gerade eingegangene Gebiet beigesteuert hat.
 *
 * Genau so viele Ereignisse, wie Schnellmeldungen dazugekommen sind: Ohne Uhr
 * und ohne Zeitstempel ist der Zähler das verlässlichere Maß dafür, was seit
 * dem letzten Blick auf die Leinwand eingegangen ist. Das Gesamtgebiet bleibt
 * außen vor – dort geht nichts ein, dort wird summiert.
 *
 * Nur für Folien, deren Gebiet die ganze Wahl umfasst. Beim Kreiswahlbereich
 * meldet ein Wahlbezirk irgendwo im Kreis, und ob er in diesem Bereich liegt,
 * geht aus dem Ereignis nicht hervor – eine Ursache daraus wäre geraten.
 */
export const beitraegeAus = (
	ereignisse: readonly Ereignis[],
	folie: WahlFolie,
	vorher: FolienStand,
): GebietsBeitrag[] => {
	if (folie.quelle.gebietId) return [];
	const wieviele = Math.max(0, folie.anz - vorher.anz);
	if (wieviele === 0) return [];
	return ereignisse
		.filter(
			(e) =>
				e.behoerde === folie.quelle.behoerde &&
				e.wahlId === folie.quelle.wahlId &&
				e.gebietId !== folie.quelle.gesamtGebietId,
		)
		.slice(0, wieviele)
		.map((e) => ({
			name: e.text,
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

/**
 * Was vom Browser kommt, auf ein Maß bringen, mit dem sich rechnen lässt.
 *
 * Der Endpunkt steht offen, und alles, was hier hereinkommt, landet in einem
 * Modellaufruf. Deshalb wird jede Zeichenkette gestutzt, jede Zahl gedeckelt
 * und die Zahl der Folien begrenzt – und die Marken müssen ohnehin zu Folien
 * passen, die es an diesem Abend wirklich gibt.
 */
const kurz = (wert: unknown, laenge: number): string =>
	typeof wert === "string" ? wert.slice(0, laenge) : "";

const zahl = (wert: unknown): number => {
	const n = Number(wert);
	return Number.isFinite(n) && n >= 0 ? Math.min(n, 100_000) : 0;
};

const saubererStand = (roh: unknown): FolienStand => {
	const r = (roh ?? {}) as Record<string, unknown>;
	return {
		ort: kurz(r.ort, 80),
		wahl: kurz(r.wahl, 80),
		anz: zahl(r.anz),
		max: zahl(r.max),
		art: kurz(r.art, 40),
		spitze: kurz(r.spitze, 80),
		parteien: Array.isArray(r.parteien)
			? r.parteien.slice(0, 12).map((p) => {
					const q = (p ?? {}) as Record<string, unknown>;
					return {
						key: kurz(q.key, 40),
						platz: zahl(q.platz),
						prozent: zahl(q.prozent),
						sitze: q.sitze === undefined ? undefined : zahl(q.sitze),
					};
				})
			: [],
	};
};

/** So viele Folien kann ein Schub berühren – darüber ist es kein Schub mehr. */
export const FOLIEN_HOECHSTENS = 20;

export const saubereAnfrage = (roh: unknown): ModerationAnfrage | undefined => {
	const r = (roh ?? {}) as Record<string, unknown>;
	const fest = kurz(r.fest, ANSAGE_HOECHSTLAENGE).trim();
	if (!fest || !Array.isArray(r.wahlen) || r.wahlen.length === 0)
		return undefined;
	return {
		kreis: kurz(r.kreis, 60),
		termin: kurz(r.termin, 60),
		behoerde: kurz(r.behoerde, 20),
		partei: r.partei ? kurz(r.partei, 40) : undefined,
		fest,
		wahlen: r.wahlen.slice(0, FOLIEN_HOECHSTENS).map((w) => {
			const q = (w ?? {}) as Record<string, unknown>;
			return {
				marke: kurz(q.marke, 80),
				vorher: saubererStand(q.vorher),
				meldungen: Array.isArray(q.meldungen)
					? q.meldungen.slice(0, 6).map((m) => kurz(m, 160))
					: [],
			};
		}),
	};
};
