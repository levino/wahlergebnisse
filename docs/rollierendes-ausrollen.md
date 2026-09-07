# Ausrollen ohne Unterbrechung

Am 13.09.2026 ist Kommunalwahl. Die Seite läuft an dem Abend live, auf einem
Beamer, und der Betreiber rechnet damit, die laufende Anwendung nachbessern zu
müssen — weil die amtlichen Daten Felder anders belegen als erwartet oder eine
Wahlart auftaucht, die es so noch nicht gab. Sein Plan: alle paar Minuten
nachsehen, ob überall Daten hereinkommen, und patchen, wenn nicht.

Dieser Plan setzt voraus, dass ein Deploy **nichts unterbricht**. Vorher tat er
das: ein Deployment, eine Replik, Strategie `Recreate` — der alte Pod ging, dann
startete der neue. Zwischen beidem war die Seite weg.

## Wie es jetzt läuft

Aus einem Deployment sind zwei geworden. Möglich macht das eine Eigenschaft von
SQLite im WAL-Modus: **ein** Schreiber, beliebig viele Leser.

```
                    ┌──────────────────────────┐
                    │ Deployment               │
   Traefik ──────▶  │ wahlergebnisse   (web)   │  2 Repliken
    Service         │ WAHLEN_ROLLE=web         │  RollingUpdate
                    │ Datenbank: readOnly      │  maxUnavailable: 0
                    └────────────┬─────────────┘
                                 │ liest
                    /data/wahlen.db  (PVC, WAL)
                                 │ schreibt
                    ┌────────────┴─────────────┐
                    │ Deployment               │
                    │ wahlergebnisse-poller    │  1 Replik
                    │ WAHLEN_ROLLE=poller      │  Recreate
                    └──────────────────────────┘
```

Welche Aufgabe ein Prozess hat, sagt `WAHLEN_ROLLE` (`src/lib/rolle.ts`):
`web`, `poller` oder — die Voreinstellung für `npm start`, `npm run dev` und die
Tests — `beides`.

Dass die Web-Pods nicht schreiben, ist nicht bloß Absicht, sondern erzwungen:
`oeffneDb` öffnet die Datei in der Rolle `web` mit `readOnly: true`. Ein Fehler
im Code kann so keinen zweiten Schreiber erzeugen, er bekommt eine Ausnahme.

**Warum mehrere Pods dasselbe RWO-Volume einhängen dürfen:** `ReadWriteOnce`
heißt „ein Knoten", nicht „ein Pod". Der Cluster hat genau einen Knoten
(`local-path`), alle Pods laufen dort.

**Warum das Web-Deployment weiter `wahlergebnisse` heißt:** Es ist dasselbe
Objekt, das vorher beides tat. Die Argo-CD-Application steht auf
`prune: false` — ein umbenanntes Deployment würde nicht entfernt, sondern liefe
als zweiter Schreiber weiter, und genau das soll die Trennung verhindern. Aus
demselben Grund bleibt sein `spec.selector` unangetastet: Er ist in Kubernetes
unveränderlich. Der Poller führt deshalb einen eigenen `name`-Wert
(`wahlergebnisse-poller`), sodass sich die Selektoren der beiden Deployments an
keiner Stelle überschneiden und der Dienst ihn nicht mit auswählt. Ein
Handgriff am Cluster ist für die Umstellung nicht nötig.

### Der Ablauf eines Deploys

1. Die CI trägt den Bild-Tag ins Produktions-Overlay ein, Argo CD synct.
2. **Web:** Kubernetes startet einen neuen Pod (`maxSurge: 1`) und nimmt
   **keinen** alten aus dem Dienst (`maxUnavailable: 0`). Der neue Pod
   bekommt erst Verkehr, wenn `/readyz` grün ist — und das heißt: Die Datenbank
   antwortet **und** die Startseite hat wirklich einmal gerendert. Erst dann
   wird ein alter Pod beendet, und auch das mit Vorsprung: `preStop` schläft
   acht Sekunden, damit Traefik den Endpunkt entfernt hat, bevor der Prozess
   aufhört zu antworten.
3. **Poller:** `Recreate` — der alte Pod ist beendet, bevor der neue startet.
   Für ein paar Sekunden kommen keine neuen Zahlen. Die Seite bleibt stehen und
   zeigt weiter den letzten Stand; niemand sieht davon etwas.

### Was aus dem gemeinsamen Prozesszustand geworden ist

Zwei Dinge liefen bisher darüber, dass Poller und Auslieferung sich einen
Modulzustand teilten.

