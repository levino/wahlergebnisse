import type { Behoerde } from "../data/behoerden.ts";
import type { Kreis } from "../data/kreise.ts";
import {
	type Termin,
	TERMINE,
	terminGiltFuerBehoerde,
} from "../data/termine.ts";
import {
	type ErgebnisZeile,
	type WahlEintragZeile,
	eigeneGebiete,
	ergebnis,
	ergebnisseEbene,
	gleichesGebiet,
	untergebietVon,
	vergleich,
	wahlBySlug,
	wahlStatus,
	wahleintraege,
} from "./abfragen.ts";
import { parteiFarbe } from "./farben.ts";
import {
	type Einheit,
	type Unsicherheit,
	MINDEST_MELDUNGEN,
	istBriefwahl,
	ordneZu,
	rechneHoch,
	schwelle,
	unsicherheit,
} from "./hochrechnung.ts";
import {
	type Kreisdeckung,
	deckungsSatz,
	deckungsTitel,
	kreisdeckung,
} from "./kreisdeckung.ts";
import { SITZE_2021, hareNiemeyer } from "./sitze.ts";
import { type Partei, parteiKey } from "./votemanager.ts";
import { amtVon, istKreiswahl, istPersonenwahl } from "./wahltyp.ts";

export type SitzModell = {
	quelle: "amtlich" | "hochrechnung";
	art: "amtlich" | "struktur" | "fortschreibung";
	gesamt: number;
	verteilung: Array<{
		key: string;
		kurz: string;
		lang: string;
		farbe: string;
		sitze: number;
		vorher?: number;
	}>;
	hinweis: string;
	unsicherheit?: Unsicherheit;
};

export type SitzeAusstehend = {
	anz: number;
	max: number;
	/** Zahl der Schnellmeldungen, ab der gerechnet wird */
	noetig: number;
	/** Wahl mit so wenigen Wahlbezirken, dass erst das Schlussergebnis zählt */
	kleinesGebiet: boolean;
	text: string;
};

/** Der Stand in drei Worten – groß und aus einigen Metern lesbar. */
export type Datenstand = {
	art: "endergebnis" | "hochrechnung" | "zwischenstand" | "teilgebiet";
	titel: string;
	text: string;
	unsicherheit?: Unsicherheit;
};

export const UNSICHERHEIT_SATZ: Record<Unsicherheit, string> = {
	hoch: "Es kann sich noch um mehrere Sitze verschieben.",
	mittel:
		"Das Bild steht in Umrissen; ein bis zwei Sitze können noch wechseln.",
	niedrig: "Höchstens noch ein Sitz wechselt.",
};

export type BalkenModell = Partei & {
	vorher?: number;
	diff?: number;
	sitze?: number;
};

const HOCHRECHNUNGS_EBENEN = [6, 3, 8] as const;

/** Stimmen je Partei eines Ergebnisses als Karte. */
const stimmenVon = (e: ErgebnisZeile): Map<string, number> =>
	new Map(e.ergebnis.parteien.map((p) => [p.key, p.stimmen]));

/** Anteil der Schnellmeldungen dieser Einheit, die schon ausgezählt sind. */
const anteilVon = (e: ErgebnisZeile): number => {
	if (e.leer) return 0;
	if (e.standMax && e.standAnz !== null && e.standMax > 0)
		return Math.min(1, e.standAnz / e.standMax);
	return 1;
};

const sammleEinheiten = (
	termin: Termin,
	behoerde: Behoerde,
	eintrag: WahlEintragZeile,
	vTermin: Termin,
	vEintrag: WahlEintragZeile,
	nurGebiete?: Set<string>,
	nurVergleichsGebiete?: Set<string>,
): Einheit[] | undefined => {
	for (const ebene of HOCHRECHNUNGS_EBENEN) {
		const vorher = ergebnisseEbene(
			vTermin.id,
			behoerde.ags,
			vEintrag.wahlId,
			ebene,
		).filter(
			(e) =>
				!e.leer &&
				(!nurVergleichsGebiete || nurVergleichsGebiete.has(e.gebietId)),
		);
		if (vorher.length < 2) continue;
		const jetzt = ergebnisseEbene(
			termin.id,
			behoerde.ags,
			eintrag.wahlId,
			ebene,
		).filter((e) => !nurGebiete || nurGebiete.has(e.gebietId));
		const kandidaten = jetzt.map((e) => ({
			id: e.gebietId,
			name: e.titel,
			briefwahl: istBriefwahl(e.titel),
			anteil: anteilVon(e),
			stimmen: stimmenVon(e),
		}));
		const { treffer, uebrig } = ordneZu(
			kandidaten,
			vorher.map((v) => ({ name: v.titel, stimmen: stimmenVon(v) })),
		);
		return [
			...kandidaten.map((k) => ({ ...k, vorwert: treffer.get(k) })),
			...uebrig.map((v, i) => ({
				id: `fehlt-${i}`,
				name: v.name,
				briefwahl: istBriefwahl(v.name),
				anteil: 0,
				stimmen: new Map<string, number>(),
				vorwert: v.stimmen,
			})),
		];
	}
	return undefined;
};

