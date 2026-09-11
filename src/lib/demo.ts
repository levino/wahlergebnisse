/**
 * Der Demo-Wahlabend: eine Generalprobe, die sich alle zehn Minuten
 * wiederholt.
 *
 * **Wozu.** Am 13.09.2026 läuft der Beamer im Saal, und dann muss alles
 * sitzen – Dashboard, Hochrechnung, Ticker, das stille Nachladen. Vorher
 * lässt sich das nur an einem Abend prüfen, den es noch nicht gibt. Also
 * bauen wir ihn nach: mit den Zahlen der jeweils letzten Wahl, Wahlbezirk für
 * Wahlbezirk hereintröpfelnd, in einer Schleife.
 *
 * **Woher die Zahlen kommen.** Je Wahl aus dem Vorwert desselben Amtes bei
 * derselben Wahlleitung – für Rat, Ortsräte, Kreistag und Landrat also 2021,
 * für die Bürgermeisterwahl Nordstemmen die von 2020. Das ist dieselbe
 * Zuordnung, nach der die Wahlseiten ihre Veränderungswerte suchen, und sie
 * hat den angenehmen Nebeneffekt, dass niemand Namen erfinden muss: Es sind
 * echte Bewerberinnen und Bewerber mit echten Zahlen, nur eben von der
 * letzten Wahl.
 *
 * **Was daran erfunden ist.** Die Zuordnung zu 2026 und ein leichtes
 * Rauschen: Je Wahllokal und Partei verschiebt ein Faktor die Stimmen um
 * wenige Prozent. Ohne das stünde in jeder Veränderungsspalte „±0,0“ und die
 * Hochrechnung hätte nichts zu tun. Der Startwert kennt den Durchlauf nicht:
 * Jeder Durchlauf spielt denselben Abend, damit eine Ansage nur einmal
 * vertont werden muss.
 *
 * **Wie sie in die Anwendung kommt.** Über denselben Schreibweg wie der
 * Poller (`speichereErgebnis` in poll.ts). Alles Weitere – Ticker,
 * Auszählstand, Hochrechnung, die Zustellung an offene Seiten – entsteht
 * daraus von selbst. Die Simulation ist eine Datenquelle, kein zweiter
 * Programmzweig; deshalb prüft sie auch wirklich, was am Wahlabend läuft.
 *
 * **Simuliert wird genau eine Größe: wann welches Wahllokal seine Zahlen
 * einträgt.** Jede Zeile, jede Folie, jeder Auszählstand ist eine Auswertung
 * darüber – die Gemeindezeile beim Kreis ebenso wie die eigene Wahl der
 * Gemeinde. Gäbe es einen zweiten Ort, an dem „wie weit ist gezählt"
 * entschieden wird, könnten zwei Sichten auf denselben Augenblick einander
 * widersprechen.
 *
 * **Ohne eigenen Zustand.** Welches Wahllokal wann eingeht, ergibt sich aus
 * der Uhr und einer Zufallsfolge mit festem Startwert – zwei Anfragen im
 * selben Augenblick sehen denselben Abend, und niemand muss sich merken, wo
 * man stehengeblieben ist. Der Nullpunkt wird beim ersten Start gemerkt: Eine
 * frische Instanz fängt beim leeren Saal an, ein Neustart läuft weiter, wo die
 * Uhr steht.
 */
import { hash } from "./hash.ts";
import type { Ergebnis, Kandidat, Partei } from "./votemanager.ts";

/**
 * Läuft dieser Prozess als Generalprobe?
 *
 * Bei jedem Aufruf frisch gelesen, wie `rolle()` auch: Der Schalter gehört zur
 * Instanz, nicht zum Code, und Tests setzen ihn um.
 */
export const demoAn = (): boolean =>
	(process.env.WAHLEN_DEMO ?? "").trim() === "1";

/** Sekunden je Durchlauf, aus `WAHLEN_DEMO_ZYKLUS`. */
export const demoZyklusSekunden = (): number => {
	const n = Number.parseInt(process.env.WAHLEN_DEMO_ZYKLUS ?? "", 10);
	return Number.isFinite(n) && n >= 60 ? n : ZYKLUS_SEKUNDEN_STANDARD;
};

