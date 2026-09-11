import type { IncomingMessage, ServerResponse } from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
	TERMINE,
	type Termin,
	behoerdenMitTermin,
	kreiseMitTermin,
	terminById,
	terminGiltFuerBehoerde,
	terminGiltFuerKreis,
	wahlleitungenMitTermin,
} from "../src/data/termine.ts";
import { kreisVorhanden } from "../src/lib/abfragen.ts";
import type { Behoerde } from "../src/data/behoerden.ts";
import { KREISE, type Kreis } from "../src/data/kreise.ts";
import {
	alsCsv,
	alsTabelle,
	apiBehoerden,
	apiEreignisse,
	apiGebiet,
	apiGebiete,
	apiTermin,
	apiUeberblick,
	apiWahl,
	apiWahlen,
	apiWahlraeume,
	behoerdeAus,
	kreisAus,
} from "../src/lib/api.ts";
import { WAHLTYP_REIHENFOLGE } from "../src/lib/wahltyp.ts";

const TERMIN_IDS = TERMINE.map((t) => t.id);
const KREIS_SLUGS = KREISE.map((k) => k.slug);
const EBENEN = ["kreis", "gemeinde", "wahlbereich", "ortsteil", "wahlbezirk"];

type Argumente = Record<string, unknown>;
type Antwort = {
	content: Array<{ type: "text"; text: string }>;
	isError?: boolean;
};

const text = (daten: unknown): Antwort => ({
	content: [{ type: "text", text: JSON.stringify(daten, null, 2) }],
});
const roh = (s: string): Antwort => ({ content: [{ type: "text", text: s }] });
const fehler = (nachricht: string): Antwort => ({
	content: [{ type: "text", text: nachricht }],
	isError: true,
});

/** Kleiner Argument-Leser: prüft Typ und erlaubte Werte, meldet verständlich. */
const str = (a: Argumente, name: string, erlaubt?: string[]): string => {
	const v = a[name];
	if (typeof v !== "string" || v === "")
		throw new Error(
			`Angabe '${name}' fehlt${erlaubt ? `. Möglich: ${erlaubt.join(", ")}` : ""}`,
		);
	if (erlaubt && !erlaubt.includes(v))
		throw new Error(
			`'${v}' ist kein gültiger Wert für '${name}'. Möglich: ${erlaubt.join(", ")}`,
		);
	return v;
};
const strOpt = (
	a: Argumente,
	name: string,
	erlaubt?: string[],
): string | undefined => {
	const v = a[name];
	if (v === undefined || v === null || v === "") return undefined;
	return str(a, name, erlaubt);
};
const zahlOpt = (
	a: Argumente,
	name: string,
	min: number,
	max: number,
): number | undefined => {
	const v = a[name];
	if (v === undefined || v === null) return undefined;
	const n = Number(v);
	if (!Number.isFinite(n)) throw new Error(`'${name}' muss eine Zahl sein`);
	return Math.min(max, Math.max(min, Math.round(n)));
};

const feld = (beschreibung: string, erlaubt?: string[]) => ({
	type: "string",
	description: beschreibung,
	...(erlaubt ? { enum: erlaubt } : {}),
});

const TERMIN_FELD = feld("Wahltermin", TERMIN_IDS);

const KREIS_FELD = feld(
	"Landkreis oder kreisfreie Stadt als Slug – so, wie er als erstes Segment in jeder Adresse steht: 'hildesheim', 'osnabrueck-land', 'region-hannover'. Nicht der Gebietsschlüssel (AGS), der wird aber auch angenommen. Welcher Kreis zu einem Ort gehört, sagt 'gemeinde_suchen'; alle Kreise nennt 'kreise'.",
	KREIS_SLUGS,
);

const BEHOERDE_FELD = feld(
	"Wahlleitung innerhalb des Kreises, als Slug: 'kreis' meint den Landkreis bzw. die kreisfreie Stadt selbst, sonst der Slug einer Stadt, Gemeinde oder Samtgemeinde aus 'behoerden' oder 'gemeinde_suchen' (der Gebietsschlüssel geht auch). Slugs gelten nur innerhalb ihres Kreises – dasselbe Wort kann in einem anderen Kreis einen anderen Ort meinen.",
);
const WAHL_FELD = feld(
	"Wahl-Slug aus dem Werkzeug 'wahlen', z. B. kreistag, landrat, buergermeister, rat, ortsrat-roessing",
);

