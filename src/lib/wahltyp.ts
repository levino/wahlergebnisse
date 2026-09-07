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
	if (t.includes("landrat") || t.includes("landrät"))
		return stichwahl ? "landrat-stichwahl" : "landrat";
	if (/\bkreiswahl/.test(t) || t.includes("kreistag")) return "kreistag";
	// „Samtgemeindebürgemeisterin“ steht so im amtlichen Titel (Emsland) – das
	// fehlende r darf die Wahl nicht in die Rubrik „sonstige“ fallen lassen.
	if (/bürger?meister/.test(t))
		return stichwahl ? "buergermeister-stichwahl" : "buergermeister";
	// „Ortstratswahl Sehlem“ (Lamspringe) ist ein Tippfehler der Wahlleitung;
	// ohne diese Nachsicht landet der Ortsrat unter „rat“ und kollidiert mit
	// der Gemeinderatswahl derselben Behörde.
	if (/orts?t?rat|ortschaftsrat/.test(t)) return "ortsrat";
	if (
		t.includes("gemeindewahl") ||
		t.includes("stadtratswahl") ||
		t.includes("samtgemeindewahl") ||
		t.includes("wahl des rates") ||
		t.includes("ratswahl") ||
		// „Wahl des Gemeinderates“, „Samtgemeinderat Herzlake“, „Wahl zum Rat
		// der Stadt Leer“, „Stadtrat“ – dieselbe Wahl, andere Schreibweise.
		/\b(?:samt)?gemeinderat|\bstadtrat|\brat(?:e?s)?\b/.test(t)
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

// ---------- Gebietsname ----------

/**
 * Bausteine, aus denen die Wahlleitungen ihre Titel zusammensetzen:
 * Gebietskörperschaften ("Samtgemeinde", "Flecken"), Gremien ("Rates",
 * "Kreistages") und Ämter ("Landrätin", "Oberbürgermeisters"). Sie stehen in
 * jeder erdenklichen Kombination – "Samtgemeindebürgermeisterwahl",
 * "Stadtbezirksratswahl", "Kreistagswahl" – deshalb werden sie aneinander
 * gehängt geprüft und nicht einzeln aufgezählt.
 *
 * Bewusst NICHT dabei: das Wort "Land" für sich. Es steckt zwar in
 * "Landkreis" und "Landrat", ist aber zugleich Namensbestandteil
 * ("Samtgemeinde Land Hadeln") – als eigenes Vokabel würde es den Ortsnamen
 * anknabbern.
 */
const BAUSTEIN =
	"(?:samt)?gemeinde|einheitsgemeinde|inselgemeinde|mitglieds|(?:hanse|berg)?stadt|fleckens?|ortschafts?|orts?|bezirks?|landkreis|kreistag(?:e?s)?|kreis|rat(?:e?s)?|tag(?:e?s)?|(?:ober)?bürger?meisters?(?:in|innen)?|landr(?:at|ats|ates|äte|ätin|ätinnen)";

/** Wahl-Wörter, die für sich stehen können ("Wahl", "Stichwahl", "Direktwahl"). */
const WAHLWORT = "(?:direkt|neu|stich|kommunal|urnen)?wahl(?:en)?";

/** Füllwörter und leere Bezeichnungen, die nie ein Gebiet benennen. */
const FUELLWORT =
	"der|die|das|des|dem|den|ein|eine|einer|eines|zum|zur|zu|im|in|am|an|auf|für|von|vom|und|oder|über|ergebnis(?:se)?|gesamt(?:ergebnis)?|wahlgebiet(?:e?s)?";

/**
 * Ein Wort gehört zum Wahl-Vokabular, wenn es sich vollständig aus Bausteinen
 * und höchstens einem angehängten Wahl-Wort zusammensetzt. Die Prüfung auf das
 * ganze Wort ist wesentlich: Der Ortsteil "Wahle" (Vechelde) darf nicht als
 * "Wahl" durchgehen, "Stadtoldendorf" nicht als "Stadt".
 */
const VOKABEL = new RegExp(
	`^(?:${FUELLWORT}|${WAHLWORT}|(?:${BAUSTEIN})+(?:${WAHLWORT})?)$`,
	"i",
);

/**
 * Der Name des Gebiets, um dessen Vertretung es geht – aus einer Bezeichnung
 * der Wahlleitung herausgeschält.
 *
 * "Wahl des Rates der Gemeinde Dahlum" → "Dahlum", "der Gemeinde Dahlum" →
 * "Dahlum", "Ortsratswahl Amelsen" → "Amelsen", "Samtgemeinderatswahl" → ""
 * (kein eigenes Gebiet, es ist die Behörde selbst).
 *
 * Gestrichen werden nur führende Vokabeln: Sobald das erste unbekannte Wort
 * kommt, bleibt der Rest unangetastet – sonst verlöre "Samtgemeinde Land
 * Hadeln" sein "Land" und "Ortsratswahl Neuhaus (Oste)" seine Klammer.
 */
export const gebietsname = (bezeichnung: string): string => {
	const ohneDatum = bezeichnung
		// "… am 13. September 2026" und schlichte Jahreszahlen am Ende
		.replace(/\s+am\s+\d{1,2}\.\s*\S+\s*(?:19|20)\d{2}\s*$/i, "")
		.replace(/\s*\b(?:19|20)\d{2}\b\s*$/, "")
		// "(-innen)" und "(-in)" kleben mitten im Wort und stören die Wortprüfung
		.replace(/\(-?in(?:nen)?\)/gi, "");
	const worte = ohneDatum.split(/[\s/,]+/).filter(Boolean);
	let i = 0;
	while (i < worte.length && VOKABEL.test(worte[i].replace(/^-+|[-.]+$/g, "")))
		i++;
	return worte.slice(i).join(" ").trim();
};

/** Zwei Gebietsnamen meinen dasselbe Gebiet. */
const gleicherName = (a: string, b: string): boolean =>
	a !== "" && slugify(a) === slugify(b);

/**
 * Alle Gebietsnamen, die ein Wahleintrag hergibt – der geeignetste zuerst.
 *
 * Drei Quellen, in dieser Reihenfolge: der Gebietsname aus dem Termin-Index,
 * der Kern des Wahltitels, und der mittlere Teil des Titels. Keine ist für
 * sich verlässlich – Northeim schreibt in den Gebietsnamen aller vierzehn
 * Ortsratswahlen der Stadt Dassel schlicht "Ergebnis", Braunschweig bei allen
 * dreizehn Stadtbezirksräten "Stadt Braunschweig", und Hildesheim lässt
 * umgekehrt den Ortsnamen im Wahltitel weg ("Ortsratswahl - Adensen -
 * Ortschaft Adensen"). Zusammen ergeben sie überall einen Namen.
 */
const gebietsKandidaten = (titel: string, gebietTitel: string): string[] => {
	const teile = titel.split(" - ");
	const namen = [gebietTitel, teile[0] ?? "", teile[1] ?? ""]
		.map(gebietsname)
		.filter((n) => n !== "");
	// Reine Ziffernfolgen kommen vor, wo eigentlich ein Ort stehen sollte
	// ("Ortsratswahl Beienrode - 001" in Gleichen). Als Notnagel taugen sie –
	// Braunschweig benennt seine Stadtbezirke wirklich nur mit Nummern –, aber
	// ein Name daneben ist immer der bessere Slug.
	const ziffern = (n: string) => /^\d+$/.test(n);
	return [...namen.filter((n) => !ziffern(n)), ...namen.filter(ziffern)];
};

/**
 * Das Gebiet einer Wahl, sofern es ein anderes ist als das der Behörde selbst.
 * Leer bedeutet: Die Behörde wählt für ihr eigenes Gebiet – dann trägt der
 * Slug nur den Wahltyp, so wie seit jeher.
 */
export const wahlGebiet = (
	titel: string,
	gebietTitel: string,
	behoerdeName = "",
): string => {
	const behoerde = gebietsname(behoerdeName);
	return (
		gebietsKandidaten(titel, gebietTitel).find(
			(n) => !gleicherName(n, behoerde),
		) ?? ""
	);
};

/**
 * Wahltypen, unter denen eine Behörde mehrere Wahlen führen kann: Eine
 * Samtgemeinde wählt neben ihrem eigenen Rat den jeder Mitgliedsgemeinde, eine
 * Stadt neben ihrem Rat jeden Ortsrat. Landrat, Kreistag und Bürgermeister
 * gibt es dagegen genau einmal – dort bliebe ein Gebietszusatz ohne Nutzen und
 * würde nur die gewachsenen Adressen zerschneiden.
 */
const MIT_GEBIET: Wahltyp[] = ["rat", "ortsrat", "sonstige"];

/**
 * Das Gebiet, das in den Slug einfließt.
 *
 * Ein Ortsrat ist nie das Gremium der Behörde selbst, auch wenn die Ortschaft
 * so heißt wie die Gemeinde ("Ortsratswahl - Nordstemmen" in der Gemeinde
 * Nordstemmen). Sein Slug trägt den Ortsnamen deshalb immer, so wie seit jeher
 * – notfalls eben den der Gemeinde. Erst gesucht wird trotzdem nach einem
 * abweichenden Namen: Rehburg-Loccum schreibt in alle vier Ortsratswahlen
 * denselben Gebietsnamen "Stadt Rehburg-Loccum", und nur der Wahltitel verrät,
 * dass es um Loccum, Münchehagen, Winzlar und Bad Rehburg geht.
 */
const gebietFuerSlug = (
	typ: Wahltyp,
	titel: string,
	gebietTitel: string,
	behoerdeName: string,
): string => {
	if (!MIT_GEBIET.includes(typ)) return "";
	const gebiet = wahlGebiet(titel, gebietTitel, behoerdeName);
	if (gebiet || typ !== "ortsrat") return gebiet;
	return gebietsKandidaten(titel, gebietTitel)[0] ?? "";
};

/**
 * Slug einer Wahl innerhalb einer Behörde: der Wahltyp, bei Rats-, Ortsrats-
 * und unerkannten Wahlen um das Gebiet ergänzt, wenn dieses ein anderes ist
 * als das der Behörde.
 *
 * Eindeutig ist das noch nicht garantiert – dafür sorgt `wahlSlugs()`, das
 * alle Wahlen einer Behörde zusammen sieht.
 */
export const wahlSlug = (
	typ: Wahltyp,
	titel: string,
	gebietTitel: string,
	behoerdeName = "",
): string => {
	const gebiet = gebietFuerSlug(typ, titel, gebietTitel, behoerdeName);
	return gebiet ? `${typ}-${slugify(gebiet)}` : typ;
};

/** So viel braucht die Slug-Bildung von einem Eintrag des Termin-Index. */
export type SlugEingabe = {
	wahlId: number;
	titel: string;
	gebietTitel: string;
	/** Gebiets-Id der Präsentation; letzte Reserve, wenn alles andere gleich ist. */
	gebietId?: string;
};

export type SlugErgebnis = {
	typ: Wahltyp;
	/** Gebiet der Wahl, leer bei der Behörde selbst – auch für die Anzeige. */
	gebiet: string;
	slug: string;
};

/**
 * Typ, Gebiet und Slug für alle Wahlen einer Behörde.
 *
 * Nur hier lässt sich Eindeutigkeit überhaupt feststellen, und nur hier greift
 * die Notbremse. Nötig ist sie selten, aber es gibt sie wirklich: Lemwerder
 * führt seine Landratswahl doppelt (einmal unter altem, einmal unter neuem
 * Titel), und die Samtgemeinde Herzlake listet ihre Samtgemeinderatswahl
 * einmal je Mitgliedsgemeinde – neben deren eigenen Gemeinderatswahlen, die
 * genauso heißen.
 *
 * Den schlichten Slug behält, wessen eigener Wahltitel das Gebiet nennt
 * ("Gemeinderat Dohren" schlägt "Samtgemeinderat Herzlake - Dohren"); bei
 * Gleichstand die kleinere Wahl-Id. Die übrigen bekommen ihre Wahl-Id
 * angehängt, und wenn selbst die geteilt wird, zusätzlich ihre Gebiets-Id.
 * Beide stehen so in der Präsentation der Wahlleitung, überstehen also ein
 * Neubefüllen der Datenbank – anders als eine laufende Nummer aus der
 * Einlesereihenfolge.
 */
export const wahlSlugs = (
	eintraege: readonly SlugEingabe[],
	behoerdeName = "",
): SlugErgebnis[] => {
	const roh = eintraege.map((e) => {
		const typ = erkenneWahltyp(e.titel);
		const gebiet = gebietFuerSlug(typ, e.titel, e.gebietTitel, behoerdeName);
		return { typ, gebiet, slug: gebiet ? `${typ}-${slugify(gebiet)}` : typ };
	});
	const gruppen = new Map<string, number[]>();
	roh.forEach((r, i) => {
		const g = gruppen.get(r.slug);
		if (g) g.push(i);
		else gruppen.set(r.slug, [i]);
	});
	/** Nennt der Wahltitel selbst das Gebiet, das der Slug meint? */
	const selbstbenannt = (i: number): boolean =>
		slugify(gebietsname(eintraege[i].titel.split(" - ")[0] ?? "")) ===
		slugify(roh[i].gebiet);
	for (const [basis, indizes] of gruppen) {
		if (indizes.length < 2) continue;
		const sortiert = [...indizes].sort(
			(a, b) =>
				Number(selbstbenannt(b)) - Number(selbstbenannt(a)) ||
				eintraege[a].wahlId - eintraege[b].wahlId,
		);
		for (const i of sortiert.slice(1)) {
			const e = eintraege[i];
			const mitId = `${basis}-${e.wahlId}`;
			roh[i].slug = gruppen.has(mitId)
				? `${mitId}-${slugify(e.gebietId ?? String(i))}`
				: mitId;
			gruppen.set(roh[i].slug, [i]);
		}
	}
	return roh;
};
