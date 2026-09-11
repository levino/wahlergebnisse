const arg = (name, standard) => {
	const i = process.argv.indexOf(`--${name}`);
	return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : standard;
};
const hat = (name) => process.argv.includes(`--${name}`);

const BASIS = arg("basis", "https://wahlergebnisse.levinkeller.de").replace(
	/\/$/,
	"",
);
const TERMIN = arg("termin", "2026");
const NUR = arg("kreise", "")
	.split(",")
	.map((s) => s.trim())
	.filter(Boolean);
/** Wahlleitungen, die am Abend im Saal hängen – die werden gründlich geprüft. */
const NAH = arg("behoerden", "nordstemmen")
	.split(",")
	.map((s) => s.trim())
	.filter(Boolean);

const befunde = [];
/** Womit der Rundgang wirklich gesprochen hat – „unauffällig" ist sonst wertlos. */
const reichweite = { kreise: 0, wahlen: 0, gebiete: 0 };
/** `stufe`: "fehler" bricht den Abend, "warnung" gehört angesehen. */
const melde = (stufe, wo, was, mehr = {}) =>
	befunde.push({ stufe, wo, was, ...mehr });

const hole = async (pfad) => {
	const url = `${BASIS}${pfad}`;
	const antwort = await fetch(url, { signal: AbortSignal.timeout(30_000) });
	if (!antwort.ok) throw new Error(`HTTP ${antwort.status} bei ${pfad}`);
	const typ = antwort.headers.get("content-type") ?? "";
	if (!typ.includes("json"))
		throw new Error(`kein JSON bei ${pfad} (${typ.split(";")[0]})`);
	return antwort.json();
};

/** Rundet wie die Anzeige, damit ein Prüfwert nicht an der dritten Stelle scheitert. */
const nah = (a, b, spanne) => Math.abs(a - b) <= spanne;

const pruefeWahl = (kreis, behoerde, wahl, daten) => {
	const wo = `${kreis}/${behoerde}/${wahl.slug}`;
	const e = daten.ergebnis;
	if (!e) {
		if (wahl.ergebnis !== null)
			melde(
				"fehler",
				wo,
				"Antwort ohne Feld `ergebnis` – hat sich die API geändert?",
			);
		return;
	}
	for (const feld of ["stand", "kennzahlen", "parteien"])
		if (!(feld in e))
			melde(
				"fehler",
				wo,
				`Feld \`${feld}\` fehlt im Ergebnis – Form der Daten geändert?`,
			);
	const stand = e.stand?.schnellmeldungen ?? {};
	const anz = stand.eingegangen;
	const max = stand.erwartet;
	if (e.leer === true) return;
	if (typeof anz !== "number" || typeof max !== "number")
		melde("fehler", wo, "Auszählstand nicht lesbar (`stand.schnellmeldungen`)");
	if (typeof anz === "number" && typeof max === "number") {
		if (max > 0 && anz > max)
			melde(
				"fehler",
				wo,
				`mehr Schnellmeldungen als erwartet: ${anz} von ${max}`,
			);
		if (max === 0 && anz > 0)
			melde("warnung", wo, `${anz} Schnellmeldungen, aber 0 erwartet`);
	}
	const parteien = e.parteien ?? [];
	if (anz > 0 && parteien.length === 0)
		melde(
			"fehler",
			wo,
			`${anz} Schnellmeldungen, aber keine einzige Partei im Ergebnis`,
		);
	const summe = parteien.reduce((s, p) => s + (p.prozent ?? 0), 0);
	if (parteien.length > 0 && anz > 0 && !nah(summe, 100, 1.5))
		melde(
			"fehler",
			wo,
			`Prozente summieren sich auf ${summe.toFixed(1)} statt 100`,
			{
				parteien: parteien.map((p) => `${p.kurz} ${p.prozent}`),
			},
		);
	for (const p of parteien) {
		if ((p.stimmen ?? 0) < 0)
			melde("fehler", wo, `negative Stimmen bei ${p.kurz}`);
		if (!p.kurz) melde("warnung", wo, "Partei ohne Kurzbezeichnung");
	}
	const jePartei = parteien.reduce((s, p) => s + (p.sitze ?? 0), 0);
	if (e.sitze?.gesamt && jePartei > 0 && jePartei !== e.sitze.gesamt)
		melde(
			"fehler",
			wo,
			`Sitze an Parteien ${jePartei}, Gremium ${e.sitze.gesamt}`,
		);

	const k = e.kennzahlen ?? {};
	if (k.waehler && k.wahlberechtigte && k.waehler > k.wahlberechtigte)
		melde(
			"fehler",
			wo,
			`mehr Wähler (${k.waehler}) als Wahlberechtigte (${k.wahlberechtigte})`,
		);
	if (
		k.wahlbeteiligung !== undefined &&
		(k.wahlbeteiligung < 0 || k.wahlbeteiligung > 100)
	)
		melde(
			"fehler",
			wo,
			`Wahlbeteiligung ${k.wahlbeteiligung} % liegt außerhalb von 0…100`,
		);
	const sitze = e.sitze;
	if (sitze?.gesamt) {
		const verteilt = (sitze.verteilung ?? []).reduce(
			(s, v) => s + (v.sitze ?? 0),
			0,
		);
		if (verteilt !== sitze.gesamt)
			melde(
				"fehler",
				wo,
				`Sitze verteilt ${verteilt}, Gremium hat ${sitze.gesamt}`,
			);
	}
};

