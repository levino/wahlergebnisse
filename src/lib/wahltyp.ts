import { enthaeltStamm, tippfehlerVarianten } from "./schreibweise.ts";

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

export const amtVon = (typ: Wahltyp): Wahltyp =>
	typ === "landrat-stichwahl"
		? "landrat"
		: typ === "buergermeister-stichwahl"
			? "buergermeister"
			: typ;

/** Personenwahl (ein Kreuz, Kandidaten) vs. Verhältniswahl (drei Stimmen, Listen + Sitze). */
export const istPersonenwahl = (typ: Wahltyp): boolean =>
	typ === "landrat" ||
	typ === "landrat-stichwahl" ||
	typ === "buergermeister" ||
	typ === "buergermeister-stichwahl";

/** Kreisweite Wahl (Ergebnisse liegen beim Landkreis UND in jeder Gemeinde vor). */
export const istKreiswahl = (typ: Wahltyp): boolean =>
	typ === "landrat" || typ === "landrat-stichwahl" || typ === "kreistag";

const REGIONSPRAESIDENT = /regionspräsident/i;
const REGIONSVERSAMMLUNG = /regionsversammlung/i;

/** Eine der drei kreisweiten Wahlen der Region Hannover? */
export const istRegionswahl = (titel: string): boolean =>
	REGIONSPRAESIDENT.test(titel) || REGIONSVERSAMMLUNG.test(titel);

export const ebenenUeberschriften = (
	kreisweiteTitel: readonly string[],
): { eigen: string; kreisweit: string } =>
	kreisweiteTitel.length > 0 && kreisweiteTitel.every(istRegionswahl)
		? { eigen: "Regionsebene", kreisweit: "Regionsweite Wahlen in" }
		: { eigen: "Kreisebene", kreisweit: "Kreisweite Wahlen in" };

/**
 * Steckt der Stamm in einem Wort des Titels – mit `fehler` Vertippern Spielraum?
 * Wortweise, damit der Vergleich nicht über Wortgrenzen hinweg zusammenfindet,
 * was nicht zusammengehört („Europawahl - Gemeinde Wallenhorst“).
 */
const imTitel = (t: string, stamm: string, fehler = 1): boolean =>
	t.includes(stamm) ||
	t
		.split(/[^a-zäöüß]+/)
		.some((wort) => wort !== "" && enthaeltStamm(wort, stamm, fehler));

/**
 * Die Gremien der Ortsebene, in der Reihenfolge, in der sie gesucht werden –
 * das längere Wort zuerst, sonst schluckt „Ortsrat“ den „Stadtbezirksrat“.
 */
const ORTSGREMIEN: Array<[stamm: string, name: string]> = [
	["stadtbezirksrat", "Stadtbezirksrat"],
	["ortschaftsrat", "Ortschaftsrat"],
	["bezirksrat", "Bezirksrat"],
	["ortsbeirat", "Ortsbeirat"],
	["ortsrat", "Ortsrat"],
];

const ortsgremium = (t: string): string | undefined =>
	ORTSGREMIEN.find(([stamm]) => imTitel(t, stamm))?.[1];

/** Vertretungen einer Gemeinde, Samtgemeinde oder Stadt. */
const RATSSTAEMME = [
	"samtgemeinderat",
	"gemeinderat",
	"stadtrat",
	"fleckenrat",
];

/** „Gemeindewahl“ und Verwandte meinen die Wahl des Rates, ohne es zu sagen. */
const RATSWAHLSTAEMME = ["samtgemeindewahl", "gemeindewahl", "stadtwahl"];

/**
 * Das Wort „Rat“ für sich – am Wortanfang und -ende, nicht mitten im Wort.
 * „Seniorenbeiratswahl“ ist keine Vertretung nach NKomVG und darf hier nicht
 * hineinrutschen.
 */
const RATSWORT = /\b(?:rat(?:e?s)?|rats?wahl(?:en)?|vertretung)\b/;

/** Benennt der Text eine Vertretung der Gemeindeebene? */
const nenntRat = (t: string): boolean =>
	RATSSTAEMME.some((s) => imTitel(t, s)) ||
	RATSWAHLSTAEMME.some((s) => imTitel(t, s, 2)) ||
	RATSWORT.test(t);

