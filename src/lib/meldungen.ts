/**
 * Was sich auf der Leinwand seit dem letzten Seitentausch getan hat.
 *
 * Am Wahlabend kommen die Zahlen in Schüben: Ein Wahlbezirk meldet, die Seite
 * holt sich ihren Inhalt neu (siehe Layout.astro), und die Folien sind danach
 * andere Elemente mit anderen Zahlen. Ohne einen Hinweis darauf **verändert
 * sich das Bild lautlos** – wer nicht gerade auf die richtige Folie sieht,
 * bekommt nichts davon mit. Genau dafür sind die Einblender da, und dies ist
 * ihre Regel: Was ist erzählenswert, und in welcher Reihenfolge.
 *
 * Hier steht nur das Rechnen – ohne DOM, ohne Zeit, ohne Astro. Das Karussell
 * (Dashboard.astro) liest die Stände aus den `data-`Merkmalen der Folien und
 * hängt an, was hier herauskommt.
 */

import type { Klangart } from "./klang.ts";
import { formatProzent } from "./zahlen.ts";

/**
 * Wo eine Partei auf einer Folie steht.
 *
 * Der Einblender „CDU zieht an SPD vorbei“ braucht nur die Spitze. Wer seine
 * eigene Partei eingestellt hat, will aber von ihr hören, auch wenn sie
 * Dritter ist – dafür reicht die Spitze nicht, und deshalb bringt jede Folie
 * diese Zeile für jede Partei mit, die auf ihr steht.
 */
export type ParteiStand = {
	/** Normalisierter Kurzname (siehe `parteiKey`). */
	key: string;
	/** Platz, nach Stimmenanteil – 1 ist die Spitze. */
	platz: number;
	prozent: number;
	/** Sitze, sofern die Folie eine Sitzverteilung zeigt. */
	sitze?: number;
};

/** Der Stand einer Folie, wie ihn das Server-HTML mitbringt. */
export type FolienStand = {
	ort: string;
	wahl: string;
	anz: number;
	max: number;
	/** Zwischenstand, Hochrechnung, Endergebnis. */
	art: string;
	/** Wer vorn liegt – Partei oder Bewerber. */
	spitze: string;
	/** Alle Parteien der Folie – für die eigene Partei (siehe `eigeneMeldungen`). */
	parteien?: ParteiStand[];
};

export type MeldungsArt =
	| "jubel"
	| "abstieg"
	| "fertig"
	| "endergebnis"
	| "hochrechnung"
	| "spitze"
	| "stand";

export type Meldung = {
	ort: string;
	wahl: string;
	art: MeldungsArt;
	text: string;
};

/**
 * Die Rangfolge der Nachrichten – zugleich die Reihenfolge, in der sie
 * eingeblendet werden.
 *
 * Ganz vorn steht, was mit der **eigenen** Partei passiert: Wer sie eingestellt
 * hat, ist an dem Abend ihretwegen da, und ein gewonnener Sitz schlägt jede
 * fremde Auszählung. Danach „fertig ausgezählt“ – die Nachricht, auf die im
 * Saal gewartet wird –, dann ein Führungswechsel. Der bloße Zähler steht
 * hinten: Er kommt am häufigsten und sagt am wenigsten.
 */
export const MELDUNGS_RANG: MeldungsArt[] = [
	"jubel",
	"abstieg",
	"fertig",
	"endergebnis",
	"hochrechnung",
	"spitze",
	"stand",
];

/** So viele Einblender auf einmal – darüber liest sie niemand mehr. */
export const MELDUNGEN_HOECHSTENS = 4;

const fertig = (s: FolienStand): boolean => s.max > 0 && s.anz >= s.max;

/**
 * Was zwischen zwei Ständen erzählenswert ist.
 *
 * **Je Folie höchstens eine Meldung.** Eine einzige Schnellmeldung ändert
 * Auszählstand, Datenstand und womöglich die Spitze auf einen Schlag; drei
 * Einblender übereinander sagten dann dasselbe dreimal.
 *
 * **Nur Folien, die es vorher schon gab.** Beim ersten Aufbau ist alles neu –
 * dann meldet die Leinwand nichts, sondern merkt sich bloß, was steht. Sonst
 * hagelte es beim Öffnen ein Dutzend Meldungen über Zahlen, die längst da
 * waren.
 */
/**
 * Der Satz, den die Leinwand ansagt.
 *
 * Nicht derselbe Text wie im Einblender: Dort steht der Ort schon groß
 * daneben, hier fehlt jeder Zusammenhang. „Rössing ist fertig ausgezählt"
 * gesprochen ohne die Wahl dazu ließe im Saal offen, welche – eine Gemeinde
 * hat an dem Abend fünf davon.
 */