/**
 * Die Wahlleitungen, die mitspielen (`WAHLEN_DEMO_BEHOERDEN`, AGS
 * komma-getrennt). Ohne Angabe alle des Standard-Kreises – für eine Probe
 * genügt ein Kreis, und 400 Behörden alle paar Sekunden neu zu rechnen wäre
 * Arbeit für niemanden.
 */
export const demoBehoerden = (): string[] | undefined =>
	process.env.WAHLEN_DEMO_BEHOERDEN?.split(",")
		.map((s) => s.trim())
		.filter(Boolean);

/**
 * Wo der Nullpunkt des Zyklus gemerkt wird (Meta-Tabelle).
 *
 * Er gehört neben die simulierte Größe und nicht in einen Prozess: Am
 * Prozessstart verankert setzte ihn jeder Deploy zurück – und am Wahlabend
 * wird nachgebessert.
 */
export const NULLPUNKT_SCHLUESSEL = "demo:nullpunkt";

/** `WAHLEN_DEMO_NEUSTART=1` – den gemerkten Nullpunkt einmal überschreiben. */
export const demoNeustart = (): boolean =>
	(process.env.WAHLEN_DEMO_NEUSTART ?? "").trim() === "1";

/**
 * Welcher Nullpunkt gilt – und ob er geschrieben werden muss.
 *
 * Ein gemerkter gilt weiter: Eine frische Instanz fängt beim leeren Saal an,
 * ein Neustart läuft weiter, wo die Uhr steht. Wer nicht schreiben darf (die
 * Web-Pods haben die Datenbank nur lesend offen), nimmt den gemerkten Wert,
 * wie er ist, und merkt nichts an.
 */
export const nullpunkt = (
	gemerkt: string | undefined,
	jetztMs: number,
	opts: { neustart: boolean; darfSchreiben: boolean },
): { beginn: number; merken: boolean } => {
	const alt = Number(gemerkt ?? "");
	const gueltig = Number.isFinite(alt) && alt > 0;
	if (gueltig && !opts.neustart) return { beginn: alt, merken: false };
	if (!opts.darfSchreiben)
		return { beginn: gueltig ? alt : jetztMs, merken: false };
	return { beginn: jetztMs, merken: true };
};

/**
 * Der Satz, der überall dabeisteht.
 *
 * Er steht nicht nur im Banner, sondern auch in jeder Dashboard-Folie: Was von
 * dieser Seite in die Welt geht, geht als Bildschirmfoto, und ein Balken am
 * oberen Rand ist weggeschnitten, bevor jemand ihn gelesen hat.
 */
export const DEMO_HINWEIS =
	"Simulation – keine echten Wahlergebnisse. Die Zahlen stammen aus früheren Wahlen, sind verändert und laufen in einer Schleife.";

/** Wie lange ein voller Durchlauf dauert – vom leeren Saal bis ausgezählt. */
export const ZYKLUS_SEKUNDEN_STANDARD = 600;

/**
 * Anteil des Zyklus, in dem noch gar nichts vorliegt.
 *
 * Am echten Abend schließen die Wahllokale um 18 Uhr, und eine Weile passiert
 * nichts. Genau dieser Zustand ist der, den man vorher am seltensten sieht
 * und am Abend als Erstes: die Aufstellung mit lauter Nullen. Die Demo hält
 * ihn deshalb bewusst eine Weile.
 */
export const VORLAUF_ANTEIL = 0.08;

/**
 * Wie lange das fertige Bild stehenbleibt, bevor der nächste Durchlauf
 * beginnt.
 *
 * Eine feste Minute und kein Anteil des Zyklus: „Alles ausgezählt“ ist der
 * Zustand, in dem die Generalprobe nichts mehr zu zeigen hat – wer dann
 * hinsieht, sieht ein Standbild. Eine Minute reicht, um das Endergebnis
 * anzusehen; alles darüber ist Wartezeit auf einen Abend, der schon vorbei
 * ist.
 */