const RATSNAMEN: Record<string, string> = {
	Gemeindewahl: "Gemeinderatswahl",
	Samtgemeindewahl: "Samtgemeinderatswahl",
	Stadtwahl: "Stadtratswahl",
};

const ohneJahr = (s: string): string =>
	s
		.replace(/\s+am\s+\d{1,2}\.\s*\S+\s*(?:19|20)\d{2}\s*$/i, "")
		.replace(/\s*\b(?:19|20)\d{2}\b\s*$/, "")
		.trim();

/**
 * Der Teil des Titels, der die Wahl benennt. Manche Wahlleitungen stellen das
 * Gebiet voran ("Gemeinde Leezdorf - Gemeinderatswahl Leezdorf").
 */
const wahlTeil = (titel: string): string => {
	const teile = titel.split(" - ");
	return (
		teile.find(
			(teil) =>
				/wahl|vertretung/i.test(teil) || RATSWORT.test(teil.toLowerCase()),
		) ??
		teile[0] ??
		titel
	);
};

export const kurzBezeichnung = (titel: string, typ: Wahltyp): string => {
	const kern = ohneJahr(wahlTeil(titel));
	const t = kern.toLowerCase();
	const ober = /oberbürgermeister/i.test(kern);
	const samtgemeinde = /samtgemeinde/i.test(kern);
	const region = istRegionswahl(kern);
	const nenntAmt = imTitel(t, "bürgermeister");
	switch (typ) {
		case "buergermeister":
			return !nenntAmt
				? kern
				: ober
					? "Oberbürgermeisterwahl"
					: samtgemeinde
						? "Samtgemeindebürgermeisterwahl"
						: "Bürgermeisterwahl";
		case "buergermeister-stichwahl":
			return !nenntAmt
				? kern
				: ober
					? "Stichwahl Oberbürgermeister"
					: "Stichwahl Bürgermeister";
		case "landrat":
			return region ? "Regionspräsidentenwahl" : "Landratswahl";
		case "landrat-stichwahl":
			return region ? "Stichwahl Regionspräsident" : "Stichwahl Landrat";
		case "kreistag":
			return region ? "Regionsversammlungswahl" : "Kreistagswahl";
		case "ortsrat":
			return wahltypLabel(typ, titel);
		case "rat":
			return RATSNAMEN[kern] ?? (nenntRat(t) ? kern : WAHLTYP_LABEL.rat);
		default:
			return RATSNAMEN[kern] ?? kern;
	}
};

export const wahltypLabel = (typ: Wahltyp, titel = ""): string =>
	typ === "ortsrat"
		? `${gremiumName(titel, typ)}swahl`
		: istRegionswahl(titel)
			? kurzBezeichnung(titel, typ)
			: WAHLTYP_LABEL[typ];

const TEST_MARKER = /\b(?:TEST|MUSTER|PROBE|DEMO)\b/;

/** Zusammengesetzt ist es eindeutig, gleich wie geschrieben. */
const TEST_WAHLWORT = /\b(?:test|muster|probe|demo)wahl\b/i;

export const istTestwahl = (titel: string): boolean =>
	TEST_MARKER.test(titel) || TEST_WAHLWORT.test(titel);

const istKreisbehoerde = (behoerdeName: string): boolean =>
	/\blandkreis\b|^region\b/i.test(behoerdeName.trim());

/**
 * Die Wahlart aus dem Titel. Was keiner bekannten Wahlart entspricht, bleibt
 * „sonstige“ – lieber ehrlich unbekannt als falsch einsortiert.
 */
