/**
 * Erkennung der Wahlart aus dem votemanager-Titel und daraus abgeleitete
 * URL-Slugs. Titel sehen so aus:
 *   "Landratswahl - Landkreis Hildesheim", "Stichwahl des Landrats - …",
 *   "Kreiswahl - …" (2021) / "Kreistagswahl - …" (2026),
 *   "Wahl des/der Bürgermeisters/in - Gemeinde Nordstemmen - Gemeinde Nordstemmen",
 *   "Wahl des/der Oberbürgermeisters/in - Stadt Hildesheim",
 *   "Samtgemeindebürgermeister(-innen)wahl - Samtgemeinde Leinebergland",
 *   "Gemeindewahl - …", "Stadtratswahl - …", "Wahl des Rates der Stadt Sarstedt - …", "Samtgemeindewahl - …",
 *   "Ortsratswahl - Adensen", "Gemeindewahl - Duingen" (Mitgliedsgemeinde einer Samtgemeinde)
 */
export type Wahltyp =
	| "landrat"
	| "landrat-stichwahl"
	| "kreistag"
	| "buergermeister"
	| "buergermeister-stichwahl"
	| "rat"
	| "ortsrat"
	| "sonstige";

export const WAHLTYP_LABEL: Record<Wahltyp, string> = {
	landrat: "Landratswahl",
	"landrat-stichwahl": "Stichwahl Landrat",
	kreistag: "Kreistagswahl",
	buergermeister: "Bürgermeisterwahl",
	"buergermeister-stichwahl": "Stichwahl Bürgermeister",
	rat: "Ratswahl",
	ortsrat: "Ortsratswahl",
	sonstige: "Wahl",
};

/** Reihenfolge in Menüs: Kreisebene zuerst, dann Gemeinde, dann Ortsräte. */
export const WAHLTYP_REIHENFOLGE: Wahltyp[] = [
	"landrat",
	"landrat-stichwahl",
	"kreistag",
	"buergermeister",
	"buergermeister-stichwahl",
	"rat",
	"ortsrat",
	"sonstige",
];

/** Personenwahl (ein Kreuz, Kandidaten) vs. Verhältniswahl (drei Stimmen, Listen + Sitze). */
export const istPersonenwahl = (typ: Wahltyp): boolean =>
	typ === "landrat" ||
	typ === "landrat-stichwahl" ||
	typ === "buergermeister" ||
	typ === "buergermeister-stichwahl";

/** Kreisweite Wahl (Ergebnisse liegen beim Landkreis UND in jeder Gemeinde vor). */
export const istKreiswahl = (typ: Wahltyp): boolean =>
	typ === "landrat" || typ === "landrat-stichwahl" || typ === "kreistag";

/**
 * Kurze Bezeichnung einer Wahl für Menüs und Überschriften.
 *
 * Die amtlichen Titel sind sperrig ("Wahl des/der Bürgermeisters/in",
 * "Samtgemeindebürgermeister(-innen)wahl") und lassen sich nicht durch bloßes
 * Ersetzen kürzen: In "Stichwahl des/der Bürgermeisters/in" steckt der Wortteil
 * "wahl des/der Bürgermeisters/in" mitten drin, was zu "StichBürgermeisterwahl"
 * führte. Deshalb geht die Bezeichnung vom erkannten Wahltyp aus; nur die
 * Unterscheidung Bürgermeister/Oberbürgermeister kommt aus dem Titel.
 */
export const kurzBezeichnung = (titel: string, typ: Wahltyp): string => {
	const kern = titel.split(" - ")[0] ?? titel;
	const ober = /oberbürgermeister/i.test(kern);
	const samtgemeinde = /samtgemeinde/i.test(kern);
	switch (typ) {
		case "buergermeister":
			return ober
				? "Oberbürgermeisterwahl"
				: samtgemeinde
					? "Samtgemeindebürgermeisterwahl"
					: "Bürgermeisterwahl";
		case "buergermeister-stichwahl":
			return ober ? "Stichwahl Oberbürgermeister" : "Stichwahl Bürgermeister";
		case "landrat":
			return "Landratswahl";
		case "landrat-stichwahl":
			return "Stichwahl Landrat";
		case "kreistag":
			return "Kreistagswahl";
		default:
			// Rats- und Ortsratswahlen heißen je Kommune anders ("Gemeindewahl",
			// "Stadtratswahl", "Wahl des Rates der Stadt Sarstedt") – dort bleibt
			// der amtliche Titel die beste Bezeichnung.
			return kern;
	}
};

export const erkenneWahltyp = (titel: string): Wahltyp => {
	const t = titel.toLowerCase();
	const stichwahl = t.includes("stichwahl");
	if (t.includes("landrat") || t.includes("landrätin"))
		return stichwahl ? "landrat-stichwahl" : "landrat";
	if (t.startsWith("kreiswahl") || t.includes("kreistag")) return "kreistag";
	if (t.includes("bürgermeister"))
		return stichwahl ? "buergermeister-stichwahl" : "buergermeister";
	if (t.startsWith("ortsratswahl") || t.includes("ortsrat")) return "ortsrat";
	if (
		t.includes("gemeindewahl") ||
		t.includes("stadtratswahl") ||
		t.includes("samtgemeindewahl") ||
		t.includes("wahl des rates") ||
		t.includes("ratswahl")
	)
		return "rat";
	return "sonstige";
};

const umlaute: Record<string, string> = { ä: "ae", ö: "oe", ü: "ue", ß: "ss" };

export const slugify = (s: string): string =>
	s
		.toLowerCase()
		.replace(/[äöüß]/g, (c) => umlaute[c] ?? c)
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");

/**
 * Slug einer Wahl innerhalb einer Behörde. Bei Ortsratswahlen (und
 * Gemeindewahlen der Samtgemeinde-Mitglieder) hängt der Ortsname an, weil
 * mehrere Einträge dieselbe Wahl-Id teilen können.
 */
export const wahlSlug = (
	typ: Wahltyp,
	titel: string,
	gebietTitel: string,
): string => {
	if (typ === "ortsrat")
		return `ortsrat-${slugify(gebietTitel.replace(/^ortschaft\s+/i, ""))}`;
	if (
		typ === "rat" &&
		/^gemeindewahl - /i.test(titel) &&
		/^(flecken|gemeinde|stadt)\s/i.test(gebietTitel) === false &&
		!/samtgemeinde/i.test(gebietTitel)
	) {
		// "Gemeindewahl - Duingen" innerhalb der Samtgemeinde
		return `rat-${slugify(gebietTitel)}`;
	}
	return typ;
};
