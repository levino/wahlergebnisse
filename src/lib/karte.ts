import type { Behoerde } from "../data/behoerden.ts";
import type { Kreis } from "../data/kreise.ts";
import { gemeindeDerZeile, gemeindePfadFuerKreiswahl } from "./kreiswahl.ts";
import { wahlPfad } from "./pfade.ts";
import type { Wahltyp } from "./wahltyp.ts";
import {
	type ErgebnisZeile,
	type UebersichtZeileDb,
	wahlraeume,
} from "./abfragen.ts";
import { kontrast, mitAlpha, parteiFarbe } from "./farben.ts";
import {
	type Feature,
	type Geometrie,
	bbox,
	gemeindenFuerBehoerde,
	normName,
	ortsteileFuer,
	wahlbezirkNr,
	wahllokalFuer,
} from "./geo.ts";
import {
	type UebersichtZeile,
	ebeneVonGebietId,
	parteiKey,
} from "./votemanager.ts";
import {
	kreiswahlbereichsRaeume,
	wahlbereichKuerzel,
	wahlbereichName,
	wahlbereicheAusRaeumen,
} from "./wahlbereiche.ts";
import { formatProzent } from "./zahlen.ts";

export type Flaeche = {
	id: string;
	name: string;
	geometry: Geometrie;
	farbe: string;
	fuellung: string;
	href?: string;
	tooltip: string;
	aktiv: boolean;
	ohneDaten: boolean;
};

export type Punkt = {
	id: string;
	name: string;
	lat: number;
	lon: number;
	farbe: string;
	href?: string;
	tooltip: string;
	aktiv: boolean;
	ohneDaten: boolean;
};

export type Ebene = { id: string; titel: string; flaechen: Flaeche[] };

export type KartenDaten = {
	ebenen: Ebene[];
	punkte: Punkt[];
	/** Umriss (Kontext), z. B. die Gemeinde bei Ortsteil-Karten */
	umriss: Geometrie[];
	bbox?: [[number, number], [number, number]];
	fokus?: [[number, number], [number, number]];
	legende: Array<{ kurz: string; farbe: string }>;
};

const NEUTRAL = "#cbd5e1";

/** Sieger einer Übersichtszeile (höchster Prozentwert ohne "Sonstige"). */
export const sieger = (
	z: UebersichtZeile,
): { kurz: string; prozent: number } | undefined => {
	let best: { kurz: string; prozent: number } | undefined;
	for (const w of z.werte) {
		if (/^sonstige/i.test(w.kurz) || w.prozent === undefined) continue;
		if (!best || w.prozent > best.prozent)
			best = { kurz: w.kurz, prozent: w.prozent };
	}
	return best;
};

const farbeFuer = (kurz: string, farben: Map<string, string>): string =>
	farben.get(parteiKey(kurz)) ?? parteiFarbe(parteiKey(kurz));

const tooltipFuer = (z: UebersichtZeile): string => {
	const top = z.werte
		.filter((w) => w.prozent !== undefined && !/^sonstige/i.test(w.kurz))
		.sort((a, b) => (b.prozent ?? 0) - (a.prozent ?? 0))
		.slice(0, 3)
		.map((w) => `${w.kurz} ${formatProzent(w.prozent)}`)
		.join(" · ");
	const stand = z.status
		? `<br><span class="opacity-70">Stand: ${z.status}</span>`
		: "";
	const wb =
		z.wahlbeteiligung !== undefined
			? ` · Wahlbeteiligung ${formatProzent(z.wahlbeteiligung)}`
			: "";
	return `<b>${z.label}</b><br>${top || "noch kein Ergebnis"}${wb}${stand}`;
};

const hatWerte = (z: UebersichtZeile): boolean =>
	z.werte.some((w) => w.absolut !== undefined && w.absolut > 0);

type Kontext = {
	kreis: Kreis;
	terminId: string;
	behoerde: Behoerde;
	wahlSlug: string;
	/** Wahlart der Seite – entscheidet, ob Gemeinden zu sich selbst führen */
	wahlTyp: Wahltyp;
	gebietId: string;
	/** Farben aus dem Gesamtergebnis (Kurzname → Hex) */
	farben: Map<string, string>;
	/** Zeilen → Gebiet-Id, falls die Übersicht keine Ids trägt (Kreisebene) */
	gebietIdFuerLabel: (label: string) => string | undefined;
};

