/**
 * Parteifarben. votemanager liefert je Partei eine Farbe mit; die nehmen wir
 * (Vorgabe des Landkreises, wiedererkennbar). Fehlt sie, greift dieser
 * Katalog. Schlüssel = normalisierter Kurzname (siehe parteiKey).
 */
const KATALOG: Record<string, string> = {
	cdu: "#000000",
	spd: "#d60029",
	gruene: "#33cc00",
	fdp: "#fbee31",
	afd: "#000063",
	linke: "#d01d5c",
	dielinke: "#d01d5c",
	piraten: "#ff8800",
	freiewaehler: "#f7a600",
	fw: "#f7a600",
	diepartei: "#8b5a2b",
	dieunabhaengigen: "#5dc66d",
	sonstige: "#acbee4",
};

export const parteiFarbe = (key: string, vorgabe?: string): string =>
	vorgabe || KATALOG[key] || "#9ca3af";

/** Weiß oder Schwarz als Schrift auf der Parteifarbe. */
export const kontrast = (hex: string): string => {
	const m = hex.replace("#", "");
	if (m.length < 6) return "#000";
	const r = Number.parseInt(m.slice(0, 2), 16);
	const g = Number.parseInt(m.slice(2, 4), 16);
	const b = Number.parseInt(m.slice(4, 6), 16);
	return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? "#000" : "#fff";
};

/** Farbe mit Alpha für Kartenflächen ("#d60029" → "rgba(214,0,41,0.65)"). */
export const mitAlpha = (hex: string, alpha: number): string => {
	const m = hex.replace("#", "");
	if (m.length < 6) return hex;
	const r = Number.parseInt(m.slice(0, 2), 16);
	const g = Number.parseInt(m.slice(2, 4), 16);
	const b = Number.parseInt(m.slice(4, 6), 16);
	return `rgba(${r},${g},${b},${alpha})`;
};