const rundgang = async () => {
	const start = Date.now();
	const wurzel = await hole("/api/v1");
	const termin = (wurzel.termine ?? []).find((t) => t.id === TERMIN);
	if (!termin) {
		melde("fehler", "api", `Termin ${TERMIN} kommt in der API nicht vor`);
		return;
	}
	const minuten = (iso) => (Date.now() - new Date(iso).getTime()) / 60000;
	if (termin.live && termin.geprueft && minuten(termin.geprueft) > 10)
		melde(
			"fehler",
			"poller",
			`seit ${minuten(termin.geprueft).toFixed(0)} Minuten kein Lauf – fragt überhaupt noch jemand die Wahlleitungen?`,
		);
	if (termin.live && !termin.geprueft)
		melde("fehler", "poller", "kein einziger Lauf verzeichnet");

	/** Zählt irgendwo gerade jemand – also: teilweise ausgezählt? */
	let zaehltGerade = false;
	const kreise = (await hole("/api/v1/kreise")).kreise ?? [];
	const zuPruefen =
		NUR.length > 0 ? kreise.filter((k) => NUR.includes(k.slug)) : kreise;
	let mitDaten = 0;

	for (const kreis of zuPruefen) {
		let ueberblick;
		try {
			ueberblick = await hole(`/api/v1/${kreis.slug}/${TERMIN}`);
		} catch (e) {
			melde("warnung", kreis.slug, `Überblick nicht abrufbar: ${e.message}`);
			continue;
		}
		const s = ueberblick.schnellmeldungen ?? {};
		reichweite.kreise++;
		if ((s.eingegangen ?? 0) > 0) mitDaten++;
		if ((s.eingegangen ?? 0) > 0 && (s.eingegangen ?? 0) < (s.erwartet ?? 0))
			zaehltGerade = true;
		if ((s.eingegangen ?? 0) > (s.erwartet ?? 0) && (s.erwartet ?? 0) > 0)
			melde(
				"fehler",
				kreis.slug,
				`${s.eingegangen} von ${s.erwartet} Schnellmeldungen – mehr als erwartet`,
			);
		for (const g of ueberblick.gemeinden ?? [])
			if ((g.eingegangen ?? 0) > (g.erwartet ?? 0) && (g.erwartet ?? 0) > 0)
				melde(
					"fehler",
					`${kreis.slug}/${g.slug}`,
					`${g.eingegangen} von ${g.erwartet} Schnellmeldungen`,
				);

		const nahe = (ueberblick.gemeinden ?? []).filter((g) =>
			NAH.includes(g.slug),
		);
		for (const g of nahe) {
			let wahlen;
			try {
				wahlen = await hole(`/api/v1/${kreis.slug}/${TERMIN}/wahlen`);
			} catch (e) {
				melde(
					"warnung",
					`${kreis.slug}/${g.slug}`,
					`Wahlen nicht abrufbar: ${e.message}`,
				);
				continue;
			}
			const eigene = (wahlen.wahlen ?? []).filter(
				(w) => w.behoerde?.slug === g.slug,
			);
			if (eigene.length === 0)
				melde(
					"warnung",
					`${kreis.slug}/${g.slug}`,
					"keine einzige Wahl geführt",
				);
			for (const w of eigene) {
				try {
					const d = await hole(
						`/api/v1/${kreis.slug}/${TERMIN}/${g.slug}/${w.slug}`,
					);
					reichweite.wahlen++;
					pruefeWahl(kreis.slug, g.slug, w, d);
				} catch (e) {
					melde(
						"fehler",
						`${kreis.slug}/${g.slug}/${w.slug}`,
						`nicht abrufbar: ${e.message}`,
					);
				}
			}
		}
	}

	if (termin.live && mitDaten === 0)
		melde("warnung", "gesamt", "kein einziger Kreis meldet Zahlen");
	if (termin.live && zaehltGerade && termin.stand && minuten(termin.stand) > 15)
		melde(
			"warnung",
			"gesamt",
			`seit ${minuten(termin.stand).toFixed(0)} Minuten keine neue Zahl, obwohl noch gezählt wird`,
		);

	try {
		const antwort = await fetch(`${BASIS}/api/live?termin=${TERMIN}`, {
			signal: AbortSignal.timeout(12_000),
			headers: { accept: "text/event-stream" },
		});
		const leser = antwort.body.getReader();
		const { value } = await leser.read();
		const text = new TextDecoder().decode(value ?? new Uint8Array());
		if (!text.includes("retry:") && !text.includes("event:"))
			melde("fehler", "zustellung", "die Leitung liefert nichts Verwertbares");
		await leser.cancel();
	} catch (e) {
		melde("fehler", "zustellung", `keine Live-Leitung: ${e.message}`);
	}

	return {
		dauer: ((Date.now() - start) / 1000).toFixed(1),
		kreise: zuPruefen.length,
		mitDaten,
		...reichweite,
	};
};

