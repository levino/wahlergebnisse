/**
 * Strukturbasierte Hochrechnung für den Wahlabend.
 *
 * Das Problem: Solange nur ein Teil der Wahlbezirke ausgezählt ist, ist der
 * rohe Zwischenstand keine Schätzung des Endergebnisses, sondern das Ergebnis
 * einer nicht zufälligen Stichprobe. Kleine Dörfer melden zuerst, die großen
 * Stadtbezirke später, die Briefwahl zuletzt – und sie wählen unterschiedlich.
 * Wer den Zwischenstand fortschreibt, überträgt genau diese Verzerrung.
 *
 * Die Rechnung hier ist die, die ARD und ZDF am Wahlabend benutzen: Für jeden
 * ausgezählten Wahlbezirk wird die Veränderung gegenüber der letzten Wahl
 * bestimmt, und diese Veränderung wird auf die noch fehlenden Bezirke
 * übertragen – gewichtet mit deren Stimmenzahl bei der letzten Wahl. Nicht der
 * Zwischenstand wird fortgeschrieben, sondern die *Veränderung*.
 *
 * Die Annahme dahinter: Die Veränderung gegenüber der Vorwahl ist über die
 * Bezirke hinweg ähnlich, auch wenn die Niveaus weit auseinanderliegen. Ein
 * Dorf, in dem die SPD 2021 bei 60 % lag, bleibt ein SPD-Dorf; wenn sie in den
 * ausgezählten Bezirken ein Zehntel ihres Anteils verliert, verliert sie es
 * dort vermutlich auch. Diese Annahme trägt nicht, wenn eine Partei nur
 * örtlich antritt oder ein Ort einen eigenen Konflikt hat (Windpark,
 * Schulschließung). Deshalb ist das Ergebnis eine Schätzung und keine
 * Auszählung, und deshalb wird es überall als Hochrechnung beschriftet.
 *
 * Getrennt gerechnet wird nach Urnen- und Briefwahlbezirken: Briefwählerinnen
 * und Briefwähler stimmen messbar anders ab, und ihre Bezirke melden spät.
 *
 * Ehrlich dazugesagt: An den Daten von 2021 lässt sich der Nutzen dieser
 * Trennung *nicht* messen – dort ist sie mal einen Hauch besser, mal einen
 * Hauch schlechter. Das liegt an der Prüfanordnung: Verglichen werden zwei
 * Wahlen desselben Tages, die Briefwahlbezirke haben in beiden dieselben
 * Wählerinnen und Wähler, und ihr Sonderprofil steckt darum schon im Vorwert
 * jedes einzelnen Bezirks. Wogegen die Trennung schützt, ist der Fall, den
 * 2021 nicht hergibt: Wenn sich der *Anteil* der Briefwahl zwischen zwei
 * Wahlen verschiebt – und 2021 war eine Corona-Wahl mit ungewöhnlich hoher
 * Briefwahl –, dann läuft die Wahlbeteiligung in beiden Gruppen
 * auseinander, und nur die getrennte Rechnung merkt das. Sie kostet nichts
 * und deckt ein bekanntes Risiko ab; deshalb bleibt sie drin.
 */

/** Eine Auszähleinheit – in der Regel ein Wahlbezirk, auf Kreisebene eine Gemeinde. */
export type Einheit = {
	/** Stabiler Schlüssel innerhalb der Wahl (Gebiets-ID) */
	id: string;
	/** Name, über den die Einheit der Vorwahl zugeordnet wird */
	name: string;
	briefwahl: boolean;
	/**
	 * Anteil der schon ausgezählten Schnellmeldungen dieser Einheit (0…1).
	 * Bei Wahlbezirken 0 oder 1; auf Kreisebene, wo eine Gemeinde viele
	 * Bezirke bündelt, auch dazwischen.
	 */
	anteil: number;
	/** Bisher ausgezählte Stimmen dieser Einheit, je Partei */
	stimmen: Map<string, number>;
	/** Stimmen derselben Einheit bei der Vergleichswahl, je Partei */
	vorwert?: Map<string, number>;
};