export const NACHLAUF_SEKUNDEN = 60;

export type Zyklus = {
	/** Fortlaufende Nummer des Durchlaufs. */
	nummer: number;
	/** Anteil der Wahlbezirke, die eingegangen sind (0…1). */
	fortschritt: number;
	/** Absoluter Zeitpunkt (ms), zu dem dieser Durchlauf begonnen hat. */
	beginn: number;
	/** Dauer eines Durchlaufs in Millisekunden. */
	dauer: number;
	/** Der leere Saal am Anfang, in Millisekunden. */
	vorlaufMs: number;
	/** Die Zeit, in der gezählt wird, in Millisekunden. */
	zaehlenMs: number;
};

/**
 * Wo im Durchlauf wir gerade sind.
 *
 * Vorlauf und Nachlauf sind nicht Zierrat, sondern die beiden Zustände, die
 * am Wahlabend am längsten zu sehen sind: nichts ausgezählt und alles
 * ausgezählt. Dazwischen läuft es gleichmäßig hoch.
 *
 * `beginnMs` ist der Nullpunkt – der Zeitpunkt, an dem der erste Durchlauf
 * beim leeren Saal anfängt. Ohne ihn (der Vorgabewert 0) hinge der Zyklus an
 * der Uhr, und wer die Seite kurz nach dem Ausrollen aufruft, fiele mitten in
 * einen halb ausgezählten Abend.
 */
export const zyklusVon = (
	jetztMs: number,
	zyklusSekunden = ZYKLUS_SEKUNDEN_STANDARD,
	beginnMs = 0,
): Zyklus => {
	const dauer = Math.max(1, zyklusSekunden) * 1000;
	const seit = jetztMs - beginnMs;
	const nummer = Math.floor(seit / dauer);
	// Modulo bleibt auch vor dem Nullpunkt positiv – eine Uhr, die einmal
	// zurückspringt, soll keinen negativen Fortschritt erzeugen.
	const imZyklus = ((seit % dauer) + dauer) % dauer;
	const vorlaufMs = VORLAUF_ANTEIL * dauer;
	// Der Nachlauf steht fest; nur wenn er in einen sehr kurzen Durchlauf nicht
	// passt, weicht er – gezählt wird immer mindestens die halbe Zeit.
	const nachlaufMs = Math.min(NACHLAUF_SEKUNDEN * 1000, dauer * 0.4);
	const zaehlenMs = dauer - vorlaufMs - nachlaufMs;
	const roh = (imZyklus - vorlaufMs) / zaehlenMs;
	return {
		nummer,
		fortschritt: Math.min(1, Math.max(0, roh)),
		beginn: beginnMs + nummer * dauer,
		dauer,
		vorlaufMs,
		zaehlenMs,
	};
};

/**
 * Zahl zwischen 0 und 1 aus beliebigem Text – überall dort, wo etwas zufällig
 * aussehen, aber bei gleichem Startwert gleich bleiben soll. Zwei Anfragen im
 * selben Moment müssen denselben Wahlabend sehen.
 */
const streu = (...teile: Array<string | number>): number => {
	const h = hash(teile.join("|"));
	return Number.parseInt(h.slice(0, 8), 16) / 0xffffffff;
};

/**
 * Wie stark sich die Eingänge zum Anfang der Zählphase drängen: Die kleinen
 * Urnenwahlbezirke melden früh, die großen und die Briefwahl brauchen länger.
 */
const EINGANG_KRUEMMUNG = 1.3;

/**
 * Wann eine einzelne Auszähleinheit eingeht – als Anteil der Zählphase, echt
 * über 0 und höchstens 1: Bei Fortschritt 0 ist nichts da, am Ende alles.
 * Der Startwert kennt den Durchlauf nicht: Jeder spielt denselben Abend.
 */
export const eingangsAnteil = (schluessel: string): number =>
	Math.min(
		1,
		Math.max(
			Number.MIN_VALUE,
			streu("eingang", schluessel) ** EINGANG_KRUEMMUNG,
		),
	);

