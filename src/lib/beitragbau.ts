import { basename } from "node:path";
import type { Behoerde } from "../data/behoerden.ts";
import type { Kreis } from "../data/kreise.ts";
import type { Termin } from "../data/termine.ts";
import { ereignisse } from "./abfragen.ts";
import {
	ansagePfad,
	dienstBereit,
	erzeugeAnsage,
	formuliere,
	istAnsageBehoerde,
	protokolliere,
	standardStimme,
} from "./ansage-datei.ts";
import type { DashboardModell, WahlFolie } from "./dashboard.ts";
import { type Db, metaSet } from "./db.ts";
import {
	MELDUNGEN_HOECHSTENS,
	type Meldung,
	ansage,
	schubFolien,
} from "./meldungen.ts";
import {
	type StilleWahl,
	type WahlKontext,
	beitraegeAus,
	eingaengeAus,
	wahlKontext,
	worumEsGeht,
} from "./moderation.ts";
import {
	type Beitrag,
	type BeitragToast,
	legeBeitragAn,
	beitragsMarke,
} from "./beitraege.ts";
import type { Schub } from "./schub.ts";

/** Genug Ereignisse, um auch einen dichten Schub abzudecken. */
const EREIGNISSE = 60;

const alsToast = (m: Meldung): BeitragToast => ({
	marke: m.marke,
	ort: m.ort,
	wahl: m.wahl,
	art: m.art,
	text: m.text,
	...(m.anz === undefined ? {} : { anz: m.anz }),
	...(m.max === undefined ? {} : { max: m.max }),
	...(m.prozent === undefined ? {} : { prozent: m.prozent }),
});

/**
 * Der Kontext für das Sprachmodell – dieselben Bausteine wie am Endpunkt.
 *
 * Was der Browser bisher aus seinen Folien zusammentrug, trägt hier der Server
 * aus dem Modell zusammen, gegen das er ohnehin verglichen hat.
 */
const kontextFuer = (
	db: Db,
	kreis: Kreis,
	termin: Termin,
	behoerde: Behoerde,
	modell: DashboardModell,
	schub: Schub,
	fest: string,
) => {
	const folien = new Map(
		modell.folien
			.filter((f): f is WahlFolie => f.art === "wahl")
			.map((f) => [f.marke, f] as const),
	);
	const geschehen = ereignisse(termin.id, EREIGNISSE, [
		...new Set([behoerde.ags, kreis.ags]),
	]);
	const wahlen: WahlKontext[] = [];
	const beruehrt = new Set<string>();
	for (const w of schubFolien(schub.vorher, schub.meldungen)) {
		const folie = folien.get(w.marke);
		if (!folie) continue;
		beruehrt.add(w.marke);
		wahlen.push(
			wahlKontext(
				folie,
				w.vorher,
				w.meldungen,
				beitraegeAus(geschehen, folie, w.vorher),
			),
		);
	}
	if (wahlen.length === 0) return undefined;
	const unveraendert: StilleWahl[] = [...folien.values()]
		.filter((f) => !beruehrt.has(f.marke))
		.map((f) => ({
			wahl: f.wahl,
			ort: f.ort,
			worum: worumEsGeht(f),
			anz: f.anz,
			max: f.max,
		}));
	return {
		behoerde: behoerde.ags,
		termin: termin.id,
		...(schub.partei ? { partei: schub.partei.kurz } : {}),
		eingaenge: eingaengeAus(wahlen),
		unveraendert,
		wahlen,
		fest,
	};
};

export type BeitragsBericht = {
	beitrag?: Beitrag;
	/** Warum kein Beitrag entstand – für das Protokoll. */
	grund?: string;
};

/**
 * Aus einem Schub ein hinterlegter Beitrag: Toasts, Satz, Aufnahme.
 *
 * Der Satz verlässt diese Funktion nicht. Er geht an den Sprachdienst und in
 * den Dateinamen der Aufnahme; abgelegt werden nur die Toasts und der Verweis
 * auf die Datei.
 */
export const baueUndLegeAb = async (
	db: Db,
	args: {
		kreis: Kreis;
		termin: Termin;
		behoerde: Behoerde;
		modell: DashboardModell;
		schub: Schub;
		topic: string;
	},
): Promise<BeitragsBericht> => {
	const { kreis, termin, behoerde, modell, schub, topic } = args;
	const toasts = schub.meldungen.map(alsToast);
	/**
	 * Ablegen **und** erst dann die Marke bewegen, an der die Zustellung
	 * hängt. Ein Ping kündigt damit nie etwas an, das es noch nicht gibt:
	 * Gerufen wird erst, wenn Toasts und Aufnahme beide dastehen.
	 */
	const ablegen = (aufnahme?: string): Beitrag => {
		const p = legeBeitragAn(db, {
			termin: termin.id,
			topic,
			schluessel: schub.schluessel,
			...(aufnahme ? { aufnahme } : {}),
			toasts,
		});
		metaSet(db, beitragsMarke(termin.id), String(p.id));
		return p;
	};

	const fest = ansage(schub.meldungen.slice(0, MELDUNGEN_HOECHSTENS));
	if (!fest) return { beitrag: ablegen(), grund: "nichts anzusagen" };
	if (!istAnsageBehoerde(behoerde.ags))
		return { beitrag: ablegen(), grund: "Wahlleitung ohne Ansagedienst" };

	let satz = fest;
	if (dienstBereit("moderation")) {
		const kontext = kontextFuer(
			db,
			kreis,
			termin,
			behoerde,
			modell,
			schub,
			fest,
		);
		if (kontext) {
			const raus = await formuliere(kontext);
			satz = raus.satz;
			if (raus.grund) protokolliere(`Moderation ${topic}: ${raus.grund}`);
		}
	}

	if (!dienstBereit())
		return { beitrag: ablegen(), grund: "kein Sprachdienst" };
	const stimme = standardStimme();
	const fertig = await erzeugeAnsage(satz, stimme);
	if (!fertig) return { beitrag: ablegen(), grund: "keine Aufnahme" };
	return { beitrag: ablegen(basename(ansagePfad(satz, stimme))) };
};
