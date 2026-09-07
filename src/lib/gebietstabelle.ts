/**
 * Die Kopfzeile der Gebietstabellen („Ergebnisse nach Gebiet“).
 *
 * Die Wahlpräsentation führt je Wahl-Id genau eine Übersichtstabelle – auch
 * dann, wenn unter dieser Id mehrere Wahlgebiete stecken. In Nordstemmen
 * hängen alle neun Ortsratswahlen an derselben Wahl-Id; die Kopfzeile nennt
 * deshalb die vier stärksten Listen der ganzen Gemeinde. Auf der Seite einer
 * einzelnen Ortschaft standen so Listen, die dort nie angetreten sind, und die
 * einzige eigene Liste rutschte in „Sonstige“ – in Adlum 2021 vier leere
 * Spalten und darunter „Sonstige 100,0 %“, während dieselbe Liste in der
 * Sitzverteilung darüber mit 100 % stand.
 *
 * Deshalb entstehen Kopfzeile und Werte hier neu: die Spalten aus den
 * Wahlvorschlägen der angezeigten Wahl, nach deren Stärke sortiert, die Zahlen
 * aus dem Ergebnis des jeweiligen Gebiets. Aus der Quelle bleibt, wie viele
 * Spalten es sind – das ist die Entscheidung der Wahlleitung über die Breite
 * der Tabelle, und sie ist gut: fünf Bewerber einer Direktwahl stehen dort
 * alle, vier Listen einer Verhältniswahl plus „Sonstige“.
 */
import {
	type Ergebnis,
	type Partei,
	type Uebersicht,
	type UebersichtZeile,
	parteiKey,
} from "./votemanager.ts";

/** Die Restspalte der Wahlpräsentation. */
const SONSTIGE = /^sonstige/i;

/**
 * Spalte, die keine Liste meint: Vor die Bewerber einer Personenwahl stellt
 * die Quelle die Zahl der gültigen Stimmen. Sie zählt nicht als Listenplatz
 * und bleibt unverändert stehen.
 */
const KENNZAHL = /^gültig/i;

const runde = (n: number): number => Math.round(n * 100) / 100;

/** Wahlvorschläge absteigend nach Anteil; bei Gleichstand nach Stimmen. */
export const nachStaerke = (parteien: Partei[]): Partei[] =>
	[...parteien].sort((a, b) => b.prozent - a.prozent || b.stimmen - a.stimmen);

const zeileMitSpalten = (
	zeile: UebersichtZeile,
	spalten: Array<{ kurz: string }>,
	gezeigt: Set<string>,
	ergebnis: Ergebnis | undefined,
): UebersichtZeile => {
	const ausQuelle = new Map(zeile.werte.map((w) => [w.kurz, w]));
	// Ohne eigenes Gebietsergebnis bleibt nur die Zeile der Quelle: Was zu einer
	// Spalte passt, wird übernommen, der Rest bleibt leer. Das kommt am
	// Wahlabend vor, wenn der Poller die Übersicht schon hat, das Ergebnis des
	// Gebiets aber noch nicht – und vor der Auszählung, wo beides leer ist.
	if (!ergebnis || ergebnis.parteien.length === 0)
		return {
			...zeile,
			werte: spalten.map((s) => ausQuelle.get(s.kurz) ?? { kurz: s.kurz }),
		};
	const nachKey = new Map(ergebnis.parteien.map((p) => [p.key, p]));
	const rest = ergebnis.parteien.filter((p) => !gezeigt.has(p.key));
	return {
		...zeile,
		werte: spalten.map((s) => {
			if (SONSTIGE.test(s.kurz))
				return {
					kurz: s.kurz,
					absolut: rest.reduce((a, p) => a + p.stimmen, 0),
					// Die Prozentwerte der Quelle sind bereits gerundet; die Summe
					// darf nicht mehr Genauigkeit vortäuschen, als in ihr steckt.
					prozent: runde(rest.reduce((a, p) => a + p.prozent, 0)),
				};
			const p = nachKey.get(parteiKey(s.kurz));
			if (p) return { kurz: s.kurz, absolut: p.stimmen, prozent: p.prozent };
			// Kennzahlenspalte („gültig“): steht nur in der Übersicht, nicht im
			// Ergebnis. Ebenso eine Liste, die in diesem Gebiet nicht antrat –
			// dort ist in der Quelle ohnehin nichts eingetragen.
			return ausQuelle.get(s.kurz) ?? { kurz: s.kurz };
		}),
	};
};

/**
 * Eine Übersichtstabelle auf die angezeigte Wahl umstellen.
 *
 * `parteien` sind die Wahlvorschläge des angezeigten Wahlgebiets (das
 * Gesamtergebnis der Wahl, nicht das des gerade betrachteten Untergebiets –
 * sonst wechselten die Spalten von Seite zu Seite). `ergebnisFuer` liefert das
 * Ergebnis zu einer Zeile; welche Gebiets-Id dahintersteckt, weiß nur die
 * aufrufende Seite (bei kreisweiten Wahlen verlinken die Gemeindezeilen auf
 * fremde Präsentationen und tragen gar keine Id).
 *
 * Lässt sich nichts Besseres sagen – keine Wahlvorschläge bekannt oder die
 * Quelle zeigt gar keine Listenspalte –, bleibt die Tabelle, wie sie war.
 */
export const gebietstabelle = (
	uebersicht: Uebersicht,
	parteien: Partei[],
	ergebnisFuer: (zeile: UebersichtZeile) => Ergebnis | undefined,
): Uebersicht => {
	const eigene = new Set(parteien.map((p) => p.key));
	const kennzahlen = uebersicht.spalten.filter(
		(s) => KENNZAHL.test(s.kurz) && !eigene.has(parteiKey(s.kurz)),
	);
	const hatSonstige = uebersicht.spalten.some((s) => SONSTIGE.test(s.kurz));
	const plaetze =
		uebersicht.spalten.length - kennzahlen.length - (hatSonstige ? 1 : 0);
	if (plaetze < 1 || parteien.length === 0) return uebersicht;
	const gezeigt = nachStaerke(parteien).slice(0, plaetze);
	const spalten = [
		...kennzahlen,
		...gezeigt.map((p) => ({ kurz: p.kurz, lang: p.lang })),
		// „Sonstige“ nur, wenn wirklich etwas übrig bleibt: Wo drei Listen
		// antraten, gehören keine vier Spalten und keine Restspalte hin.
		...(parteien.length > gezeigt.length ? [{ kurz: "Sonstige" }] : []),
	];
	const gezeigteKeys = new Set(gezeigt.map((p) => p.key));
	return {
		...uebersicht,
		spalten,
		zeilen: uebersicht.zeilen.map((z) =>
			zeileMitSpalten(z, spalten, gezeigteKeys, ergebnisFuer(z)),
		),
	};
};