const flaecheAus = (
	ctx: Kontext,
	id: string,
	name: string,
	geometry: Geometrie,
	zeile: UebersichtZeile | undefined,
	href: string | undefined,
): Flaeche => {
	const s = zeile ? sieger(zeile) : undefined;
	const daten = Boolean(zeile && hatWerte(zeile) && s);
	const farbe = daten && s ? farbeFuer(s.kurz, ctx.farben) : NEUTRAL;
	return {
		id,
		name,
		geometry,
		farbe,
		fuellung: mitAlpha(farbe, daten ? 0.6 : 0.35),
		href,
		tooltip: zeile ? tooltipFuer(zeile) : `<b>${name}</b><br>keine Daten`,
		aktiv: id === ctx.gebietId,
		ohneDaten: !daten,
	};
};

const hrefFuer = (
	ctx: Kontext,
	gebietId: string | undefined,
): string | undefined =>
	gebietId
		? wahlPfad(
				ctx.kreis.slug,
				ctx.terminId,
				ctx.behoerde.slug,
				ctx.wahlSlug,
				gebietId,
			)
		: undefined;

/** Kreisebene: Gemeinden (und optional Wahlbereiche) einfärben. */
const kreisKarte = (
	ctx: Kontext,
	uebersichten: UebersichtZeileDb[],
): Ebene[] => {
	const ebenen: Ebene[] = [];
	const gemeindenUe = uebersichten.find((u) => /gemeinde/i.test(u.titel));
	if (gemeindenUe) {
		const flaechen: Flaeche[] = [];
		for (const z of gemeindenUe.uebersicht.zeilen) {
			const b = gemeindeDerZeile(ctx.kreis, z);
			if (!b) continue;
			const gebietId = z.gebietId ?? ctx.gebietIdFuerLabel(z.label);
			const href =
				gemeindePfadFuerKreiswahl({
					kreis: ctx.kreis,
					terminId: ctx.terminId,
					typ: ctx.wahlTyp,
					zeile: z,
				}) ?? hrefFuer(ctx, gebietId);
			for (const f of gemeindenFuerBehoerde(b.ags)) {
				flaechen.push(
					flaecheAus(
						ctx,
						gebietId ?? b.ags,
						f.properties.name,
						f.geometry,
						z,
						href,
					),
				);
			}
		}
		ebenen.push({ id: "gemeinden", titel: "Gemeinden", flaechen });
	}
	const wbUe = uebersichten.find((u) => /wahlbereich/i.test(u.titel));
	if (wbUe) {
		const raeumeJeGemeinde = kreiswahlbereichsRaeume(ctx.terminId);
		const wahlbereiche = wahlbereicheAusRaeumen(raeumeJeGemeinde);
		const zuordnung = new Map<string, string>(); // "ags" oder "ags|ortsteil" → Buchstabe
		for (const { behoerde: b, raeume } of raeumeJeGemeinde) {
			for (const r of raeume) {
				if (!r.kreiswahlbereich) continue;
				zuordnung.set(
					`${b.ags}`,
					zuordnung.has(b.ags) && zuordnung.get(b.ags) !== r.kreiswahlbereich
						? "gemischt"
						: r.kreiswahlbereich,
				);
				if (r.ortsteil)
					zuordnung.set(`${b.ags}|${normName(r.ortsteil)}`, r.kreiswahlbereich);
			}
		}
		if (zuordnung.size) {
			const zeileFuer = new Map<string, UebersichtZeile>();
			for (const z of wbUe.uebersicht.zeilen) {
				const kuerzel = wahlbereichKuerzel(z.label);
				if (kuerzel)
					zeileFuer.set(kuerzel, {
						...z,
						label: wahlbereichName(z.label, wahlbereiche),
					});
			}
			const flaechen: Flaeche[] = [];
			for (const { behoerde: b } of raeumeJeGemeinde) {
				const kwb = zuordnung.get(b.ags);
				if (!kwb) continue;
				if (kwb !== "gemischt") {
					const z = zeileFuer.get(kwb);
					for (const f of gemeindenFuerBehoerde(b.ags))
						flaechen.push(
							flaecheAus(
								ctx,
								z?.gebietId ?? `wb-${kwb}`,
								`${f.properties.name} – ${wahlbereichName(kwb, wahlbereiche)}`,
								f.geometry,
								z,
								hrefFuer(ctx, z?.gebietId),
							),
						);
				} else {
					const seen = new Set<string>();
					for (const [key, letter] of zuordnung) {
						if (!key.startsWith(`${b.ags}|`)) continue;
						const ortsteil = key.split("|")[1];
						if (seen.has(ortsteil)) continue;
						seen.add(ortsteil);
						const z = zeileFuer.get(letter);
						for (const f of ortsteileFuer([b.ags], ortsteil))
							flaechen.push(
								flaecheAus(
									ctx,
									z?.gebietId ?? `wb-${letter}`,
									`${f.properties.name} – ${wahlbereichName(letter, wahlbereiche)}`,
									f.geometry,
									z,
									hrefFuer(ctx, z?.gebietId),
								),
							);
					}
				}
			}
			if (flaechen.length)
				ebenen.push({ id: "wahlbereiche", titel: wbUe.titel, flaechen });
		}
	}
	return ebenen;
};