export const erkenneWahltyp = (titel: string, behoerdeName = ""): Wahltyp => {
	const t = titel.toLowerCase();
	const stichwahl = imTitel(t, "stichwahl");
	if (
		t.includes("landrat") ||
		t.includes("landrät") ||
		imTitel(t, "landratswahl")
	)
		return stichwahl ? "landrat-stichwahl" : "landrat";
	if (imTitel(t, "kreistag") || /\bkreiswahl/.test(t)) return "kreistag";
	if (imTitel(t, "bürgermeister"))
		return stichwahl ? "buergermeister-stichwahl" : "buergermeister";
	if (ortsgremium(t)) return "ortsrat";
	if (nenntRat(t)) return "rat";
	if (REGIONSPRAESIDENT.test(t))
		return stichwahl ? "landrat-stichwahl" : "landrat";
	if (REGIONSVERSAMMLUNG.test(t)) return "kreistag";
	if (/\bdirektwahl/.test(t))
		return istKreisbehoerde(behoerdeName)
			? stichwahl
				? "landrat-stichwahl"
				: "landrat"
			: stichwahl
				? "buergermeister-stichwahl"
				: "buergermeister";
	if (/\bkommunalwahl/.test(t))
		return istKreisbehoerde(behoerdeName) ? "kreistag" : "rat";
	if (stichwahl)
		return istKreisbehoerde(behoerdeName)
			? "landrat-stichwahl"
			: "buergermeister-stichwahl";
	return "sonstige";
};

export const gremiumName = (titel: string, typ: Wahltyp): string =>
	typ === "ortsrat"
		? (ortsgremium(wahlTeil(titel).toLowerCase()) ?? "Ortsrat")
		: wahltypLabel(typ, titel);

const umlaute: Record<string, string> = { ä: "ae", ö: "oe", ü: "ue", ß: "ss" };

export const slugify = (s: string): string =>
	s
		.toLowerCase()
		.replace(/[äöüß]/g, (c) => umlaute[c] ?? c)
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");

const BAUSTEIN =
	"(?:samt)?gemeinde|einheitsgemeinde|inselgemeinde|mitglieds|(?:hanse|berg)?stadt|fleckens?|ortschafts?|ortsteils?|stadtteils?|orts?|bezirks?|landkreis|kreistag(?:e?s)?|kreis|rat(?:e?s)?|tag(?:e?s)?|(?:ober)?bürger?meisters?(?:in|innen)?|landr(?:at|ats|ates|äte|ätin|ätinnen)";

/** Wahl-Wörter, die für sich stehen können ("Wahl", "Stichwahl", "Direktwahl"). */
const WAHLWORT = "(?:direkt|neu|stich|kommunal|urnen)?wahl(?:en)?";

/**
 * Jedes zusammengesetzte Wort auf „-wahl“ benennt die Wahl, nicht den Ort:
 * „Europawahl“, „Seniorenbeiratswahl“. Keine Ortschaft in Niedersachsen heißt so.
 */
const WAHLKOMPOSITUM = "[a-zäöüß]{3,}s?wahl(?:en)?";

/** Füllwörter und leere Bezeichnungen, die nie ein Gebiet benennen. */
const FUELLWORT =
	"der|die|das|des|dem|den|ein|eine|einer|eines|zum|zur|zu|im|in|am|an|auf|für|von|vom|und|oder|über|ergebnis(?:se)?|gesamt(?:ergebnis)?|wahlgebiet(?:e?s)?|vertretung(?:en)?|or|ot";

const AUFGEZAEHLT = `${FUELLWORT}|${WAHLWORT}|(?:${BAUSTEIN})+(?:${WAHLWORT})?`;

const VOKABEL = new RegExp(`^(?:${AUFGEZAEHLT}|${WAHLKOMPOSITUM})$`, "i");

/**
 * Für den Vergleich mit Vertipper-Spielraum bleibt das Wahlkompositum außen
 * vor: sonst wird aus der Ortschaft „Wiedensahl“ eine „Wiedenswahl“.
 */
const VOKABEL_STRENG = new RegExp(`^(?:${AUFGEZAEHLT})$`, "i");

const gemerkt = new Map<string, boolean>();

/** Ein Wort, das die Wahl oder die Rechtsform benennt – notfalls mit Vertipper. */
const istVokabel = (wort: string): boolean => {
	const bekannt = gemerkt.get(wort);
	if (bekannt !== undefined) return bekannt;
	const klein = wort.toLowerCase();
	const wert =
		VOKABEL.test(wort) ||
		(klein.length >= 8 &&
			[...tippfehlerVarianten(klein)].some((v) => VOKABEL_STRENG.test(v)));
	gemerkt.set(wort, wert);
	return wert;
};

