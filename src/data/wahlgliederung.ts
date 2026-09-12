/**
 * Worauf sich ein Eintrag stützt.
 *
 * `wahlleitung` – aus der Wahlpräsentation dieses Termins abgerufen.
 * `bekanntmachung` – aus einer amtlichen Veröffentlichung außerhalb der
 *   Wahlpräsentation: Wahlbekanntmachung, Hauptsatzung, Beschlussvorlage.
 *   Von Hand erhoben, siehe src/data/wahlbereichseinteilung.ts.
 * `katalog` – aus der erhobenen Behördenliste (src/data/kreis-katalog.ts).
 * `vergleich` – Zahl aus einem anderen Termin; der Beleg nennt ihn.
 * `keine` – nichts gefunden.
 */
export type Herkunft =
	| "wahlleitung"
	| "bekanntmachung"
	| "katalog"
	| "vergleich"
	| "keine";

export type Beleg = {
	herkunft: Herkunft;
	/** Adresse oder Datei, aus der der Eintrag stammt */
	quelle: string;
	/** Termin des Belegs; bei `vergleich` ein anderer als der des Verzeichnisses */
	terminBeleg?: string;
	/** ISO-Zeitpunkt der Erhebung */
	erhoben: string;
	/** Warum der Eintrag entfällt oder unbekannt bleibt */
	grund?: string;
};

/**
 * `belegt` – die Wahlleitung führt es für diesen Termin.
 * `entfaellt` – es gibt es für diesen Termin nachweislich nicht; der Beleg nennt den Grund.
 * `unbekannt` – für diesen Termin liegt nichts vor. Nie aus einem anderen Termin gefüllt.
 */
export type Stand = "belegt" | "entfaellt" | "unbekannt";

export type Amt =
	| "kreistag"
	| "landrat"
	| "landrat-stichwahl"
	| "rat"
	| "buergermeister"
	| "buergermeister-stichwahl"
	| "ortsrat";

/** Eine einzelne Wahl, wie die Anwendung sie führt. */
export type Wahlbezeichnung = {
	slug: string;
	titel: string;
	/** Gebiet, für das gewählt wird – Ortschaft, Mitgliedsgemeinde, Stadtbezirk */
	gebiet?: string;
};

/**
 * Ein Amt bei einer Wahlleitung. Ein Amt kann mehrere Wahlen haben: die
 * Ortsräte einer Gemeinde, die Räte der Mitgliedsgemeinden einer Samtgemeinde,
 * die Stadtbezirksräte einer kreisfreien Stadt.
 */
export type AmtEintrag = {
	stand: Stand;
	wahlen: Wahlbezeichnung[];
	/** Fehlt, wenn der Beleg der Wahlleitung selbst gilt – siehe {@link belegVon}. */
	beleg?: Beleg;
};

/**
 * Eine Menge von Gebieten eines Termins.
 *
 * `eintraege` enthält ausschließlich Gebiete, die für **diesen** Termin belegt
 * sind. Ist nichts belegt, bleibt die Liste leer und `stand` ist `unbekannt`;
 * `erwartetAnzahl` nennt dann, wie viele es am Vergleichstermin waren – eine
 * Zahl, kein Zuschnitt. Zuschnitte eines anderen Termins stehen hier nie.
 */
export type Gebietsmenge<T> = {
	stand: Stand;
	eintraege: T[];
	erwartetAnzahl?: number;
	beleg: Beleg;
};

export type Kreiswahlbereich = {
	/** Buchstabe oder Nummer, wie die Wahlleitung ihn schreibt */
	kuerzel: string;
	name: string;
	/** Gebiets-Id der Wahlpräsentation, wenn bekannt */
	gebietId?: string;
};

/** Welche Gemeinden in welchem Kreiswahlbereich liegen – eigener Zuschnitt, eigener Beleg. */
export type Wahlbereichszuordnung = {
	kuerzel: string;
	gemeinden: string[];
	/** Nur, wenn eine Gemeinde auf mehrere Bereiche aufgeteilt ist */
	ortsteile?: string[];
};

export type Ortschaft = {
	slug: string;
	name: string;
	/** Steht für diese Ortschaft eine Ortsratswahl an? */
	ortsrat: Stand;
};

export type Wahlbezirk = {
	/** Bezeichnung der Wahlleitung, z. B. "06 - Adensen" */
	bezeichnung: string;
	ortsteil?: string;
};

export type Wahlleitung = {
	ags: string;
	slug: string;
	name: string;
	art: "kreis" | "stadt" | "gemeinde" | "samtgemeinde";
	beleg: Beleg;
	aemter: Partial<Record<Amt, AmtEintrag>>;
	/** Nur bei Samtgemeinden vorhanden */
	mitgliedsgemeinden?: Gebietsmenge<string>;
	ortschaften: Gebietsmenge<Ortschaft>;
	wahlbezirke: Gebietsmenge<Wahlbezirk>;
};

export type Kreisgliederung = {
	slug: string;
	ags: string;
	name: string;
	art: "landkreis" | "kreisfreie-stadt" | "region";
	kreiswahlbereiche: Gebietsmenge<Kreiswahlbereich>;
	wahlbereichszuordnung: Gebietsmenge<Wahlbereichszuordnung>;
	wahlleitungen: Wahlleitung[];
};

export type Wahlgliederung = {
	termin: string;
	erzeugt: string;
	/** Kurzbeschreibung, woraus das Verzeichnis gebaut wurde */
	erhebung: string;
	kreise: Kreisgliederung[];
};

/** Der Beleg eines Amts – der eigene, sonst der seiner Wahlleitung. */
export const belegVon = (eintrag: AmtEintrag, w: Wahlleitung): Beleg =>
	eintrag.beleg ?? w.beleg;