const kreisArg = (a: Argumente): Kreis => {
	const wert = a.kreis;
	if (typeof wert !== "string" || wert === "")
		throw new Error(
			"Angabe 'kreis' fehlt. Sie ist Pflicht, weil Gemeindenamen sich in Niedersachsen wiederholen und ein Ortsname allein nicht eindeutig ist. 'gemeinde_suchen' nennt den Kreis zu einem Ortsnamen, 'kreise' listet alle 45.",
		);
	const k = kreisAus(wert);
	if (!k)
		throw new Error(
			`'${wert}' ist kein Kreis dieser App. 'kreise' listet alle 45 Slugs, 'gemeinde_suchen' findet den Kreis zu einem Ortsnamen.`,
		);
	return k;
};

const lueckeHinweis = (
	kreis: Kreis,
	terminId?: string,
	behoerde?: Behoerde,
): Antwort | undefined => {
	if (!kreisVorhanden(kreis))
		return roh(
			`Für ${kreis.name} liegen hier keine Ergebnisse vor.${kreis.hinweis ? ` ${kreis.hinweis}` : ""} Das ist kein Fehler der Abfrage: Diese Wahlleitung veröffentlicht nicht (mehr) über votemanager. Zahlen gibt es nur bei ihr selbst.`,
		);
	if (!terminId) return undefined;
	const t = terminById(terminId);
	if (!t) return undefined;
	if (
		behoerde
			? terminGiltFuerBehoerde(t, kreis, behoerde)
			: terminGiltFuerKreis(t, kreis.slug)
	)
		return undefined;
	const eigene = behoerdenMitTermin(t, kreis).map((b) => b.slug);
	if (eigene.length && !behoerde)
		return roh(
			`'${t.titel}' ist kein kreisweiter Wahltag in ${kreis.name}, sondern der Wahltag einzelner Wahlleitungen: ${eigene.join(", ")}. Dieselbe Abfrage mit 'behoerde' auf eine davon liefert die Zahlen.`,
		);
	if (behoerde)
		return roh(
			`${behoerde.name} hat am Wahltag '${t.titel}' nicht gewählt.${eigene.length ? ` In ${kreis.kurz} taten das: ${eigene.join(", ")}.` : ""} 'wahltermine' mit 'kreis' zeigt, welche Termine wo vorliegen.`,
		);
	const mit = kreiseMitTermin(t);
	const wo =
		mit.length > 6
			? `${mit.length} andere Kreise`
			: mit.map((s) => KREISE.find((k) => k.slug === s)?.kurz ?? s).join(", ");
	const stattdessen = TERMINE.filter((x) => terminGiltFuerKreis(x, kreis.slug))
		.map((x) => x.id)
		.join(", ");
	return roh(
		`'${t.titel}' liegt für ${kreis.name} nicht vor – dieser Termin ist bisher nur für ${wo} eingelesen. Für ${kreis.kurz} gibt es: ${stattdessen}.`,
	);
};

/** Behörde im Kreis auflösen, mit einer Meldung, die weiterhilft. */
const behoerdeArg = (a: Argumente, kreis: Kreis): Behoerde => {
	const wert = str(a, "behoerde");
	const b = behoerdeAus(wert, kreis);
	if (!b)
		throw new Error(
			`'${wert}' ist keine Wahlleitung in ${kreis.name}. 'behoerden' listet die vorhandenen; liegt der Ort in einem anderen Kreis, hilft 'gemeinde_suchen'.`,
		);
	return b;
};

/** Umlaute und Zeichensetzung weg, damit „Rössing“ und „roessing“ dasselbe sind. */
const normName = (s: string): string =>
	s
		.toLowerCase()
		.replace(/ä/g, "ae")
		.replace(/ö/g, "oe")
		.replace(/ü/g, "ue")
		.replace(/ß/g, "ss")
		.replace(/[^a-z0-9]+/g, " ")
		.trim();

type IndexEintrag = { kreis: Kreis; behoerde: Behoerde; texte: string[] };

