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

const RATSNAMEN: Record<string, string> = {
	Gemeindewahl: "Gemeinderatswahl",
	Samtgemeindewahl: "Samtgemeinderatswahl",
	Stadtwahl: "Stadtratswahl",
};

export const kurzBezeichnung = (titel: string, typ: Wahltyp): string => {
	const kern = titel.split(" - ")[0] ?? titel;
	const ober = /oberbürgermeister/i.test(kern);
	const samtgemeinde = /samtgemeinde/i.test(kern);
	const region = istRegionswahl(kern);
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
			return region ? "Regionspräsidentenwahl" : "Landratswahl";
		case "landrat-stichwahl":
			return region ? "Stichwahl Regionspräsident" : "Stichwahl Landrat";
		case "kreistag":
			return region ? "Regionsversammlungswahl" : "Kreistagswahl";
		default:
			return RATSNAMEN[kern] ?? kern;
	}
};

export const wahltypLabel = (typ: Wahltyp, titel = ""): string =>
	istRegionswahl(titel) ? kurzBezeichnung(titel, typ) : WAHLTYP_LABEL[typ];

const TEST_MARKER = /\b(?:TEST|MUSTER|PROBE|DEMO)\b/;

/** Zusammengesetzt ist es eindeutig, gleich wie geschrieben. */
const TEST_WAHLWORT = /\b(?:test|muster|probe|demo)wahl\b/i;

export const istTestwahl = (titel: string): boolean =>
	TEST_MARKER.test(titel) || TEST_WAHLWORT.test(titel);

const istKreisbehoerde = (behoerdeName: string): boolean =>
	/\blandkreis\b|^region\b/i.test(behoerdeName.trim());

export const erkenneWahltyp = (titel: string, behoerdeName = ""): Wahltyp => {
	const t = titel.toLowerCase();
	const stichwahl = t.includes("stichwahl");
	if (t.includes("landrat") || t.includes("landrät"))
		return stichwahl ? "landrat-stichwahl" : "landrat";
	if (/\bkreiswahl/.test(t) || t.includes("kreistag")) return "kreistag";
	if (/bürger?meister/.test(t))
		return stichwahl ? "buergermeister-stichwahl" : "buergermeister";
	if (/orts?t?rat|ortschaftsrat/.test(t)) return "ortsrat";
	if (
		/gemeind(?:e(?:de)?)?wahl/.test(t) ||
		t.includes("stadtratswahl") ||
		t.includes("wahl des rates") ||
		t.includes("ratswahl") ||
		/\b(?:samt)?gemeinde?rat|\bstadtrat|\brat(?:e?s)?\b/.test(t)
	)
		return "rat";
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

export const gremiumName = (titel: string, typ: Wahltyp): string => {
	if (typ !== "ortsrat") return wahltypLabel(typ, titel);
	const m = (titel.split(" - ")[0] ?? titel).match(
		/\b((?:stadt)?bezirksrat|ortschaftsrat|ortsbeirat|ortsrat)/i,
	);
	if (!m) return "Ortsrat";
	return m[1][0].toUpperCase() + m[1].slice(1);
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

const BAUSTEIN =
	"(?:samt)?gemeinde|einheitsgemeinde|inselgemeinde|mitglieds|(?:hanse|berg)?stadt|fleckens?|ortschafts?|orts?|bezirks?|landkreis|kreistag(?:e?s)?|kreis|rat(?:e?s)?|tag(?:e?s)?|(?:ober)?bürger?meisters?(?:in|innen)?|landr(?:at|ats|ates|äte|ätin|ätinnen)";

/** Wahl-Wörter, die für sich stehen können ("Wahl", "Stichwahl", "Direktwahl"). */
const WAHLWORT = "(?:direkt|neu|stich|kommunal|urnen)?wahl(?:en)?";

/** Füllwörter und leere Bezeichnungen, die nie ein Gebiet benennen. */
const FUELLWORT =
	"der|die|das|des|dem|den|ein|eine|einer|eines|zum|zur|zu|im|in|am|an|auf|für|von|vom|und|oder|über|ergebnis(?:se)?|gesamt(?:ergebnis)?|wahlgebiet(?:e?s)?";

const VOKABEL = new RegExp(
	`^(?:${FUELLWORT}|${WAHLWORT}|(?:${BAUSTEIN})+(?:${WAHLWORT})?)$`,
	"i",
);

export const gebietsname = (bezeichnung: string): string => {
	const ohneDatum = bezeichnung
		.replace(/\s+am\s+\d{1,2}\.\s*\S+\s*(?:19|20)\d{2}\s*$/i, "")
		.replace(/\s*\b(?:19|20)\d{2}\b\s*$/, "")
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
	return (
		gebietsKandidaten(titel, gebietTitel).find(
			(n) => !gleicherName(n, behoerde),
		) ?? ""
	);
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
