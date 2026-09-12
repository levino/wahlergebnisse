import { TESTWAHLEN, type Wahlart, zuordnung } from "../data/wahlzuordnung.ts";

export type Wahltyp = Wahlart;

export const WAHLTYP_LABEL: Record<Wahltyp, string> = {
	landrat: "Landratswahl",
	"landrat-stichwahl": "Stichwahl Landrat",
	kreistag: "Kreistagswahl",
	buergermeister: "Bürgermeisterwahl",
	"buergermeister-stichwahl": "Stichwahl Bürgermeister",
	rat: "Ratswahl",
	ortsrat: "Ortsratswahl",
	sonstige: "Wahl",
	unbekannt: "Unbekannte Wahl",
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
	"unbekannt",
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

const umlaute: Record<string, string> = { ä: "ae", ö: "oe", ü: "ue", ß: "ss" };

export const slugify = (s: string): string =>
	s
		.toLowerCase()
		.replace(/[äöüß]/g, (c) => umlaute[c] ?? c)
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");

/** Eine Wahl, so wie wir sie führen. */
export type WahlDeutung = {
	typ: Wahltyp;
	/** Gebiet der Wahl; leer, wenn die Behörde selbst gewählt wird. */
	gebiet: string;
	/** Adresse unter der Behörde. */
	slug: string;
	/** Beschriftung der Wahl. */
	wahl: string;
	/** Name des Gremiums, nur auf der Ortsebene besetzt. */
	gremium: string;
};

/**
 * Was diese Wahl ist – nachgeschlagen in `src/data/wahlzuordnung`, nicht aus
 * dem Titel der Wahlleitung abgeleitet. Was dort fehlt, bleibt unbekannt.
 */
export const deuteWahl = (
	termin: string,
	behoerde: string,
	wahlId: number,
	gebietId = "",
): WahlDeutung => {
	const z = zuordnung(termin, behoerde, wahlId, gebietId);
	if (!z)
		return {
			typ: "unbekannt",
			gebiet: "",
			slug: `unbekannt-${wahlId}`,
			wahl: WAHLTYP_LABEL.unbekannt,
			gremium: "",
		};
	const [typ, wahl, gebiet = "", gremium = "", adresse] = z;
	return {
		typ,
		gebiet,
		wahl,
		gremium: gremium || (typ === "ortsrat" ? "Ortsrat" : ""),
		slug: adresse ?? (gebiet ? `${typ}-${slugify(gebiet)}` : typ),
	};
};

/** Testdatensatz der Wahlleitung – kein Wahlergebnis. */
export const istTestwahl = (
	termin: string,
	behoerde: string,
	wahlId: number,
): boolean => TESTWAHLEN.has(`${termin}/${behoerde}/${wahlId}`);

export const ebenenUeberschriften = (
	kreisweiteWahlen: readonly string[],
): { eigen: string; kreisweit: string } =>
	kreisweiteWahlen.length > 0 &&
	kreisweiteWahlen.every((w) => w.startsWith("Regions"))
		? { eigen: "Regionsebene", kreisweit: "Regionsweite Wahlen in" }
		: { eigen: "Kreisebene", kreisweit: "Kreisweite Wahlen in" };

/** So viel braucht die Adressbildung von einem Eintrag des Termin-Index. */
export type SlugEingabe = {
	wahlId: number;
	/** Gebiets-Id der Präsentation; unterscheidet Gebiete derselben Wahl. */
	gebietId?: string;
};

export type SlugErgebnis = {
	typ: Wahltyp;
	/** Gebiet der Wahl, leer bei der Behörde selbst – auch für die Anzeige. */
	gebiet: string;
	slug: string;
};

export const wahlSlugs = (
	termin: string,
	behoerde: string,
	eintraege: readonly SlugEingabe[],
): SlugErgebnis[] =>
	eintraege.map((e) => {
		const { typ, gebiet, slug } = deuteWahl(
			termin,
			behoerde,
			e.wahlId,
			e.gebietId ?? "",
		);
		return { typ, gebiet, slug };
	});
