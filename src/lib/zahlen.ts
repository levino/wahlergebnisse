/** Deutsche Zahlformate der votemanager-Dateien → number. */
export const parseZahl = (
	s: string | number | null | undefined,
): number | undefined => {
	if (typeof s === "number") return s;
	if (!s) return undefined;
	const t = String(s)
		.replace(/\./g, "")
		.replace(",", ".")
		.replace(/[^\d.-]/g, "");
	if (t === "" || t === "-") return undefined;
	const n = Number(t);
	return Number.isFinite(n) ? n : undefined;
};

/** "34,03 %" → 34.03 */
export const parseProzent = (
	s: string | number | null | undefined,
): number | undefined => {
	if (typeof s === "number") return s;
	if (!s) return undefined;
	const m = String(s).match(/-?\d+(?:[.,]\d+)?/);
	return m ? Number(m[0].replace(",", ".")) : undefined;
};

const fmtInt = new Intl.NumberFormat("de-DE");
const fmtPct = new Intl.NumberFormat("de-DE", {
	minimumFractionDigits: 1,
	maximumFractionDigits: 1,
});

export const formatZahl = (n: number | undefined | null): string =>
	n === undefined || n === null ? "–" : fmtInt.format(n);

export const formatProzent = (n: number | undefined | null): string =>
	n === undefined || n === null ? "–" : `${fmtPct.format(n)} %`;

/** "+3,2" / "−1,4" für Vergleiche */
export const formatDiff = (n: number | undefined | null): string => {
	if (n === undefined || n === null) return "";
	const s = fmtPct.format(Math.abs(n));
	return n > 0 ? `+${s}` : n < 0 ? `−${s}` : `±${s}`;
};

/** votemanager-Zeitstempel "08.04.2022 12:45" → ISO (Europe/Berlin nicht nötig, nur Anzeige) */
export const formatZeit = (iso: string | undefined | null): string => {
	if (!iso) return "";
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return iso;
	return d.toLocaleString("de-DE", {
		timeZone: "Europe/Berlin",
		day: "2-digit",
		month: "2-digit",
		year: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
};

export const formatUhrzeit = (iso: string | undefined | null): string => {
	if (!iso) return "";
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return iso;
	return d.toLocaleTimeString("de-DE", {
		timeZone: "Europe/Berlin",
		hour: "2-digit",
		minute: "2-digit",
	});
};

/**
 * Wie lange die letzte Abfrage her ist, als Abstand statt als Uhrzeit.
 *
 * Im Kopf der Seite steht neben „Stand 19:14" auch, wann zuletzt bei der
 * Wahlleitung nachgefragt wurde. Als zweite Uhrzeit („geprüft 19:15") liest
 * sich das wie ein Widerspruch – zwei Zeitangaben, die nicht zusammenpassen,
 * obwohl beide stimmen: die Zahl ist von 19:14, nachgefragt wurde um 19:15 und
 * es lag nichts Neues vor. Als Abstand ist die Aussage eindeutig.
 */
export const formatGeprueft = (
	iso: string | undefined | null,
	jetzt: number = Date.now(),
): string => {
	if (!iso) return "";
	const ms = Date.parse(iso);
	if (!Number.isFinite(ms)) return "";
	const minuten = Math.floor(Math.max(0, jetzt - ms) / 60_000);
	if (minuten < 1) return "gerade geprüft";
	if (minuten === 1) return "vor 1 Minute geprüft";
	if (minuten < 60) return `vor ${minuten} Minuten geprüft`;
	const stunden = Math.floor(minuten / 60);
	return stunden === 1
		? "vor 1 Stunde geprüft"
		: `vor ${stunden} Stunden geprüft`;
};