export type Hochrechnung = {
	/** Hochgerechnete Gesamtstimmen je Partei */
	stimmen: Map<string, number>;
	/**
	 * Anteil der Vorwahl-Stimmen, der über ausgezählte Einheiten abgedeckt ist
	 * (0…1). Das ehrlichere Maß für „wie weit ist die Auszählung“ als die
	 * bloße Zahl der Schnellmeldungen, weil es die Größe der Bezirke kennt.
	 */
	abdeckung: number;
	/** Einheiten mit Vorwert, aus denen die Veränderung geschätzt wurde */
	basis: number;
	/** Wurde die Briefwahl getrennt gerechnet, weil eigene Werte vorlagen? */
	briefwahlGetrennt: boolean;
};

const summe = (m: Map<string, number>): number => {
	let s = 0;
	for (const v of m.values()) s += Math.max(0, v);
	return s;
};

const addiere = (
	ziel: Map<string, number>,
	quelle: Map<string, number>,
	faktor = 1,
): void => {
	for (const [k, v] of quelle) ziel.set(k, (ziel.get(k) ?? 0) + v * faktor);
};

/**
 * Erkennt Briefwahlbezirke am Namen. Die Wahlleitungen schreiben sie
 * unterschiedlich („901 - Briefwahl Nordstemmen“, „Briefwahlbezirk 1“,
 * „Briefwahl 05“); gemeinsam ist der Wortanfang „Brief“.
 */
export const istBriefwahl = (name: string): boolean => /\bbrief/i.test(name);

/**
 * Vergleichbarer Schlüssel für denselben Wahlbezirk in zwei Wahljahren.
 * Zwischen zwei Wahlen ändert sich die Schreibweise des Wahllokals häufiger
 * als seine Nummer („09 - Rössing - DGH“ → „09 - Rössing, Dorfgemeinschaftshaus“),
 * die führende Nummer ist der stabilere Teil.
 */
export const bezirksNummer = (name: string): string | undefined => {
	const m = name.trim().match(/^0*(\d+)\b/);
	return m ? m[1] : undefined;
};

const normName = (name: string): string =>
	name
		.toLowerCase()
		.replace(/ä/g, "a")
		.replace(/ö/g, "o")
		.replace(/ü/g, "u")
		.replace(/ß/g, "s")
		.replace(/[^a-z0-9]/g, "");

/**
 * Ordnet die Einheiten der aktuellen Wahl denen der Vergleichswahl zu.
 * Erst über den normalisierten Namen, dann über die Wahlbezirksnummer
 * innerhalb derselben Art (Urne/Brief). Was übrig bleibt, ist ein Bezirk
 * ohne Vorwert – neu zugeschnitten oder neu eingerichtet.
 */
export const ordneZu = <
	T extends { name: string; briefwahl: boolean },
	V extends { name: string; stimmen: Map<string, number> },
>(
	aktuell: T[],
	vorher: V[],
): { treffer: Map<T, Map<string, number>>; uebrig: V[] } => {
	const offen = vorher.map((v) => ({
		eintrag: v,
		brief: istBriefwahl(v.name),
		norm: normName(v.name),
		nr: bezirksNummer(v.name),
		vergeben: false,
	}));
	const treffer = new Map<T, Map<string, number>>();
	for (const a of aktuell) {
		const n = normName(a.name);
		const v = offen.find((o) => !o.vergeben && o.norm === n);
		if (v) {
			v.vergeben = true;
			treffer.set(a, v.eintrag.stimmen);
		}
	}
	for (const a of aktuell) {
		if (treffer.has(a)) continue;
		const nr = bezirksNummer(a.name);
		if (!nr) continue;
		const v = offen.find(
			(o) => !o.vergeben && o.nr === nr && o.brief === a.briefwahl,
		);
		if (v) {
			v.vergeben = true;
			treffer.set(a, v.eintrag.stimmen);
		}
	}
	return {
		treffer,
		uebrig: offen.filter((o) => !o.vergeben).map((o) => o.eintrag),
	};
};