type SitzKontext = {
	termin: Termin;
	behoerde: Behoerde;
	eintrag: WahlEintragZeile;
	/** Zeigt die Seite das Wahlgebiet selbst – oder einen Ausschnitt daraus? */
	istGesamt: boolean;
	aktuell?: ErgebnisZeile;
	vergleichE?: ErgebnisZeile;
	vergleichTermin?: Termin;
	vEintrag?: WahlEintragZeile;
	nurGebiete?: Set<string>;
	nurVergleichsGebiete?: Set<string>;
	deckung?: Kreisdeckung;
};

const sitzeFuer = (
	k: SitzKontext,
): { sitze?: SitzModell; ausstehend?: SitzeAusstehend } => {
	const { aktuell, eintrag, behoerde, vergleichE } = k;
	if (!aktuell || aktuell.leer || istPersonenwahl(eintrag.typ)) return {};
	if (!k.istGesamt) return {};
	const vorherMap = new Map(
		(vergleichE?.ergebnis.sitze?.verteilung ?? []).map((v) => [v.key, v.sitze]),
	);
	const amtlich = aktuell.ergebnis.sitze;
	if (amtlich && amtlich.gesamt > 0) {
		return {
			sitze: {
				quelle: "amtlich",
				art: "amtlich",
				gesamt: amtlich.gesamt,
				hinweis: amtlich.hinweis,
				verteilung: amtlich.verteilung.map((v) => ({
					...v,
					vorher: vorherMap.get(v.key),
				})),
			},
		};
	}
	if (k.deckung) return {};
	const gesamt =
		vergleichE?.ergebnis.sitze?.gesamt ??
		SITZE_2021[`${behoerde.ags}/${eintrag.typ}`];
	if (!gesamt) return {};

	const anz = aktuell.standAnz ?? 0;
	const max = aktuell.standMax ?? 0;
	const noetig = schwelle(max);
	if (max > 0 && anz < noetig) {
		const kleinesGebiet = max <= MINDEST_MELDUNGEN;
		return {
			ausstehend: {
				anz,
				max,
				noetig,
				kleinesGebiet,
				text: kleinesGebiet
					? `Dieses Wahlgebiet hat nur ${max} Wahlbezirke. Aus einem Teil davon lässt sich nichts hochrechnen – die Sitzverteilung erscheint hier erst, wenn alle ${max} Schnellmeldungen vorliegen.`
					: `Erst ab ${noetig} von ${max} Schnellmeldungen. Vorher hängt die Sitzverteilung fast nur davon ab, welche Wahlbezirke zufällig zuerst fertig waren.`,
			},
		};
	}

	const einheiten =
		k.vergleichTermin && k.vEintrag
			? sammleEinheiten(
					k.termin,
					behoerde,
					eintrag,
					k.vergleichTermin,
					k.vEintrag,
					k.nurGebiete,
					k.nurVergleichsGebiete,
				)
			: undefined;
	const hr = einheiten ? rechneHoch(einheiten) : undefined;

	const parteien = aktuell.ergebnis.parteien;
	const stimmen = hr
		? parteien.map((p) => ({
				key: p.key,
				stimmen: hr.stimmen.get(p.key) ?? p.stimmen,
			}))
		: parteien
				.filter((p) => p.stimmen > 0)
				.map((p) => ({ key: p.key, stimmen: p.stimmen }));
	if (!stimmen.length) return {};
	const hn = hareNiemeyer(stimmen, gesamt);
	const stand = `${anz} von ${max} Schnellmeldungen`;
	const stufe = unsicherheit(anz, max, !hr);
	return {
		sitze: {
			quelle: "hochrechnung",
			art: hr ? "struktur" : "fortschreibung",
			gesamt,
			unsicherheit: stufe,
			hinweis: hr
				? `Hochgerechnet aus ${stand}: Die Veränderung gegenüber ${k.vergleichTermin?.titel ?? "der letzten Wahl"} wird auf die fehlenden Wahlbezirke übertragen, gewichtet mit deren damaliger Stimmenzahl. ${gesamt} Sitze nach Hare-Niemeyer. Unsicherheit ${stufe}: ${UNSICHERHEIT_SATZ[stufe]} Keine Prognose der Wahlleitung.`
				: `Fortschreibung von ${stand}: Für diese Wahl liegen keine vergleichbaren Bezirksergebnisse der letzten Wahl vor – der Zwischenstand wird deshalb ungewichtet auf ${gesamt} Sitze umgerechnet. Die Unsicherheit ist damit hoch, unabhängig vom Auszählstand: Es fehlen gerade die Bezirke, die zuletzt melden. Keine Prognose der Wahlleitung.`,
			verteilung: stimmen.map((s) => {
				const p = parteien.find((x) => x.key === s.key);
				return {
					key: s.key,
					kurz: p?.kurz ?? s.key,
					lang: p?.lang ?? s.key,
					farbe: p?.farbe ?? "#999",
					sitze: hn.find((h) => h.key === s.key)?.sitze ?? 0,
					vorher: vorherMap.get(s.key),
				};
			}),
		},
	};
};

