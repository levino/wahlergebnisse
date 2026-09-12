import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { KATALOG } from "../src/data/kreis-katalog.ts";
import type { Behoerde } from "../src/data/behoerden.ts";
import type { Kreis } from "../src/data/kreise.ts";
import { wurzelVon } from "../src/data/kreise.ts";
import {
	type Fundort,
	apiBasisVon,
	findeOrdner,
	parseTerminIndex,
	terminById,
	terminIndexUrl,
	vorgabeFundort,
} from "../src/data/termine.ts";
import type {
	Amt,
	AmtEintrag,
	Beleg,
	Gebietsmenge,
	Kreisgliederung,
	Kreiswahlbereich,
	Ortschaft,
	Wahlbezirk,
	Wahlbereichszuordnung,
	Wahlgliederung,
	Wahlleitung,
} from "../src/data/wahlgliederung.ts";
import {
	ebeneVonGebietId,
	parseErgebnisDateiname,
	parseListing,
	parseTermin,
	parseWahl,
	parseWahlraeume,
} from "../src/lib/votemanager.ts";
import { wahlSlugs } from "../src/lib/wahltyp.ts";

const HIER = dirname(fileURLToPath(import.meta.url));
const ZIELORDNER = join(HIER, "..", "src", "data", "wahlgliederung");

const args = process.argv.slice(2);
const wert = (name: string): string | undefined => {
	const i = args.indexOf(name);
	return i >= 0 ? args[i + 1] : undefined;
};

const terminId = wert("--termin") ?? "2026";
const dbPfad = wert("--db");
const herkunft = wert("--herkunft");
const nurKreise = (wert("--kreise") ?? "")
	.split(",")
	.map((s) => s.trim())
	.filter(Boolean);
const gleichzeitig = Number(wert("--gleichzeitig") ?? 8);

const termin = terminById(terminId);
if (!termin) {
	console.error(`Termin ${terminId} steht nicht in src/data/termine.ts`);
	process.exit(1);
}

const jetzt = new Date().toISOString();
const kreise = nurKreise.length
	? KATALOG.filter((k) => nurKreise.includes(k.slug))
	: KATALOG;

const kreisArt = (k: Kreis): Kreisgliederung["art"] =>
	k.slug === "region-hannover"
		? "region"
		: /^Landkreis\b/.test(k.name)
			? "landkreis"
			: "kreisfreie-stadt";

const leer = <T>(beleg: Beleg, erwartetAnzahl?: number): Gebietsmenge<T> => ({
	stand: "unbekannt",
	eintraege: [],
	...(erwartetAnzahl === undefined ? {} : { erwartetAnzahl }),
	beleg,
});

const belegt = <T>(eintraege: T[], beleg: Beleg): Gebietsmenge<T> => ({
	stand: "belegt",
	eintraege,
	beleg,
});

const ohneDoppel = (werte: string[]): string[] => [...new Set(werte)];

const zuordnungAls = (
	zuordnung: Map<string, string[]>,
	quelle: string,
): Gebietsmenge<Wahlbereichszuordnung> =>
	zuordnung.size
		? belegt(
				[...zuordnung]
					.sort((a, b) => a[0].localeCompare(b[0], "de"))
					.map(([kuerzel, gemeinden]) => ({
						kuerzel,
						gemeinden: [...gemeinden].sort((a, b) => a.localeCompare(b, "de")),
					})),
				{
					herkunft: "wahlleitung",
					quelle,
					terminBeleg: termin.id,
					erhoben: jetzt,
				},
			)
		: leer<Wahlbereichszuordnung>({
				herkunft: "keine",
				quelle: `Wahlraum-Übersichten des Termins ${termin.id}`,
				erhoben: jetzt,
				grund:
					"die Wahlräume dieses Termins führen keine Spalte Kreiswahlbereich",
			});

