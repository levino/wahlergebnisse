# Schemaänderungen beim rollenden Ausrollen

Während eines Deploys laufen alter und neuer Stand gleichzeitig auf derselben
Datenbank, und Web-Pods und Poller wechseln unabhängig voneinander. Daraus
folgen sechs Regeln:

1. **Additiv ändern.** Neue Tabellen, Spalten und Meta-Schlüssel sind
   unbedenklich.
2. **Nichts umbenennen, nichts entfernen – jedenfalls nicht in einem Zug.**
   Erst ein Deploy, der die Spalte nicht mehr benutzt; wenn davon nichts Altes
   mehr läuft, ein zweiter, der sie fallen lässt. `NACHGEREICHTE_SPALTEN` in
   `src/lib/db.ts` kann nur hinzufügen.
3. **Nie `NOT NULL` ohne Vorgabewert** – der alte Stand füllt die Spalte nicht.
   `NOT NULL DEFAULT ''` ist in Ordnung. Eine neue Spalte muss auch beim
   *Lesen* fehlen dürfen: `migriereDatenstand` läuft nur im Poller, ein
   Web-Pod kann sie nicht selbst nachreichen.
4. **Spalten in `INSERT` und `SELECT` benennen**, nie `SELECT *`.
5. **`DATENSTAND` nur erhöhen, wenn beide Stände mit dem Ergebnis leben
   können.** Nicht in Ordnung wäre eine Migration, die vorhandene Zeilen
   umschreibt oder löscht.
6. **Am Wahlabend gar nicht migrieren.** Ein erhöhter `DATENSTAND` stößt ein
   vollständiges Neu-Einlesen des Archivs an.

Nicht nachstellbar und deshalb ungeprüft: das Zusammenspiel mit Traefik (der
`preStop`-Schlaf ist geschätzt, nicht an diesem Cluster gemessen) und das
Verhalten unter der Last eines Wahlabends.