/** Alle Wahlleitungen mit ihrem Kreis – einmal aufgebaut, nur gelesen. */
const SUCHINDEX: IndexEintrag[] = KREISE.flatMap((kreis) =>
	kreis.behoerden.map((behoerde) => ({
		kreis,
		behoerde,
		texte: [
			normName(behoerde.name),
			normName(behoerde.kurz),
			normName(behoerde.slug),
			...(behoerde.art === "kreis"
				? [normName(kreis.kurz), normName(kreis.name)]
				: []),
		],
	})),
);

/** 0 = genau, 1 = Wortanfang, 2 = irgendwo; kleiner ist besser. */
const rang = (texte: string[], frage: string): number | undefined => {
	if (texte.some((t) => t === frage)) return 0;
	if (texte.some((t) => t.startsWith(frage) || t.includes(` ${frage}`)))
		return 1;
	if (texte.some((t) => t.includes(frage))) return 2;
	return undefined;
};

const gemeindeSuche = (frage: string, grenze = 40) => {
	const roheFrage = frage.trim();
	const q = normName(frage);
	const ziffern = /^\d{5,9}$/.test(roheFrage);
	if (!ziffern && q.length < 2) return { gesamt: 0, liste: [] };
	const treffer = SUCHINDEX.flatMap((e) => {
		const r = ziffern
			? e.behoerde.ags.startsWith(roheFrage)
				? 0
				: undefined
			: rang(e.texte, q);
		return r === undefined ? [] : [{ ...e, rang: r }];
	}).sort(
		(a, b) =>
			a.rang - b.rang ||
			a.kreis.kurz.localeCompare(b.kreis.kurz, "de") ||
			a.behoerde.kurz.localeCompare(b.behoerde.kurz, "de"),
	);
	return {
		gesamt: treffer.length,
		liste: treffer.slice(0, grenze).map((e) => ({
			kreis: e.kreis.slug,
			kreisName: e.kreis.name,
			behoerde: e.behoerde.slug,
			name: e.behoerde.name,
			art: e.behoerde.art,
			ags: e.behoerde.ags,
			/** false: Für diesen Kreis liegt keine benutzbare Präsentation vor. */
			ergebnisseVorhanden: e.kreis.vorhanden,
		})),
	};
};

type Werkzeug = {
	name: string;
	title: string;
	description: string;
	schema: {
		type: "object";
		properties: Record<string, unknown>;
		required?: string[];
	};
	fn: (a: Argumente) => Antwort;
};

const terminEintrag = (t: Termin) => {
	const gilt = kreiseMitTermin(t);
	const nur = wahlleitungenMitTermin(t);
	return {
		...apiTermin(t),
		gilt: gilt.length === KREISE.length ? "alle Kreise" : gilt,
		...(nur.length ? { nurWahlleitungen: nur } : {}),
	};
};