let lage;
try {
	lage = await rundgang();
} catch (e) {
	console.error(`Rundgang gescheitert: ${e.message}`);
	process.exit(2);
}

if (hat("json")) {
	console.log(
		JSON.stringify({ basis: BASIS, termin: TERMIN, ...lage, befunde }, null, 2),
	);
} else {
	const fehler = befunde.filter((b) => b.stufe === "fehler");
	const warnungen = befunde.filter((b) => b.stufe === "warnung");
	console.log(
		`Rundgang ${BASIS} · Termin ${TERMIN} · ${lage?.kreise ?? 0} Kreise (${lage?.mitDaten ?? 0} mit Zahlen) · ${lage?.wahlen ?? 0} Wahlen geprüft · ${lage?.dauer}s`,
	);
	if ((lage?.wahlen ?? 0) === 0)
		console.log(
			"FEHLER rundgang: keine einzige Wahl geprüft – Auswahl oder API-Form prüfen",
		);
	if (befunde.length === 0) console.log("Unauffällig.");
	for (const b of [...fehler, ...warnungen])
		console.log(
			`${b.stufe === "fehler" ? "FEHLER " : "Warnung"} ${b.wo}: ${b.was}`,
		);
}
process.exit(
	befunde.some((b) => b.stufe === "fehler") || (lage?.wahlen ?? 0) === 0
		? 1
		: 0,
);
