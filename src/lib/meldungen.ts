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
};

export type MeldungsArt =
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
 * „Fertig ausgezählt“ ist die Nachricht, auf die im Saal gewartet wird; ein
 * Führungswechsel die zweite. Der bloße Zähler steht hinten: Er kommt am
 * häufigsten und sagt am wenigsten.
 */
export const MELDUNGS_RANG: MeldungsArt[] = [
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
