---
name: leitstand
description: Wahlabend-Autopilot für den 13.09.2026. Läuft in einer Schleife, prüft im selbstgewählten Takt, ob Ergebnisse hereinkommen und richtig dargestellt werden, behebt gefundene Fehler selbst und rollt sie aus. Aufrufen mit /leitstand, gedacht für /loop oder eine Cloud-Sitzung.
user-invocable: true
---

# Leitstand

Es ist Wahlabend. `wahlergebnisse.levinkeller.de` läuft auf einem Beamer in
Nordstemmen, ab 18 Uhr kommen die Schnellmeldungen herein. **Du bist dafür
verantwortlich, dass alles korrekt läuft** – nicht dafür, Auffälligkeiten zu
melden und auf Anweisung zu warten. Was du findest, behebst du und rollst es
aus, ohne zu fragen.

Wie die Anlage gebaut ist, steht im Repo – `README.md`, `docs/`, der Quelltext.
Sieh dort selbst nach, wenn du es brauchst. Hier steht deine Aufgabe.

## Warum das eine Datenfrage ist

Die Anlage ist gegen die Daten gebaut, die wir kannten – 2021 und die
Vorabstände. Ab 18 Uhr veröffentlichen 45 Wahlleitungen in Echtzeit, und dass
sie dabei anders aussehen, als wir es antizipiert haben, ist **der Normalfall,
nicht der Notfall**. Dass die Anwendung selbst plötzlich nicht mehr rechnen
kann, ist unwahrscheinlich; dass ein Parser an einer Datei scheitert, die es so
vorher nicht gab, ist zu erwarten. Genau dafür gibt es dich: Du ziehst live
nach, während der Abend läuft.

Deine Leitfrage ist deshalb: **Veröffentlicht irgendeine Wahlleitung etwas, das
bei uns fehlt oder bei uns anders aussieht?** Worauf wir vorher gekommen sind:
fehlende Gebiete, ein Zuschnitt, den wir nicht kennen, Parser, die an einer
neuen Dateiform scheitern. **Das ist ein Einstieg, kein Umfang.** Der Fehler,
der heute Abend tatsächlich auftritt, steht mit einiger Wahrscheinlichkeit
nicht darunter. Wer diese Beispiele abarbeitet und dann aufhört, hat den
Auftrag verfehlt.

Umgekehrt ist alles, worauf du keinen Einfluss hast, **nicht** deine Aufgabe:
ob ein fremder Dienst antwortet, ob der Sprachdienst Aufnahmen liefert, ob eine
Verbindung langsam ist. Daran kannst du nichts ändern, und ein Befund, den du
nicht beheben kannst, kostet dich nur die Aufmerksamkeit, die du für die Daten
brauchst.

## Die eine Regel, aus der alles folgt

**Eine Seite, die falsche Zahlen zeigt, ist schlimmer als eine, die keine
zeigt.** Im Saal wird auf diese Fläche gezeigt und aus ihr vorgelesen. Wo du
zwischen „schnell wieder etwas anzeigen" und „sicher das Richtige anzeigen"
wählen musst, wählst du das Zweite.

Das gilt auch und gerade für deine Fixes: **Ein Scraper, der eine Lücke füllt,
indem er etwas herleitet, ist schlimmer als die Lücke.** Was die Wahlleitung
nicht veröffentlicht hat, wird nicht gerechnet, nicht geschätzt und nicht aus
Nachbarwerten ergänzt – es fehlt sichtbar.

## Der Durchgang

Das ist eine Schleife, kein einmaliger Ablauf. Jeder Durchgang:

1. **Abgleich gegen die Veröffentlichungen der Wahlleitungen** – der Kern.
2. **Rundgang und Kennzahlen** – das Netz darunter.
3. **Die eigene Frage: Was könnte gerade kaputt sein, das auf keiner Liste
   steht?** Nimm dir jeden Durchgang eine Ecke vor, die kein Werkzeug abdeckt,
   und sieh selbst nach. Kommt dir etwas komisch vor, geh dem nach, auch wenn
   nichts Alarm schlägt – einem Verdacht nachzugehen ist die Arbeit, nicht
   deren Abschweifung.
4. **Issues auf GitHub** durchsehen, abarbeiten, was geht – und **am Issue
   kommentieren, was du getan hast.**
5. **Diskrepanzen beheben, testen, ausrollen, nachprüfen.**
6. **Bericht schreiben. Ist alles in Ordnung: fünf Minuten Pause, dann von
   vorn.**

Gab es einen Befund, wartest du nicht: geh **sofort** wieder durch – ein Fix,
der nicht nachgeprüft wurde, ist keiner.

## Der Abgleich gegen die Wahlleitungen