type Gruppe = {
	/** Vorwahl-Stimmen der ausgezählten Anteile, je Partei */
	basisVor: Map<string, number>;
	/** aktuelle Stimmen der ausgezählten Anteile, je Partei */
	basisJetzt: Map<string, number>;
	/** Vorwahl-Stimmen der fehlenden Anteile, je Partei */
	fehlendVor: Map<string, number>;
	/** fehlende Anteile ohne Vorwert, in Einheiten gezählt */
	fehlendOhneVorwert: number;
	/** Einheiten mit Vorwert (für die Mittelgröße) */
	mitVorwert: number;
	/** Vorwahl-Stimmen aller Einheiten mit Vorwert */
	vorGesamt: number;
};

const leereGruppe = (): Gruppe => ({
	basisVor: new Map(),
	basisJetzt: new Map(),
	fehlendVor: new Map(),
	fehlendOhneVorwert: 0,
	mitVorwert: 0,
	vorGesamt: 0,
});

/**
 * Veränderungsfaktoren je Partei: Wie hat sich ihr *Anteil* in den
 * ausgezählten Einheiten gegenüber der Vorwahl verändert?
 *
 * Multiplikativ auf Anteilen und nicht additiv in Prozentpunkten: Eine Partei
 * kann so nicht unter null fallen, und ein Zuwachs bleibt dort groß, wo sie
 * schon stark war. Der Preis ist, dass eine sehr kleine Partei mit einem
 * hohen Faktor (1 % → 2 %) auch in den fehlenden Bezirken verdoppelt wird;
 * der Faktor wird deshalb gedeckelt (siehe FAKTOR_MAX).
 */
const FAKTOR_MAX = 4;

/**
 * Was für eine Partei aus dem ausgezählten Teil ableitbar ist: entweder ein
 * Veränderungsfaktor gegenüber ihrem eigenen Vorwert – oder, wenn sie 2021
 * nicht angetreten ist, nur ihr Anteil im ausgezählten Teil.
 */
type Veraenderung =
	| { art: "faktor"; wert: number }
	| { art: "neu"; anteil: number };

const faktoren = (g: Gruppe): Map<string, Veraenderung> | undefined => {
	const vor = summe(g.basisVor);
	const jetzt = summe(g.basisJetzt);
	if (vor <= 0 || jetzt <= 0) return undefined;
	const f = new Map<string, Veraenderung>();
	const keys = new Set([...g.basisVor.keys(), ...g.basisJetzt.keys()]);
	for (const k of keys) {
		const a = (g.basisVor.get(k) ?? 0) / vor;
		const b = (g.basisJetzt.get(k) ?? 0) / jetzt;
		f.set(
			k,
			a > 0
				? { art: "faktor", wert: Math.min(FAKTOR_MAX, b / a) }
				: { art: "neu", anteil: b },
		);
	}
	return f;
};

/**
 * Wie viel der ausgezählten Stimmen muss auf Parteien entfallen, die es bei
 * der Vergleichswahl schon gab, damit fortschreiben überhaupt sinnvoll ist?
 *
 * Der Fall, den das abfängt: Als Vergleichswahl wird eine gefunden, deren
 * Parteien gar nicht zu denen der aktuellen passen – etwa eine Landratswahl
 * (dort stehen Personen, keine Listen). Dann hat jede Partei den Status „neu“,
 * die Rechnung schreibt nur noch den Zwischenstand fort und wäre trotzdem als
 * Hochrechnung beschriftet. Ehrlicher ist, sie fallen zu lassen.
 */
const MINDEST_VERGLEICHBARKEIT = 0.5;