export const WERKZEUGE: Werkzeug[] = [
	{
		name: "kreise",
		title: "Landkreise und kreisfreie Städte",
		description:
			"Alle 45 niedersächsischen Landkreise und kreisfreien Städte mit ihrem Slug – dem Wert, den alle anderen Werkzeuge als 'kreis' erwarten. Je Kreis kommen Slug, amtlicher Name, Kurzname, Gebietsschlüssel und die Zahl seiner Wahlleitungen zurück. 'ergebnisseVorhanden' ist bei sieben Kreisen false: Sie veröffentlichen nicht über votemanager, 'hinweis' sagt warum – Abfragen dazu liefern eine Erklärung statt Zahlen. Mit 'suche' lässt sich die Liste auf einen Namensteil eingrenzen. Wer einen Ortsnamen hat und den Kreis dazu sucht, nimmt 'gemeinde_suchen'.",
		schema: {
			type: "object",
			properties: {
				suche: feld(
					"Namensteil, z. B. 'osna' oder 'hannover'. Ohne Angabe kommen alle 45.",
				),
			},
		},
		fn: (a) => {
			const q = strOpt(a, "suche");
			const n = q ? normName(q) : undefined;
			const kreise = KREISE.filter(
				(k) =>
					!n ||
					normName(k.kurz).includes(n) ||
					normName(k.name).includes(n) ||
					normName(k.slug).includes(n),
			).map((k) => ({
				slug: k.slug,
				name: k.name,
				kurz: k.kurz,
				ags: k.ags,
				ergebnisseVorhanden: k.vorhanden,
				...(k.hinweis ? { hinweis: k.hinweis } : {}),
				anzahlWahlleitungen: k.behoerden.length,
			}));
			return text({ anzahl: kreise.length, kreise });
		},
	},
	{
		name: "gemeinde_suchen",
		title: "Ort finden – in welchem Kreis liegt er?",
		description:
			"Sucht einen Ortsnamen über alle 45 Kreise hinweg und sagt, zu welchem Kreis er gehört. Das ist der übliche erste Schritt, wenn die Frage einen Ort nennt, aber keinen Kreis („Wie hat Nordstemmen gewählt?“). Jeder Treffer nennt 'kreis' und 'behoerde' – genau die beiden Werte, die 'ergebnis', 'wahlen' und 'gebiete' erwarten. Gefunden werden Wahlleitungen, also Landkreise, kreisfreie Städte, Städte, Gemeinden und Samtgemeinden; Ortsteile und Wahlbezirke stehen nicht darin, die kommen aus 'gebiete'. Trägt mehr als ein Ort den Namen, stehen alle Treffer in der Liste und 'eindeutig' ist false – dann bitte nachfragen, welcher gemeint ist, statt den ersten zu nehmen. Umlaute, Groß- und Kleinschreibung und Zusätze wie 'Stadt' oder 'Gemeinde' sind egal; ein Gebietsschlüssel geht auch.",
		schema: {
			type: "object",
			properties: {
				name: feld(
					"Ortsname oder Teil davon, z. B. 'Nordstemmen', 'Neuenkirchen', 'Alfeld'. Auch ein Gebietsschlüssel (AGS).",
				),
			},
			required: ["name"],
		},
		fn: (a) => {
			const frage = str(a, "name");
			const { gesamt, liste } = gemeindeSuche(frage);
			return text({
				suche: frage,
				anzahl: gesamt,
				eindeutig: gesamt === 1,
				...(gesamt === 0
					? {
							hinweis:
								"Kein Treffer. Gesucht wird nur unter den Wahlleitungen (Landkreise, kreisfreie Städte, Städte, Gemeinden, Samtgemeinden). Ortsteile und Wahlbezirke stehen nicht hier, sondern im Werkzeug 'gebiete' zur jeweiligen Wahl.",
						}
					: {}),
				...(gesamt > 1
					? {
							hinweis:
								"Mehrere Wahlleitungen tragen diesen Namen. Bitte klären, welche gemeint ist – nicht einfach die erste nehmen.",
						}
					: {}),
				...(gesamt > liste.length
					? { gekuerzt: `nur die ersten ${liste.length} von ${gesamt}` }
					: {}),
				treffer: liste,
			});
		},
	},
	{
		name: "wahltermine",
		title: "Wahltermine",
		description:
			"Welche Wahltermine es gibt, wie aktuell die Daten sind und welcher gerade live ausgezählt wird. Termine hängen an einer Ebene: 'gilt' sagt, für welche Kreise ein Termin ein kreisweiter Wahltag ist (Kommunalwahl, Landrats- und Kreistagswahl); 'nurWahlleitungen' nennt die einzelnen Städte und Gemeinden, die ihn sonst noch führen – fast immer eine Bürgermeisterwahl, deren Amtszeit versetzt zur Ratsperiode läuft. Mit 'kreis' kommen unter 'termine' die kreisweiten Wahltage und unter 'weitereTermine' die der einzelnen Wahlleitungen, jeweils mit 'nurBei'. Wer einen Termin aus 'weitereTermine' abfragt, muss 'behoerde' mitgeben.",
		schema: {
			type: "object",
			properties: {
				kreis: {
					...KREIS_FELD,
					description: `Optional – ohne Angabe kommen alle Termine. ${KREIS_FELD.description}`,
				},
			},
		},
		fn: (a) => {
			if (strOpt(a, "kreis") === undefined)
				return text({ termine: TERMINE.map(terminEintrag) });
			const kreis = kreisArg(a);
			const kreisweit = TERMINE.filter((t) =>
				terminGiltFuerKreis(t, kreis.slug),
			);
			const weitere = TERMINE.filter(
				(t) => !kreisweit.includes(t) && behoerdenMitTermin(t, kreis).length,
			).map((t) => ({
				...apiTermin(t),
				nurBei: behoerdenMitTermin(t, kreis).map((b) => b.slug),
			}));
			return text({
				kreis: kreis.slug,
				termine: kreisweit.map(terminEintrag),
				...(weitere.length ? { weitereTermine: weitere } : {}),
			});
		},
	},
	{
		name: "ueberblick",
		title: "Überblick zu einem Termin",
		description:
			"Auszählstand eines Kreises und je Gemeinde darin: wie viele Schnellmeldungen da sind und wie viele noch fehlen.",
		schema: {
			type: "object",
			properties: { kreis: KREIS_FELD, termin: TERMIN_FELD },
			required: ["kreis", "termin"],
		},
		fn: (a) => {
			const kreis = kreisArg(a);
			const termin = str(a, "termin", TERMIN_IDS);
			const luecke = lueckeHinweis(kreis, termin);
			if (luecke) return luecke;
			const u = apiUeberblick(termin, kreis);
			return u ? text(u) : fehler("Unbekannter Termin");
		},
	},
	{
		name: "behoerden",
		title: "Wahlleitungen eines Kreises",
		description:
			"Alle Städte, Gemeinden und Samtgemeinden eines Kreises samt der Kreisbehörde selbst, mit ihren Wahlen und dem jeweiligen Auszählstand. Liefert die 'behoerde'-Slugs, die 'ergebnis', 'gebiete' und 'wahllokale' erwarten.",
		schema: {
			type: "object",
			properties: { kreis: KREIS_FELD, termin: TERMIN_FELD },
			required: ["kreis", "termin"],
		},
		fn: (a) => {
			const kreis = kreisArg(a);
			const termin = str(a, "termin", TERMIN_IDS);
			const luecke = lueckeHinweis(kreis, termin);
			if (luecke) return luecke;
			return text({
				kreis: kreis.slug,
				behoerden: apiBehoerden(termin, kreis),
			});
		},
	},
	{
		name: "wahlen",
		title: "Wahlen suchen",
		description:
			"Alle Wahlen eines Termins in einem Kreis, wahlweise nach Wahlleitung oder Wahlart gefiltert. Liefert die Slugs, die 'ergebnis' und 'gebiete' erwarten.",
		schema: {
			type: "object",
			properties: {
				kreis: KREIS_FELD,
				termin: TERMIN_FELD,
				behoerde: BEHOERDE_FELD,
				typ: feld("Wahlart", WAHLTYP_REIHENFOLGE as unknown as string[]),
			},
			required: ["kreis", "termin"],
		},
		fn: (a) => {
			const kreis = kreisArg(a);
			const termin = str(a, "termin", TERMIN_IDS);
			const gefiltert = strOpt(a, "behoerde");
			const luecke = lueckeHinweis(
				kreis,
				termin,
				gefiltert ? behoerdeArg(a, kreis) : undefined,
			);
			if (luecke) return luecke;
			const wahlen = apiWahlen(
				termin,
				{
					behoerde: gefiltert,
					typ: strOpt(a, "typ", WAHLTYP_REIHENFOLGE as unknown as string[]),
				},
				kreis,
			);
			return text({ kreis: kreis.slug, anzahl: wahlen.length, wahlen });
		},
	},
	{
		name: "ergebnis",
		title: "Ergebnis einer Wahl",
		description:
			"Das Ergebnis einer Wahl – für das ganze Wahlgebiet oder, mit 'gebiet', für einen Ortsteil oder ein einzelnes Wahllokal. Enthält Stimmen, Prozente, Kennzahlen und bei Rats- und Kreistagswahlen die Sitzverteilung samt gewählter Personen. Bei Verhältniswahlen steht unter jeder Partei zusätzlich 'kandidaten': alle Bewerberinnen und Bewerber mit Listenplatz ('platz', kann null sein), Stimmen, Anteil an allen gültigen Stimmen des Gebiets ('prozent') und Mandat ('gewaehlt'). Achtung bei 'prozentInPartei': Das ist der Anteil an den Kandidatenstimmen der eigenen Partei, wie ihn die amtliche Präsentation ausweist – er beschreibt nur die Verteilung innerhalb einer Liste und ist kein Wahlergebnis. Für Aussagen über die Stärke einer Person immer 'prozent' verwenden. 'sitze' ist immer die von der Wahlleitung veröffentlichte Verteilung und null, solange sie keine veröffentlicht hat – am Wahlabend also den ganzen Abend über. Die Hochrechnung, die die Seiten in dieser Zeit anzeigen, wird hier bewusst nicht geliefert: Sie ist eine Schätzung mit angesagter Unsicherheit und keine Zahl, die als Ergebnis weitergegeben werden darf.",
		schema: {
			type: "object",
			properties: {
				kreis: KREIS_FELD,
				termin: TERMIN_FELD,
				behoerde: BEHOERDE_FELD,
				wahl: WAHL_FELD,
				gebiet: feld(
					"Gebiets-Id aus 'gebiete', z. B. ebene_6_id_3119. Ohne Angabe kommt das Gesamtergebnis.",
				),
			},
			required: ["kreis", "termin", "behoerde", "wahl"],
		},
		fn: (a) => {
			const kreis = kreisArg(a);
			const termin = str(a, "termin", TERMIN_IDS);
			const b = behoerdeArg(a, kreis);
			const luecke = lueckeHinweis(kreis, termin, b);
			if (luecke) return luecke;
			const wahl = str(a, "wahl");
			const gebiet = strOpt(a, "gebiet");
			if (gebiet) {
				const g = apiGebiet(termin, b, wahl, gebiet);
				return g
					? text(g)
					: fehler(`Das Gebiet ${gebiet} gibt es bei dieser Wahl nicht.`);
			}
			const w = apiWahl(termin, b, wahl);
			return w
				? text(w)
				: fehler(
						`Die Wahl '${wahl}' gibt es bei ${b.name} nicht – 'wahlen' zeigt die vorhandenen.`,
					);
		},
	},
	{
		name: "gebiete",
		title: "Alle Gebiete einer Wahl",
		description:
			"Die Ergebnisse aller Untergebiete einer Wahl auf einmal – Gemeinden, Ortsteile oder Wahlbezirke. Wie bei 'ergebnis' enthält jede Partei bei Verhältniswahlen ihre Bewerberinnen und Bewerber mit Listenplatz, Stimmen, Anteil an allen gültigen Stimmen ('prozent') und Mandat ('gewaehlt'); die Listenplätze gelten je Gebiet, weil jede Partei bei der Kreistagswahl pro Wahlbereich eine eigene Liste aufstellt. 'prozentInPartei' ist auch hier nur der Anteil innerhalb der eigenen Liste, kein Wahlergebnis. Mit format='csv' kommt eine flache Tabelle, eine Zeile je Gebiet und Partei – ohne die Bewerberdaten, die gibt es nur als JSON.",
		schema: {
			type: "object",
			properties: {
				kreis: KREIS_FELD,
				termin: TERMIN_FELD,
				behoerde: BEHOERDE_FELD,
				wahl: WAHL_FELD,
				ebene: feld("Nur diese Ebene", EBENEN),
				format: feld("Ausgabeform", ["json", "csv"]),
			},
			required: ["kreis", "termin", "behoerde", "wahl"],
		},
		fn: (a) => {
			const kreis = kreisArg(a);
			const termin = str(a, "termin", TERMIN_IDS);
			const b = behoerdeArg(a, kreis);
			const luecke = lueckeHinweis(kreis, termin, b);
			if (luecke) return luecke;
			const g = apiGebiete(termin, b, str(a, "wahl"), {
				ebene: strOpt(a, "ebene", EBENEN),
			});
			if (!g)
				return fehler(
					`Die Wahl gibt es bei ${b.name} nicht – 'wahlen' zeigt die vorhandenen.`,
				);
			return strOpt(a, "format", ["json", "csv"]) === "csv"
				? roh(alsCsv(alsTabelle(g)))
				: text({ anzahl: g.length, gebiete: g });
		},
	},
	{
		name: "ticker",
		title: "Eingegangene Schnellmeldungen",
		description:
			"Was zuletzt in einem Kreis hereinkam, neueste zuerst – am Wahlabend die Live-Sicht auf den Auszählfortschritt.",
		schema: {
			type: "object",
			properties: {
				kreis: KREIS_FELD,
				termin: TERMIN_FELD,
				limit: {
					type: "integer",
					minimum: 1,
					maximum: 500,
					description: "Anzahl Einträge (Vorgabe 50)",
				},
				behoerde: BEHOERDE_FELD,
			},
			required: ["kreis", "termin"],
		},
		fn: (a) => {
			const kreis = kreisArg(a);
			const termin = str(a, "termin", TERMIN_IDS);
			const nurBehoerde = strOpt(a, "behoerde");
			const luecke = lueckeHinweis(
				kreis,
				termin,
				nurBehoerde ? behoerdeArg(a, kreis) : undefined,
			);
			if (luecke) return luecke;
			return text({
				kreis: kreis.slug,
				ereignisse: apiEreignisse(
					termin,
					{
						limit: zahlOpt(a, "limit", 1, 500),
						behoerde: nurBehoerde,
					},
					kreis,
				),
			});
		},
	},
	{
		name: "wahllokale",
		title: "Wahllokale",
		description:
			"Die Wahlräume einer Gemeinde mit Wahlbezirk, Ortsteil und Barrierefreiheit.",
		schema: {
			type: "object",
			properties: {
				kreis: KREIS_FELD,
				termin: TERMIN_FELD,
				behoerde: BEHOERDE_FELD,
			},
			required: ["kreis", "termin", "behoerde"],
		},
		fn: (a) => {
			const kreis = kreisArg(a);
			const termin = str(a, "termin", TERMIN_IDS);
			const b = behoerdeArg(a, kreis);
			const luecke = lueckeHinweis(kreis, termin, b);
			if (luecke) return luecke;
			return text({ wahlraeume: apiWahlraeume(termin, b) });
		},
	},
	{
		name: "vergleich",
		title: "Vergleich zweier Termine",
		description:
			"Stellt dieselbe Wahl bei zwei Terminen gegenüber und rechnet die Veränderung je Partei in Prozentpunkten aus. Beide Termine müssen für den Kreis vorliegen – die Archivtermine gibt es bisher nur für Hildesheim, siehe 'wahltermine'.",
		schema: {
			type: "object",
			properties: {
				kreis: KREIS_FELD,
				termin: feld("aktueller Termin", TERMIN_IDS),
				vergleichsTermin: feld("früherer Termin", TERMIN_IDS),
				behoerde: BEHOERDE_FELD,
				wahl: WAHL_FELD,
			},
			required: ["kreis", "termin", "vergleichsTermin", "behoerde", "wahl"],
		},
		fn: (a) => {
			const kreis = kreisArg(a);
			const termin = str(a, "termin", TERMIN_IDS);
			const vorher = str(a, "vergleichsTermin", TERMIN_IDS);
			const b = behoerdeArg(a, kreis);
			const luecke =
				lueckeHinweis(kreis, termin, b) ?? lueckeHinweis(kreis, vorher, b);
			if (luecke) return luecke;
			const wahl = str(a, "wahl");
			const jetzt = apiWahl(termin, b, wahl);
			const frueher = apiWahl(vorher, b, wahl);
			if (!jetzt?.ergebnis)
				return fehler(
					`Für '${wahl}' bei ${b.name} gibt es zu ${termin} noch kein Ergebnis.`,
				);
			const alt = new Map(
				(frueher?.ergebnis?.parteien ?? []).map((p) => [p.key, p.prozent]),
			);
			return text({
				kreis: kreis.slug,
				behoerde: b.slug,
				wahl,
				termin,
				vergleichsTermin: vorher,
				wahlbeteiligung: {
					[termin]: jetzt.ergebnis.kennzahlen.wahlbeteiligung,
					[vorher]: frueher?.ergebnis?.kennzahlen.wahlbeteiligung ?? null,
				},
				parteien: jetzt.ergebnis.parteien.map((p) => {
					const v = alt.get(p.key);
					return {
						key: p.key,
						kurz: p.kurz,
						prozent: p.prozent,
						prozentVorher: v ?? null,
						veraenderung:
							v === undefined ? null : Math.round((p.prozent - v) * 100) / 100,
						sitze: p.sitze ?? null,
					};
				}),
			});
		},
	},
];

