/**
 * Die Stimmenwahl – ohne Browser prüfbar.
 *
 * Genau dafür ist `waehleStimme` eine reine Funktion über einer Liste: Welche
 * Stimme am Wahlabend spricht, entscheidet sich hier und nicht in einem
 * Skript, das man nur auf dem Beamer ausprobieren kann.
 */
import { describe, expect, it } from "vitest";
import {
	type StimmenAngabe,
	deutscheStimmen,
	guete,
	klang,
	waehleStimme,
} from "./stimme.ts";

const stimme = (
	name: string,
	lang = "de-DE",
	localService = true,
): StimmenAngabe => ({ name, lang, voiceURI: name, localService });

/** Was ein Mac ohne nachgeladene Stimme in Safari anbietet. */
const MAC_KOMPAKT = [
	stimme("Anna (Kompakt)"),
	stimme("Zarvox"),
	stimme("Samantha", "en-US"),
];

/** Derselbe Mac, nachdem jemand die Premium-Fassung geladen hat. */
const MAC_PREMIUM = [
	stimme("Anna (Kompakt)"),
	stimme("Anna (Premium)"),
	stimme("Petra (Erweitert)"),
	stimme("Google Deutsch", "de-DE", false),
	stimme("Samantha", "en-US"),
];

describe("waehleStimme", () => {
	it("gibt nichts zurück, solange die Liste leer ist", () => {
		// Chrome füllt `getVoices()` erst nach `voiceschanged`. Der Aufrufer
		// muss diesen Fall kennen – hier ist er ausdrücklich `undefined` und
		// nicht etwa „irgendeine".
		expect(waehleStimme([])).toBeUndefined();
	});

	it("schweigt lieber, als eine englische Stimme Deutsch lesen zu lassen", () => {
		// Ohne deutsche Stimme kommt nichts zurück; `sprich` sagt dann gar
		// nichts. Eine englische Stimme, die „Ortsratswahl Rössing" vorliest,
		// wäre im Saal schlimmer als Stille.
		expect(
			waehleStimme([stimme("Samantha", "en-US"), stimme("Daniel", "en-GB")]),
		).toBeUndefined();
	});

	it("nimmt eSpeak, wenn es sonst nichts gibt", () => {
		// Auf Linux/Chrome ist eSpeak die einzige deutsche Stimme. Sie klingt
		// nach 1985, ist aber verständlich – und damit besser als Schweigen.
		const nur = [stimme("espeak-ng German", "de")];
		expect(waehleStimme(nur)?.name).toBe("espeak-ng German");
		expect(guete(nur[0])).toBe("roboter");
	});

	it("nimmt niemals eSpeak, wenn eine andere deutsche Stimme da ist", () => {
		// Das war der alte Fehler: `localService` bevorzugt, und lokal ist auf
		// Linux eben eSpeak.
		const gewaehlt = waehleStimme([
			stimme("espeak-ng German", "de"),
			stimme("Google Deutsch", "de-DE", false),
		]);
		expect(gewaehlt?.name).toBe("Google Deutsch");
	});

	it("zieht die geladene Premium-Fassung allem anderen vor", () => {
		// Auf dem Mac am Beamer ist das der ganze Unterschied: dieselbe
		// Sprecherin, einmal als Sparfassung und einmal richtig.
		expect(waehleStimme(MAC_PREMIUM)?.name).toBe("Anna (Premium)");
	});

	it("stellt die Netzstimme vor die Kompaktfassung", () => {
		expect(
			waehleStimme([stimme("Anna (Kompakt)"), stimme("Google Deutsch")])?.name,
		).toBe("Google Deutsch");
	});

	it("lässt die Spaßstimmen von macOS unten", () => {
		// „Zarvox" ist eine deutsche Stimme im Sinne der Liste – und das
		// Letzte, was auf einer Leinwand von selbst anspringen soll.
		expect(waehleStimme(MAC_KOMPAKT)?.name).toBe("Anna (Kompakt)");
	});

	it("nimmt de-DE vor de-AT bei sonst gleichem Rang", () => {
		const gewaehlt = waehleStimme([
			stimme("Markus", "de-AT"),
			stimme("Martin", "de-DE"),
		]);
		expect(gewaehlt?.lang).toBe("de-DE");
	});

	it("folgt dem Wunsch des Nutzers gegen die Rangfolge", () => {
		// Wer im Saal durchgehört hat, weiß es besser als jede Punktzahl.
		expect(waehleStimme(MAC_PREMIUM, "Petra (Erweitert)")?.name).toBe(
			"Petra (Erweitert)",
		);
	});

	it("fällt auf die Rangfolge zurück, wenn es die gewünschte Stimme nicht gibt", () => {
		// Anderer Rechner, andere Stimmen: Dann soll es sprechen und nicht
		// schweigen.
		expect(waehleStimme(MAC_PREMIUM, "Microsoft Katja")?.name).toBe(
			"Anna (Premium)",
		);
	});

	it("entscheidet unabhängig von der Reihenfolge der Liste", () => {
		// Systeme melden ihre Stimmen in wechselnder Reihenfolge; die
		// Vorauswahl darf davon nicht abhängen.
		const rueckwaerts = [...MAC_PREMIUM].reverse();
		expect(waehleStimme(rueckwaerts)?.name).toBe(
			waehleStimme(MAC_PREMIUM)?.name,
		);
	});
});

describe("deutscheStimmen", () => {
	it("bietet nur deutsche an, beste zuerst", () => {
		expect(deutscheStimmen(MAC_PREMIUM).map((s) => s.name)).toEqual([
			"Anna (Premium)",
			"Petra (Erweitert)",
			"Google Deutsch",
			"Anna (Kompakt)",
		]);
	});

	it("lässt die Liste leer, wenn nichts Deutsches dabei ist", () => {
		expect(deutscheStimmen([stimme("Samantha", "en-US")])).toEqual([]);
	});
});

describe("guete", () => {
	it("erkennt, wann sich das Nachladen einer Stimme lohnt", () => {
		// Von dieser Einstufung hängt der Hinweis in der Bedienleiste ab.
		expect(guete(stimme("Anna (Premium)"))).toBe("premium");
		expect(guete(stimme("Petra (Erweitert)"))).toBe("premium");
		expect(guete(stimme("Google Deutsch"))).toBe("netz");
		expect(guete(stimme("Anna (Kompakt)"))).toBe("einfach");
		expect(guete(stimme("espeak-ng German", "de"))).toBe("roboter");
		expect(guete(undefined)).toBe("roboter");
	});
});

describe("klang", () => {
	it("gibt jeder Stimme das Tempo, das sie verträgt", () => {
		// Die Netzstimme spricht von Haus aus zügig, eSpeak wird erst langsam
		// verständlich.
		expect(klang(stimme("Anna (Premium)")).rate).toBeGreaterThan(
			klang(stimme("Google Deutsch")).rate,
		);
		expect(klang(stimme("espeak-ng German", "de")).rate).toBeLessThan(1);
		expect(klang(undefined).rate).toBeLessThan(1);
	});
});
