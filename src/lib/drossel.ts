export type Grenze = {
	/** Marken je Sekunde – der Durchschnitt, den der Host auf Dauer sieht. */
	proSekunde: number;
	/** Wie viele Marken sich höchstens ansammeln (Vorrat für den Anlauf). */
	spitze: number;
};

export const STANDARD_GRENZEN: Record<string, Grenze> = {
	"votemanager.kdo.de": { proSekunde: 60, spitze: 120 },
};

export const STANDARD_GRENZE: Grenze = { proSekunde: 10, spitze: 20 };

const istLokal = (host: string): boolean =>
	/^(127\.\d+\.\d+\.\d+|localhost|\[::1\])(:\d+)?$/.test(host);

export type Drossel = {
	/** Wartet, bis für diesen Host eine Marke frei ist. */
	nimm: (host: string) => Promise<void>;
	/** Wie viele Marken jetzt frei sind (für Tests). */
	frei: (host: string) => number;
};

type Konto = { marken: number; stand: number; grenze: Grenze };

export const hostDrossel = (
	opts: {
		grenzen?: Record<string, Grenze>;
		standard?: Grenze;
		jetzt?: () => number;
		warte?: (ms: number) => Promise<void>;
	} = {},
): Drossel => {
	const grenzen = opts.grenzen ?? STANDARD_GRENZEN;
	const standard = opts.standard ?? STANDARD_GRENZE;
	const jetzt = opts.jetzt ?? (() => Date.now());
	const warte =
		opts.warte ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
	const konten = new Map<string, Konto>();

	const konto = (host: string): Konto => {
		let k = konten.get(host);
		if (!k) {
			const grenze = grenzen[host] ?? standard;
			k = { marken: grenze.spitze, stand: jetzt(), grenze };
			konten.set(host, k);
		}
		const now = jetzt();
		k.marken = Math.min(
			k.grenze.spitze,
			k.marken + ((now - k.stand) / 1000) * k.grenze.proSekunde,
		);
		k.stand = now;
		return k;
	};

	const unbegrenzt = (host: string) => istLokal(host) && !grenzen[host];

	return {
		frei: (host) =>
			unbegrenzt(host) ? Number.POSITIVE_INFINITY : konto(host).marken,
		nimm: async (host) => {
			if (unbegrenzt(host)) return;
			for (;;) {
				const k = konto(host);
				if (k.marken >= 1) {
					k.marken -= 1;
					return;
				}
				const fehlt = 1 - k.marken;
				await warte(
					Math.max(1, Math.ceil((fehlt / k.grenze.proSekunde) * 1000)),
				);
			}
		},
	};
};

export const grenzenAusUmgebung = (
	wert: string | undefined,
): Record<string, Grenze> => {
	if (!wert?.trim()) return STANDARD_GRENZEN;
	const grenzen: Record<string, Grenze> = { ...STANDARD_GRENZEN };
	for (const teil of wert.split(",")) {
		const [host, zahlen] = teil.split("=").map((s) => s.trim());
		if (!host || !zahlen) continue;
		const [proSekunde, spitze] = zahlen.split(":").map(Number);
		if (!Number.isFinite(proSekunde) || proSekunde <= 0) continue;
		grenzen[host] = {
			proSekunde,
			spitze:
				Number.isFinite(spitze) && spitze > 0
					? spitze
					: Math.max(1, proSekunde * 2),
		};
	}
	return grenzen;
};