const HINWEISE = `Kommunalwahlergebnisse in Niedersachsen – alle 45 Landkreise
und kreisfreien Städte.

Der Kreis ist Pflicht. Gemeindenamen wiederholen sich in Niedersachsen, ein
Ortsname allein ist nicht eindeutig. Deshalb verlangt jedes Werkzeug, das
Zahlen liefert, den Kreis-Slug ('hildesheim', 'osnabrueck-land') – nicht den
Gebietsschlüssel. Nennt die Frage nur einen Ort, zuerst 'gemeinde_suchen'
aufrufen: Es liefert Kreis und Wahlleitung und zeigt an, wenn der Name
mehrdeutig ist. 'kreise' listet alle Kreise.

Übliche Reihenfolge: 'gemeinde_suchen' (oder 'kreise') → 'wahlen' zeigt die
vorhandenen Wahlen und ihre Slugs → 'ergebnis' liefert Zahlen für ein
Wahlgebiet, 'gebiete' alle Untergebiete auf einmal. Alle Werkzeuge lesen nur.

Termine hängen an einer Ebene. Kreisweite Wahltage – die Kommunalwahl 2026
(Wahlabend, wird laufend aktualisiert), die Kommunalwahl 2021 (amtliche
Endergebnisse) und einzelne Landratswahlen – werden mit 'kreis' abgefragt.
Bürgermeister- und Oberbürgermeisterwahlen laufen dagegen in eigenen
Amtszeiten: Sie liegen an eigenen Wahltagen und gehören **einer** Stadt oder
Gemeinde, etwa die Bürgermeisterwahl der Gemeinde Nordstemmen vom 13.09.2020.
Solche Termine brauchen zusätzlich 'behoerde'; ohne sie kommt eine Erklärung
statt Zahlen. 'wahltermine' trennt beides: 'termine' sind die kreisweiten,
'weitereTermine' die einzelner Wahlleitungen samt 'nurBei'.

Sieben Kreise veröffentlichen nicht über votemanager; Abfragen dazu antworten
mit einer Erklärung statt mit Zahlen. Das ist kein Fehler und kein Grund, es
erneut zu versuchen.

Ebenen von oben nach unten: Kreis → Gemeinde → Wahlbereich/Ortsteil →
Wahlbezirk (einzelnes Wahllokal).`;