const kuerzelVon = (bezeichnung: string): string => {
	const s = bezeichnung.trim();
	return (
		s.match(/^([A-Za-z0-9]+)$/)?.[1] ??
		s.match(/(?:wahlbereich|wahlkreis)\s+([A-Za-z0-9]+)\b/i)?.[1] ??
		s.match(/\b([A-Za-z0-9]+)\s*$/)?.[1] ??
		s
	).toUpperCase();
};

const parallel = async <T>(
	werte: T[],
	fn: (w: T) => Promise<void>,
): Promise<void> => {
	const offen = [...werte];
	const arbeiter = async () => {
		for (;;) {
			const w = offen.shift();
			if (!w) return;
			await fn(w);
		}
	};
	await Promise.all(
		Array.from({ length: Math.max(1, gleichzeitig) }, arbeiter),
	);
};

type Antwort<T> = { daten: T; url: string } | undefined;

const holeJson = async <T>(url: string): Promise<Antwort<T>> => {
	for (let versuch = 0; versuch < 3; versuch++) {
		try {
			const r = await fetch(url, { signal: AbortSignal.timeout(45000) });
			if (r.status === 404) return undefined;
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			return { daten: (await r.json()) as T, url };
		} catch (e) {
			if (versuch === 2) {
				fehler.push(`${url}: ${e instanceof Error ? e.message : String(e)}`);
				return undefined;
			}
			await new Promise((f) => setTimeout(f, 1200 * (versuch + 1)));
		}
	}
	return undefined;
};

const fehler: string[] = [];

const holeText = async (url: string): Promise<string | undefined> => {
	try {
		const r = await fetch(url, { signal: AbortSignal.timeout(45000) });
		return r.ok ? await r.text() : undefined;
	} catch {
		return undefined;
	}
};

/**
 * Gebiete einer Ebene aus dem Verzeichnis der Wahl. Nur Server, die ein Listing
 * ausliefern, geben sie vor dem Wahlabend preis.
 */
const gebieteAusListing = async (
	wahlBasis: string,
	ebene: string,
): Promise<Array<{ id: string; titel: string }>> => {
	const html = await holeText(`${wahlBasis}/`);
	if (!html) return [];
	const nummer = ebeneVonGebietId(`${ebene}_id_0`);
	const ids = parseListing(html)
		.map((d) => parseErgebnisDateiname(d.name))
		.filter(
			(d): d is { gebietId: string; stimmentyp: number } =>
				d?.stimmentyp === 0 && ebeneVonGebietId(d.gebietId) === nummer,
		)
		.map((d) => d.gebietId);
	const gefunden: Array<{ id: string; titel: string }> = [];
	await parallel(ids, async (id) => {
		const r = await holeJson<{ seitentitel?: string }>(
			`${wahlBasis}/ergebnis_${id}_0.json`,
		);
		const titel = r?.daten.seitentitel
			?.split(" - ")
			.slice(1)
			.join(" - ")
			.trim();
		if (titel) gefunden.push({ id, titel });
	});
	return gefunden.sort((a, b) => a.titel.localeCompare(b.titel, "de"));
};

const AEMTER: Amt[] = [
	"kreistag",
	"landrat",
	"landrat-stichwahl",
	"rat",
	"buergermeister",
	"buergermeister-stichwahl",
	"ortsrat",
];

const wahlleitungsArt = (b: Behoerde): Wahlleitung["art"] => b.art;

const grundgeruest = (k: Kreis, b: Behoerde, beleg: Beleg): Wahlleitung => ({
	ags: b.ags,
	slug: b.slug,
	name: b.name,
	art: wahlleitungsArt(b),
	beleg,
	aemter: {},
	...(b.art === "samtgemeinde"
		? { mitgliedsgemeinden: leer<string>(beleg) }
		: {}),
	ortschaften: leer<Ortschaft>(beleg),
	wahlbezirke: leer<Wahlbezirk>(beleg),
});

type Eintrag = {
	wahlId: number;
	titel: string;
	gebietId: string;
	gebietTitel: string;
};