**Wer sieht gerade hin.** Der Poller fragt einen Kreis, den jemand offen hat,
häufiger ab (`src/lib/takt.ts`). Die Web-Pods melden das jetzt über je eine
kleine Datei unter `/data/betrachtet/<pod>.json` (`src/lib/betrachtet.ts`):
jeder Prozess schreibt genau seine eigene, der Poller liest alle und nimmt je
Kreis den jüngsten Zeitstempel. Kein zweiter Schreiber auf der Datenbank, kein
zusätzlicher Dienst — und, anders als bei einem HTTP-Aufruf an den Poller, geht
nichts verloren, während der Poller gerade neu startet: Die Datei liegt weiter
da und gilt sofort wieder. Inhaltlich steht darin nur, was vorher in der Map
stand: je Kreis ein Zeitstempel. Kein Zähler, keine Kennung.

**Wann dieser Kreis zuletzt geprüft wurde.** Die Standanzeige schreibt
„geprüft 18:44", und gemeint ist dieser Kreis, nicht der letzte Lauf irgendwo in
Niedersachsen. Diese Richtung geht über die Datenbank: Der Poller schreibt nach
jedem Lauf `kreis:<slug>:geholt` in die Meta-Tabelle, die Web-Pods lesen es
(`src/lib/geprueft.ts`). Der Poller liest die Werte außerdem beim Start wieder
ein — sonst gälte nach jedem Deploy jeder Kreis als „nie geholt" und damit als
sofort fällig, also 38 Kreise auf einen Schlag, ausgerechnet direkt nach einem
Deploy am Wahlabend.

### Was die offenen Live-Verbindungen tun

Die SSE-Leitungen (`/api/live`) reißen ab, wenn der Pod getauscht wird, der sie
hält. `EventSource` verbindet nach `retry: 3000` von selbst neu und landet beim
neuen Pod; der schickt sofort den aktuellen Stand, und weicht der vom
gerenderten ab, lädt die Seite still nach.