/** Beschriftung des Datenstands: Endergebnis, Hochrechnung oder Zwischenstand. */
const datenstandVon = (
	aktuell: ErgebnisZeile | undefined,
	status: string | undefined,
	sitze: SitzModell | undefined,
	deckung: Kreisdeckung | undefined,
): Datenstand => {
	const anz = aktuell?.standAnz ?? 0;
	const max = aktuell?.standMax ?? 0;
	const stand = max > 0 ? `${anz} von ${max} Schnellmeldungen` : "";
	const fertig = max > 0 && anz >= max;
	if (deckung)
		return {
			art: "teilgebiet",
			titel: deckungsTitel,
			text: `${deckungsSatz(deckung)}${stand ? ` Der Auszählstand ${stand} ist der der Quelle; er belegt nicht, dass der ganze Kreis ausgezählt ist.` : ""}`,
		};
	if (sitze?.quelle === "amtlich" || (fertig && status))
		return {
			art: "endergebnis",
			titel: status ?? "Endergebnis",
			text: stand ? `Alle ${max} Schnellmeldungen ausgezählt.` : "",
		};
	if (fertig)
		return {
			art: "endergebnis",
			titel: "Ausgezählt",
			text: `Alle ${max} Schnellmeldungen liegen vor; die Wahlleitung hat das Ergebnis noch nicht für amtlich erklärt.`,
		};
	if (sitze?.quelle === "hochrechnung") {
		const stufe = sitze.unsicherheit ?? "hoch";
		return {
			art: "hochrechnung",
			titel: "Hochrechnung",
			unsicherheit: stufe,
			text: stand
				? `${UNSICHERHEIT_SATZ[stufe]} Stimmen: ausgezählter Zwischenstand aus ${stand}. Sitze: eigene Hochrechnung, keine Prognose der Wahlleitung.`
				: `${UNSICHERHEIT_SATZ[stufe]} Eigene Hochrechnung, keine Prognose der Wahlleitung.`,
		};
	}
	return {
		art: "zwischenstand",
		titel: "Zwischenstand",
		text: stand
			? `Die Auszählung läuft: ${stand}. Die Zahlen sind ein Teilergebnis, kein Hochrechnungswert.`
			: "Die Auszählung läuft. Die Zahlen sind ein Teilergebnis.",
	};
};

/** Vergleichsergebnis für ein Untergebiet: gleicher Gebietsname bei der Vergleichswahl. */
const vergleichFuerGebiet = (
	vTermin: Termin | undefined,
	behoerde: Behoerde,
	eintrag: WahlEintragZeile,
	aktuell: ErgebnisZeile | undefined,
	istGesamt: boolean,
): ErgebnisZeile | undefined => {
	if (!vTermin) return undefined;
	if (istGesamt)
		return vergleich(
			vTermin.id,
			behoerde.ags,
			eintrag.typ,
			untergebietVon(eintrag),
		);
	if (!aktuell) return undefined;
	const gebiet = untergebietVon(eintrag);
	const vEintrag = wahleintraege(vTermin.id, behoerde.ags).find(
		(w) =>
			w.typ === eintrag.typ &&
			(gebiet === undefined
				? untergebietVon(w) === undefined
				: gleichesGebiet(w, gebiet)),
	);
	if (!vEintrag) return undefined;
	const kandidaten = ergebnisseEbene(
		vTermin.id,
		behoerde.ags,
		vEintrag.wahlId,
		aktuell.ebene,
	);
	const n = (s: string) =>
		s
			.toLowerCase()
			.replace(/^\d+\s*-\s*/, "")
			.replace(/[^a-zäöüß]/g, "");
	return kandidaten.find((k) => n(k.titel) === n(aktuell.titel));
};

export type WahlKern = {
	eintrag: WahlEintragZeile;
	gebietId: string;
	istGesamt: boolean;
	personenwahl: boolean;
	status?: string;
	aktuell?: ErgebnisZeile;
	gesamt?: ErgebnisZeile;
	vergleich?: ErgebnisZeile;
	vergleichTermin?: Termin;
	balken: BalkenModell[];
	sitze?: SitzModell;
	sitzeAusstehend?: SitzeAusstehend;
	datenstand: Datenstand;
	/** Die Gebiete, die die Wahlleitung dieser Wahl zuschreibt (siehe `eigeneGebiete`). */
	eigeneGebiete?: Set<string>;
	/** Gesetzt, wenn diese kreisweite Summe nicht das ganze Kreisgebiet umfasst. */
	deckung?: Kreisdeckung;
};