/**
 * Ab wann darf überhaupt eine Sitzverteilung gezeigt werden?
 *
 * Nachgerechnet an den echten Wahlbezirksergebnissen der Kommunalwahl 2021 in
 * Nordstemmen (23 Wahlbezirke, 15 Urnen- und 8 Briefwahlbezirke), über 32
 * durchgespielte Auszählverläufe (Dörfer zuerst, große Bezirke zuerst,
 * zufällig, Briefwahl zuletzt bzw. gemischt). Verglichen wurde jeweils mit dem
 * bekannten Endergebnis; „Sitze falsch“ meint die Zahl der Sitze, die in einem
 * 30er-Rat anders vergeben worden wären:
 *
 *   ausgezählt   Zwischenstand roh          Hochrechnung
 *                Ø / schlimmster Fall       Ø / schlimmster Fall
 *    1 von 23    5,7 / 40,5 PP, 12 Sitze    2,0 / 13,6 PP,  5 Sitze
 *    2 von 23    3,9 / 20,4 PP,  8 Sitze    1,5 /  7,1 PP,  3 Sitze
 *    3 von 23    3,1 / 13,9 PP,  5 Sitze    1,2 /  5,6 PP,  3 Sitze
 *    4 von 23    2,6 / 12,6 PP,  4 Sitze    1,1 /  4,1 PP,  2 Sitze
 *    5 von 23    2,3 / 11,9 PP,  4 Sitze    0,9 /  3,5 PP,  2 Sitze
 *    7 von 23    2,0 /  9,7 PP,  4 Sitze    0,8 /  3,0 PP,  2 Sitze
 *   12 von 23    1,1 /  5,9 PP,  2 Sitze    0,4 /  1,7 PP,  1 Sitz
 *
 * Bei einer einzigen Schnellmeldung liegt der rohe Zwischenstand im
 * schlimmsten Fall um 40 Prozentpunkte daneben – eine Sitzverteilung daraus
 * ist eine Zufallszahl mit amtlichem Anstrich. Von der vierten, fünften
 * Meldung an bricht der schlimmste Fall deutlich ein und läuft danach flach
 * aus; das ist der Punkt, an dem die Anzeige vertretbar wird. Ein Fünftel der
 * erwarteten Meldungen trifft diesen Punkt bei 23 Bezirken (5 von 23 = 22 %)
 * und skaliert für größere Wahlen mit.
 *
 * Dazu ein absoluter Boden von fünf Meldungen: Bei der Kreistagswahl wären ein
 * Fünftel von 426 Bezirken 86 Meldungen – da bindet der Boden nie. Bei einem
 * Ortsrat mit drei Wahlbezirken wären es dagegen rechnerisch eine einzige, und
 * genau dort ist jede Fortschreibung sinnlos. Hat eine Wahl weniger als fünf
 * Wahlbezirke, verlangt die Schwelle sie alle – dann erscheint die
 * Sitzverteilung erst zum Schluss. Das ist gewollt und wird auf der Seite auch
 * so gesagt, damit es nicht wie ein Fehler aussieht.
 */
export const MINDEST_ANTEIL = 0.2;
export const MINDEST_MELDUNGEN = 5;

/** Wie viele Schnellmeldungen es braucht, bevor Sitze gezeigt werden. */
export const schwelle = (erwartet: number): number =>
	erwartet <= 0
		? 0
		: Math.min(
				erwartet,
				Math.max(MINDEST_MELDUNGEN, Math.ceil(erwartet * MINDEST_ANTEIL)),
			);

/**
 * Wie belastbar die angezeigte Hochrechnung ist. Eine glatte Zahl ohne diese
 * Angabe liest sich wie ein Ergebnis; drei Stufen sagen in einem Wort, wie
 * weit sie sich noch bewegen kann.
 */
export type Unsicherheit = "hoch" | "mittel" | "niedrig";

