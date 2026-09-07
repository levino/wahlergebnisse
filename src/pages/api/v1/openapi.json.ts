import type { APIRoute } from "astro";
import { TERMINE } from "../../../data/termine.ts";
import { KREISE } from "../../../data/kreise.ts";
import { WAHLTYP_REIHENFOLGE } from "../../../lib/wahltyp.ts";
import { basisUrl, json, optionen } from "../../../lib/http.ts";

export const prerender = false;

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });

/** OpenAPI 3.1 – handgepflegt, damit die Beschreibungen etwas taugen. */
export const GET: APIRoute = ({ request, url, site }) => {
	const basis = basisUrl(site, url);
	const spec = {
		openapi: "3.1.0",
		info: {
			title: "Wahlergebnisse Niedersachsen",
			version: "1.0.0",
			description:
				"Kommunalwahlergebnisse der niedersächsischen Landkreise und kreisfreien Städte, aufbereitet aus den amtlichen Wahlpräsentationen (votemanager). Jede Zahl trägt einen Namen, jede Ebene hat dasselbe Format, alles gibt es auch als CSV. Der Kreis ist das erste Segment jedes Pfades. Nur Lesezugriffe, keine Anmeldung.",
			contact: { url: "https://github.com/levino/wahlergebnisse/issues" },
			license: {
				name: "Amtliche Ergebnisse der Wahlleitungen; Geodaten siehe /api/v1/",
				url: `${basis}/api/v1/`,
			},
		},
		servers: [{ url: `${basis}/api/v1` }],
		paths: {
			"/": {
				get: {
					summary: "Einstieg mit allen Pfaden und Lizenzen",
					responses: { "200": { description: "OK" } },
				},
			},
			"/termine": {
				get: {
					summary: "Verfügbare Wahltermine",
					responses: { "200": { description: "OK" } },
				},
			},
			"/kreise": {
				get: {
					summary: "Landkreise und kreisfreie Städte mit ihren Wahlleitungen",
					responses: { "200": { description: "OK" } },
				},
			},
			"/{kreis}": {
				get: {
					summary: "Ein Kreis mit seinen Wahlleitungen",
					parameters: [ref("KreisParam")],
					responses: {
						"200": { description: "OK" },
						"404": { description: "Unbekannter Kreis" },
					},
				},
			},
			"/{kreis}/{termin}": {
				get: {
					summary: "Überblick: Stand und Auszählfortschritt",
					parameters: [ref("KreisParam"), ref("TerminParam")],
					responses: {
						"200": { description: "OK" },
						"404": { description: "Unbekannter Termin" },
					},
				},
			},
			"/{kreis}/{termin}/behoerden": {
				get: {
					summary: "Wahlleitungen mit ihren Wahlen",
					parameters: [ref("KreisParam"), ref("TerminParam")],
					responses: { "200": { description: "OK" } },
				},
			},
			"/{kreis}/{termin}/wahlen": {
				get: {
					summary: "Alle Wahlen des Termins",
					parameters: [
						ref("KreisParam"),
						ref("TerminParam"),
						{
							name: "behoerde",
							in: "query",
							schema: { type: "string" },
							description: "Slug oder AGS",
						},
						{
							name: "typ",
							in: "query",
							schema: { type: "string", enum: WAHLTYP_REIHENFOLGE },
						},
					],
					responses: { "200": { description: "OK" } },
				},
			},
			"/{kreis}/{termin}/{behoerde}/{wahl}": {
				get: {
					summary: "Eine Wahl mit Gesamtergebnis",
					parameters: [
						ref("KreisParam"),
						ref("TerminParam"),
						ref("BehoerdeParam"),
						ref("WahlParam"),
					],
					responses: {
						"200": {
							description: "OK",
							content: { "application/json": { schema: ref("Wahl") } },
						},
						"404": { description: "Unbekannt" },
					},
				},
			},
			"/{kreis}/{termin}/{behoerde}/{wahl}/gebiete": {
				get: {
					summary: "Alle Gebiete der Wahl mit Ergebnis (JSON oder CSV)",
					description:
						"Mit format=csv kommt eine flache Tabelle: eine Zeile je Gebiet und Partei, Semikolon-getrennt, UTF-8 mit BOM. Die Bewerberinnen und Bewerber (kandidaten) stehen nur in der JSON-Fassung.",
					parameters: [
						ref("KreisParam"),
						ref("TerminParam"),
						ref("BehoerdeParam"),
						ref("WahlParam"),
						{
							name: "ebene",
							in: "query",
							schema: {
								type: "string",
								enum: [
									"kreis",
									"gemeinde",
									"wahlbereich",
									"ortsteil",
									"wahlbezirk",
								],
							},
						},
						{
							name: "format",
							in: "query",
							schema: {
								type: "string",
								enum: ["json", "csv"],
								default: "json",
							},
						},
					],
					responses: { "200": { description: "OK" } },
				},
			},
			"/{kreis}/{termin}/{behoerde}/{wahl}/gebiete/{gebiet}": {
				get: {
					summary: "Ein einzelnes Gebiet",
					parameters: [
						ref("KreisParam"),
						ref("TerminParam"),
						ref("BehoerdeParam"),
						ref("WahlParam"),
						{
							name: "gebiet",
							in: "path",
							required: true,
							schema: { type: "string" },
							description:
								"Gebiets-Id aus der Gebiete-Liste, z. B. ebene_6_id_3119",
						},
					],
					responses: {
						"200": {
							description: "OK",
							content: { "application/json": { schema: ref("Ergebnis") } },
						},
					},
				},
			},
			"/{kreis}/{termin}/{behoerde}/wahlraeume": {
				get: {
					summary: "Wahllokale einer Behörde",
					parameters: [
						ref("KreisParam"),
						ref("TerminParam"),
						ref("BehoerdeParam"),
					],
					responses: { "200": { description: "OK" } },
				},
			},
			"/{kreis}/{termin}/ereignisse": {
				get: {
					summary: "Ticker der eingegangenen Schnellmeldungen",
					parameters: [
						ref("KreisParam"),
						ref("TerminParam"),
						{
							name: "limit",
							in: "query",
							schema: { type: "integer", default: 50, maximum: 500 },
						},
						{ name: "behoerde", in: "query", schema: { type: "string" } },
					],
					responses: { "200": { description: "OK" } },
				},
			},
			"/geo/{datei}": {
				get: {
					summary: "Geodaten als GeoJSON",
					parameters: [
						{
							name: "datei",
							in: "path",
							required: true,
							schema: {
								type: "string",
								enum: [
									"gemeinden.geojson",
									"ortsteile.geojson",
									"wahllokale.geojson",
								],
							},
						},
						{
							name: "kreis",
							in: "query",
							description:
								"5- oder 8-stelliger Kreisschlüssel; ohne ihn kommt ganz Niedersachsen",
							schema: { type: "string", example: "03254" },
						},
					],
					responses: { "200": { description: "OK" } },
				},
			},
		},
		components: {
			parameters: {},
			schemas: {
				KreisParam: {
					name: "kreis",
					in: "path",
					required: true,
					description:
						"Landkreis oder kreisfreie Stadt, als Slug (hildesheim) oder 8-stelliger Schlüssel (03254000). Alle unter /kreise; Kreise mit vorhanden=false liefern keine Ergebnisse.",
					schema: { type: "string", enum: KREISE.map((k) => k.slug) },
				},
				TerminParam: {
					name: "termin",
					in: "path",
					required: true,
					description: `Wahltermin. ${TERMINE.map((t) => `${t.id}: ${t.beschreibung}`).join(" – ")}. Nicht jeder Termin liegt für jeden Kreis vor – welche es dort gibt, nennt /{kreis}; ein Termin, den es dort nicht gibt, antwortet mit 404. Nicht jeder Termin umfasst alle Behörden; welche Wahlen es gibt, zeigt /{kreis}/{termin}/wahlen.`,
					schema: { type: "string", enum: TERMINE.map((t) => t.id) },
				},
				BehoerdeParam: {
					name: "behoerde",
					in: "path",
					required: true,
					description:
						"Wahlleitung innerhalb des Kreises, als Slug (nordstemmen) oder AGS (03254026); die Kreisbehörde heißt kreis. Welche es gibt, zeigt /{kreis}/{termin}/behoerden.",
					schema: { type: "string" },
				},
				WahlParam: {
					name: "wahl",
					in: "path",
					required: true,
					description:
						"Wahl-Slug, z. B. kreistag, landrat, buergermeister, rat, ortsrat-roessing",
					schema: { type: "string" },
				},
				Partei: {
					type: "object",
					properties: {
						key: {
							type: "string",
							description: "stabiler Schlüssel, z. B. cdu",
						},
						kurz: { type: "string" },
						name: { type: "string" },
						farbe: { type: "string" },
						stimmen: { type: "integer" },
						prozent: { type: "number" },
						listenstimmen: {
							type: "integer",
							description: "Stimmen für die Liste als Ganzes",
						},
						kandidatenstimmen: {
							type: "integer",
							description:
								"Summe der Stimmen für die einzelnen Bewerber dieser Partei – die Bezugsgröße von kandidaten[].prozentInPartei",
						},
						sitze: { type: "integer" },
						kandidat: {
							type: "object",
							description:
								"Personenwahl (Landrat, Bürgermeister): die antretende Person",
							properties: {
								name: { type: "string" },
								partei: { type: "string" },
							},
						},
						kandidaten: {
							type: "array",
							description:
								"Bewerberinnen und Bewerber dieser Partei im abgefragten Gebiet, nach Stimmen absteigend. Nur bei Verhältniswahlen (Kreistag, Rat, Ortsrat); bei Personenwahlen steht die antretende Person in kandidat.",
							items: ref("Kandidat"),
						},
					},
					required: ["key", "kurz", "name", "stimmen", "prozent"],
				},
				Kandidat: {
					type: "object",
					description:
						"Eine Bewerberin oder ein Bewerber auf der Liste einer Partei, bezogen auf das abgefragte Gebiet. Listenplätze werden je Gebiet geführt: bei der Kreistagswahl stellt jede Partei in jedem Wahlbereich eine eigene Liste auf, dieselbe Person kann also anderswo einen anderen Platz haben oder gar nicht antreten.",
					properties: {
						name: {
							type: "string",
							description: "Name in der Schreibweise der Wahlleitung",
						},
						stimmen: {
							type: "integer",
							description:
								"Stimmen, die im abgefragten Gebiet auf diese Person entfallen sind",
						},
						prozent: {
							type: ["number", "null"],
							description:
								"Anteil an ALLEN gültigen Stimmen des Gebiets, in Prozent. Das ist der Wert, mit dem sich Bewerber verschiedener Parteien vergleichen lassen. null, solange die Zahl der gültigen Stimmen nicht vorliegt.",
						},
						prozentInPartei: {
							type: ["number", "null"],
							description:
								"Anteil an den Kandidatenstimmen der EIGENEN Partei, in Prozent – der Wert, den die amtliche Wahlpräsentation ausweist. Er ist leicht misszuverstehen: Er beschreibt nur, wie sich die Stimmen innerhalb einer Liste verteilen, nicht wie stark die Person im Gebiet abgeschnitten hat. Wer auf einer kurzen Liste die meisten Stimmen holt, steht hier schnell bei 40 %, obwohl das gemessen an allen gültigen Stimmen (siehe prozent) wenige Prozent sind. Für Vergleiche zwischen Parteien ist der Wert unbrauchbar; dafür ist prozent da.",
						},
						platz: {
							type: ["integer", "null"],
							description:
								"Platz auf dem Wahlvorschlag in diesem Gebiet. null, wenn kein Wahlvorschlag vorliegt oder der Platz nicht eindeutig bestimmbar ist (zwei Bewerber derselben Liste mit exakt gleicher Stimmenzahl).",
						},
						gewaehlt: {
							type: "boolean",
							description:
								"true, wenn die Person laut amtlicher Gewähltenliste ein Mandat erhalten hat. Steht erst fest, wenn die Sitzverteilung vorliegt.",
						},
					},
					required: [
						"name",
						"stimmen",
						"prozent",
						"prozentInPartei",
						"platz",
						"gewaehlt",
					],
				},
				Ergebnis: {
					type: "object",
					properties: {
						termin: { type: "string" },
						behoerde: { type: "string" },
						wahl: { type: "string" },
						gebiet: {
							type: "object",
							properties: {
								id: { type: "string" },
								name: { type: "string" },
								ebene: { type: "string" },
							},
						},
						leer: {
							type: "boolean",
							description: "true, solange keine Zahlen vorliegen",
						},
						stand: {
							type: "object",
							properties: {
								schnellmeldungen: {
									type: "object",
									properties: {
										eingegangen: { type: ["integer", "null"] },
										erwartet: { type: ["integer", "null"] },
									},
								},
								vollstaendig: { type: "boolean" },
								status: {
									type: ["string", "null"],
									description: "z. B. Amtliches Endergebnis",
								},
								datenstand: { type: ["string", "null"], format: "date-time" },
								abgerufen: { type: "string", format: "date-time" },
							},
						},
						kennzahlen: {
							type: "object",
							properties: {
								wahlberechtigte: { type: ["integer", "null"] },
								waehler: { type: ["integer", "null"] },
								wahlbeteiligung: { type: ["number", "null"] },
								ungueltig: { type: ["integer", "null"] },
								gueltigeStimmzettel: { type: ["integer", "null"] },
								gueltigeStimmen: {
									type: ["integer", "null"],
									description: "bei Verhältniswahl bis zu drei je Stimmzettel",
								},
							},
						},
						parteien: { type: "array", items: ref("Partei") },
						sitze: {
							type: ["object", "null"],
							properties: {
								gesamt: { type: "integer" },
								verteilung: { type: "array", items: { type: "object" } },
								gewaehlte: { type: "array", items: { type: "object" } },
							},
						},
					},
				},
				Wahl: {
					type: "object",
					properties: {
						termin: { type: "string" },
						behoerde: { type: "object" },
						slug: { type: "string" },
						typ: { type: "string", enum: WAHLTYP_REIHENFOLGE },
						typLabel: { type: "string" },
						titel: { type: "string" },
						gebiet: { type: "string" },
						personenwahl: { type: "boolean" },
						status: { type: ["string", "null"] },
						ergebnis: ref("Ergebnis"),
						ebenen: {
							type: "array",
							items: {
								type: "object",
								properties: {
									ebene: { type: "string" },
									anzahl: { type: "integer" },
								},
							},
						},
					},
				},
			},
		},
	};
	return json(request, spec, { maxAge: 3600 });
};

export const OPTIONS: APIRoute = () => optionen();