const WAHLWORT =
	/^(?:wahl|des|der|zum|stadtrat(?:e?s)?|stadtratswahl|stadtwahl|samtgemeinderat(?:e?s)?|samtgemeinderatswahl|samtgemeindewahl|gemeinderat(?:e?s)?|gemeinderatswahl|gemeindewahl|rat(?:e?s)?|ratswahl)\s+/i;

/** Der Gemeindename, den der Wahltitel selbst nennt: „Gemeinderatswahl Flecken Brome". */
const gemeindeAusTitel = (titel: string): string => {
	const kern = (titel.split(" - ")[0] ?? "").trim();
	let rest = kern;
	for (;;) {
		const gekuerzt = rest.replace(WAHLWORT, "").trim();
		if (!gekuerzt || gekuerzt === rest) return rest === kern ? "" : rest;
		rest = gekuerzt;
	}
};

const traegtAemter = (
	w: Wahlleitung,
	eintraege: Eintrag[],
	behoerdeName: string,
	beleg: Beleg,
): void => {
	const slugs = wahlSlugs(eintraege, behoerdeName);
	const ortschaften: Ortschaft[] = [];
	const mitglieder: string[] = [];
	eintraege.forEach((e, i) => {
		const { typ, slug, gebiet } = slugs[i];
		if (!AEMTER.includes(typ as Amt)) return;
		const amt = typ as Amt;
		if (amt === "ortsrat") {
			if (gebiet)
				ortschaften.push({
					slug,
					name: gebiet,
					ortsrat: "belegt",
				});
		} else if (amt === "rat" && w.art === "samtgemeinde" && slug !== "rat") {
			const name =
				gebiet ||
				(e.gebietTitel && e.gebietTitel !== w.name
					? e.gebietTitel
					: gemeindeAusTitel(e.titel));
			if (name && name !== w.name) mitglieder.push(name);
		}
		if (!w.aemter[amt])
			w.aemter[amt] = {
				stand: "belegt",
				wahlen: [],
				...(beleg.quelle === w.beleg.quelle ? {} : { beleg }),
			};
		const eintrag = w.aemter[amt] as AmtEintrag;
		eintrag.wahlen.push({
			slug,
			titel: e.titel.split(" - ")[0],
			...(gebiet ? { gebiet } : {}),
		});
	});
	for (const eintrag of Object.values(w.aemter))
		eintrag.wahlen.sort((a, b) => a.slug.localeCompare(b.slug));
	if (ortschaften.length) w.ortschaften = belegt(ortschaften, beleg);
	if (mitglieder.length)
		w.mitgliedsgemeinden = belegt(ohneDoppel(mitglieder), beleg);
};

const ausWahlraeumen = (
	raeume: Array<{ bezirk: string; ortsteil?: string }>,
	beleg: Beleg,
): Gebietsmenge<Wahlbezirk> => {
	const gesehen = new Map<string, Wahlbezirk>();
	for (const r of raeume) {
		const bezeichnung = r.bezirk.trim();
		if (!bezeichnung || gesehen.has(bezeichnung)) continue;
		gesehen.set(bezeichnung, {
			bezeichnung,
			...(r.ortsteil ? { ortsteil: r.ortsteil.trim() } : {}),
		});
	}
	return gesehen.size
		? belegt([...gesehen.values()], beleg)
		: leer<Wahlbezirk>(beleg);
};

