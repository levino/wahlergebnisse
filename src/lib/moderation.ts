import type { Ereignis } from "./abfragen.ts";
import { ANSAGE_HOECHSTLAENGE, type ModerationAnfrage } from "./ansage.ts";
import type { WahlFolie } from "./dashboard.ts";
import type { FolienStand } from "./meldungen.ts";

export const MODERATION_FASSUNG = 2;

export const SAETZE_HOECHSTENS = 6;

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

/** Was ein Eingang in einer einzelnen Wahl bewirkt hat. */
export type Wirkung = {
	wahl: string;
	ort: string;
	anz: number;
	max: number;
	fertig: boolean;
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
	anz: number;
	max: number;
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
	"Die Leinwand zeigt die nackten Fakten – welcher Wahlbezirk eingegangen",
	"ist, wie viele ausgezählt sind, wer vorn liegt. Die stehen dort und",
	"werden gelesen. **Du liest sie nicht vor.** Du erzählst, was sie",
	"bedeuten: wie spannend es steht, wer sich abgesetzt hat, wie viel noch",
	"aussteht, worauf man jetzt wartet.",
	"",
	"So sprichst du:",
	"- Drei bis fünf Sätze. Erst ein Auftakt, damit die Leute aufhorchen, dann",
	"  was passiert ist, dann was das für den Abend heißt.",
	"- Etwa so: „Und bei der Bürgermeisterwahl bleibt es spannend! Gerald",
	"  Ludewig setzt sich an die Spitze des Feldes. Aber noch ist alles offen –",
	"  es sind erst 30 Prozent der Wahlbezirke ausgezählt.“",
	"- Wie weit ausgezählt ist, gehört in jede Ansage. „Erst 30 Prozent“ hält",
	"  die Spannung, wo eine nackte Zahl sie nimmt.",
	"- Gesprochene Sprache, kurze Hauptsätze. Zahlen als Ziffern,",
	"  Prozentzeichen als Wort „Prozent“. Keine Aufzählung, keine Überschrift,",
	"  keine Klammern, keine Emojis, keine Regieanweisungen.",
	"- Kommen mehrere Meldungen zusammen, machst du daraus einen",
	"  Zusammenhang, statt sie aufzuzählen.",
	"- Fang nicht jedes Mal gleich an. Der Abend hat hundert solcher Momente,",
	"  und der immer gleiche Auftakt macht sie alle gleich.",
	"",
	"Woran du dich hältst:",
	"- Du sagst nur, was im Kontext steht. Keine Zahl, kein Name, kein Trend,",
	"  der dort nicht steht. Im Zweifel weniger sagen.",
	"- Spannung ja, Bewertung nein. Dass es knapp ist, darfst du sagen; dass",
	"  es gut ausgeht oder wer gewinnen wird, nicht.",
	"- Keine Bewertung von Parteien oder Personen, keine Prognose.",
	"- Eine Ursache nennst du nur, wenn der Kontext sie hergibt – also wenn ein",
	"  eingegangenes Gebiet die Veränderung erklärt. Sonst berichtest du,",
	"  statt zu erklären.",
	"- Die Partei des Zuschauers darfst du beim Namen nennen, aber nicht loben.",
	"",
	"Du antwortest ausschließlich mit dem, was du sprechen würdest.",
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

const wirkungZeile = (w: Wirkung): string => {
	const zeilen = [`  ${w.wahl} ${w.ort}: ${standSatz(w)}`];
	const dort = w.beitrag ? beitragDetail(w.beitrag) : "";
	if (dort) zeilen.push(`    dort: ${dort}`);
	for (const m of w.meldungen) zeilen.push(`    erzählenswert: ${m}`);
	return zeilen.join("\n");
};

const eingangBlock = (e: EingangsBericht): string =>
	[`Eingegangen: ${e.gebiet}`, ...e.wirkungen.map(wirkungZeile)].join("\n");

const stilleZeile = (w: StilleWahl): string =>
	`${w.wahl} ${w.ort} (${w.anz} von ${w.max})`;

export const kontextText = (schub: Schub): string => {
	const ohneGebiet = schub.wahlen.filter((w) => w.beitraege.length === 0);
	const zeilen = [
		schub.partei
			? `Der Zuschauer hat „${schub.partei}“ als seine Partei eingestellt.`
			: "Der Zuschauer hat keine eigene Partei eingestellt.",
		`Das steht gerade als Einblender auf der Leinwand, du liest es nicht vor: ${schub.fest}`,
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

const saetze = (text: string): number =>
	text.split(/[.!?](?:\s|$)/).filter((t) => t.trim().length > 0).length;

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
				anz: w.anz,
				max: w.max,
				fertig: w.max > 0 && w.anz >= w.max,
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
	return ereignisse
		.filter(
			(e) =>
				e.behoerde === folie.quelle.behoerde &&
				e.wahlId === folie.quelle.wahlId &&
				e.gebietId !== folie.quelle.gesamtGebietId,
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