/**
 * Der Zeitpunkt, zu dem ein Stand zuletzt gewachsen ist: der der zuletzt
 * eingegangenen Einheit. „Stand 20:14“ ist eine Aussage und darf nicht bei
 * jedem Schreibvorgang auf die Uhr springen – sonst liefe der Ticker über.
 * Ohne Eingang ist es der Beginn der Zählung.
 */
export const eingangsZeit = (
	zyklus: Zyklus,
	anteile: readonly number[],
): number => {
	let letzte = 0;
	for (const a of anteile) if (a > letzte) letzte = Math.min(1, a);
	return Math.round(
		zyklus.beginn + zyklus.vorlaufMs + letzte * zyklus.zaehlenMs,
	);
};

/**
 * Mischt eine Liste immer gleich, wenn der Startwert gleich ist
 * (Fisher-Yates mit `streu` statt `Math.random`).
 */
export const mische = <T>(items: readonly T[], startwert: string): T[] => {
	const a = [...items];
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(streu(startwert, i) * (i + 1));
		[a[i], a[j]] = [a[j], a[i]];
	}
	return a;
};

/**
 * Der Faktor, mit dem die Stimmen einer Partei verschoben werden: ±8 Prozent
 * ihres eigenen Werts. Der Startwert ist das Wahllokal, nicht der Durchlauf –
 * jeder Durchlauf zeigt denselben Abend, und eine Ansage muss nur einmal
 * vertont werden.
 */
export const rauschFaktor = (schluessel: string, parteiKey: string): number =>
	0.92 + streu("rausch", schluessel, parteiKey) * 0.16;

/**
 * Legt das Rauschen auf die Zahlen eines einzelnen Wahllokals – einmal, und
 * danach in jeder Sicht dieselben.
 *
 * Der Faktor hing an Wahlleitung und Amt. Damit lieferte dasselbe Wahllokal
 * an die Gemeindesicht andere Stimmen als an die Kreissicht: Zwei Folien über
 * denselben Augenblick widersprachen sich, ohne dass eine von beiden falsch
 * gerechnet hätte. Er gehört zum Wahllokal, und weil hier schon gerundet
 * wird, ist jede Zeile darüber die Summe genau der ganzen Zahlen, die in den
 * Wahlbezirkszeilen stehen.
 */
export const verrausche = (
	e: Ergebnis,
	faktor: (parteiKey: string) => number,
): Ergebnis => ({
	...e,
	parteien: e.parteien.map((p) => {
		const f = faktor(p.key);
		const mal = (n: number | undefined) =>
			n === undefined ? undefined : Math.round(n * f);
		return {
			...p,
			stimmen: Math.round(p.stimmen * f),
			listenstimmen: mal(p.listenstimmen),
			kandidatenstimmen: mal(p.kandidatenstimmen),
			kandidaten: p.kandidaten?.map((k) => ({
				...k,
				stimmen: Math.round(k.stimmen * f),
			})),
		};
	}),
});

const rundeAuf = (n: number, stellen = 2): number => {
	const f = 10 ** stellen;
	return Math.round(n * f) / f;
};

/** Summe über eine Zahl, die auch fehlen darf. */
const plus = (
	a: number | undefined,
	b: number | undefined,
): number | undefined =>
	a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0);

const kandidatenSumme = (
	listen: Array<Kandidat[] | undefined>,
): Kandidat[] | undefined => {
	const nach = new Map<string, Kandidat>();
	let hatte = false;
	for (const liste of listen) {
		if (!liste) continue;
		hatte = true;
		for (const k of liste) {
			const alt = nach.get(k.name);
			nach.set(k.name, {
				...k,
				stimmen: (alt?.stimmen ?? 0) + k.stimmen,
				// Der Anteil in der Partei ergibt sich erst aus der Summe; bis
				// dahin wäre jeder übernommene Wert falsch.
				prozentInPartei: undefined,
			});
		}
	}
	if (!hatte) return undefined;
	return [...nach.values()].sort((a, b) => b.stimmen - a.stimmen);
};