const ausWahlleitungen = async (): Promise<Wahlgliederung> => {
	const kreisgliederungen: Kreisgliederung[] = [];
	for (const k of kreise) {
		const wahlleitungen: Wahlleitung[] = [];
		const zuordnung = new Map<string, string[]>();
		let zuordnungQuelle = "";
		let kwb: Gebietsmenge<Kreiswahlbereich> = leer<Kreiswahlbereich>({
			herkunft: "keine",
			quelle: "-",
			erhoben: jetzt,
			grund: "keine Kreisbehörde mit Kreistagswahl abrufbar",
		});
		await parallel(k.behoerden, async (b) => {
			const wurzel = wurzelVon(k, b);
			const katalogBeleg: Beleg = {
				herkunft: "katalog",
				quelle: "src/data/kreis-katalog.ts",
				erhoben: jetzt,
			};
			const w = grundgeruest(k, b, katalogBeleg);
			wahlleitungen.push(w);

			const index = await holeJson<{
				termine?: Array<{ date?: string; name?: string; url?: string }>;
			}>(terminIndexUrl(b.ags, wurzel));
			const ordner = index
				? findeOrdner(parseTerminIndex(index.daten), termin)
				: undefined;
			const fundorte: Fundort[] = [
				{ ...vorgabeFundort(termin), ...(ordner ? { ordner } : {}) },
				{
					...vorgabeFundort(termin),
					...(ordner ? { ordner } : {}),
					layout: termin.layout === "v22" ? "v26" : "v22",
				},
			];
			let basis: string | undefined;
			let terminJson: Antwort<Parameters<typeof parseTermin>[0]>;
			for (const f of fundorte) {
				const versuch = apiBasisVon(f, b.ags, wurzel);
				terminJson = await holeJson(`${versuch}/termin.json`);
				if (terminJson) {
					basis = versuch;
					break;
				}
			}
			if (!terminJson || !basis) {
				w.beleg = {
					herkunft: "keine",
					quelle: apiBasisVon(fundorte[0], b.ags, wurzel),
					erhoben: jetzt,
					grund: "kein termin.json – die Wahlleitung hat nichts veröffentlicht",
				};
				return;
			}
			const quelleBeleg: Beleg = {
				herkunft: "wahlleitung",
				quelle: terminJson.url,
				terminBeleg: termin.id,
				erhoben: jetzt,
			};
			w.beleg = quelleBeleg;
			const eintraege = parseTermin(terminJson.daten);
			traegtAemter(w, eintraege, b.name, quelleBeleg);

			const raeume = await holeJson<Parameters<typeof parseWahlraeume>[0]>(
				`${basis}/wahlraeume_uebersicht.json`,
			);
			if (raeume) {
				const geparst = parseWahlraeume(raeume.daten);
				w.wahlbezirke = ausWahlraeumen(geparst, {
					herkunft: "wahlleitung",
					quelle: raeume.url,
					terminBeleg: termin.id,
					erhoben: jetzt,
				});
				for (const r of geparst) {
					if (!r.kreiswahlbereich || b.ags === k.ags) continue;
					zuordnungQuelle = raeume.url;
					const kuerzel = kuerzelVon(r.kreiswahlbereich);
					const l = zuordnung.get(kuerzel) ?? [];
					if (!l.includes(b.kurz)) l.push(b.kurz);
					zuordnung.set(kuerzel, l);
				}
			}

			if (b.ags !== k.ags) return;
			const kreistag = eintraege.find(
				(e) => wahlSlugs([e], b.name)[0].typ === "kreistag",
			);
			if (!kreistag) return;
			const wahlBasis = `${basis}/wahl_${kreistag.wahlId}`;
			const wahlJson = await holeJson<Parameters<typeof parseWahl>[0]>(
				`${wahlBasis}/wahl.json`,
			);
			if (!wahlJson) return;
			const info = parseWahl(wahlJson.daten);
			const ebene = info.uebersichten.find((u) =>
				/wahlbereich|wahlkreis/i.test(u.titel),
			);
			const gebiete = info.ergebnisse.filter(
				(g) => g.id !== kreistag.gebietId && g.titel !== k.name,
			);
			if (!gebiete.length && ebene)
				gebiete.push(...(await gebieteAusListing(wahlBasis, ebene.ebene)));
			const kwbBeleg: Beleg = {
				herkunft: "wahlleitung",
				quelle: wahlJson.url,
				terminBeleg: termin.id,
				erhoben: jetzt,
			};
			if (gebiete.length)
				kwb = belegt(
					gebiete.map((g) => ({
						kuerzel: kuerzelVon(g.titel),
						name: g.titel,
						gebietId: g.id,
					})),
					kwbBeleg,
				);
			else
				kwb = leer<Kreiswahlbereich>({
					...kwbBeleg,
					herkunft: ebene ? "wahlleitung" : "keine",
					grund: ebene
						? `die Ebene „${ebene.titel}" ist angekündigt, aber noch ohne Gebiete`
						: "die Kreistagswahl führt keine Wahlbereichsebene",
				});
		});
		wahlleitungen.sort((a, b) => a.ags.localeCompare(b.ags));
		kreisgliederungen.push({
			slug: k.slug,
			ags: k.ags,
			name: k.name,
			art: kreisArt(k),
			kreiswahlbereiche: kwb,
			wahlbereichszuordnung: zuordnungAls(zuordnung, zuordnungQuelle),
			wahlleitungen,
		});
		console.log(
			`${k.slug}: ${wahlleitungen.filter((w) => w.beleg.herkunft === "wahlleitung").length}/${wahlleitungen.length} Wahlleitungen, ${kwb.eintraege.length} Kreiswahlbereiche`,
		);
	}
	return {
		termin: termin.id,
		erzeugt: jetzt,
		erhebung: `Wahlpräsentationen der Wahlleitungen, abgerufen am ${jetzt.slice(0, 10)}`,
		kreise: kreisgliederungen,
	};
};