/**
 * Die Grenzen, gemessen statt geraten.
 *
 * Prüfanordnung wie bei `MINDEST_ANTEIL`, nur feiner: die echten
 * Wahlbezirksergebnisse der Kommunalwahl 2021 in Nordstemmen (23 Bezirke),
 * beide Richtungen des Paars Gemeindewahl/Kreiswahl, 802 durchgespielte
 * Auszählverläufe je Richtung (Dörfer zuerst, große Bezirke zuerst, zufällig,
 * Briefwahl zuletzt bzw. gemischt) – 1604 Vergleiche je Auszählstand. „Schlimmster
 * Fall“ ist die größte Abweichung, die eine einzelne Partei in Prozentpunkten
 * hatte, einmal als 99. Perzentil und einmal als Maximum über alle Läufe;
 * „Sitze falsch“ sind die Sitze, die in einem 30er-Rat anders vergeben worden
 * wären. Nachrechnen lässt sich das mit `test/hochrechnung.test.ts`.
 *
 * Diese Zahlen sind bewusst größer als die in der Tabelle bei
 * `MINDEST_ANTEIL` und nicht mit ihnen vergleichbar: Dort steht der über alle
 * Parteien gemittelte Fehler, hier der der schlechtesten einzelnen Partei –
 * und die entscheidet über den Sitz.
 *
 *   ausgezählt        schlimmster Fall je Partei   Sitze falsch
 *                     p99 / Maximum                p99 / Maximum
 *    5 von 23 (0,22)   5,3 /  6,6 PP                2 / 4
 *    7 von 23 (0,30)   4,0 /  6,1 PP                2 / 3
 *    8 von 23 (0,35)   3,5 /  4,4 PP                2 / 3
 *    9 von 23 (0,39)   3,1 /  3,8 PP                2 / 2   ← Stufe
 *   11 von 23 (0,48)   2,7 /  3,9 PP                2 / 2
 *   14 von 23 (0,61)   2,0 /  3,3 PP                1 / 2
 *   15 von 23 (0,65)   1,8 /  2,3 PP                1 / 2
 *   16 von 23 (0,70)   1,7 /  2,4 PP                1 / 1   ← Stufe
 *   20 von 23 (0,87)   0,9 /  1,5 PP                1 / 1
 *
 * Die Reihe fällt nicht gleichmäßig, sondern in zwei Stufen, und genau dort
 * liegen die Grenzen:
 *
 * - Zwischen 8 und 9 von 23 (0,35 → 0,39) hört der Fall auf, in dem drei von
 *   30 Sitzen falsch vergeben sind. `MITTEL_AB` trifft diese Lücke in der
 *   Mitte.
 * - Zwischen 15 und 16 von 23 (0,65 → 0,70) wechselt schlimmstenfalls nur noch
 *   ein einziger Sitz, und keine Partei liegt mehr als 2,4 Prozentpunkte
 *   daneben. Ab da ist das Bild gesetzt; `NIEDRIG_AB` trifft auch diese Lücke
 *   in der Mitte.
 *
 * Als zweite Wahl gegengerechnet: die Bürgermeisterwahl 2020 in Nordstemmen
 * (18 Wahlbezirke, Hauptwahl gegen Stichwahl, ebenfalls beide Richtungen und
 * 1604 Läufe je Stand). Sie ist der härtere Fall, weil sich zwischen den
 * beiden Wahlgängen das ganze Feld neu sortiert – genau die Annahme, von der
 * die Hochrechnung lebt. Dort liegt die erste Stufe früher (zwischen 5 und 6
 * von 18, also 0,28 → 0,33), die Prozentpunkte fallen dafür langsamer
 * (2,7 PP erst bei 0,67). Die Stufen sind also keine Eigenart eines einzelnen
 * Wahlpaars; wo sie genau liegen, hängt aber an der Wahl. Maßgeblich ist die
 * strengere Reihe, und das ist die von 2021 – und sie ist auch die
 * einschlägige: Eine Sitzverteilung wird nur bei Verhältniswahlen gezeigt,
 * eine Bürgermeisterwahl bekommt nie eine.
 *
 * Bewusst Anteile und keine absoluten Zahlen: Der Landkreis zählt 426
 * Wahlbezirke aus, eine Gemeinde 23 – „ab 9 Meldungen“ wäre bei der einen
 * Wahl streng und bei der anderen sinnlos. Als Anteil gerechnet lassen sich
 * die Reihen von 2021 (23 Bezirke) und 2020 (18 Bezirke) überhaupt erst
 * nebeneinanderlegen.
 *
 * Gemessen und wieder verworfen: die Abdeckung nach Stimmengewicht
 * (`Hochrechnung.abdeckung`) und die „Schiefe“ der schon gemeldeten Gebiete
 * (wie anders sie bei der Vergleichswahl gewählt haben als das Gesamtgebiet).
 * Die Abdeckung sagt die Genauigkeit exakt so gut voraus wie der bloße
 * Auszählstand (Rangkorrelation −0,825 gegen −0,824) – ein Gewinn, der keiner
 * ist. Die Schiefe trennt innerhalb eines Auszählstands gar nichts (−0,03 bis
 * +0,05 in den unteren beiden Bändern); die schiefen und die ausgewogenen
 * Verläufe haben dort denselben schlimmsten Fall. Beides wäre erklärungs-
 * bedürftig gewesen, ohne die Einstufung zu verbessern.
 */