Die Standanzeige stellt das als kurzen Aussetzer dar und nicht als Störung: Sie
geht auf Gelb („verbindet"), und erst wenn nach zehn Sekunden noch nichts
zurückgekommen ist, auf Rot („Verbindung unterbrochen"). Zehn Sekunden sind
mehr als das Dreifache des Wiederverbindungsabstands und immer noch kurz genug,
dass niemand vor einer stillstehenden Seite sitzt, die „Live" behauptet.

## Die Regel für Änderungen an den Datenstrukturen

> „Ich hoffe, dass keine Migrationen an den Datenstrukturen notwendig werden.
> Falls doch, müssen die halt backwards kompatibel gemacht werden."

Das ist ab jetzt keine Hoffnung mehr, sondern eine Bedingung. Während eines
rollenden Deploys laufen **alter und neuer Stand gleichzeitig auf derselben
Datenbank** — mindestens für die Sekunden, die der Wechsel dauert, und
länger, wenn der neue Pod nicht bereit wird und die alten weiterlaufen (was
`maxUnavailable: 0` ausdrücklich so will). Web-Pods und Poller wechseln
außerdem unabhängig voneinander: Es gibt Momente, in denen ein neuer Poller
schreibt und alte Web-Pods lesen, und Momente andersherum.

Daraus folgt:

1. **Additiv ändern.** Neue Tabellen, neue Spalten, neue Meta-Schlüssel sind
   unbedenklich: Der alte Stand kennt sie nicht und übersieht sie.
2. **Nichts umbenennen und nichts entfernen — jedenfalls nicht in einem Zug.**
   Eine Spalte, die der neue Stand nicht mehr schreibt, liest der alte
   trotzdem. Wer sie loswerden will, braucht zwei Deploys: erst einen, der sie
   nicht mehr benutzt, und wenn davon nichts Altes mehr läuft, einen zweiten,
   der sie fallen lässt. `NACHGEREICHTE_SPALTEN` in `src/lib/db.ts` kann nur
   hinzufügen — das ist kein Mangel, sondern genau die richtige Beschränkung.
3. **Nie `NOT NULL` ohne Vorgabewert.** Der alte Stand füllt die Spalte nicht;
   sein `INSERT` schlüge fehl. `NOT NULL DEFAULT ''` ist in Ordnung.
4. **Spalten in `INSERT` und `SELECT` benennen**, nie `SELECT *` gegen eine
   Tabelle, die eine Spalte dazubekommen könnte.
5. **`DATENSTAND` nur erhöhen, wenn beide Stände mit dem Ergebnis leben
   können.** Was das Erhöhen auslöst, ist harmlos: `migriereDatenstand`
   löscht die `termin:*:vollstaendig`-Marken und verwirft die
   Änderungssignale in `dateien` (ETag, Hash). Beides sind Angaben *über* die
   Daten, keine Daten. Die Ergebnisse bleiben stehen, der alte Stand liest
   sie unverändert weiter, und der Poller trägt die fehlenden Ableitungen
   nach. Nicht in Ordnung wäre eine Migration, die vorhandene Zeilen
   umschreibt oder löscht — dann sähe der alte Stand Daten, mit denen er
   nichts anfangen kann.
6. **Beim Wahlabend gar nicht migrieren.** Ein Patch am Wahlabend soll eine
   Auswertung geradebiegen, nicht das Schema anfassen. Wer `DATENSTAND`
   erhöht, stößt einen vollständigen Neu-Einlesevorgang des Archivs an — an
   einem Abend, an dem der Poller mit den Live-Zahlen genug zu tun hat.

Der vorhandene Mechanismus genügt diesen Regeln, mit einer Einschränkung, die
man kennen muss: `migriereDatenstand` läuft nur noch im Poller. Die Web-Pods
öffnen nur lesend und können weder Schema noch Datenstand anfassen. Startet ein
Web-Pod mit einem neuen Stand, bevor der Poller die Spalte nachgereicht hat,
findet er sie nicht. Deshalb gilt Regel 3 doppelt: Eine neue Spalte muss auch
beim *Lesen* fehlen dürfen — oder ihr erster Leser wartet auf den nächsten
Poller-Lauf, statt einen Fehler zu werfen.

## Was geprüft ist — und was nicht

`e2e/ausrollen.e2e.ts` stellt den Wechsel nach: ein Poller-Prozess und zwei
Web-Prozesse auf **derselben** Datenbank, davor ein kleiner Proxy, der sich wie
ein Kubernetes-Dienst verhält (ein Ziel bekommt Verkehr, sobald sein `/readyz`
grün ist, und wird aus der Liste genommen, bevor sein Prozess SIGTERM
bekommt). Währenddessen läuft eine Probe, die ohne Pause Seiten abruft. Der Test
schlägt fehl, sobald **eine** Anfrage fehlschlägt — im Lauf sind das rund
viertausend. Ein vorgeschalteter Test prüft die Probe selbst gegen eine Adresse,
die es nicht gibt: Eine Messung, die nie rot werden kann, wäre grün und wertlos.
Zusätzlich hängt ein echter Browser an der Seite und muss den Wechsel
überstehen: Die Standanzeige darf kurz gelb werden, muss danach aber von selbst
wieder grün sein.

Dass die Probe wirklich hinsieht, hat sich schon einmal gezeigt: Ein erster
Anlauf meldete genau einen 502 unter 4419 Anfragen. Er kam nicht aus dem Server,
sondern aus dem Verteiler — der zerstörte beim Herausnehmen eines Ziels auch
Verbindungen mit laufender Anfrage, was Kubernetes nicht tut. Der Fehler saß
also in der Attrappe; die Lehre daraus steht als Kommentar an Ort und Stelle.

`test/nur-lesen.test.ts`, `test/betrachtet.test.ts` und `test/geprueft.test.ts`
prüfen die Teile einzeln: dass eine Nur-Lese-Verbindung wirklich nicht
schreiben kann, aber sieht, was der Schreiber gerade committet hat; dass die
Meldung über die betrachteten Kreise zwischen Prozessen ankommt und ein
verschwundener Pod daraus herausfällt; dass „zuletzt geprüft“ einen Neustart
des Pollers übersteht.

**Nicht geprüft, weil es sich außerhalb des Clusters nicht nachstellen lässt:**

- Das Zusammenspiel mit Traefik. Dass der `preStop`-Schlaf lang genug ist,
  damit der Endpunkt vor dem Beenden entfernt ist, beruht auf der üblichen
  Größenordnung (Endpunkt-Entfernung in unter einer Sekunde) und nicht auf
  einer Messung an diesem Cluster.
- Das Verhalten unter echter Last am Wahlabend. Die Probe im Test läuft
  sequenziell und mit wenigen gleichzeitigen Anfragen.
- Der einmalige Übergang selbst: Beim ersten Sync nach dieser Änderung rollt
  das Web-Deployment von „ein Pod, der beides tut" auf „zwei Pods, die nur
  lesen" um, und parallel startet der Poller. In diesen Sekunden können der
  alte Alleskönner-Pod und der neue Poller gleichzeitig schreiben wollen.
  SQLite trägt das (Sperren plus `busy_timeout`), es kostet höchstens ein paar
  doppelte Anfragen an die Wahlleitungen — trotzdem gehört dieser eine Sync
  nicht auf den Wahlabend gelegt.

## Handgriffe am Wahlabend

```sh
# Wer läuft?
kubectl -n wahlergebnisse get pods -L app.kubernetes.io/component

# Nur die Auslieferung neu ausrollen (unterbrechungsfrei)
kubectl -n wahlergebnisse rollout status deploy/wahlergebnisse

# Was der Poller tut
kubectl -n wahlergebnisse logs -f deploy/wahlergebnisse-poller

# In den Poller hineinsehen, ohne über den Dienst zu gehen
kubectl -n wahlergebnisse port-forward deploy/wahlergebnisse-poller 8080:8080
```

Bleibt ein neuer Web-Pod rot, rollt Kubernetes **nicht** weiter: Die alten Pods
liefern aus, bis der neue bereit ist oder jemand `kubectl rollout undo` sagt.
Das ist gewollt — ein kaputter Stand soll die Seite nicht mitnehmen.