const ausBestand = (pfad: string): Wahlgliederung => {
	const db = new DatabaseSync(pfad, { readOnly: true });
	const bestand = herkunft ?? pfad;
	const beleg = (was: string): Beleg => ({
		herkunft: "wahlleitung",
		quelle: `${was} aus ${bestand}`,
		terminBeleg: termin.id,
		erhoben: jetzt,
	});

	const eintraege = db
		.prepare(
			"SELECT behoerde, wahl_id, gebiet_id, titel, gebiet_titel FROM wahleintraege WHERE termin = ? ORDER BY behoerde, reihenfolge",
		)
		.all(termin.id) as Array<{
		behoerde: string;
		wahl_id: number;
		gebiet_id: string;
		titel: string;
		gebiet_titel: string;
	}>;
	const jeBehoerde = new Map<string, Eintrag[]>();
	for (const e of eintraege) {
		const l = jeBehoerde.get(e.behoerde) ?? [];
		l.push({
			wahlId: e.wahl_id,
			titel: e.titel,
			gebietId: e.gebiet_id,
			gebietTitel: e.gebiet_titel,
		});
		jeBehoerde.set(e.behoerde, l);
	}

	const raeume = db
		.prepare(
			"SELECT behoerde, bezirk, ortsteil, kreiswahlbereich FROM wahlraeume WHERE termin = ? ORDER BY behoerde, id",
		)
		.all(termin.id) as Array<{
		behoerde: string;
		bezirk: string;
		ortsteil: string | null;
		kreiswahlbereich: string | null;
	}>;
	const raeumeJeBehoerde = new Map<string, typeof raeume>();
	for (const r of raeume) {
		const l = raeumeJeBehoerde.get(r.behoerde) ?? [];
		l.push(r);
		raeumeJeBehoerde.set(r.behoerde, l);
	}

	const kwbZeilen = db
		.prepare(
			`SELECT e.behoerde, e.gebiet_id, e.titel FROM ergebnisse e
			 JOIN wahlen w ON w.termin = e.termin AND w.behoerde = e.behoerde AND w.wahl_id = e.wahl_id
			 WHERE e.termin = ? AND w.typ = 'kreistag' AND e.ebene IN (5, 9) ORDER BY e.titel`,
		)
		.all(termin.id) as Array<{
		behoerde: string;
		gebiet_id: string;
		titel: string;
	}>;
	const kwbJeKreis = new Map<string, typeof kwbZeilen>();
	for (const z of kwbZeilen) {
		const l = kwbJeKreis.get(z.behoerde) ?? [];
		l.push(z);
		kwbJeKreis.set(z.behoerde, l);
	}

	const kreisgliederungen: Kreisgliederung[] = [];
	for (const k of kreise) {
		const gemeindenJeKuerzel = new Map<string, string[]>();
		for (const b of k.behoerden) {
			if (b.ags === k.ags) continue;
			for (const r of raeumeJeBehoerde.get(b.ags) ?? []) {
				if (!r.kreiswahlbereich) continue;
				const kuerzel = kuerzelVon(r.kreiswahlbereich);
				const l = gemeindenJeKuerzel.get(kuerzel) ?? [];
				if (!l.includes(b.kurz)) l.push(b.kurz);
				gemeindenJeKuerzel.set(kuerzel, l);
			}
		}
		const wahlleitungen = k.behoerden.map((b) => {
			const eigene = jeBehoerde.get(b.ags);
			const w = grundgeruest(
				k,
				b,
				eigene
					? beleg("Wahleinträge")
					: {
							herkunft: "keine",
							quelle: `Ergebnisbestand ${termin.id} (${bestand})`,
							erhoben: jetzt,
							grund: "keine Wahleinträge im Bestand",
						},
			);
			if (eigene) traegtAemter(w, eigene, b.name, beleg("Wahleinträge"));
			const rs = raeumeJeBehoerde.get(b.ags);
			if (rs?.length)
				w.wahlbezirke = ausWahlraeumen(
					rs.map((r) => ({
						bezirk: r.bezirk,
						ortsteil: r.ortsteil ?? undefined,
					})),
					beleg("Wahlraum-Übersicht"),
				);
			return w;
		});
		const zeilen = kwbJeKreis.get(k.ags) ?? [];
		const kwbBeleg = beleg("Kreistagswahl, Wahlbereichsebene");
		const kwb: Gebietsmenge<Kreiswahlbereich> = zeilen.length
			? belegt(
					zeilen.map((z) => ({
						kuerzel: kuerzelVon(z.titel),
						name: z.titel,
						gebietId: z.gebiet_id,
					})),
					kwbBeleg,
				)
			: leer<Kreiswahlbereich>({
					...kwbBeleg,
					herkunft: "keine",
					grund: "keine Wahlbereichsebene bei der Kreistagswahl im Bestand",
				});
		kreisgliederungen.push({
			slug: k.slug,
			ags: k.ags,
			name: k.name,
			art: kreisArt(k),
			kreiswahlbereiche: kwb,
			wahlbereichszuordnung: zuordnungAls(
				gemeindenJeKuerzel,
				`Wahlraum-Übersichten des Termins ${termin.id} aus ${bestand}`,
			),
			wahlleitungen,
		});
	}
	db.close();
	return {
		termin: termin.id,
		erzeugt: jetzt,
		erhebung: `Amtliche Ergebnisdaten des Termins ${termin.id} aus ${bestand}`,
		kreise: kreisgliederungen,
	};
};