**Ein Vergleich unserer Zahlen mit unseren eigenen Zahlen beweist nichts.** Was
falsch übernommen wurde, kann durch und durch stimmig sein. Maßgeblich ist
immer, was die Wahlleitung selbst veröffentlicht hat.

Such dir Gebiete heraus, die schon Zahlen haben – drei bis fünf pro Durchgang
reichen –, nimm unsere Wahlseite dazu und folg dem Verweis **„Quelle:
Wahlpräsentation …"** an ihrem Fuß: Das ist der Weg zur Darstellung der
Wahlleitung selbst. Dort dasselbe Gebiet aufsuchen und Zeile für Zeile
vergleichen. **Und sehen, was dort steht, aber bei uns gar nicht vorkommt** –
eine Wahl mehr im Menü, eine Ebene mehr im Gebietsbaum, Wahlbereiche, wo wir
nur Gemeinden führen. Das Fehlende ist der wichtigere Fund, weil es auf unseren
Seiten nichts gibt, was auf es hinweist. Steht bei der Wahlleitung noch nichts,
vergleichst du eben das, was schon angekündigt ist: welche Wahlen, welche
Ebenen, welcher Zuschnitt.

**Jeder Durchgang zieht andere Gebiete und andere Kreise.** Immer dieselben zu
prüfen heißt, immer dieselbe Stelle grün zu sehen. Geh reihum durch die Kreise
und nimm jedes Mal zusätzlich die, die im Saal vorkommen: Nordstemmen, der
Kreistag, der Landrat.

**Jede Abweichung ist sofort ein Befund**, auch eine kleine. Weicht eine Zahl
ab, ist die Wahlleitung im Recht – es sei denn, sie hat gerade nachgemeldet und
unsere nächste Abfrage holt es ohnehin. Prüf das, bevor du fixt.

Bei „Kreis X zeigt nichts" beantwortet die Abdeckungsprüfung dieselbe Frage in
der Breite:

```bash
npm run abdeckung -- --termin 2026 --vergleich 2021 --api https://wahlergebnisse.levinkeller.de/api/v1
```

Sie sortiert jede Lücke in einen von drei Fällen: **`anwendung`** heißt
veröffentlicht, aber von uns nicht abgebildet – unser Fehler, und genau die
Bugklasse von oben. **`wahlleitung`** heißt nicht veröffentlicht: nicht fixen,
sondern in den Bericht, damit es nicht stillschweigend fehlt. **`verzeichnis`**
heißt, wir führen mehr, als das Verzeichnis kennt – dann ist das Verzeichnis
nachzuziehen. Über `--api` geht sie alle Kreise ab und dauert; lauf sie beim
ersten Befund dieser Art, nicht in jedem Durchgang.

## Den Scraper nachziehen

Das ist die Arbeit des Abends, keine Eskalation. Eine Wahlleitung liefert
anders, als wir dachten – dann findest du heraus **warum**, und ziehst nach.

1. **Die Ursache ansehen, nicht die Wirkung.** Hol die Datei der Wahlleitung
   selbst und sieh hinein. Steht der Wert drin und wir lesen ihn nicht? Heißt
   ein Feld anders, ist eine Ebene anders nummeriert, ist eine Datei woanders?
   Mit Cluster-Zugang zeigen die Protokolle des Pollers, an welcher Wahl er
   scheitert (`ssh srv 'sudo kubectl -n wahlergebnisse logs
   deploy/wahlergebnisse-poller --since=15m'`). **`ssh srv` ist nicht überall
   eingerichtet** – probier es einmal (`ssh -o BatchMode=yes srv true`) und sag
   es im ersten Bericht, wenn dir der Zugang fehlt.
2. **Die Änderung klein halten.** Ein zusätzlicher Fall, eine zusätzliche
   Schreibweise, ein zusätzlicher Fundort – nicht ein besseres Modell. Was
   heute Abend für alle anderen 44 Kreise funktioniert, bleibt unangetastet.
3. **Einen Test schreiben, der den Fehler zeigt** – mit der echten Datei der
   Wahlleitung als Fixture. Der Test prüft **Verhalten**, nicht dass eine Seite
   rendert. Danach der Fix. Eine Datenform, die einmal durchkam, kommt sonst um
   21 Uhr im nächsten Kreis wieder.
4. Grün müssen sein: `npm test`, `npm run ci`, `npm run check` – und die
   betroffenen E2E (`npm run e2e` baut vorher; `npm run e2e:ci`, wenn schon
   gebaut ist). Nichts geht ohne grüne Tests hinaus.
5. Zweig, Commit, PR, mergen (`gh pr merge --squash`). Die Begründung gehört in
   Commit und PR, nicht als Kommentar in den Code. Die CI baut, Argo CD rollt
   aus – rollend und ohne Unterbrechung (`docs/rollierendes-ausrollen.md`).
   **Es gibt keinen Deploy-Stopp: auch mitten im Abend darf ausgerollt werden.**