export const MITTEL_AB = 0.37;
export const NIEDRIG_AB = 0.67;

/**
 * Einstufung der Unsicherheit.
 *
 * Bei der bloßen Fortschreibung – keine brauchbaren Vergleichsdaten, der
 * Zwischenstand wird ungewichtet hochgerechnet – ist sie immer hoch, egal wie
 * weit gezählt ist. Dieselbe Messreihe sagt für die Fortschreibung: bei 5 von
 * 23 schlimmstenfalls 21 Prozentpunkte und 6 falsche Sitze, bei 12 von 23 noch
 * 9 Prozentpunkte und 4 Sitze, bei 20 von 23 immer noch 2 Sitze. Das ist über
 * den ganzen Abend eine andere Größenordnung als die echte Hochrechnung, und
 * der Fehler ist dabei nicht zufällig, sondern gerichtet: Es fehlen die
 * Bezirke, die zuletzt melden – die großen und die Briefwahl.
 */
export const unsicherheit = (
	anz: number,
	erwartet: number,
	fortschreibung: boolean,
): Unsicherheit => {
	if (fortschreibung || erwartet <= 0) return "hoch";
	const anteil = anz / erwartet;
	if (anteil >= NIEDRIG_AB) return "niedrig";
	return anteil >= MITTEL_AB ? "mittel" : "hoch";
};

/**
 * Rechnet aus ausgezählten Einheiten und ihren Vorwerten das Gesamtergebnis
 * hoch. Gibt `undefined` zurück, wenn die Datengrundlage nicht trägt – dann
 * ist der rohe Zwischenstand der ehrlichere Rückfall.
 */