/**
 * Zählt Wahllokale zu einem Gebietsergebnis zusammen.
 *
 * `vorlage` liefert alles, was sich nicht aus den Stimmen ergibt: Titel,
 * Untergebiete, die Reihenfolge der Parteien auf dem Stimmzettel. Aus den
 * Bausteinen kommen die Zahlen – und zwar nur die der schon eingegangenen,
 * denn genau das ist ein Zwischenstand.
 *
 * Gerechnet wird ohne Rauschen: Das liegt schon auf den Bausteinen
 * (`verrausche`), damit jede Sicht auf dasselbe Wahllokal dieselbe Zahl
 * bekommt.
 */
export const zaehleZusammen = (
	vorlage: Ergebnis,
	bausteine: readonly Ergebnis[],
	anz: number,
	max: number,
	/** Zeitstempel dieses Stands; ohne Angabe die Uhr. */
	stempel?: string,
): Ergebnis => {
	const stimmenJe = new Map<string, number>();
	const listenJe = new Map<string, number | undefined>();
	const kandidatenJe = new Map<string, number | undefined>();
	const kandidatenListen = new Map<string, Array<Kandidat[] | undefined>>();
	for (const b of bausteine)
		for (const p of b.parteien) {
			stimmenJe.set(p.key, (stimmenJe.get(p.key) ?? 0) + p.stimmen);
			listenJe.set(p.key, plus(listenJe.get(p.key), p.listenstimmen));
			kandidatenJe.set(
				p.key,
				plus(kandidatenJe.get(p.key), p.kandidatenstimmen),
			);
			kandidatenListen.set(p.key, [
				...(kandidatenListen.get(p.key) ?? []),
				p.kandidaten,
			]);
		}
	const runde = (n: number | undefined) =>
		n === undefined ? undefined : Math.round(n);
	const gesamt = [...stimmenJe.values()].reduce((s, v) => s + v, 0);
	const parteien: Partei[] = vorlage.parteien.map((p) => {
		const stimmen = Math.round(stimmenJe.get(p.key) ?? 0);
		const kandidaten = kandidatenSumme(kandidatenListen.get(p.key) ?? []);
		const kStimmen = kandidaten?.reduce((s, k) => s + k.stimmen, 0) ?? 0;
		return {
			...p,
			stimmen,
			prozent: gesamt > 0 ? rundeAuf((stimmen / gesamt) * 100) : 0,
			listenstimmen: runde(listenJe.get(p.key)),
			kandidatenstimmen: runde(kandidatenJe.get(p.key)),
			kandidaten: kandidaten?.map((k) => ({
				...k,
				stimmen: Math.round(k.stimmen),
				prozentInPartei:
					kStimmen > 0 ? rundeAuf((k.stimmen / kStimmen) * 100) : undefined,
			})),
		};
	});

	const summe = (feld: (e: Ergebnis) => number | undefined) => {
		let s: number | undefined;
		for (const b of bausteine) s = plus(s, feld(b));
		return s === undefined ? undefined : Math.round(s);
	};
	const wahlberechtigte = summe((e) => e.kennzahlen.wahlberechtigte);
	const waehler = summe((e) => e.kennzahlen.waehler);

	return {
		...vorlage,
		leer: bausteine.length === 0,
		zeitstempel: stempel ?? new Date().toISOString(),
		stand: { ...vorlage.stand, anz, max, hinweis: [`${anz} von ${max}`] },
		kennzahlen: {
			wahlberechtigte,
			waehler,
			wahlbeteiligung:
				wahlberechtigte && waehler
					? rundeAuf((waehler / wahlberechtigte) * 100)
					: undefined,
			ungueltig: summe((e) => e.kennzahlen.ungueltig),
			gueltig: summe((e) => e.kennzahlen.gueltig),
			stimmen: summe((e) => e.kennzahlen.stimmen),
		},
		parteien,
		// Sitze erst, wenn alles ausgezählt ist – vorher rechnet die Anwendung
		// selbst hoch, und genau das soll die Demo ja zeigen.
		sitze: anz >= max && max > 0 ? vorlage.sitze : undefined,
	};
};
