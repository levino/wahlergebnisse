/**
 * Der Vertrag der Leitung: Adressen, Parameter, Ereignisarten, Rümpfe.
 *
 * Server und Browser nennen hier dieselben Werte, statt zwei Zeichenketten zu
 * pflegen, die zufällig gleich lauten sollen. Das Modul hängt an nichts –
 * weder an der Ablage noch am Fenster –, damit es beide Seiten einbinden
 * können.
 */

export const LIVE_PFAD = "/api/live";

/** Die Auskunft ohne Leitung, für den Fall, dass keine steht. */
export const VERSION_PFAD = "/api/version.json";

/** Die Parameter, aus denen der Server Termin, Zuschnitt und Partei liest. */
export const ORT_PARAM = {
	termin: "termin",
	topic: "topic",
	partei: "partei",
} as const;

/** Die Ereignisarten der Zustellung – gesendet wie abgehört. */
export const LIVE_EREIGNIS = {
	/** Die Zahlen haben sich bewegt. */
	stand: "stand",
	/** Die Leitung lebt. */
	puls: "puls",
	/** Es liegt ein Moderationsbeitrag bereit. */
	beitrag: "beitrag",
} as const;

export type LiveEreignis = (typeof LIVE_EREIGNIS)[keyof typeof LIVE_EREIGNIS];

/** Womit die Leitung der Leinwand einen Beitrag meldet. */
export const BEITRAG_EREIGNIS = "wahlen:beitrag";

/** Womit eine neue Parteiwahl die Leitung neu aufbauen lässt. */
export const PARTEI_EREIGNIS = "wahlen:partei";

export type BeitragsDetail = { kennung: number };

/** Wo ein Zuschauer steht – daraus bildet sich jede seiner Adressen. */
export type LiveOrt = {
	termin: string;
	/** Die Kennung, die der Server in die Seite geschrieben hat. */
	topic?: string;
	/** Eingestellte Partei; sie schneidet ein eigenes Topic. */
	partei?: string;
};

/** Die Zahlen haben sich bewegt. Kennungen, keine Inhalte. */
export type Ping = {
	termin: string;
	topic: string;
	version: string;
	geprueft: string;
};

/**
 * Es liegt ein Moderationsbeitrag bereit – Toast und Aufnahme, sofort abrufbar.
 *
 * Eigene Nachricht mit eigenem Auslöser: Ein Beitrag hat mit einer neuen Zahl
 * nichts zu tun. Er entsteht Sekunden später, weil eine Aufnahme erzeugt wird,
 * und ein klemmender Sprachdienst darf die Zahlen nicht aufhalten. Umgekehrt
 * muss ein fertiger Beitrag auch dann hinausgehen, wenn sich an den Zahlen
 * seit der letzten Zustellung nichts mehr getan hat.
 */
export type BeitragsPing = { kennung: string };

/** Dieselben Felder wie ein `stand` – nur eben abgefragt statt zugestellt. */
export type VersionAntwort = Ping;

export const ortsParameter = (ort: LiveOrt): URLSearchParams => {
	const p = new URLSearchParams();
	p.set(ORT_PARAM.termin, ort.termin);
	if (ort.topic) p.set(ORT_PARAM.topic, ort.topic);
	if (ort.partei) p.set(ORT_PARAM.partei, ort.partei);
	return p;
};

export const liveAdresse = (ort: LiveOrt): string =>
	`${LIVE_PFAD}?${ortsParameter(ort)}`;

export const versionAdresse = (ort: LiveOrt): string =>
	`${VERSION_PFAD}?${ortsParameter(ort)}`;

/**
 * Dieselbe Leitung für einen Zuschauer mit eingestellter Partei.
 *
 * Das Server-HTML kennt die Auswahl nicht – die liegt im Browser. Deshalb
 * trägt der Browser sie an die fertige Adresse an.
 */
export const mitPartei = (adresse: string, parteiKey: string): string =>
	adresse && parteiKey
		? `${adresse}${adresse.includes("?") ? "&" : "?"}${new URLSearchParams({
				[ORT_PARAM.partei]: parteiKey,
			})}`
		: adresse;

/** Dieselben Parameter an der Auskunft statt an der Leitung. */
export const alsVersion = (adresse: string): string =>
	adresse.startsWith(`${LIVE_PFAD}?`)
		? `${VERSION_PFAD}${adresse.slice(LIVE_PFAD.length)}`
		: adresse;
