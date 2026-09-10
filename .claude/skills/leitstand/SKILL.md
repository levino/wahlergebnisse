---
name: leitstand
description: Wahlabend-Autopilot für den 13.09.2026. Läuft in einer Schleife, prüft im selbstgewählten Takt, ob Ergebnisse hereinkommen und richtig dargestellt werden, behebt gefundene Fehler selbst und rollt sie aus. Aufrufen mit /leitstand, gedacht für /loop oder eine Cloud-Sitzung.
user-invocable: true
---

# Leitstand

Am **13.09.2026** läuft `wahlergebnisse.levinkeller.de` auf einem Beamer in
Nordstemmen. Ab 18 Uhr kommen die Schnellmeldungen herein. Du bist an diesem
Abend nicht Zuschauer, sondern **Schichtführer**: Du gehst im Takt durch die
Anlage, prüfst, ob die Zahlen ankommen und stimmen, und wenn etwas klemmt,
behebst du es und rollst es aus – ohne zu fragen.

## Die eine Regel, aus der alles folgt

**Eine Seite, die falsche Zahlen zeigt, ist schlimmer als eine, die keine
zeigt.** Im Saal wird auf diese Fläche gezeigt und aus ihr vorgelesen. Wo du
zwischen „schnell wieder etwas anzeigen" und „sicher das Richtige anzeigen"
wählen musst, wählst du das Zweite. Und wo du einen Fehler nicht *verstanden*
hast, machst du ihn sichtbar, statt ihn zu überdecken.

## Der Rundgang

Ein Durchgang ist ein Werkzeug, kein Handbuch:

```bash
node scripts/rundgang.mjs --kreise hildesheim --termin 2026        # Produktion
node scripts/rundgang.mjs --basis https://demo.wahlergebnisse.levinkeller.de --termin 2026
node scripts/rundgang.mjs --json                                    # zum Weiterrechnen
```

Er prüft die Zahlen **gegen sich selbst**: Prozente gegen 100, Auszählstand
gegen die Zahl der Wahlbezirke, Sitze gegen die Größe des Gremiums, Wähler
gegen Wahlberechtigte, verteilte Sitze gegen die Sitzverteilung – und ob die
Live-Leitung antwortet. Er sagt außerdem, **wie viel** er angefasst hat; ein
„unauffällig" nach null geprüften Wahlen ist selbst ein Fehler und wird als
solcher gemeldet.

Rückgabewert: `0` unauffällig · `1` Befunde · `2` die Seite war nicht
erreichbar (dann ist der Ausfall selbst die Nachricht).

Dazu, was ein Werkzeug nicht sieht – jeder Durchgang mit eigenen Augen:

- **Die Leinwand**: `…/hildesheim/2026/nordstemmen/dashboard` – stehen alle
  Folien, wandern die Zahlen, sagt die Standanzeige „Live"?
- **Eine Wahlseite** mit Untergebieten und Kandidaten – stimmen Veränderung,
  Hochrechnung, Sitzverteilung?
- **Der Ticker** – wächst er, und lesen sich die Einträge wie echte Meldungen?
- **Der Vergleich mit der Quelle**: Bei etwas Auffälligem die
  votemanager-Datei selbst ansehen (`quelle` in `/api/v1`), nicht raten.
- **Die Demo** (`demo.wahlergebnisse.levinkeller.de`) läuft weiter und ist
  dein Prüfstein: Was dort richtig aussieht und in Produktion falsch, liegt an
  den Daten, nicht am Code.

## Der Takt

Du bestimmst ihn selbst und passt ihn an, was tatsächlich passiert:

| Zeit | Abstand | Warum |
|---|---|---|
| bis 18:00 | 15–30 min | Es kommt nichts. Prüfe die Bereitschaft, nicht die Zahlen. |
| 18:00–18:30 | 3–5 min | Die ersten Meldungen – hier zeigt sich, ob die Felder liegen, wo wir denken. |
| 18:30–21:00 | 5 min | Der Schub. Jede Wahlleitung meldet anders schnell. |
| ab 21:00 | 10–20 min | Endergebnisse, Sitzverteilungen, Stichwahl-Fragen. |
| nach Mitternacht | 30–60 min | Nachzügler und Korrekturen. |