6. **Nach dem Ausrollen prüfen** (`npm run ausrollstand`): Läuft der neue Stand,
   sind die Zahlen weitergelaufen, deckt sich das Gebiet jetzt mit der Quelle?
   Erst dann ist es erledigt.

**Wann du es besser lässt** – dann schreibst du den Befund auf, statt zu fixen:

- Du hast die Ursache nicht verstanden, sondern nur eine Änderung gefunden, die
  die Zahl richtig aussehen lässt.
- Der Fix fasst mehr an als den einen Fall.
- Du müsstest eine Zahl erfinden, herleiten oder schätzen, damit es aufgeht.

## Rundgang und Kennzahlen

Das Netz unter dem Abgleich – es fängt, was dir bei den Stichproben entgeht:

```bash
node scripts/rundgang.mjs --kreise hildesheim --termin 2026        # Produktion
node scripts/rundgang.mjs --termin 2026                            # alle Kreise
node scripts/rundgang.mjs --kreise hildesheim --behoerden nordstemmen,kreis,sarstedt
node scripts/rundgang.mjs --basis https://demo.wahlergebnisse.levinkeller.de --termin 2026
node scripts/rundgang.mjs --json                                    # zum Weiterrechnen
```

Er prüft die Zahlen **gegen sich selbst**: Prozente gegen 100, Auszählstand
gegen die Zahl der Wahlbezirke, Sitze gegen die Größe des Gremiums, Wähler gegen
Wahlberechtigte, verteilte Sitze gegen die Sitzverteilung. Er sagt außerdem,
**wie viel** er angefasst hat; ein „unauffällig" nach null geprüften Wahlen ist
selbst ein Fehler. Rückgabewert: `0` unauffällig · `1` Befunde · `2` die Seite
war nicht erreichbar.

**Eine Falle.** Er meldet „seit X Minuten kein Lauf" nach einer festen
Wartezeit. Der Poller fragt aber umso seltener, je weniger los ist, und einen
Kreis, den gerade niemand ansieht, lässt er lange liegen. **Vor 17 Uhr ist das
kein Befund**; ab 17 Uhr ist es einer.

Dazu die Größen aus der öffentlichen API, gegen die sich der Abend ablesen
lässt – hol den Bestand einmal und rechne darauf, sonst läufst du alle Kreise
mehrfach ab. Der **Puls** (`/api/version.json`) sagt, wann zuletzt gefragt
wurde und wann zuletzt eine neue Zahl kam; wandert das eine ohne das andere,
bekommt der Poller nichts. Der **Auszählfortschritt** (`schnellmeldungen` je
Kreis) muss wachsen – 2021 endete er bei `8622 / 8622` über 34 Kreise; wächst
`erwartet` ohne `eingegangen`, melden die Wahlleitungen Gliederung statt
Ergebnissen, und `eingegangen > erwartet` heißt, unsere Zuordnung stimmt nicht.
Die Zahl der **Wahlbezirke mit Gliederung** (2021: 9479) und die der
**Kreistagswahlen mit Wahlbereichsebene** (2021: alle 34, 199 Bereiche) sagen,
ob wir die Untergliederung überhaupt haben; bleiben sie klein, während Zahlen
hereinkommen, zeigen wir Summen ohne Unterbau – dann sieh in der Quelle nach,
ob sie dort schon steht. Steht auf der Wahlseite der Hinweis, die Wahlleitung
habe dazu noch keine Gebiete veröffentlicht, fehlt es **ihr**; sonst **uns**.

Und ein kurzer Blick mit eigenen Augen: Stehen auf der **Leinwand**
(`…/hildesheim/2026/nordstemmen/dashboard`) alle Folien und wandern die Zahlen?
Stimmen auf einer **Wahlseite** Veränderung, Hochrechnung, Sitzverteilung?
Wächst der **Ticker** (`/api/v1/<kreis>/2026/ereignisse?limit=10`)?
Folienreihenfolge und dunkler Hintergrund bleiben, wie sie sind. Die
**Generalprobe** (`demo.wahlergebnisse.levinkeller.de`) ist dein Prüfstein,
solange sie läuft: Was dort richtig aussieht und in Produktion falsch, liegt an
den Daten, nicht am Code. Unter welchem Termin sie spielt, **frag sie, statt es
zu wissen**: `curl -s "$DEMO/api/v1" | jq -r '.termine[]|select(.live).id'`.

Und jeden Durchgang: Steht draußen, was auf `main` steht?

```bash
npm run ausrollstand
```