export const satz = (m: Meldung): string => {
	const wo = m.wahl ? `${m.wahl} ${m.ort}` : m.ort;
	switch (m.art) {
		case "jubel":
		case "abstieg":
			// Bei der eigenen Partei steht die Nachricht vorn und das Gebiet
			// hinten: „CDU liegt vorn!“ ist der Satz, auf den es ankommt – wo,
			// ist die Nachfrage. Bei allen anderen Meldungen ist es umgekehrt.
			return `${m.text} – ${wo}.`;
		case "fertig":
			return `${wo}: fertig ausgezählt!`;
		case "endergebnis":
			return `${wo}: das Endergebnis steht.`;
		case "hochrechnung":
			return `${wo}: erste Hochrechnung.`;
		case "spitze":
			// Der Text trägt hier die Namen („CDU zieht an SPD vorbei"), und die
			// sind die Nachricht – der Ort ordnet sie nur ein.
			return `${wo}: ${m.text}`;
		default:
			return `${wo}: ${m.text}`;
	}
};

/**
 * Was von einem Schub angesagt wird: das Wichtigste, und wie viel dazu kam.
 *
 * Fünf Sätze hintereinander hört niemand zu Ende, und der letzte wäre der
 * wichtigste gewesen – deshalb einer, und der Rest gezählt.
 */
export const ansage = (meldungen: readonly Meldung[]): string => {
	if (meldungen.length === 0) return "";
	const erste = satz(meldungen[0]);
	const rest = meldungen.length - 1;
	if (rest === 0) return erste;
	return `${erste} Und ${rest} weitere ${rest === 1 ? "Meldung" : "Meldungen"}.`;
};

export const vergleiche = (
	alt: Map<string, FolienStand>,
	neu: Map<string, FolienStand>,
): Meldung[] => {
	const raus: Meldung[] = [];
	for (const [marke, n] of neu) {
		const a = alt.get(marke);
		if (!a) continue;
		const kopf = { ort: n.ort, wahl: n.wahl };
		if (fertig(n) && !fertig(a))
			raus.push({
				...kopf,
				art: "fertig",
				text: `${n.ort} ist fertig ausgezählt!`,
			});
		else if (n.art !== a.art && n.art === "endergebnis")
			raus.push({ ...kopf, art: "endergebnis", text: "Endergebnis steht" });
		else if (n.art !== a.art && n.art === "hochrechnung")
			raus.push({ ...kopf, art: "hochrechnung", text: "Erste Hochrechnung" });
		else if (n.spitze && a.spitze && n.spitze !== a.spitze)
			raus.push({
				...kopf,
				art: "spitze",
				text: `${n.spitze} zieht an ${a.spitze} vorbei`,
			});
		else if (n.anz > a.anz)
			raus.push({
				...kopf,
				art: "stand",
				text:
					n.max > 0
						? `${n.anz} von ${n.max} ausgezählt`
						: `${n.anz} Schnellmeldungen`,
			});
	}
	return raus.sort(
		(x, y) => MELDUNGS_RANG.indexOf(x.art) - MELDUNGS_RANG.indexOf(y.art),
	);
};

/**
 * Die Parteistände einer Folie als ein einziges Merkmal.
 *
 * `cdu:1:34.1:9|spd:2:30.0:8|gruene:3:12.5:-` – Schlüssel, Platz, Prozent,
 * Sitze; ein Strich, wo die Folie keine Sitze zeigt. Ein knappes Format statt
 * JSON, weil es fünfzehn Folien mal sechs Parteien in jedem Server-HTML gibt
 * und der Wahlabend über eine Mobilfunkverbindung im Saal läuft.
 *
 * Die Prozentzahl steht mit Punkt und einer Stelle: Sie wird verglichen, nicht
 * angezeigt – die Anzeige macht `formatProzent`.
 */
export const kodiereStaende = (staende: readonly ParteiStand[]): string =>
	staende
		.map((p) =>
			[p.key, p.platz, p.prozent.toFixed(1), p.sitze ?? "-"].join(":"),
		)
		.join("|");

export const liesStaende = (text: string | undefined): ParteiStand[] => {
	if (!text) return [];
	const raus: ParteiStand[] = [];
	for (const stueck of text.split("|")) {
		const [key, platz, prozent, sitze] = stueck.split(":");
		if (!key) continue;
		const s = Number(sitze);
		raus.push({
			key,
			platz: Number(platz) || 0,
			prozent: Number(prozent) || 0,
			sitze: sitze === "-" || Number.isNaN(s) ? undefined : s,
		});
	}
	return raus;
};

/**
 * Ab wann eine Veränderung des Anteils eine Meldung wert ist.
 *
 * Darunter ist es das Rauschen der Auszählung: Ein einzelner Wahlbezirk
 * bewegt den Anteil um Zehntel, und eine Fanfare je Zehntel ist nach einer
 * halben Stunde kein Jubel mehr, sondern ein Weckruf.
 */
export const PROZENT_SCHWELLE = 1;

const standVon = (
	s: FolienStand | undefined,
	key: string,
): ParteiStand | undefined => s?.parteien?.find((p) => p.key === key);