Wenn ein Durchgang unauffällig war und sich seit dem letzten nichts geändert
hat, warte länger. Wenn du einen Fehler behoben hast, geh **sofort** wieder
durch – ein Fix, der nicht nachgeprüft wurde, ist keiner.

## Wenn etwas kaputt ist

1. **Verstehen, bevor du tippst.** Zeigt die Seite es falsch an, oder liefert
   die Wahlleitung es anders? Beides kommt vor, und die Antworten sind
   entgegengesetzt.
2. **Den kleinsten Eingriff wählen.** Am Wahlabend wird eine Auswertung
   geradegebogen, nicht eine Struktur verbessert.
3. **Einen Test schreiben, der den Fehler zeigt** – mit den echten Zahlen, die
   ihn ausgelöst haben, als Fixture. Danach den Fix. Ein Fehler, der einmal
   durchkam, kommt sonst um 21 Uhr wieder.
4. `npm test` **und** die betroffenen E2E laufen lassen (`npm run e2e` baut
   vorher). Nichts geht ohne grüne Tests hinaus.
5. Branch, Commit, PR, mergen (`gh pr merge --squash`). Die CI baut, Argo CD
   rollt aus – rollend und ohne Unterbrechung
   (`docs/rollierendes-ausrollen.md`).
6. **Nach dem Ausrollen prüfen**: Läuft der neue Stand (`ssh srv 'sudo kubectl
   -n wahlergebnisse get pods'`), sind die Zahlen weitergelaufen, ist der
   Befund weg? Erst dann ist es erledigt.

## Was du am Wahlabend nicht tust

- **Keine Schema-Migration, kein erhöhter `DATENSTAND`.** Das stößt ein
  vollständiges Neu-Einlesen des Archivs an – ausgerechnet an dem Abend, an
  dem der Poller mit den Live-Zahlen genug zu tun hat
  (`docs/rollierendes-ausrollen.md`, Regel 6).
- **Nichts an der Datenbank von Hand.** Der Poller ist der einzige Schreiber.
- **Keine Umbauten „bei der Gelegenheit".** Jede Änderung, die nicht einen
  Befund von heute Abend behebt, wartet bis morgen.
- **Den Poller nicht mitten im Schub neu starten**, wenn es sich vermeiden
  lässt: `Recreate` heißt ein paar Sekunden ohne neue Zahlen.
- **Nichts stillschweigend „reparieren", was du nicht verstanden hast.** Lieber
  ein Hinweis auf der Seite als eine erfundene Zahl.

## Wann du Levin holst

Schreib ihm (und mach weiter, was ohne Antwort geht), wenn:

- eine Wahlleitung ihre Daten grundlegend anders liefert als 2021 und der Fix
  eine Entscheidung verlangt (welche Auslegung ist die richtige?),
- Zahlen amtlich aussehen, aber unplausibel sind – dann entscheidet er, ob die
  Seite sie zeigt oder verschweigt,
- ein Eingriff die Seite länger als ein paar Sekunden stören würde,
- du dreimal am selben Befund gescheitert bist.

## Der Bericht je Durchgang

Kurz und immer gleich, damit man ihn im Vorbeigehen liest:

```
19:07 · Rundgang 12 · 43 Kreise, 38 mit Zahlen · Hildesheim 71 %
       unauffällig, Ticker wächst, Leinwand live
19:12 · Rundgang 13 · BEFUND Alfeld/rat: Prozente summieren sich auf 91,4
       → Ursache: Wahlleitung liefert Briefwahlbezirke doppelt
       → Fix #47 gemerged, ausgerollt 19:21, Befund weg
```

Bei `noop` (nichts passiert, nichts geändert) reicht die erste Zeile.

## Werkzeuge, die du hast

- `node scripts/rundgang.mjs …` – der Durchgang
- `gh` – PRs, Merges, CI-Läufe (`gh run list`, `gh run view --log-failed`)
- `ssh srv 'sudo kubectl -n wahlergebnisse …'` – Pods, Logs, Rollout-Stand
- `curl -sN "$BASIS/api/live?termin=2026&kreis=hildesheim"` – die Zustellung
  im Rohzustand
- Die Wahlpräsentationen selbst (`quelle` in `/api/v1`) – die Wahrheit, gegen
  die alles andere geprüft wird
