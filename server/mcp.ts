/**
 * MCP-Endpunkt (`/mcp`, Streamable HTTP, ohne Anmeldung – die Daten sind
 * öffentlich). Damit kann ein Sprachmodell die Ergebnisse direkt abfragen:
 * „Wie hat Rössing 2021 bei der Gemeindewahl gestimmt?“
 *
 * Zustandslos: pro Anfrage ein Transport, keine Sitzungen. Das passt zu
 * lesenden Abfragen und überlebt jeden Neustart.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { TERMINE } from "../src/data/termine.ts";
import { BEHOERDEN } from "../src/data/behoerden.ts";
import {
	alsCsv,
	alsTabelle,
	apiBehoerden,
	apiEreignisse,
	apiGebiet,
	apiGebiete,
	apiTermine,
	apiUeberblick,
	apiWahl,
	apiWahlen,
	apiWahlraeume,
	behoerdeAus,
	terminAus,
} from "../src/lib/api.ts";
import { WAHLTYP_REIHENFOLGE } from "../src/lib/wahltyp.ts";

const TERMIN_IDS = TERMINE.map((t) => t.id);
const BEHOERDEN_SLUGS = BEHOERDEN.map((b) => b.slug);
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
const BEHOERDE_FELD = feld(
	"Wahlleitung als Slug ('kreis' für den Landkreis) oder AGS",
	BEHOERDEN_SLUGS,
);
const WAHL_FELD = feld(
	"Wahl-Slug aus dem Werkzeug 'wahlen', z. B. kreistag, landrat, buergermeister, rat, ortsrat-roessing",
);

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

const WERKZEUGE: Werkzeug[] = [
	{
		name: "wahltermine",
		title: "Wahltermine",
		description:
			"Welche Wahltermine es gibt, wie aktuell die Daten sind und welcher gerade live ausgezählt wird.",
		schema: { type: "object", properties: {} },
		fn: () => text({ termine: apiTermine() }),
	},
	{
		name: "ueberblick",
		title: "Überblick zu einem Termin",
		description:
			"Auszählstand kreisweit und je Gemeinde: wie viele Schnellmeldungen da sind und wie viele noch fehlen.",
		schema: {
			type: "object",
			properties: { termin: TERMIN_FELD },
			required: ["termin"],
		},
		fn: (a) => {
			const u = apiUeberblick(str(a, "termin", TERMIN_IDS));
			return u ? text(u) : fehler("Unbekannter Termin");
		},
	},
	{
		name: "behoerden",
		title: "Wahlleitungen",
		description:
			"Alle Städte, Gemeinden und der Landkreis mit ihren Wahlen und dem jeweiligen Auszählstand.",
		schema: {
			type: "object",
			properties: { termin: TERMIN_FELD },
			required: ["termin"],
		},
		fn: (a) => text({ behoerden: apiBehoerden(str(a, "termin", TERMIN_IDS)) }),
	},
	{
		name: "wahlen",
		title: "Wahlen suchen",
		description:
			"Alle Wahlen eines Termins, wahlweise nach Behörde oder Wahlart gefiltert. Liefert die Slugs, die 'ergebnis' und 'gebiete' erwarten.",
		schema: {
			type: "object",
			properties: {
				termin: TERMIN_FELD,
				behoerde: BEHOERDE_FELD,
				typ: feld("Wahlart", WAHLTYP_REIHENFOLGE as unknown as string[]),
			},
			required: ["termin"],
		},
		fn: (a) => {
			const wahlen = apiWahlen(str(a, "termin", TERMIN_IDS), {
				behoerde: strOpt(a, "behoerde"),
				typ: strOpt(a, "typ", WAHLTYP_REIHENFOLGE as unknown as string[]),
			});
			return text({ anzahl: wahlen.length, wahlen });
		},
	},
	{
		name: "ergebnis",
		title: "Ergebnis einer Wahl",
		description:
			"Das Ergebnis einer Wahl – für das ganze Wahlgebiet oder, mit 'gebiet', für einen Ortsteil oder ein einzelnes Wahllokal. Enthält Stimmen, Prozente, Kennzahlen und bei Rats- und Kreistagswahlen die Sitzverteilung samt gewählter Personen. Bei Verhältniswahlen steht unter jeder Partei zusätzlich 'kandidaten': alle Bewerberinnen und Bewerber mit Listenplatz ('platz', kann null sein), Stimmen, Anteil an allen gültigen Stimmen des Gebiets ('prozent') und Mandat ('gewaehlt'). Achtung bei 'prozentInPartei': Das ist der Anteil an den Kandidatenstimmen der eigenen Partei, wie ihn die amtliche Präsentation ausweist – er beschreibt nur die Verteilung innerhalb einer Liste und ist kein Wahlergebnis. Für Aussagen über die Stärke einer Person immer 'prozent' verwenden.",
		schema: {
			type: "object",
			properties: {
				termin: TERMIN_FELD,
				behoerde: BEHOERDE_FELD,
				wahl: WAHL_FELD,
				gebiet: feld(
					"Gebiets-Id aus 'gebiete', z. B. ebene_6_id_3119. Ohne Angabe kommt das Gesamtergebnis.",
				),
			},
			required: ["termin", "behoerde", "wahl"],
		},
		fn: (a) => {
			const termin = str(a, "termin", TERMIN_IDS);
			const b = behoerdeAus(str(a, "behoerde"));
			if (!b)
				return fehler(
					`Unbekannte Behörde. Möglich: ${BEHOERDEN_SLUGS.join(", ")}`,
				);
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
				termin: TERMIN_FELD,
				behoerde: BEHOERDE_FELD,
				wahl: WAHL_FELD,
				ebene: feld("Nur diese Ebene", EBENEN),
				format: feld("Ausgabeform", ["json", "csv"]),
			},
			required: ["termin", "behoerde", "wahl"],
		},
		fn: (a) => {
			const termin = str(a, "termin", TERMIN_IDS);
			const b = behoerdeAus(str(a, "behoerde"));
			if (!b) return fehler("Unbekannte Behörde");
			const g = apiGebiete(termin, b, str(a, "wahl"), {
				ebene: strOpt(a, "ebene", EBENEN),
			});
			if (!g) return fehler("Diese Wahl gibt es bei der Behörde nicht.");
			return strOpt(a, "format", ["json", "csv"]) === "csv"
				? roh(alsCsv(alsTabelle(g)))
				: text({ anzahl: g.length, gebiete: g });
		},
	},
	{
		name: "ticker",
		title: "Eingegangene Schnellmeldungen",
		description:
			"Was zuletzt hereinkam, neueste zuerst – am Wahlabend die Live-Sicht auf den Auszählfortschritt.",
		schema: {
			type: "object",
			properties: {
				termin: TERMIN_FELD,
				limit: {
					type: "integer",
					minimum: 1,
					maximum: 500,
					description: "Anzahl Einträge (Vorgabe 50)",
				},
				behoerde: BEHOERDE_FELD,
			},
			required: ["termin"],
		},
		fn: (a) =>
			text({
				ereignisse: apiEreignisse(str(a, "termin", TERMIN_IDS), {
					limit: zahlOpt(a, "limit", 1, 500),
					behoerde: strOpt(a, "behoerde"),
				}),
			}),
	},
	{
		name: "wahllokale",
		title: "Wahllokale",
		description:
			"Die Wahlräume einer Gemeinde mit Wahlbezirk, Ortsteil und Barrierefreiheit.",
		schema: {
			type: "object",
			properties: { termin: TERMIN_FELD, behoerde: BEHOERDE_FELD },
			required: ["termin", "behoerde"],
		},
		fn: (a) => {
			const b = behoerdeAus(str(a, "behoerde"));
			if (!b) return fehler("Unbekannte Behörde");
			return text({
				wahlraeume: apiWahlraeume(str(a, "termin", TERMIN_IDS), b),
			});
		},
	},
	{
		name: "vergleich",
		title: "Vergleich zweier Termine",
		description:
			"Stellt dieselbe Wahl bei zwei Terminen gegenüber und rechnet die Veränderung je Partei in Prozentpunkten aus.",
		schema: {
			type: "object",
			properties: {
				termin: feld("aktueller Termin", TERMIN_IDS),
				vergleichsTermin: feld("früherer Termin", TERMIN_IDS),
				behoerde: BEHOERDE_FELD,
				wahl: WAHL_FELD,
			},
			required: ["termin", "vergleichsTermin", "behoerde", "wahl"],
		},
		fn: (a) => {
			const termin = str(a, "termin", TERMIN_IDS);
			const vorher = str(a, "vergleichsTermin", TERMIN_IDS);
			const b = behoerdeAus(str(a, "behoerde"));
			if (!b) return fehler("Unbekannte Behörde");
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

const HINWEISE = `Kommunalwahlergebnisse im Landkreis Hildesheim (Niedersachsen).

Drei Termine: 2021 (Kommunalwahlen, amtliche Endergebnisse), 2026 (Wahlabend,
wird laufend aktualisiert) und 2020 – letzterer ausschließlich die
Bürgermeisterwahl der Gemeinde Nordstemmen samt Stichwahl, deren Amtszeit
versetzt zur Ratsperiode läuft; für alle anderen Behörden gibt es unter 2020
nichts. Ebenen von oben nach unten: Landkreis → Gemeinde →
Wahlbereich/Ortsteil → Wahlbezirk (einzelnes Wahllokal).

Übliche Reihenfolge: 'wahlen' zeigt die vorhandenen Wahlen und ihre Slugs,
'ergebnis' liefert Zahlen für ein Wahlgebiet, 'gebiete' alle Untergebiete auf
einmal. Alle Werkzeuge lesen nur.`;

export const baueMcpServer = (): Server => {
	const server = new Server(
		{ name: "wahlen-hildesheim", version: "1.0.0" },
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

	server.setRequestHandler(CallToolRequestSchema, async (anfrage) => {
		const w = WERKZEUGE.find((x) => x.name === anfrage.params.name);
		if (!w)
			return fehler(
				`Unbekanntes Werkzeug '${anfrage.params.name}'. Möglich: ${WERKZEUGE.map((x) => x.name).join(", ")}`,
			);
		try {
			return w.fn((anfrage.params.arguments ?? {}) as Argumente);
		} catch (e) {
			return fehler((e as Error).message);
		}
	});

	return server;
};

/**
 * Node-Handler für `/mcp`. Zustandslos: je Anfrage ein frischer Server und
 * Transport, danach wird beides geschlossen.
 */
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