/** Gemeindeebene: Ortsteile (Flächen) und Wahllokale (Punkte). */
const gemeindeKarte = (
	ctx: Kontext,
	uebersichten: UebersichtZeileDb[],
	nurGebiete?: Set<string>,
): { ebenen: Ebene[]; punkte: Punkt[] } => {
	const agsListe = gemeindenFuerBehoerde(ctx.behoerde.ags).map(
		(f) => f.properties.ags,
	);
	const raeume = wahlraeume(ctx.terminId, ctx.behoerde.ags);
	const bezirke = uebersichten.find((u) => /wahlbezirk/i.test(u.titel));
	const ortsteileUe = uebersichten.find((u) =>
		/ortsteil|ortschaft/i.test(u.titel),
	);

	const bezirkZeilen = (bezirke?.uebersicht.zeilen ?? []).filter(
		(z) => z.gebietId && (!nurGebiete || nurGebiete.has(z.gebietId)),
	);

	let ortsteilZeilen: UebersichtZeile[] = [];
	if (ortsteileUe) {
		ortsteilZeilen = ortsteileUe.uebersicht.zeilen.filter(
			(z) =>
				z.gebietId &&
				ebeneVonGebietId(z.gebietId) !== 3 && // Summenzeile der Gemeinde ist kein Ortsteil
				(!nurGebiete || nurGebiete.has(z.gebietId)),
		);
	} else if (bezirke) {
		const ortsteilVon = new Map<string, string>();
		for (const r of raeume)
			if (r.ortsteil) ortsteilVon.set(wahlbezirkNr(r.bezirk), r.ortsteil);
		const gruppen = new Map<string, UebersichtZeile[]>();
		for (const z of bezirkZeilen) {
			const ot =
				ortsteilVon.get(wahlbezirkNr(z.label)) ??
				z.label.match(/briefwahl\s+(.+)$/i)?.[1];
			if (!ot) continue;
			gruppen.set(ot, [...(gruppen.get(ot) ?? []), z]);
		}
		ortsteilZeilen = [...gruppen].map(([ot, zeilen]) => aggregiere(ot, zeilen));
	}

	const flaechen: Flaeche[] = [];
	for (const z of ortsteilZeilen) {
		const feats = ortsteileFuer(agsListe, z.label);
		for (const f of feats)
			flaechen.push(
				flaecheAus(
					ctx,
					z.gebietId ?? `ot-${normName(z.label)}`,
					z.label,
					f.geometry,
					z,
					hrefFuer(ctx, z.gebietId),
				),
			);
	}

	const punkte: Punkt[] = [];
	for (const z of bezirkZeilen) {
		const nr = wahlbezirkNr(z.label);
		const lokal =
			wahllokalFuer(ctx.terminId, ctx.behoerde.ags, nr) ??
			wahllokalFuer("2021", ctx.behoerde.ags, nr);
		if (lokal?.geometry?.type !== "Point") continue;
		const s = sieger(z);
		const daten = hatWerte(z) && Boolean(s);
		const farbe = daten && s ? farbeFuer(s.kurz, ctx.farben) : NEUTRAL;
		punkte.push({
			id: z.gebietId as string,
			name: z.label,
			lat: lokal.geometry.coordinates[1],
			lon: lokal.geometry.coordinates[0],
			farbe,
			href: hrefFuer(ctx, z.gebietId),
			tooltip: `${tooltipFuer(z)}<br><span class="opacity-70">${lokal.properties.name}, ${lokal.properties.adresse}</span>`,
			aktiv: z.gebietId === ctx.gebietId,
			ohneDaten: !daten,
		});
	}
	const ebenen: Ebene[] = [];
	if (flaechen.length)
		ebenen.push({ id: "ortsteile", titel: "Ortsteile", flaechen });
	return { ebenen, punkte };
};

