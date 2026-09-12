import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { KREISE, wurzelVon } from "../src/data/kreise.ts";
import { parseTerminIndex } from "../src/data/termine.ts";
import { hostWarteschlange } from "../src/lib/warteschlange.ts";
import { type Wahltyp, erkenneWahltyp } from "../src/lib/wahltyp.ts";

const HIER = dirname(fileURLToPath(import.meta.url));

/** Der kommende Wahltag – alles davor kommt als Vorwert in Frage. */
const WAHLTAG = "2026-09-13";

const FRUEHESTENS = "2006-01-01";

/** Ämter, für die ein Vorwert gesucht wird (Stichwahlen zählen zum Amt). */
const AEMTER: Wahltyp[] = [
	"landrat",
	"kreistag",
	"buergermeister",
	"rat",
	"ortsrat",
];

/** Stichwahl und Hauptwahl besetzen dasselbe Amt. */
const amtVon = (typ: Wahltyp): Wahltyp | undefined => {
	if (typ === "landrat-stichwahl") return "landrat";
	if (typ === "buergermeister-stichwahl") return "buergermeister";
	return AEMTER.includes(typ) ? typ : undefined;
};

const isoVon = (deutsch: string): string => {
	const m = deutsch.match(/(\d{2})\.(\d{2})\.(\d{4})/);
	return m ? `${m[3]}-${m[2]}-${m[1]}` : deutsch;
};

const warteschlange = hostWarteschlange({ zeitgrenzeMs: 30_000 });
let anfragen = 0;

const hole = async (url: string): Promise<unknown | undefined> => {
	anfragen++;
	for (let versuch = 0; versuch < 3; versuch++) {
		try {
			const res = await warteschlange.hole(url, {
				headers: { "user-agent": "wahlergebnisse-erhebung/1.0" },
			});
			if (res.status < 200 || res.status >= 300) return undefined;
			const text = res.text;
			const anfang = text.trimStart()[0];
			if (anfang !== "{" && anfang !== "[") return undefined;
			return JSON.parse(text);
		} catch {
			if (versuch === 2) return undefined;
			await new Promise((r) => setTimeout(r, 500 * (versuch + 1)));
		}
	}
	return undefined;
};

type RohTermin = {
	datum_string?: string;
	wahleintraege?: Array<{ wahl?: { titel?: string } }>;
};

const holeTermin = async (
	wurzel: string,
	ordner: string,
	ags: string,
	datum: string,
): Promise<
	{ layout: "v22" | "v26"; datum: string; titel: string[] } | undefined
> => {
	const erst = datum <= "2022-10-09" ? "v22" : "v26";
	for (const layout of [erst, erst === "v22" ? "v26" : "v22"] as const) {
		const url =
			layout === "v22"
				? `${wurzel}${ordner}/${ags}/api/praesentation/termin.json`
				: `${wurzel}${ordner}/${ags}/daten/api/termin.json`;
		const roh = (await hole(url)) as RohTermin | undefined;
		if (!roh?.wahleintraege) continue;
		return {
			layout,
			datum: roh.datum_string ? isoVon(roh.datum_string) : datum,
			titel: roh.wahleintraege
				.map((e) => e.wahl?.titel ?? "")
				.filter((t) => t !== ""),
		};
	}
	return undefined;
};

type VorwertEintrag = {
	amt: Wahltyp;
	datum: string;
	datumString: string;
	ordner: string;
	layout: "v22" | "v26";
	/** Wie der Termin-Index diesen Ordner benennt (alle Einträge dazu) */
	terminNamen: string[];
	/** Die amtlichen Wahltitel dieses Amts an dem Tag (inkl. Stichwahl) */
	wahlen: string[];
	/** Gab es an dem Tag eine Stichwahl zu diesem Amt? */
	stichwahl: boolean;
	mehrdeutig: boolean;
	stichwahlTag?: string;
};

type BehoerdeErgebnis = {
	kreis: string;
	ags: string;
	name: string;
	wurzel: string;
	/** Antwortet der Termin-Index der Behörde? */
	index: "ok" | "fehlt";
	/** Ämter, die am 13.09.2026 zur Wahl stehen */
	aemter2026: Wahltyp[];
	/** War die Präsentation zum 13.09.2026 abrufbar? */
	termin2026: boolean;
	/** Ordner des 13.09.2026 laut Index (bei Hannover `Wahl-2026-09-13`) */
	ordner2026?: string;
	vorwerte: VorwertEintrag[];
	/** Wie viele frühere Termine dafür angesehen wurden */
	geprueft: number;
	/** Ämter 2026 ohne jeden Vorwert */
	ohneVorwert: Wahltyp[];
	verschwunden: Array<{ datum: string; ordner: string; namen: string[] }>;
};

const argWert = (name: string): string | undefined =>
	process.argv.includes(name)
		? process.argv[process.argv.indexOf(name) + 1]
		: undefined;

const nurKreise = argWert("--kreise")?.split(",").filter(Boolean);
const ziel = argWert("--ziel") ?? join(HIER, "quellen", "nds-vorwerte.json");

