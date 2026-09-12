import { einteilungFuer } from "./wahlbereichseinteilung.ts";
import type {
	Amt,
	AmtEintrag,
	Kreisgliederung,
	Wahlgliederung,
	Wahlleitung,
} from "./wahlgliederung.ts";
import gliederung2021 from "./wahlgliederung/2021.json" with { type: "json" };
import gliederung2026 from "./wahlgliederung/2026.json" with { type: "json" };

/**
 * Die Wahlbereichszuordnung aus dem erzeugten Verzeichnis stammt aus den
 * Wahlraum-Übersichten. Führen die sie nicht, tritt die von Hand aus einer
 * amtlichen Veröffentlichung erhobene Einteilung an ihre Stelle – mit deren
 * eigenem Beleg. Was die Wahlleitung selbst führt, bleibt unangetastet.
 */
const mitEinteilung = (g: Wahlgliederung): Wahlgliederung => ({
	...g,
	kreise: g.kreise.map((k) => {
		if (k.wahlbereichszuordnung.stand === "belegt") return k;
		const erhoben = einteilungFuer(g.termin, k.slug);
		return erhoben ? { ...k, wahlbereichszuordnung: erhoben } : k;
	}),
});

const GLIEDERUNGEN: Record<string, Wahlgliederung> = {
	"2021": mitEinteilung(gliederung2021 as Wahlgliederung),
	"2026": mitEinteilung(gliederung2026 as Wahlgliederung),
};

export const TERMINE_MIT_GLIEDERUNG: string[] = Object.keys(GLIEDERUNGEN);

export const gliederungFuer = (termin: string): Wahlgliederung | undefined =>
	GLIEDERUNGEN[termin];

export const kreisgliederung = (
	termin: string,
	kreisSlug: string,
): Kreisgliederung | undefined =>
	gliederungFuer(termin)?.kreise.find((k) => k.slug === kreisSlug);

export const wahlleitungen = (termin: string): Wahlleitung[] =>
	gliederungFuer(termin)?.kreise.flatMap((k) => k.wahlleitungen) ?? [];

export const wahlleitungByAgs = (
	termin: string,
	ags: string,
): Wahlleitung | undefined => wahlleitungen(termin).find((w) => w.ags === ags);

/** Alle Ämter eines Termins als flache Liste – Grundlage der Gegenprobe. */
export const aemter = (
	termin: string,
): Array<{
	kreis: string;
	wahlleitung: Wahlleitung;
	amt: Amt;
	eintrag: AmtEintrag;
}> => {
	const g = gliederungFuer(termin);
	if (!g) return [];
	return g.kreise.flatMap((k) =>
		k.wahlleitungen.flatMap((w) =>
			(Object.entries(w.aemter) as Array<[Amt, AmtEintrag]>).map(
				([amt, eintrag]) => ({ kreis: k.slug, wahlleitung: w, amt, eintrag }),
			),
		),
	);
};