/** Summiert Wahlbezirks-Zeilen zu einer Ortsteil-Zeile (Prozente neu aus Absolutwerten). */
export const aggregiere = (
	label: string,
	zeilen: UebersichtZeile[],
): UebersichtZeile => {
	const werte = new Map<string, number>();
	let wahlberechtigte = 0;
	let waehler = 0;
	let eingegangen = 0;
	for (const z of zeilen) {
		if (z.wahlberechtigte) wahlberechtigte += z.wahlberechtigte;
		if (z.wahlberechtigte && z.wahlbeteiligung)
			waehler += (z.wahlberechtigte * z.wahlbeteiligung) / 100;
		if (hatWerte(z)) eingegangen++;
		for (const w of z.werte)
			werte.set(w.kurz, (werte.get(w.kurz) ?? 0) + (w.absolut ?? 0));
	}
	const summe = [...werte.values()].reduce((a, b) => a + b, 0);
	return {
		label,
		gebietId: undefined,
		status: `${eingegangen} von ${zeilen.length}`,
		statusProzent: zeilen.length ? (eingegangen / zeilen.length) * 100 : 0,
		stimmbezirk: false,
		wahlberechtigte: wahlberechtigte || undefined,
		wahlbeteiligung: wahlberechtigte
			? (waehler / wahlberechtigte) * 100
			: undefined,
		werte: [...werte].map(([kurz, absolut]) => ({
			kurz,
			absolut,
			prozent: summe ? (absolut / summe) * 100 : undefined,
		})),
	};
};

export const baueKarte = (args: {
	/** Der Kreis: Slug für die Adressen, Behörden für die Zuordnung der Gemeinden */
	kreis: Kreis;
	terminId: string;
	behoerde: Behoerde;
	wahlSlug: string;
	wahlTyp: Wahltyp;
	gebietId: string;
	gesamt?: ErgebnisZeile;
	uebersichten: UebersichtZeileDb[];
	ergebnisseEbene3: ErgebnisZeile[];
	/** Für Ortsratswahlen: nur diese Wahlbezirke */
	nurGebiete?: Set<string>;
}): KartenDaten | undefined => {
	const farben = new Map<string, string>();
	for (const p of args.gesamt?.ergebnis.parteien ?? [])
		farben.set(p.key, p.farbe);
	const ebene3 = new Map(
		args.ergebnisseEbene3.map((e) => [normName(e.titel), e.gebietId]),
	);
	const ctx: Kontext = {
		kreis: args.kreis,
		terminId: args.terminId,
		behoerde: args.behoerde,
		wahlSlug: args.wahlSlug,
		wahlTyp: args.wahlTyp,
		gebietId: args.gebietId,
		farben,
		gebietIdFuerLabel: (label) => ebene3.get(normName(label)),
	};

	let ebenen: Ebene[] = [];
	let punkte: Punkt[] = [];
	let umriss: Geometrie[] = [];
	if (args.behoerde.art === "kreis") {
		ebenen = kreisKarte(ctx, args.uebersichten);
	} else {
		const g = gemeindeKarte(ctx, args.uebersichten, args.nurGebiete);
		ebenen = g.ebenen;
		punkte = g.punkte;
		umriss = gemeindenFuerBehoerde(args.behoerde.ags).map((f) => f.geometry);
	}
	if (!ebenen.length && !punkte.length) return undefined;

	const alle: Array<Feature<unknown>> = [
		...umriss.map((g) => ({
			type: "Feature" as const,
			properties: {},
			geometry: g,
		})),
		...ebenen.flatMap((e) =>
			e.flaechen.map((f) => ({
				type: "Feature" as const,
				properties: {},
				geometry: f.geometry,
			})),
		),
		...punkte.map((p) => ({
			type: "Feature" as const,
			properties: {},
			geometry: {
				type: "Point" as const,
				coordinates: [p.lon, p.lat] as [number, number],
			},
		})),
	];
	const aktiv = [
		...ebenen.flatMap((e) =>
			e.flaechen
				.filter((f) => f.aktiv)
				.map((f) => ({
					type: "Feature" as const,
					properties: {},
					geometry: f.geometry,
				})),
		),
		...punkte
			.filter((p) => p.aktiv)
			.map((p) => ({
				type: "Feature" as const,
				properties: {},
				geometry: {
					type: "Point" as const,
					coordinates: [p.lon, p.lat] as [number, number],
				},
			})),
	];
	const legendeKeys = new Map<string, string>();
	for (const e of ebenen)
		for (const f of e.flaechen)
			if (!f.ohneDaten) legendeKeys.set(f.farbe, f.farbe);
	for (const p of punkte) if (!p.ohneDaten) legendeKeys.set(p.farbe, p.farbe);
	const legende = (args.gesamt?.ergebnis.parteien ?? [])
		.filter((p) => legendeKeys.has(p.farbe))
		.map((p) => ({ kurz: p.kurz, farbe: p.farbe }));
	return {
		ebenen,
		punkte,
		umriss,
		bbox: bbox(alle),
		fokus: aktiv.length ? bbox(aktiv) : undefined,
		legende,
	};
};

export const textFarbe = kontrast;
