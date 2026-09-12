/**
 * Näherungsvergleich für die Bezeichnungen der Wahlleitungen.
 *
 * Jede Wahlleitung tippt ihre Titel selbst; „Orstratswahl“, „Orschaft“ und
 * „Bügermeisters“ stehen so im amtlichen Bestand. Eine Liste bekannter
 * Schreibweisen versagt beim nächsten Vertipper, deshalb wird hier auf einen
 * Vertipper Abstand verglichen statt auf Gleichheit.
 */

/** Damerau-Levenshtein-Abstand, oberhalb von `grenze` abgebrochen. */
export const abstand = (a: string, b: string, grenze = 99): number => {
	if (Math.abs(a.length - b.length) > grenze) return grenze + 1;
	let vorvor: number[] = [];
	let vor = Array.from({ length: b.length + 1 }, (_, j) => j);
	for (let i = 1; i <= a.length; i++) {
		const jetzt = [i];
		for (let j = 1; j <= b.length; j++) {
			const kosten = a[i - 1] === b[j - 1] ? 0 : 1;
			let wert = Math.min(vor[j] + 1, jetzt[j - 1] + 1, vor[j - 1] + kosten);
			if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
				wert = Math.min(wert, vorvor[j - 2] + 1);
			jetzt[j] = wert;
		}
		if (Math.min(...jetzt) > grenze) return grenze + 1;
		vorvor = vor;
		vor = jetzt;
	}
	return vor[b.length];
};

/** Steht `stamm` – bis auf `fehler` Vertipper – irgendwo in `text`? */
export const enthaeltStamm = (
	text: string,
	stamm: string,
	fehler = 1,
): boolean => {
	if (text.includes(stamm)) return true;
	if (stamm.length - fehler > text.length) return false;
	let vorvor: number[] = [];
	let vor = Array.from({ length: stamm.length + 1 }, (_, j) => j);
	for (let i = 1; i <= text.length; i++) {
		const jetzt = [0];
		for (let j = 1; j <= stamm.length; j++) {
			const kosten = text[i - 1] === stamm[j - 1] ? 0 : 1;
			let wert = Math.min(vor[j] + 1, jetzt[j - 1] + 1, vor[j - 1] + kosten);
			if (
				i > 1 &&
				j > 1 &&
				text[i - 1] === stamm[j - 2] &&
				text[i - 2] === stamm[j - 1]
			)
				wert = Math.min(wert, vorvor[j - 2] + 1);
			jetzt[j] = wert;
		}
		if (jetzt[stamm.length] <= fehler) return true;
		vorvor = vor;
		vor = jetzt;
	}
	return false;
};

const BUCHSTABEN = "abcdefghijklmnopqrstuvwxyzäöüß";

/**
 * Die Wörter, aus denen `wort` durch ein ausgelassenes, ein doppeltes oder
 * zwei vertauschte Zeichen entstanden sein kann. Ein *ersetztes* Zeichen bleibt
 * außen vor: sonst wird aus der Ortschaft „Oststadt“ eine „Ortstadt“.
 */
export function* tippfehlerVarianten(wort: string): Generator<string> {
	for (let i = 0; i < wort.length; i++)
		yield wort.slice(0, i) + wort.slice(i + 1);
	for (let i = 0; i + 1 < wort.length; i++)
		yield wort.slice(0, i) + wort[i + 1] + wort[i] + wort.slice(i + 2);
	for (let i = 0; i <= wort.length; i++)
		for (const c of BUCHSTABEN) yield wort.slice(0, i) + c + wort.slice(i);
}