const gliederung = dbPfad ? ausBestand(dbPfad) : await ausWahlleitungen();

mkdirSync(ZIELORDNER, { recursive: true });
const ziel = join(ZIELORDNER, `${termin.id}.json`);
writeFileSync(ziel, `${JSON.stringify(gliederung, null, "\t")}\n`);

const zaehle = (fn: (w: Wahlleitung) => number): number =>
	gliederung.kreise.reduce(
		(s, k) => s + k.wahlleitungen.reduce((t, w) => t + fn(w), 0),
		0,
	);
console.log(
	[
		`${ziel}`,
		`${gliederung.kreise.length} Kreise`,
		`${zaehle(() => 1)} Wahlleitungen (${zaehle((w) => (w.beleg.herkunft === "wahlleitung" ? 1 : 0))} belegt)`,
		`${zaehle((w) => Object.keys(w.aemter).length)} Ämter`,
		`${gliederung.kreise.reduce((s, k) => s + k.kreiswahlbereiche.eintraege.length, 0)} Kreiswahlbereiche`,
		`${zaehle((w) => w.ortschaften.eintraege.length)} Ortschaften`,
		`${zaehle((w) => w.wahlbezirke.eintraege.length)} Wahlbezirke`,
	].join(", "),
);
if (fehler.length)
	console.log(
		`${fehler.length} Abrufe endeten mit einem Fehler:\n  ${fehler.slice(0, 20).join("\n  ")}`,
	);
