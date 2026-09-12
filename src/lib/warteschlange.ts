export type Verbindungen = {
	start: number;
	mindestens: number;
	hoechstens: number;
};

export const STANDARD_VERBINDUNGEN: Verbindungen = {
	start: 8,
	mindestens: 2,
	hoechstens: 32,
};

export const ARCHIV_VERBINDUNGEN: Verbindungen = {
	start: 2,
	mindestens: 1,
	hoechstens: 4,
};

export const LATENZ_SCHWELLE = 3;
export const ZEITGRENZE_MS = 20_000;

const SENKUNG = 0.5;
const LATENZ_FENSTER_MS = 30_000;
const LATENZ_PROBEN = 16;
const GLAETTUNG = 0.2;
const VERSUCHE = 3;
const SPERRE_OHNE_ANGABE_MS = 1_000;
const SPERRE_HOECHSTENS_MS = 60_000;

const istLokal = (host: string): boolean =>
	/^(127\.\d+\.\d+\.\d+|localhost|\[::1\])(:\d+)?$/.test(host);

const gesund = (v: Verbindungen): Verbindungen => {
	const hoechstens = Math.max(1, Math.floor(v.hoechstens));
	const mindestens = Math.min(
		Math.max(1, Math.floor(v.mindestens)),
		hoechstens,
	);
	return {
		hoechstens,
		mindestens,
		start: Math.min(Math.max(mindestens, v.start), hoechstens),
	};
};

export const sperrdauerMs = (
	wert: string | null | undefined,
	jetzt: number,
): number | undefined => {
	const text = wert?.trim();
	if (!text) return undefined;
	if (/^\d+$/.test(text))
		return Math.min(Number(text) * 1000, SPERRE_HOECHSTENS_MS);
	const punkt = Date.parse(text);
	if (!Number.isFinite(punkt)) return undefined;
	return Math.min(Math.max(0, punkt - jetzt), SPERRE_HOECHSTENS_MS);
};

type Hostzustand = {
	grenzen: Verbindungen;
	erlaubt: number;
	offen: number;
	wartend: Array<() => void>;
	gesperrt: boolean;
	sperreBis: number;
	sperrmarke: number;
	letzteSenkung: number;
	unbegrenzt: boolean;
	mittel: number;
	proben: number;
	fensterBeginn: number;
	minJetzt: number;
	minVorher: number;
};

export type Antwort = {
	status: number;
	statusText: string;
	etag: string | null;
	text: string;
};

export type Warteschlange = {
	hole: (
		url: string,
		init?: { headers?: Record<string, string> },
	) => Promise<Antwort>;
	erlaubt: (host: string) => number;
	offen: (host: string) => number;
	stand: () => Array<{ host: string; erlaubt: number; offen: number }>;
};