/** „1-Gemeinde“ → „Gemeinde“, „Landrätin-“ → „Landrätin“. */
const kernWort = (wort: string): string =>
	wort.replace(/^[-–]+|[-–.]+$/g, "").replace(/^\d+[-.]/, "");

/**
 * Der Schrägstrich trennt Wortvarianten („des/der“, „Bürgermeisters/in“) –
 * er gehört aber auch mitten in Ortsnamen („Brockzetel/Wiesens“). Nur wenn
 * jeder Teil eine Vokabel ist, ist das ganze Wort eine.
 */
const istBezeichnungswort = (wort: string): boolean =>
	wort
		.split("/")
		.map(kernWort)
		.every((teil) => teil === "" || istVokabel(teil));

export const gebietsname = (bezeichnung: string): string => {
	const ohneDatum = bezeichnung
		.replace(/\s+am\s+\d{1,2}\.\s*\S+\s*(?:19|20)\d{2}\s*$/i, "")
		.replace(/\s*\b(?:19|20)\d{2}\b\s*$/, "")
		.replace(/\(-?in(?:nen)?\)/gi, "");
	const worte = ohneDatum.split(/[\s,]+/).filter(Boolean);
	let i = 0;
	while (i < worte.length && istBezeichnungswort(worte[i])) i++;
	return worte.slice(i).join(" ").trim();
};

/** Zwei Gebietsnamen meinen dasselbe Gebiet. */
const gleicherName = (a: string, b: string): boolean =>
	a !== "" && slugify(a) === slugify(b);

/**
 * Samtgemeinde oder Mitgliedsgemeinde? In vierzehn von siebzehn Samtgemeinden
 * heißt die namensgebende Mitgliedsgemeinde wie die Samtgemeinde selbst; ohne
 * diese Unterscheidung halten beide Ratswahlen sich für die der Behörde.
 */
const istSamtgemeindeEbene = (text: string): boolean =>
	/samtgemeind/i.test(text);

const KOERPERSCHAFT = /samtgemeind|gemeind|\bstadt|flecken/i;

/**
 * Wählt die Behörde hier für sich selbst? Nur wenn der Wahltitel überhaupt eine
 * Rechtsform nennt, taugt er als Unterscheider – „Europawahl“ sagt nichts.
 */
const wahltAlsBehoerde = (titel: string, behoerdeName: string): boolean => {
	const teil = wahlTeil(titel);
	return (
		!KOERPERSCHAFT.test(teil) ||
		istSamtgemeindeEbene(teil) === istSamtgemeindeEbene(behoerdeName)
	);
};

const gebietsKandidaten = (titel: string, gebietTitel: string): string[] => {
	const teile = titel.split(" - ");
	const namen = [gebietTitel, teile[0] ?? "", teile[1] ?? ""]
		.map(gebietsname)
		.filter((n) => n !== "");
	const ziffern = (n: string) => /^\d+$/.test(n);
	return [...namen.filter((n) => !ziffern(n)), ...namen.filter(ziffern)];
};

export const wahlGebiet = (
	titel: string,
	gebietTitel: string,
	behoerdeName = "",
): string => {
	const behoerde = gebietsname(behoerdeName);
	const kandidaten = gebietsKandidaten(titel, gebietTitel);
	const fremd = kandidaten.find((n) => !gleicherName(n, behoerde));
	if (fremd) return fremd;
	return wahltAlsBehoerde(titel, behoerdeName) ? "" : (kandidaten[0] ?? "");
};

const MIT_GEBIET: Wahltyp[] = ["rat", "ortsrat", "sonstige"];

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

export const wahlSlugs = (
	eintraege: readonly SlugEingabe[],
	behoerdeName = "",
): SlugErgebnis[] => {
	const roh = eintraege.map((e) => {
		const typ = erkenneWahltyp(e.titel, behoerdeName);
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