/**
 * Was sich für die **eigene** Partei getan hat (siehe `partei.ts`).
 *
 * Am Wahlabend interessiert den, der selbst kandidiert, nicht die Spitze,
 * sondern seine eigene Zeile: ein Platz nach vorn, ein Sitz mehr, ein
 * Prozentpunkt dazu. Genau davon handeln diese Meldungen – und nur davon;
 * ohne eingestellte Partei kommt hier nichts heraus.
 *
 * **Je Folie höchstens eine, und die größte zuerst.** Ein gewonnener Sitz und
 * ein Platz nach vorn kommen im selben Schub; drei Fanfaren übereinander
 * wären dieselbe Nachricht dreimal. Der Platz steht dabei vor dem Sitz: „Wir
 * sind stärkste Kraft“ ist der Satz, der im Saal gerufen wird.
 *
 * **Nur Parteien, die auf beiden Ständen stehen.** Eine Folie zeigt die
 * stärksten Listen; wer neu hinzukommt oder herausfällt, hat keinen
 * Vergleich – und eine Meldung ohne Vergleich wäre geraten.
 */
export const eigeneMeldungen = (
	alt: Map<string, FolienStand>,
	neu: Map<string, FolienStand>,
	partei: { key: string; kurz: string } | undefined,
): Meldung[] => {
	if (!partei?.key) return [];
	const raus: Meldung[] = [];
	const wir = partei.kurz;
	for (const [marke, n] of neu) {
		const a = alt.get(marke);
		if (!a) continue;
		const vorher = standVon(a, partei.key);
		const jetzt = standVon(n, partei.key);
		if (!vorher || !jetzt) continue;
		const kopf = { ort: n.ort, wahl: n.wahl };
		if (jetzt.platz !== vorher.platz) {
			// „Stärkste Kraft“ träfe bei einer Bürgermeisterwahl daneben – dort
			// steht eine Person auf der Folie und keine Fraktion. „Liegt vorn“
			// stimmt in beiden Fällen.
			const auf = jetzt.platz < vorher.platz;
			raus.push({
				...kopf,
				art: auf ? "jubel" : "abstieg",
				text: auf
					? jetzt.platz === 1
						? `${wir} liegt vorn!`
						: `${wir} klettert auf Platz ${jetzt.platz}`
					: vorher.platz === 1
						? `${wir} liegt nicht mehr vorn`
						: `${wir} rutscht auf Platz ${jetzt.platz}`,
			});
			continue;
		}
		if (
			jetzt.sitze !== undefined &&
			vorher.sitze !== undefined &&
			jetzt.sitze !== vorher.sitze
		) {
			const d = jetzt.sitze - vorher.sitze;
			const wieviel = Math.abs(d) === 1 ? "einen Sitz" : `${Math.abs(d)} Sitze`;
			raus.push({
				...kopf,
				art: d > 0 ? "jubel" : "abstieg",
				text:
					d > 0
						? `${wir} gewinnt ${wieviel} – jetzt ${jetzt.sitze}`
						: `${wir} verliert ${wieviel} – nur noch ${jetzt.sitze}`,
			});
			continue;
		}
		const diff = jetzt.prozent - vorher.prozent;
		if (Math.abs(diff) >= PROZENT_SCHWELLE)
			raus.push({
				...kopf,
				art: diff > 0 ? "jubel" : "abstieg",
				text: `${wir} ${diff > 0 ? "legt zu" : "verliert"}: ${formatProzent(jetzt.prozent)}`,
			});
	}
	return raus;
};

/**
 * Alles, was ein Schub hergibt – die eigene Partei zuerst.
 *
 * Ein und dieselbe Folie kann beides melden („fertig ausgezählt“ *und* „CDU
 * liegt vorn“): Das ist keine Doppelung, sondern zwei Nachrichten, von denen
 * die zweite nur den einen im Saal angeht, der dafür den ganzen Abend
 * gekämpft hat.
 */
export const alleMeldungen = (
	alt: Map<string, FolienStand>,
	neu: Map<string, FolienStand>,
	partei?: { key: string; kurz: string },
): Meldung[] =>
	[...eigeneMeldungen(alt, neu, partei), ...vergleiche(alt, neu)].sort(
		(x, y) => MELDUNGS_RANG.indexOf(x.art) - MELDUNGS_RANG.indexOf(y.art),
	);

/**
 * Der Ton zu einem Schub: Die wichtigste Meldung gibt ihn vor.
 *
 * Ein Ton je Schub und nicht je Meldung – vier Einblender auf einmal wären
 * sonst vier Töne übereinander.
 */
export const klangArt = (meldungen: readonly Meldung[]): Klangart => {
	switch (meldungen[0]?.art) {
		case "jubel":
			return "jubel";
		case "abstieg":
			return "abstieg";
		case "fertig":
			return "fertig";
		default:
			return "neu";
	}
};
