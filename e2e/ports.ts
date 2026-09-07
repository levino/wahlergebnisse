/**
 * Ports der Testumgebung.
 *
 * Fest verdrahtete Ports vertragen sich nicht damit, dass mehrere Läufe
 * gleichzeitig stattfinden – zwei parallele Testläufe auf derselben Maschine
 * blockieren sich gegenseitig am Port des Servers ("address already in use").
 * Deshalb kommen die Ports aus der Umgebung; wer nichts setzt, bekommt die
 * bisherigen Werte, damit ein einzelner Lauf unverändert funktioniert.
 *
 * `npm run e2e` wählt über scripts/freie-ports.mjs freie Paare aus.
 */
export const APP_PORT = Number(process.env.E2E_APP_PORT ?? 8099);
export const STEUER_PORT = Number(process.env.E2E_STEUER_PORT ?? 8098);
export const BASIS = `http://127.0.0.1:${APP_PORT}`;
export const STEUERUNG = `http://127.0.0.1:${STEUER_PORT}`;
