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

/** "#d60029" → [214, 0, 41]; alles Unbrauchbare → `undefined`. */
const zerlege = (hex: string): [number, number, number] | undefined => {
	const m = hex.replace("#", "");
	if (m.length < 6) return undefined;
	const r = Number.parseInt(m.slice(0, 2), 16);
	const g = Number.parseInt(m.slice(2, 4), 16);
	const b = Number.parseInt(m.slice(4, 6), 16);
	return Number.isNaN(r + g + b) ? undefined : [r, g, b];
};

const zweistellig = (n: number): string =>
	Math.max(0, Math.min(255, Math.round(n)))
		.toString(16)
		.padStart(2, "0");

/** Empfundene Helligkeit 0–255 – dieselbe Gewichtung wie in `kontrast()`. */
export const helligkeit = (hex: string): number => {
	const rgb = zerlege(hex);
	if (!rgb) return 0;
	return (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000;
};

/** Mischt zwei Farben: `anteil` 0 gibt `a`, 1 gibt `b`. */
export const mische = (a: string, b: string, anteil: number): string => {
	const x = zerlege(a);
	const y = zerlege(b);
	if (!x || !y) return a;
	const t = Math.max(0, Math.min(1, anteil));
	return `#${x.map((wert, i) => zweistellig(wert + (y[i] - wert) * t)).join("")}`;
};

/**
 * Der dunkle Grund der Leinwand (siehe `.db-buehne` in Dashboard.astro). Der
 * Akzent muss darauf lesbar sein – deshalb steht der Grund hier und nicht nur
 * im Stilblatt.
 */
export const LEINWAND_GRUND = "#222c38";

/**
 * So hell muss ein Akzent auf diesem Grund mindestens sein. Darunter
 * verschwindet eine Linie aus fünf Metern – und genau das täten die Farben,
 * um die es hier geht: Schwarz (CDU) und Dunkelblau (AfD).
 */
const AKZENT_HELLIGKEIT = 150;

/** Wie stark die Parteifarbe den Grund der Leinwand einfärbt. */
const GRUND_ANTEIL = 0.22;

/**
 * Die Oberfläche in einer Parteifarbe – die Werte, die als
 * CSS-Custom-Properties am `<html>`-Element landen.
 *
 * **Warum nicht überall dieselbe Farbe.** Parteifarben sind für weißes Papier
 * gemacht. Schwarz (CDU) und Dunkelblau (AfD) sind als Fläche mit heller
 * Schrift stark, als dünne Linie auf dem dunklen Grund der Leinwand aber
 * unsichtbar. Deshalb zwei Farben aus einer: `farbe` für Flächen – mit
 * `schrift` als lesbarer Aufschrift –, `akzent` für alles, was als Linie oder
 * Punkt auf dem Grund liegt.
 *
 * **Die Balken bleiben unberührt.** Sie tragen die Farbe der jeweiligen Partei
 * und keine Stimmung; sie einzufärben hieße, ein Ergebnis zu verfälschen.
 */
export type ParteiThema = {
	/** Die Parteifarbe selbst – für Flächen. */
	farbe: string;
	/** Lesbare Schrift auf dieser Fläche. */
	schrift: string;
	/** Aufgehellt, bis sie auf dem dunklen Grund trägt. */
	akzent: string;
	/** Der Grund der Leinwand, in Richtung Parteifarbe getönt. */
	grund: string;
};

export const parteiThema = (
	farbe: string,
	grund = LEINWAND_GRUND,
): ParteiThema => {
	const h = helligkeit(farbe);
	// Helligkeit ist in jedem Kanal linear, also auch beim Mischen: Der
	// Anteil, der genau auf die Schwelle führt, lässt sich ausrechnen, statt
	// ihn in Schritten zu suchen.
	const anteil =
		h >= AKZENT_HELLIGKEIT ? 0 : (AKZENT_HELLIGKEIT - h) / (255 - h);
	return {
		farbe,
		schrift: kontrast(farbe),
		akzent: mische(farbe, "#ffffff", anteil),
		grund: mische(grund, farbe, GRUND_ANTEIL),
	};
};