export const rufeWerkzeug = (
	name: string,
	argumente: Argumente = {},
): Antwort => {
	const w = WERKZEUGE.find((x) => x.name === name);
	if (!w)
		return fehler(
			`Unbekanntes Werkzeug '${name}'. Möglich: ${WERKZEUGE.map((x) => x.name).join(", ")}`,
		);
	try {
		return w.fn(argumente);
	} catch (e) {
		return fehler((e as Error).message);
	}
};

export const baueMcpServer = (): Server => {
	const server = new Server(
		{ name: "wahlergebnisse-niedersachsen", version: "2.0.0" },
		{ capabilities: { tools: {} }, instructions: HINWEISE },
	);

	server.setRequestHandler(ListToolsRequestSchema, async () => ({
		tools: WERKZEUGE.map((w) => ({
			name: w.name,
			title: w.title,
			description: w.description,
			inputSchema: w.schema,
		})),
	}));

	server.setRequestHandler(CallToolRequestSchema, async (anfrage) =>
		rufeWerkzeug(
			anfrage.params.name,
			(anfrage.params.arguments ?? {}) as Argumente,
		),
	);

	return server;
};

export const mcpHandler = async (
	req: IncomingMessage,
	res: ServerResponse,
	body: unknown,
): Promise<void> => {
	const server = baueMcpServer();
	const transport = new StreamableHTTPServerTransport({
		sessionIdGenerator: undefined,
		enableJsonResponse: true,
	});
	res.on("close", () => {
		transport.close();
		server.close();
	});
	await server.connect(transport);
	await transport.handleRequest(req, res, body);
};