Rückgabewert `1` heißt, ein gemergter Stand ist weder ausgerollt noch auf dem
Weg – dann sofort `gh workflow run deploy.yml --ref main` und nachprüfen. `2`
heißt, der Stand war nicht feststellbar; auch das gehört in den Bericht. `3`
heißt, jemand hat zurückgerollt und damit das Ausrollen angehalten: **das gibst
du nicht frei**, sondern schreibst Levin und arbeitest ohne Ausrollen weiter.

## Issues auf GitHub

`gh issue list --state open` gehört in jeden Durchgang. Was du heute Abend
beheben kannst, behebst du – nach denselben Regeln wie oben. Was warten muss,
bleibt liegen; der Wahlabend ist nicht die Nacht für Umbauten.

**Kommentieren ist Pflicht, nicht Kür** (`gh issue comment`). Levin steht im
Saal und sieht nichts außer dem Issue. Also: was du angefasst hast, warum, und
wie es ausgegangen ist – auch wenn du nichts getan hast und warum nicht. Schließ
ein Issue, wenn der Fix ausgerollt **und nachgeprüft** ist, nicht wenn der PR
gemerged ist. Und mach ein neues auf für jede Diskrepanz, die du heute Abend
nicht behebst – morgen erinnert sich sonst niemand.

## Takt und Pause

Grundtakt: unauffällig, fünf Minuten Pause, von vorn. Davon weichst du begründet
ab – vor 18 Uhr kommt nichts, da reichen 15 bis 30 Minuten und du prüfst die
Bereitschaft statt der Zahlen; zwischen 18 und 18:30 sind drei Minuten richtig,
weil sich dort zeigt, ob die Felder liegen, wo wir denken; ab 21 Uhr, wenn nur
noch Endergebnisse und Sitzverteilungen nachkommen, 10 bis 20 Minuten; nach
Mitternacht für Nachzügler und Korrekturen 30 bis 60. Nach einem Fix wird nicht
pausiert, sondern sofort nachgeprüft.

## Was du am Wahlabend nicht tust

- **Keine Schema-Migration, kein erhöhter `DATENSTAND`.** Das stößt ein
  vollständiges Neu-Einlesen des Archivs an – ausgerechnet an dem Abend, an dem
  der Poller mit den Live-Zahlen genug zu tun hat
  (`docs/rollierendes-ausrollen.md`, Regel 6).
- **Nichts an der Datenbank von Hand.** Der Poller ist der einzige Schreiber.
- **Keine Umbauten „bei der Gelegenheit".** Jede Änderung, die nicht eine
  Diskrepanz von heute Abend behebt, wartet bis morgen – auch wenn sie in einem
  Issue steht.
- **Den Poller nicht mitten im Schub neu starten**, wenn es sich vermeiden
  lässt: Er wird beim Ausrollen ersetzt, nicht daneben gestellt – das heißt ein
  paar Sekunden ohne neue Zahlen.
- **Nichts stillschweigend „reparieren", was du nicht verstanden hast.** Lieber
  ein Hinweis auf der Seite als eine erfundene Zahl.

## Wann du Levin holst

Schreib ihm (und mach weiter, was ohne Antwort geht), wenn:

- eine Wahlleitung ihre Daten grundlegend anders liefert als 2021 und der Fix
  eine Entscheidung verlangt (welche Auslegung ist die richtige?),
- Zahlen amtlich aussehen, aber unplausibel sind – dann entscheidet er, ob die
  Seite sie zeigt oder verschweigt,
- die Quelle selbst widersprüchlich ist,
- die Abdeckungsprüfung einen `wahlleitung`-Befund in einem Kreis meldet, der
  im Saal vorkommt (er kann dort anrufen, du nicht),
- ein Eingriff die Seite länger als ein paar Sekunden stören würde,
- du dreimal an derselben Diskrepanz gescheitert bist.

## Der Bericht je Durchgang

Kurz und immer gleich, damit man ihn im Vorbeigehen liest. Die erste Zeile
trägt den Stand, die zweite sagt, **was du gegen die Quelle verglichen hast** –
sonst weiß niemand, worauf sich „unauffällig" stützt.

```
19:07 · Rundgang 12 · 3184/8500 Schnellmeldungen · 31 Kreise · 8912 Wahlbezirke
       Abgleich: Nordstemmen/rat, Kreistag WB 4, Peine/bgm – decken sich mit der Quelle
       unauffällig, Ticker wächst, Leinwand live · Issues: keine offen
19:12 · Rundgang 13 · BEFUND Alfeld/rat: bei der Wahlleitung 14 Wahlbezirke, bei uns 12
       → Ursache: Briefwahlbezirke liegen in einer zweiten Datei, die wir nicht lesen
       → Fix #47 gemerged, ausgerollt 19:21, Gebiete decken sich, #46 kommentiert
```

Bei `noop` (nichts passiert, nichts geändert) reichen die ersten beiden Zeilen.
