/**
 * Welche Aufgabe dieser Prozess hat.
 *
 * Bis hierher machte ein einziger Node-Prozess beides: Seiten ausliefern und
 * bei den Wahlleitungen nachfragen. Das ging, solange davon genau eine Kopie
 * lief – und genau das war der Preis: Ein Deploy hieß „alter Pod weg, neuer
 * Pod hoch", die Seite war dabei weg. Am Wahlabend, wenn ein Beamer läuft und
 * der Betreiber die laufende Anwendung nachbessert, ist das nicht hinnehmbar.
 *
 * Die Trennung nutzt aus, was SQLite im WAL-Modus kann: **ein** Schreiber,
 * beliebig viele Leser. Also:
 *
 * - `poller` – fragt ab und schreibt. Genau eine Kopie, Strategie `Recreate`.
 *   Ist er kurz weg, kommen für ein paar Sekunden keine neuen Zahlen; die
 *   Seite bleibt stehen und zeigt weiter den letzten Stand.
 * - `web` – liefert nur aus und öffnet die Datenbank **nur lesend**. Mehrere
 *   Kopien, Strategie `RollingUpdate` mit `maxUnavailable: 0`. Der Dienst
 *   zeigt auf diese Pods.
 * - `beides` – ein Prozess wie bisher. Voreinstellung, damit `npm start`,
 *   `npm run dev` und die Browser-Tests unverändert funktionieren.
 *
 * Das Nur-Lesen ist nicht bloß Absicht, sondern erzwungen: `oeffneDb` öffnet
 * in der Rolle `web` mit `readOnly: true` (siehe `db.ts`). Ein Fehler im Code
 * kann so keinen zweiten Schreiber erzeugen – er bekommt eine Ausnahme.
 *
 * Warum eine Umgebungsvariable und kein Aufrufparameter: Das Astro-Bundle
 * (`dist/server/entry.mjs`) ist eine eigene Kopie dieser Module und öffnet
 * seine eigene Verbindung, ohne dass `server/main.ts` daran vorbeikäme. Nur
 * etwas, das im ganzen Prozess gilt, erreicht beide Kopien.
 */

export type Rolle = "poller" | "web" | "beides";

const ERLAUBT: Rolle[] = ["poller", "web", "beides"];

/**
 * Rolle dieses Prozesses aus `WAHLEN_ROLLE`.
 *
 * Bei jedem Aufruf frisch gelesen statt einmal beim Laden festgehalten: Tests
 * setzen die Variable um und erwarten, dass die nächste Verbindung der neuen
 * Angabe folgt. Der Aufruf kostet nichts.
 */
export const rolle = (): Rolle => {
	const wert = (process.env.WAHLEN_ROLLE ?? "").trim().toLowerCase();
	if (!wert) return "beides";
	if ((ERLAUBT as string[]).includes(wert)) return wert as Rolle;
	// Ein Tippfehler in der Rolle darf nicht stillschweigend zu „beides"
	// werden – das wäre am Wahlabend ein zweiter Schreiber auf derselben
	// Datei. Lieber laut sein und trotzdem weiterlaufen: `beides` ist die
	// Einstellung, die für sich allein funktioniert.
	console.warn(
		`WAHLEN_ROLLE="${wert}" ist unbekannt (erlaubt: ${ERLAUBT.join(", ")}) – es gilt "beides"`,
	);
	return "beides";
};

/** Fragt dieser Prozess bei den Wahlleitungen nach und schreibt? */
export const schreibtDieserProzess = (): boolean => rolle() !== "web";