export const wahlKern = (
	kreis: Kreis,
	termin: Termin,
	behoerde: Behoerde,
	wahlSlug: string,
	gebietId?: string,
): WahlKern | undefined => {
	const eintrag = wahlBySlug(termin.id, behoerde.ags, wahlSlug);
	if (!eintrag) return undefined;
	const istGesamt = !gebietId || gebietId === eintrag.gebietId;
	const gid = gebietId ?? eintrag.gebietId;
	const gesamt = ergebnis(
		termin.id,
		behoerde.ags,
		eintrag.wahlId,
		eintrag.gebietId,
	);
	const aktuell = istGesamt
		? gesamt
		: ergebnis(termin.id, behoerde.ags, eintrag.wahlId, gid);
	if (!istGesamt && !aktuell) return undefined;
	const personenwahl = istPersonenwahl(eintrag.typ);
	const status = wahlStatus(termin.id, behoerde.ags, eintrag.wahlId);

	const amt = amtVon(eintrag.typ);
	const eigenesGebiet = untergebietVon(eintrag);
	const vergleichTermin = TERMINE.filter(
		(t) => t.datum < termin.datum && terminGiltFuerBehoerde(t, kreis, behoerde),
	)
		.sort((a, b) => b.datum.localeCompare(a.datum))
		.find((t) =>
			wahleintraege(t.id, behoerde.ags).some(
				(w) =>
					amtVon(w.typ) === amt &&
					(eigenesGebiet === undefined
						? untergebietVon(w) === undefined
						: gleichesGebiet(w, eigenesGebiet)),
			),
		);
	const vergleichE = vergleichFuerGebiet(
		vergleichTermin,
		behoerde,
		eintrag,
		aktuell,
		istGesamt,
	);
	const vorherMap = new Map(
		(vergleichE?.ergebnis.parteien ?? []).map((p) => [
			personenwahl ? parteiKey(p.kandidat?.partei ?? p.kurz) : p.key,
			p.prozent,
		]),
	);
	const sitzeMap = new Map(
		(aktuell?.ergebnis.sitze?.verteilung ?? []).map((v) => [v.key, v.sitze]),
	);
	const balken: BalkenModell[] = (aktuell?.ergebnis.parteien ?? []).map((p) => {
		const vorher = vorherMap.get(
			personenwahl ? parteiKey(p.kandidat?.partei ?? p.kurz) : p.key,
		);
		return {
			...p,
			farbe: parteiFarbe(p.key, p.farbe),
			vorher,
			diff: vorher !== undefined ? p.prozent - vorher : undefined,
			sitze: sitzeMap.get(p.key),
		};
	});

	const vEintrag = vergleichTermin
		? wahleintraege(vergleichTermin.id, behoerde.ags).find(
				(w) =>
					w.typ === eintrag.typ &&
					(eigenesGebiet === undefined
						? untergebietVon(w) === undefined
						: gleichesGebiet(w, eigenesGebiet)),
			)
		: undefined;
	const eigeneBezirke = eigeneGebiete(termin.id, behoerde.ags, eintrag);
	const vergleichsBezirke =
		eintrag.typ === "ortsrat" && vergleichE
			? new Set(
					vergleichE.ergebnis.untergebiete.flatMap((u) =>
						u.gebiete.map((g) => g.id),
					),
				)
			: undefined;
	const deckung =
		istGesamt && behoerde.ags === kreis.ags && istKreiswahl(eintrag.typ)
			? kreisdeckung(termin.id, kreis)
			: undefined;
	const { sitze, ausstehend: sitzeAusstehend } = sitzeFuer({
		termin,
		behoerde,
		eintrag,
		istGesamt,
		deckung,
		aktuell,
		vergleichE,
		vergleichTermin,
		vEintrag,
		nurGebiete: eigeneBezirke?.size ? eigeneBezirke : undefined,
		nurVergleichsGebiete: vergleichsBezirke?.size
			? vergleichsBezirke
			: undefined,
	});
	const datenstand = datenstandVon(aktuell, status, sitze, deckung);
	return {
		deckung,
		eintrag,
		gebietId: gid,
		istGesamt,
		personenwahl,
		status,
		aktuell,
		gesamt,
		vergleich: vergleichE,
		vergleichTermin: vergleichE ? vergleichTermin : undefined,
		balken,
		sitze,
		sitzeAusstehend,
		datenstand,
		eigeneGebiete: eigeneBezirke,
	};
};