const behoerdeErheben = async (
	kreisSlug: string,
	ags: string,
	name: string,
	wurzel: string,
): Promise<BehoerdeErgebnis> => {
	const basis: BehoerdeErgebnis = {
		kreis: kreisSlug,
		ags,
		name,
		wurzel,
		index: "fehlt",
		aemter2026: [],
		termin2026: false,
		vorwerte: [],
		geprueft: 0,
		ohneVorwert: [],
		verschwunden: [],
	};
	const roh = await hole(`${wurzel}${ags}/api/termine.json`);
	if (!roh) return basis;
	basis.index = "ok";
	const eintraege = parseTerminIndex(roh as never).map((e) => ({
		...e,
		iso: isoVon(e.datum),
	}));

	const heute = eintraege.find((e) => e.iso === WAHLTAG);
	if (heute) {
		const t = await holeTermin(wurzel, heute.ordner, ags, WAHLTAG);
		basis.ordner2026 = heute.ordner;
		if (t) {
			basis.termin2026 = true;
			for (const titel of t.titel) {
				const amt = amtVon(erkenneWahltyp(titel, name));
				if (amt && !basis.aemter2026.includes(amt)) basis.aemter2026.push(amt);
			}
		}
	}
	const offen = new Set<Wahltyp>(
		basis.aemter2026.length > 0 ? basis.aemter2026 : AEMTER,
	);
	const gesucht = [...offen];

	const ordnerJeDatum = new Map<string, Set<string>>();
	for (const e of eintraege) {
		const s = ordnerJeDatum.get(e.iso) ?? new Set<string>();
		s.add(e.ordner);
		ordnerJeDatum.set(e.iso, s);
	}
	const eindeutig = (iso: string): boolean =>
		(ordnerJeDatum.get(iso)?.size ?? 0) === 1;

	const ordner = new Map<string, { tage: string[]; namen: string[] }>();
	for (const e of eintraege) {
		if (e.iso >= WAHLTAG || e.iso < FRUEHESTENS) continue;
		const o = ordner.get(e.ordner);
		if (o) {
			o.namen.push(`${e.datum} ${e.name}`);
			o.tage.push(e.iso);
		} else
			ordner.set(e.ordner, {
				tage: [e.iso],
				namen: [`${e.datum} ${e.name}`],
			});
	}
	const kandidaten = [...ordner.entries()]
		.map(([ord, o]) => {
			const tage = [...o.tage].sort();
			const treffer = tage.find(eindeutig);
			return {
				ord,
				namen: o.namen,
				tag: treffer ?? tage[0],
				mehrdeutig: treffer === undefined,
			};
		})
		.sort((a, b) => (a.tag < b.tag ? 1 : a.tag > b.tag ? -1 : 0));

	for (const info of kandidaten) {
		if (offen.size === 0) break;
		const ord = info.ord;
		const t = await holeTermin(wurzel, ord, ags, info.tag);
		basis.geprueft++;
		if (!t) {
			basis.verschwunden.push({
				datum: info.tag,
				ordner: ord,
				namen: info.namen,
			});
			continue;
		}
		const gefunden = new Map<
			Wahltyp,
			{ wahlen: string[]; stichwahl: boolean }
		>();
		for (const titel of t.titel) {
			const typ = erkenneWahltyp(titel, name);
			const amt = amtVon(typ);
			if (!amt || !offen.has(amt)) continue;
			const g = gefunden.get(amt) ?? { wahlen: [], stichwahl: false };
			g.wahlen.push(titel);
			if (typ.endsWith("-stichwahl")) g.stichwahl = true;
			gefunden.set(amt, g);
		}
		const stichTag = eintraege.find(
			(e) => e.ordner === ord && /stichwahl/i.test(e.name),
		)?.iso;
		const mehrdeutig = info.mehrdeutig;
		for (const [amt, g] of gefunden) {
			basis.vorwerte.push({
				amt,
				datum: info.tag,
				datumString: t.datum,
				ordner: ord,
				layout: t.layout,
				terminNamen: info.namen,
				wahlen: g.wahlen,
				stichwahl: g.stichwahl,
				mehrdeutig,
				...(g.stichwahl && stichTag ? { stichwahlTag: stichTag } : {}),
			});
			offen.delete(amt);
		}
	}
	basis.ohneVorwert = gesucht.filter((a) => offen.has(a));
	return basis;
};

const kreise = KREISE.filter((k) => !nurKreise || nurKreise.includes(k.slug));
const aufgaben: Array<() => Promise<BehoerdeErgebnis>> = [];
for (const kreis of kreise)
	for (const b of kreis.behoerden)
		aufgaben.push(() =>
			behoerdeErheben(kreis.slug, b.ags, b.name, wurzelVon(kreis, b)),
		);

const ergebnisse: BehoerdeErgebnis[] = [];
const GLEICHZEITIG = 12;
let naechste = 0;
const t0 = Date.now();
await Promise.all(
	Array.from({ length: GLEICHZEITIG }, async () => {
		for (;;) {
			const i = naechste++;
			if (i >= aufgaben.length) return;
			ergebnisse.push(await aufgaben[i]());
			if (ergebnisse.length % 25 === 0)
				console.error(
					`  ${ergebnisse.length}/${aufgaben.length} Behörden, ${anfragen} Anfragen, ${((Date.now() - t0) / 1000).toFixed(0)} s`,
				);
		}
	}),
);

ergebnisse.sort((a, b) => a.ags.localeCompare(b.ags));
writeFileSync(ziel, `${JSON.stringify(ergebnisse, null, 1)}\n`);

const ausserhalb = ergebnisse.flatMap((e) =>
	e.vorwerte.filter((v) => v.datum !== "2021-09-12"),
);
console.error(`\nBehörden        ${ergebnisse.length}`);
console.error(
	`Index fehlt     ${ergebnisse.filter((e) => e.index === "fehlt").length}`,
);
console.error(`Anfragen        ${anfragen}`);
console.error(`Dauer           ${((Date.now() - t0) / 1000).toFixed(0)} s`);
console.error(
	`Ämter gesamt    ${ergebnisse.reduce((n, e) => n + e.vorwerte.length, 0)}`,
);
console.error(`davon ≠ 2021    ${ausserhalb.length}`);
console.error(`Datei           ${ziel}`);
