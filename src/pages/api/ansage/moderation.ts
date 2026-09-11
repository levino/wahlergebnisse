/**
 * Der Endpunkt, der einen Schub in einen Satz verwandelt.
 *
 * Der Browser schickt, was allein er weiß: welche Folien sich geändert haben,
 * wie sie **vorher** aussahen und was die Leinwand dazu einblendet. Alles
 * Übrige – Parteien mit Veränderung zur Vorwahl, Sitze, Wahlbeteiligung,
 * Bewerber, Listen, Datenstand – baut der Server aus derselben Quelle, aus der
 * er die Seite gerendert hat, und dazu die Ereignisse der gerade eingegangenen
 * Gebiete. Über die Leitung ginge das alles ein zweites Mal.
 *
 * Eine Astro-Route und nicht ein Endpunkt neben `server/ansage.ts`: Hier wird
 * das Foliennmodell gebraucht, und das hängt über `seite.ts` an den
 * Geodaten – die stehen als JSON-Importe im Bundle und nicht im nackten
 * Node-Prozess des Servers.
 *
 * Antwortet das Textmodell nicht, nicht rechtzeitig oder unbrauchbar, kommt
 * die feste Formulierung zurück, die der Browser mitgeschickt hat. Der
 * Endpunkt schweigt nie – schweigen kann nur die Stimme.
 */
import type { APIRoute } from "astro";
import { kreisBySlug } from "../../../data/kreise.ts";
import { terminById, terminGiltFuerBehoerde } from "../../../data/termine.ts";
import { ereignisse, wahleintraege } from "../../../lib/abfragen.ts";
import type {
	ModerationAnfrage,
	ModerationAntwort,
} from "../../../lib/ansage.ts";
import {
	dienstBereit,
	formuliere,
	istAnsageBehoerde,
	vorproduziere,
} from "../../../lib/ansage-datei.ts";
import { kreisebeneFuer, ladeDashboard } from "../../../lib/dashboard.ts";
import {
	type WahlKontext,
	beitraegeAus,
	saubereAnfrage,
	wahlKontext,
} from "../../../lib/moderation.ts";

export const prerender = false;

/** Genug Ereignisse, um auch einen dichten Schub abzudecken. */
const EREIGNISSE = 60;

const antwort = (daten: ModerationAntwort, status = 200): Response =>
	new Response(JSON.stringify(daten), {
		status,
		headers: {
			"content-type": "application/json; charset=utf-8",
			"cache-control": "no-store",
		},
	});

const satzFuer = async (a: ModerationAnfrage): Promise<ModerationAntwort> => {
	const fest: ModerationAntwort = { satz: a.fest, quelle: "fest" };
	if (!istAnsageBehoerde(a.behoerde) || !dienstBereit()) return fest;
	const kreis = kreisBySlug(a.kreis);
	const termin = terminById(a.termin);
	const behoerde = kreis?.behoerden.find((b) => b.ags === a.behoerde);
	if (!kreis || !termin || !behoerde) return fest;
	if (!terminGiltFuerBehoerde(termin, kreis, behoerde)) return fest;
	const kreisBehoerde = kreis.behoerden.find((b) => b.ags === kreis.ags);
	const modell = ladeDashboard(
		kreis,
		termin,
		behoerde,
		wahleintraege(termin.id, behoerde.ags),
		kreisBehoerde ? kreisebeneFuer(termin, kreisBehoerde, behoerde) : undefined,
	);
	const folien = new Map(
		modell.folien
			.filter((f) => f.art === "wahl")
			.map((f) => [f.marke, f] as const),
	);
	const geschehen = ereignisse(termin.id, EREIGNISSE, [
		...new Set([behoerde.ags, kreis.ags]),
	]);
	const wahlen: WahlKontext[] = [];
	for (const w of a.wahlen) {
		const folie = folien.get(w.marke);
		if (folie?.art !== "wahl") continue;
		wahlen.push(
			wahlKontext(
				folie,
				w.vorher,
				w.meldungen,
				beitraegeAus(geschehen, folie, w.vorher),
			),
		);
	}
	if (wahlen.length === 0) return fest;
	const satz = await formuliere({
		behoerde: behoerde.ags,
		termin: termin.id,
		partei: a.partei,
		wahlen,
		fest: a.fest,
	});
	if (satz === a.fest) return fest;
	// Die Aufnahme entsteht schon, während der Browser den Satz erst bekommt.
	vorproduziere(satz, behoerde.ags);
	return { satz, quelle: "modell" };
};

export const POST: APIRoute = async ({ request }) => {
	const anfrage = saubereAnfrage(await request.json().catch(() => undefined));
	if (!anfrage) return antwort({ satz: "", quelle: "fest" }, 400);
	return antwort(await satzFuer(anfrage));
};
