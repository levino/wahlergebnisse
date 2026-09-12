import { type Kreis, kreisbehoerdeVon } from "../data/kreise.ts";
import { kommunenLautBekanntmachung } from "../data/wahlbereichseinteilung.ts";
import { kreisgliederung } from "../data/wahlgliederungen.ts";
import {
	alleErgebnisse,
	angekuendigteEbenen,
	wahleintraege,
} from "./abfragen.ts";
import { ebeneVon, ebenennamen } from "./ebenen.ts";
import { wahlbereichKuerzel } from "./wahlbereiche.ts";
import { istKreiswahl } from "./wahltyp.ts";

/**
 * Kommunen des Kreises, zu denen in einer kreisweiten Summe nichts nachweisbar
 * ist: weder eine eigene Wahlleitung noch ein Gebiet, das die Kreisbehörde
 * selbst führt.
 */
export type Kreisdeckung = {
	kommunen: number;
	fehlend: string[];
	quelle: string;
	dokument: string;
	terminBeleg: string;
};

/** Was die Kreisbehörde an Untergliederung ihres Kreisgebiets veröffentlicht. */
export type Kreisgebiete = {
	bereiche: Set<string>;
	gemeinden: Set<string>;
};

const RECHTSFORM =
	/^(samtgemeinde|sg|gemeindefreier bezirk|gemfr\. bezirk|gemeinde|landkreis|stadt|flecken|hansestadt|inselgemeinde|nordseebad|bergstadt|berg- und universitätsstadt|landeshauptstadt|hanse- und universitätsstadt|universitätsstadt|kreisstadt)\s+/;

const ZUSATZ =
	/\s+(a\.t\.w\.|am teutoburger wald|am elm|oldb|oldenburg|ems|leine|weser|harz|unterweser|aller|luhe|ostfriesland|in der nordheide)$/;

export const normKommune = (roh: string): string => {
	let s = roh.toLowerCase().replace(/[„“"]/g, "").replace(/\s+/g, " ").trim();
	s = s.replace(/,.*$/, "");
	for (;;) {
		const n = s.replace(RECHTSFORM, "");
		if (n === s) break;
		s = n;
	}
	s = s.split("(")[0].split("/")[0].trim().replace(ZUSATZ, "");
	return s.replace(/[- ]+/g, " ").trim();
};

const eigeneNamen = (terminId: string, kreis: Kreis): Set<string> => {
	const namen = new Set(kreis.behoerden.map((b) => normKommune(b.name)));
	for (const w of kreisgliederung(terminId, kreis.slug)?.wahlleitungen ?? [])
		for (const m of w.mitgliedsgemeinden?.eintraege ?? [])
			namen.add(normKommune(m));
	return namen;
};

/** Wahlbereiche und Gemeinden, zu denen die Kreisbehörde selbst Zahlen führt. */
export const kreisgebiete = (terminId: string, kreis: Kreis): Kreisgebiete => {
	const kreisbehoerde = kreisbehoerdeVon(kreis);
	const bereiche = new Set<string>();
	const gemeinden = new Set<string>();
	if (!kreisbehoerde) return { bereiche, gemeinden };
	for (const w of wahleintraege(terminId, kreisbehoerde.ags)) {
		if (!istKreiswahl(w.typ)) continue;
		const namen = ebenennamen(
			angekuendigteEbenen(terminId, kreisbehoerde.ags, w.wahlId),
		);
		for (const e of alleErgebnisse(terminId, kreisbehoerde.ags, w.wahlId)) {
			if (e.gebietId === w.gebietId) continue;
			const ebene = ebeneVon(e.gebietId, namen);
			if (ebene === "Wahlbereich") {
				const k = wahlbereichKuerzel(e.titel);
				if (k) bereiche.add(k);
			}
			if (ebene === "Gemeinde") gemeinden.add(normKommune(e.titel));
		}
	}
	return { bereiche, gemeinden };
};

export const deckungslueckeAus = (
	kreis: Kreis,
	eigene: ReadonlySet<string>,
	gebiete: Kreisgebiete,
): Kreisdeckung | undefined => {
	const verzeichnis = kommunenLautBekanntmachung(kreis.slug);
	if (!verzeichnis) return undefined;
	if (gebiete.bereiche.size === 0 && gebiete.gemeinden.size === 0)
		return undefined;
	const fehlend = verzeichnis.kommunen
		.filter((k) => !eigene.has(normKommune(k.name)))
		.filter((k) => !gebiete.gemeinden.has(normKommune(k.name)))
		.filter(
			(k) =>
				!k.bereiche.some((b) =>
					gebiete.bereiche.has(wahlbereichKuerzel(b) ?? b),
				),
		)
		.map((k) => k.name);
	if (fehlend.length === 0) return undefined;
	return {
		kommunen: verzeichnis.kommunen.length,
		fehlend,
		quelle: verzeichnis.quelle,
		dokument: verzeichnis.dokument,
		terminBeleg: verzeichnis.termin,
	};
};

export const kreisdeckung = (
	terminId: string,
	kreis: Kreis,
): Kreisdeckung | undefined =>
	deckungslueckeAus(
		kreis,
		eigeneNamen(terminId, kreis),
		kreisgebiete(terminId, kreis),
	);

export const deckungsSatz = (d: Kreisdeckung): string =>
	`Für ${d.fehlend.length} der ${d.kommunen} Kommunen des Kreises führt hier niemand eigene Zahlen: ${d.fehlend.join(", ")}. Zu ihnen gibt es weder eine eigene Wahlleitung noch ein Gebiet, das die Kreisbehörde veröffentlicht. Dass diese Summe das ganze Kreisgebiet umfasst, ist damit nicht belegt.`;

export const deckungsTitel = "Teilergebnis";
