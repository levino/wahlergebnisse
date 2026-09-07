/**
 * Ein Anfragenkonto je Host.
 *
 * Die Last fällt nicht je Kreis an, sondern je Server. 372 abfragbare
 * Behörden verteilen sich auf vier Hosts, und einer davon trägt fast alles:
 *
 *   votemanager.kdo.de      351 Behörden in 37 Kreisen  (CDN davor)
 *   wahlen.kreis-hi.de       19 Behörden in  1 Kreis    (Apache, kein CDN)
 *   wahlen.hann.muenden.de    1 Behörde
 *   www.nordenham.de          1 Behörde
 *
 * Ein Deckel je Kreis wäre deshalb das falsche Maß: Er würde den kleinen
 * Apache genauso behandeln wie das CDN, das die anderen 37 Kreise ausliefert.
 * Wer die Server schonen will, muss dort deckeln, wo die Last ankommt.
 *
 * Umgesetzt als klassisches Eimer-Verfahren: Jeder Host hat ein Konto, das
 * sich mit `proSekunde` Marken je Sekunde füllt und höchstens `spitze` Marken
 * fasst. Jede Anfrage nimmt eine Marke; ist keine da, wartet sie, bis wieder
 * eine nachgelaufen ist. Der Vorrat lässt einen Lauf zügig anfangen, der
 * Nachlauf hält den Durchschnitt.
 *
 * Wichtig fürs Verständnis: Das ist kein zusätzlicher Bremsklotz, sondern
 * der Ersatz für die frühere Vorsicht. Weil die Grenze hier steht, darf der
 * Takt (src/lib/takt.ts) eng sein – ein Rückstand macht den Poller langsamer,
 * nicht den fremden Server.
 */

export type Grenze = {
	/** Marken je Sekunde – der Durchschnitt, den der Host auf Dauer sieht. */
	proSekunde: number;
	/** Wie viele Marken sich höchstens ansammeln (Vorrat für den Anlauf). */
	spitze: number;
};

/**
 * Was ein Host aushält.
 *
 * `votemanager.kdo.de` liegt hinter einem CDN und liefert die Präsentation
 * von 37 Kreisen aus; die Abfragen sind bedingt (If-None-Match) und
 * überwiegend 304 ohne Rumpf, also Randbedienung ohne Ursprungsabfrage.
 * 60 Anfragen je Sekunde sind dort weniger als das, was ein einziger
 * Wahlabend an Besuchern erzeugt.
 *
 * Alles ohne CDN bekommt die Vorgabe von 10 je Sekunde. Das gilt vor allem
 * für `wahlen.kreis-hi.de`, einen nackten Apache mit 19 Behörden: 19 × 18
 * Anfragen ergeben einen vollen Durchgang in gut einer halben Minute – ein
 * Bruchteil dessen, was die amtliche Präsentation selbst an dem Abend an
 * Zugriffen sieht.
 */
export const STANDARD_GRENZEN: Record<string, Grenze> = {
	"votemanager.kdo.de": { proSekunde: 60, spitze: 120 },
};

export const STANDARD_GRENZE: Grenze = { proSekunde: 10, spitze: 20 };

/**
 * Der eigene Rechner ist kein fremder Server. Tests und Vorschau-Umgebungen
 * fragen einen Mock auf 127.0.0.1 ab; dort etwas zu schonen, würde nur die
 * Prüfungen verlangsamen. Wer die Bremse trotzdem messen will, nennt den Host
 * ausdrücklich in den Grenzen – dann gilt sie auch hier.
 */
const istLokal = (host: string): boolean =>
	/^(127\.\d+\.\d+\.\d+|localhost|\[::1\])(:\d+)?$/.test(host);

export type Drossel = {
	/** Wartet, bis für diesen Host eine Marke frei ist. */
	nimm: (host: string) => Promise<void>;
	/** Wie viele Marken jetzt frei sind (für Tests). */
	frei: (host: string) => number;
};

type Konto = { marken: number; stand: number; grenze: Grenze };

/**
 * Baut ein Konto je Host.
 *
 * `jetzt` und `warte` sind einsetzbar, damit sich ein Wahlabend im Test in
 * Millisekunden durchspielen lässt, statt ihn abzuwarten.
 */
export const hostDrossel = (
	opts: {
		grenzen?: Record<string, Grenze>;
		standard?: Grenze;
		jetzt?: () => number;
		warte?: (ms: number) => Promise<void>;
	} = {},
): Drossel => {
	const grenzen = opts.grenzen ?? STANDARD_GRENZEN;
	const standard = opts.standard ?? STANDARD_GRENZE;
	const jetzt = opts.jetzt ?? (() => Date.now());
	const warte =
		opts.warte ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
	const konten = new Map<string, Konto>();

	const konto = (host: string): Konto => {
		let k = konten.get(host);
		if (!k) {
			const grenze = grenzen[host] ?? standard;
			k = { marken: grenze.spitze, stand: jetzt(), grenze };
			konten.set(host, k);
		}
		const now = jetzt();
		k.marken = Math.min(
			k.grenze.spitze,
			k.marken + ((now - k.stand) / 1000) * k.grenze.proSekunde,
		);
		k.stand = now;
		return k;
	};

	const unbegrenzt = (host: string) => istLokal(host) && !grenzen[host];

	return {
		frei: (host) =>
			unbegrenzt(host) ? Number.POSITIVE_INFINITY : konto(host).marken,
		nimm: async (host) => {
			if (unbegrenzt(host)) return;
			// Schleife statt einmaligem Warten: Zwischen dem Ausrechnen der
			// Wartezeit und dem Aufwachen können andere Anfragen dieselbe Marke
			// genommen haben. Wer zu spät kommt, wartet noch einmal.
			for (;;) {
				const k = konto(host);
				if (k.marken >= 1) {
					k.marken -= 1;
					return;
				}
				const fehlt = 1 - k.marken;
				await warte(
					Math.max(1, Math.ceil((fehlt / k.grenze.proSekunde) * 1000)),
				);
			}
		},
	};
};

/**
 * Grenzen aus der Umgebung lesen: `POLL_HOST_GRENZEN` als
 * `host=proSekunde[:spitze]`, mit Komma getrennt. Ohne Angabe gelten die
 * Standardwerte oben. Gedacht für den Fall, dass ein Betreiber sich meldet
 * und eine Zahl nennt – dann soll niemand dafür ein Image bauen müssen.
 */
export const grenzenAusUmgebung = (
	wert: string | undefined,
): Record<string, Grenze> => {
	if (!wert?.trim()) return STANDARD_GRENZEN;
	const grenzen: Record<string, Grenze> = { ...STANDARD_GRENZEN };
	for (const teil of wert.split(",")) {
		const [host, zahlen] = teil.split("=").map((s) => s.trim());
		if (!host || !zahlen) continue;
		const [proSekunde, spitze] = zahlen.split(":").map(Number);
		if (!Number.isFinite(proSekunde) || proSekunde <= 0) continue;
		grenzen[host] = {
			proSekunde,
			spitze:
				Number.isFinite(spitze) && spitze > 0
					? spitze
					: Math.max(1, proSekunde * 2),
		};
	}
	return grenzen;
};