export const hostWarteschlange = (
	opts: {
		standard?: Verbindungen;
		hosts?: Record<string, Verbindungen>;
		latenzSchwelle?: number;
		zeitgrenzeMs?: number;
		uhr?: () => number;
		warte?: (ms: number) => Promise<void>;
		hole?: typeof fetch;
	} = {},
): Warteschlange => {
	const standard = gesund(opts.standard ?? STANDARD_VERBINDUNGEN);
	const hosts = opts.hosts ?? {};
	const schwelle = opts.latenzSchwelle ?? LATENZ_SCHWELLE;
	const zeitgrenze = opts.zeitgrenzeMs ?? ZEITGRENZE_MS;
	const uhr = opts.uhr ?? (() => Date.now());
	const warte =
		opts.warte ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
	const netz = opts.hole ?? fetch;
	const zustaende = new Map<string, Hostzustand>();

	const zustand = (host: string): Hostzustand => {
		let z = zustaende.get(host);
		if (z) return z;
		const eigene = hosts[host];
		const grenzen = gesund(eigene ?? standard);
		z = {
			grenzen,
			erlaubt: grenzen.start,
			offen: 0,
			wartend: [],
			gesperrt: false,
			sperreBis: 0,
			sperrmarke: 0,
			letzteSenkung: -1,
			unbegrenzt: !eigene && istLokal(host),
			mittel: 0,
			proben: 0,
			fensterBeginn: uhr(),
			minJetzt: Number.POSITIVE_INFINITY,
			minVorher: Number.POSITIVE_INFINITY,
		};
		zustaende.set(host, z);
		return z;
	};

	const grenze = (z: Hostzustand): number =>
		z.unbegrenzt
			? Number.POSITIVE_INFINITY
			: Math.max(1, Math.floor(z.erlaubt));

	const vergib = (z: Hostzustand): void => {
		while (z.wartend.length > 0 && !z.gesperrt && z.offen < grenze(z)) {
			z.offen++;
			z.wartend.shift()?.();
		}
	};

	const platz = (z: Hostzustand): Promise<void> => {
		if (z.wartend.length === 0 && !z.gesperrt && z.offen < grenze(z)) {
			z.offen++;
			return Promise.resolve();
		}
		return new Promise<void>((los) => {
			z.wartend.push(los);
		});
	};

	const frei = (z: Hostzustand): void => {
		z.offen--;
		vergib(z);
	};

	const sperre = (z: Hostzustand, ms: number): void => {
		const bis = uhr() + ms;
		if (z.gesperrt && bis <= z.sperreBis) return;
		z.gesperrt = true;
		z.sperreBis = bis;
		const marke = ++z.sperrmarke;
		void warte(ms).then(() => {
			if (marke !== z.sperrmarke) return;
			z.gesperrt = false;
			vergib(z);
		});
	};

	const senke = (z: Hostzustand, begonnen: number): void => {
		if (begonnen <= z.letzteSenkung) return;
		z.erlaubt = Math.max(z.grenzen.mindestens, z.erlaubt * SENKUNG);
		z.letzteSenkung = uhr();
	};

	const basis = (z: Hostzustand): number => Math.min(z.minJetzt, z.minVorher);

	const beobachte = (z: Hostzustand, dauer: number): void => {
		const jetzt = uhr();
		if (jetzt - z.fensterBeginn >= LATENZ_FENSTER_MS) {
			z.minVorher = z.minJetzt;
			z.minJetzt = Number.POSITIVE_INFINITY;
			z.fensterBeginn = jetzt;
		}
		z.minJetzt = Math.min(z.minJetzt, dauer);
		z.mittel =
			z.proben === 0 ? dauer : z.mittel * (1 - GLAETTUNG) + dauer * GLAETTUNG;
		z.proben++;
	};

	const traege = (z: Hostzustand): boolean =>
		z.proben >= LATENZ_PROBEN &&
		Number.isFinite(basis(z)) &&
		basis(z) > 0 &&
		z.mittel > basis(z) * schwelle;

	const hebe = (z: Hostzustand): void => {
		z.erlaubt = Math.min(z.grenzen.hoechstens, z.erlaubt + 1 / z.erlaubt);
		vergib(z);
	};

	const ueberlastet = (status: number): boolean =>
		status === 429 || status >= 500;

	return {
		erlaubt: (host) => zustand(host).erlaubt,
		offen: (host) => zustand(host).offen,
		stand: () =>
			[...zustaende].map(([host, z]) => ({
				host,
				erlaubt: z.erlaubt,
				offen: z.offen,
			})),
		hole: async (url, init) => {
			const z = zustand(new URL(url).host);
			let letzte: Antwort | undefined;
			for (let versuch = 0; versuch < VERSUCHE; versuch++) {
				await platz(z);
				const begonnen = uhr();
				try {
					const res = await netz(url, {
						headers: init?.headers,
						signal: AbortSignal.timeout(zeitgrenze),
					});
					const antwort: Antwort = {
						status: res.status,
						statusText: res.statusText,
						etag: res.headers.get("etag"),
						text:
							res.status === 204 || res.status === 304 ? "" : await res.text(),
					};
					const dauer = uhr() - begonnen;
					if (!ueberlastet(antwort.status)) {
						beobachte(z, dauer);
						if (traege(z)) senke(z, begonnen);
						else hebe(z);
						return antwort;
					}
					senke(z, begonnen);
					letzte = antwort;
					const angabe = sperrdauerMs(res.headers.get("retry-after"), uhr());
					if (antwort.status === 429)
						sperre(z, angabe ?? SPERRE_OHNE_ANGABE_MS);
					else if (angabe !== undefined) sperre(z, angabe);
					else return antwort;
				} catch (err) {
					senke(z, begonnen);
					throw err;
				} finally {
					frei(z);
				}
			}
			return letzte as Antwort;
		},
	};
};

const zahl = (wert: string | undefined, vorgabe: number): number => {
	const n = Number(wert);
	return Number.isFinite(n) && n > 0 ? n : vorgabe;
};

export const verbindungenAusUmgebung = (
	umgebung: Record<string, string | undefined>,
): { standard: Verbindungen; hosts: Record<string, Verbindungen> } => {
	const standard = gesund({
		start: zahl(umgebung.POLL_VERBINDUNGEN_START, STANDARD_VERBINDUNGEN.start),
		mindestens: zahl(
			umgebung.POLL_VERBINDUNGEN_MINDESTENS,
			STANDARD_VERBINDUNGEN.mindestens,
		),
		hoechstens: zahl(
			umgebung.POLL_VERBINDUNGEN_HOECHSTENS,
			STANDARD_VERBINDUNGEN.hoechstens,
		),
	});
	const hosts: Record<string, Verbindungen> = {};
	for (const teil of (umgebung.POLL_HOST_VERBINDUNGEN ?? "").split(",")) {
		const [host, zahlen] = teil.split("=").map((s) => s.trim());
		if (!host || !zahlen) continue;
		const [start, hoechstens, mindestens] = zahlen.split(":").map(Number);
		if (!Number.isFinite(start) || start <= 0) continue;
		hosts[host] = gesund({
			start,
			hoechstens:
				Number.isFinite(hoechstens) && hoechstens > 0 ? hoechstens : start,
			mindestens:
				Number.isFinite(mindestens) && mindestens > 0 ? mindestens : 1,
		});
	}
	return { standard, hosts };
};