export const rechneHoch = (einheiten: Einheit[]): Hochrechnung | undefined => {
	const gruppen: Record<"urne" | "brief", Gruppe> = {
		urne: leereGruppe(),
		brief: leereGruppe(),
	};
	// Tatsächlich ausgezählte Stimmen – die stehen fest und werden nicht geschätzt.
	const gezaehlt = new Map<string, number>();
	for (const e of einheiten) {
		const g = gruppen[e.briefwahl ? "brief" : "urne"];
		addiere(gezaehlt, e.stimmen);
		const anteil = Math.min(1, Math.max(0, e.anteil));
		if (!e.vorwert || summe(e.vorwert) <= 0) {
			// Bezirk ohne Vorwert (Gebietsänderung, neuer Wahlbezirk): Er kann zur
			// Schätzung der Veränderung nichts beitragen, seine ausgezählten
			// Stimmen zählen aber mit. Für den fehlenden Teil wird er später mit
			// der mittleren Bezirksgröße seiner Gruppe angesetzt.
			g.fehlendOhneVorwert += 1 - anteil;
			continue;
		}
		g.mitVorwert += 1;
		g.vorGesamt += summe(e.vorwert);
		addiere(g.basisVor, e.vorwert, anteil);
		addiere(g.fehlendVor, e.vorwert, 1 - anteil);
		if (anteil > 0) addiere(g.basisJetzt, e.stimmen);
	}

	const vorGesamt = gruppen.urne.vorGesamt + gruppen.brief.vorGesamt;
	const basisVor = summe(gruppen.urne.basisVor) + summe(gruppen.brief.basisVor);
	if (vorGesamt <= 0) return undefined;
	const abdeckung = basisVor / vorGesamt;

	const fUrne = faktoren(gruppen.urne);
	const fBrief = faktoren(gruppen.brief);
	// Ohne eine einzige ausgezählte Einheit mit Vorwert gibt es nichts
	// fortzuschreiben.
	if (!fUrne && !fBrief) return undefined;

	// Passt die Vergleichswahl inhaltlich? Gemessen daran, wie viel der schon
	// ausgezählten Stimmen auf Parteien entfällt, die es damals auch gab.
	const jetztGesamt =
		summe(gruppen.urne.basisJetzt) + summe(gruppen.brief.basisJetzt);
	let bekannt = 0;
	for (const art of ["urne", "brief"] as const)
		for (const [k, v] of gruppen[art].basisJetzt)
			if (
				(gruppen.urne.basisVor.get(k) ?? 0) +
					(gruppen.brief.basisVor.get(k) ?? 0) +
					(gruppen.urne.fehlendVor.get(k) ?? 0) +
					(gruppen.brief.fehlendVor.get(k) ?? 0) >
				0
			)
				bekannt += v;
	if (jetztGesamt <= 0 || bekannt / jetztGesamt < MINDEST_VERGLEICHBARKEIT)
		return undefined;

	const stimmen = new Map(gezaehlt);
	for (const art of ["urne", "brief"] as const) {
		const g = gruppen[art];
		const eigen = art === "urne" ? fUrne : fBrief;
		// Liegt für die Briefwahl noch nichts vor, wird die Veränderung der
		// Urnenbezirke übernommen – aber auf das *eigene* Vorwahl-Profil der
		// Briefwahlbezirke angewandt. Ihr Sonderprofil (mehr CDU, mehr GRÜNE)
		// bleibt so erhalten, nur die Veränderung wird geliehen.
		const f = eigen ?? (art === "urne" ? fBrief : fUrne);
		if (!f) continue;
		const vor = summe(g.basisVor);
		const jetzt = summe(g.basisJetzt);
		const fremd = art === "urne" ? gruppen.brief : gruppen.urne;
		// Wahlbeteiligungsfaktor: Wie viele Stimmen kommen heute dort heraus, wo
		// die Vorwahl eine bekannte Zahl brachte?
		const beteiligung =
			vor > 0 && jetzt > 0
				? jetzt / vor
				: summe(fremd.basisVor) > 0
					? summe(fremd.basisJetzt) / summe(fremd.basisVor)
					: 1;
		const mittel = g.mitVorwert > 0 ? g.vorGesamt / g.mitVorwert : 0;
		const fehlendVorSumme = summe(g.fehlendVor) + g.fehlendOhneVorwert * mittel;
		if (fehlendVorSumme <= 0) continue;
		// Rohgewichte je Partei; anschließend auf die erwartete Stimmenzahl der
		// fehlenden Bezirke normiert, damit weder Deckelung noch Ersatzwerte für
		// neue Parteien die Summe sprengen.
		const roh = new Map<string, number>();
		for (const [k, v] of f) {
			// Mit Vorwert: die Vorwahl-Stimmen dieser Partei in den fehlenden
			// Bezirken, mal ihrem Veränderungsfaktor. Ohne Vorwert (neue Partei):
			// ihr Anteil aus dem ausgezählten Teil, angewandt auf die gesamte
			// Stimmenmasse der fehlenden Bezirke. Anschließend wird normiert –
			// eine neue Partei kann die Summe deshalb nicht sprengen.
			const gewicht =
				v.art === "faktor"
					? (g.fehlendVor.get(k) ?? 0) * v.wert
					: fehlendVorSumme * v.anteil;
			if (gewicht > 0) roh.set(k, gewicht);
		}
		// Bezirke ohne Vorwert bringen zusätzliche Masse, aber kein eigenes
		// Profil – sie bekommen das Profil ihrer Gruppe.
		const rohSumme = summe(roh);
		if (rohSumme <= 0) continue;
		const erwartet = fehlendVorSumme * beteiligung;
		for (const [k, w] of roh)
			stimmen.set(k, (stimmen.get(k) ?? 0) + (w / rohSumme) * erwartet);
	}

	return {
		stimmen,
		abdeckung,
		basis: gruppen.urne.mitVorwert + gruppen.brief.mitVorwert,
		briefwahlGetrennt: Boolean(fUrne && fBrief),
	};
};
