/**
 * Namen für die Teile der Seite, die einen Seitentausch überleben sollen
 * (`transition:persist`).
 *
 * Astros Router ersetzt beim Tausch den ganzen Body. Ein Element bleibt nur
 * dann stehen, wenn die neue Seite eines mit **demselben** Persist-Namen
 * mitbringt – der Name ist also nicht bloß eine Beschriftung, sondern die
 * Bedingung: Gleicher Name heißt „mitnehmen“, anderer Name heißt „ersetzen“.
 *
 * Am Wahlabend kommt der Tausch alle paar Minuten von selbst (Live-Zustellung
 * in Layout.astro), ohne dass jemand etwas angeklickt hätte. Was dabei
 * aufgeklappt, ausgewählt oder halb getippt ist, darf nicht verschwinden.
 */

/**
 * Name des Kreis-Umschalters im Kopf.
 *
 * Er trägt den Kreis-Slug, weil der Inhalt des Umschalters daran hängt:
 * Beschriftung im Kopf und Hervorhebung in der Kreisliste. Bleibt man im
 * Kreis (jede Live-Aktualisierung, jeder Klick innerhalb des Kreises), ist der
 * Name gleich und der offene Aufklapper bleibt offen. Wechselt man den Kreis,
 * unterscheiden sich die Namen und die neue Seite bringt ihren eigenen, zur
 * neuen Beschriftung passenden Umschalter mit – zu, wie es sich gehört.
 *
 * Ohne Kreis (Auswahlseite unter „/“) gibt es keinen Slug; „keiner“ hält den
 * Namen trotzdem eindeutig und stabil.
 */
export const umschalterName = (kreisSlug?: string): string =>
	`kreis-wechsel-${kreisSlug ?? "keiner"}`;
