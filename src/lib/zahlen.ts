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
