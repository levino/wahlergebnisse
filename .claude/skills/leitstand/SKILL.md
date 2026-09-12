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

## Die Anlage in sechs Sätzen

Damit du ohne Vorwissen weißt, wovon die Rede ist:

1. Ein **Poller** (ein Pod, `WAHLEN_ROLLE=poller`, `Recreate`) fragt die
   votemanager-Präsentationen der Wahlleitungen ab und ist der **einzige
   Schreiber** auf `/data/wahlen.db`.
2. Zwei **Web-Pods** (`WAHLEN_ROLLE=web`, `RollingUpdate`,
   `maxUnavailable: 0`) lesen dieselbe Datei `readOnly` und liefern Seiten und
   API aus (`docs/rollierendes-ausrollen.md`).
3. Die Seiten abonnieren **`/api/live?termin=…&topic=…`** (SSE) und bekommen
   dort nur *Kennungen*: `event: stand`, `event: puls`, `event: beitrag`.
4. Ein **Topic** ist die Kennung des Zuschnitts einer Seite –
   `<kreis>/<ags>/<ags>…`, eigene Wahlleitung zuerst, gebildet in
   `src/lib/stand.ts`. Der Server schreibt sie in die Seite; für den Browser
   ist sie undurchsichtig. **Es gibt kein `kreis=` und kein `behoerde=` mehr.**
5. Die **Ansage ist nicht mehr client-getrieben.** Der Poller baut
   **Moderationsbeiträge** (Einblendertext + MP3), legt sie ab und kündigt sie
   über `event: beitrag` an; der Browser holt sie über **`/api/beitraege`** und
   **`/api/beitrag/<id>.mp3`** (`src/lib/beitrag-abruf.ts`,
   `src/lib/beitragbau.ts`, `server/beitrag.ts`).
6. **`/api/ansage?text=`, `/api/ansage/stand` und `/api/ansage/moderation`
   gibt es nicht mehr.** Wer sie anfasst, arbeitet nach einer alten Notiz.

## Erster Durchgang des Abends: Bereitschaft

Einmal, bevor etwas hereinkommt. Es kostet zwei Minuten und erspart dir, um
18:10 festzustellen, dass ein Werkzeug gar nicht da ist:

```bash
git pull --ff-only
ls scripts/rundgang.mjs scripts/abdeckung-probe.ts src/lib/ebenen.ts
npm run abdeckung -- --termin 2026 --vergleich 2021 --api https://wahlergebnisse.levinkeller.de/api/v1 | head -3
gh run list --limit 3
```

Fehlt `npm run abdeckung` oder `scripts/abdeckung-probe.ts`, ist der Zweig
`wahlgliederung-verzeichnis` nie auf `main` gelandet. Dann **fehlt dir die
Abdeckungsprüfung** – merk es an und arbeite ohne sie weiter, statt sie in
jedem Durchgang neu zu suchen.

`ssh srv` ist nicht überall eingerichtet. Probier es **einmal**
(`ssh -o BatchMode=yes srv true`); geht es nicht, hast du keine Pods und keine
Container-Protokolle und musst alles von außen erkennen – das geht, siehe
unten. Sag dem Betreiber im ersten Bericht, dass dir der Zugang fehlt.

## Der Rundgang

Ein Durchgang ist ein Werkzeug, kein Handbuch:

```bash
node scripts/rundgang.mjs --kreise hildesheim --termin 2026        # Produktion
node scripts/rundgang.mjs --termin 2026                            # alle 45 Kreise
node scripts/rundgang.mjs --kreise hildesheim --behoerden nordstemmen,kreis,sarstedt
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

**Eine Falle, die du kennen musst.** Der Rundgang meldet „seit X Minuten kein
Lauf – fragt überhaupt noch jemand die Wahlleitungen?", sobald `geprueft` älter
als 10 Minuten ist. Der Poller taktet aber nach Stufe (`src/lib/takt.ts`):

| Stufe | wann | betrachteter Kreis | übrige Kreise |
|---|---|---|---|
| `ruhig` | vor dem Wahltag | 15 min | 6 h |
| `wahltag` | 13.09. bis 17 Uhr | 5 min | 30 min |
| `wahlabend` | 13.09. ab 17 Uhr | 60 s | 3 min |

Vor 17 Uhr ist diese Meldung also **kein Befund**, solange niemand hinsieht –
ein Kreis gilt 15 Minuten lang als „betrachtet", nachdem jemand eine seiner
Seiten geöffnet hat (`src/lib/betrachtet.ts`). Ab 17 Uhr ist sie einer: dann
muss `geprueft` im Minutentakt wandern.

## Die Kennzahlen

Das sind die Zahlen, an denen du erkennst, dass etwas klemmt. Alle kommen aus
der öffentlichen API, alle sind ohne Vorwissen abfragbar. Hol den Bestand
einmal und rechne dann darauf – sonst läufst du 45 Kreise mehrfach ab.

```bash
B=https://wahlergebnisse.levinkeller.de
T=$(mktemp -d)
curl -s "$B/api/v1/kreise" | jq -r '.kreise[].slug' > "$T/kreise"
while read -r k; do curl -s --max-time 60 "$B/api/v1/$k/2026";        done < "$T/kreise" > "$T/ueberblick.json"
while read -r k; do curl -s --max-time 90 "$B/api/v1/$k/2026/wahlen"; done < "$T/kreise" > "$T/wahlen.json"
```

### 1 · Puls des Pollers

```bash
curl -s "$B/api/version.json?termin=2026" | jq '{version,geprueft}'
```

`geprueft` ist der letzte **Lauf**, `version` die letzte **neue Zahl**.
Ab 17 Uhr darf `geprueft` nie älter als ~3 Minuten sein. Steht `version`
still, während `geprueft` wandert, fragt der Poller und bekommt nichts Neues –
das ist bis 18 Uhr normal und danach ein Befund.

### 2 · Auszählfortschritt

```bash
jq -s '{eingegangen:(map(.schnellmeldungen.eingegangen//0)|add),
        erwartet:(map(.schnellmeldungen.erwartet//0)|add),
        kreiseMitZahlen:(map(select((.schnellmeldungen.eingegangen//0)>0))|length)}' "$T/ueberblick.json"
```

**Stand 12.09. mittags: `0 / 0`, 0 Kreise mit Zahlen.** So gehört es sich am
Vorabend. **2021 am Ende: `8622 / 8622` über 34 Kreise.** Morgen ist das die
Zahl, die wachsen muss: bleibt sie ab 18:15 bei 0, kommt gar nichts herein;
wächst `erwartet`, aber nicht `eingegangen`, melden die Wahlleitungen ihre
Gliederung, aber keine Ergebnisse; steht `eingegangen > erwartet`, stimmt
unsere Zuordnung nicht (das meldet der Rundgang eigens).

### 3 · Wahlbezirke, zu denen überhaupt etwas veröffentlicht ist

```bash
jq -s '[.[]|(.wahlen//[])[]
        | {ags:.behoerde.ags, n:(([(.ebenen//[])[]|select(.ebene=="wahlbezirk")|.anzahl]|max)//0)}]
       | group_by(.ags) | map(max_by(.n).n) | add' "$T/wahlen.json"
```

**Stand 12.09. mittags: 232.** **2021 über dieselbe Abfrage: 9479** (in der
Datenbank gezählt: 9735). Zwischen diesen beiden Zahlen spielt sich der Abend
ab. Von 232 auf mehrere tausend springt es in dem Moment, in dem die
Wahlleitungen ihre Wahlbezirksgliederung freischalten – meist kurz vor oder mit
der ersten Meldung. Steht die Zahl um 19 Uhr noch bei 232, während
`eingegangen` wächst, zeigen wir Summen ohne Untergliederung: die Leinwand
zeigt dann Prozente, aber keine einzelnen Wahlbezirke.

Zur Einordnung, was überhaupt bekannt ist: **6959** Wahlbezirke führen die
Wahlräume über 413 Wahlleitungen
(`/api/v1/<kreis>/2026/<behoerde>/wahlraeume`, `wahlbezirk` entdoppelt), und
**2824** Wahlen sind für 2026 geführt (2021: 2861).

### 4 · Kreiswahlbereiche

```bash
jq -s '[.[]|(.wahlen//[])[]|select(.typ=="kreistag" and .behoerde.slug=="kreis")]
       | {kreistagswahlen: length,
          mitBereichsebene: ([.[]|select([(.ebenen//[])[]|select(.ebene=="gebiet" or .ebene=="wahlbereich")]|length>0)]|length),
          bereiche: ([.[]|(.ebenen//[])[]|select(.ebene=="gebiet" or .ebene=="wahlbereich")|.anzahl]|add//0)}' "$T/wahlen.json"
```

**Stand 12.09. mittags: 33 Kreistagswahlen, davon 1 mit Bereichsebene, 11
Bereiche** – das ist Hildesheim, sonst niemand. **2021: 34 Kreistagswahlen, 34
mit Bereichsebene, 199 Bereiche.**

Das ist erwartbar und **kein Befund am Vorabend**: Die 33 Kreise *kündigen* die
Ebene in `menu_links` ihrer `wahl.json` an, aber die Bereiche entstehen erst
mit der Auszählung. Morgen ist die Frage: **tauchen sie auf?** Wenn um 19 Uhr
in einem Kreis Ergebnisse laufen und `mitBereichsebene` ihn immer noch nicht
zählt, liegt es entweder daran, dass diese Wahlleitung keine Bereiche
veröffentlicht (ihr Recht), oder daran, dass wir ihre Ebenennummer nicht
erkennen – und Letzteres ist unser Fehler. Wer die Ebenen benennt, steht in
`src/lib/ebenen.ts` (`ebenennamen`, `leereEbenen`); die Nummer kommt aus
`ebeneVonGebietId` in `src/lib/votemanager.ts`. Ab `v26` vergibt die Quelle je
Präsentation eigene, **negative** Nummern – dann trägt allein die Bezeichnung
aus `menu_links`. Ein Kreis, dessen Bereiche als „Gebiet" statt als
„Wahlbereich" auf der Leinwand stehen, ist genau dieser Fall.

Fehlt `src/lib/ebenen.ts`, ist der Zweig `kreiswahlbereiche-2026` nicht
gelandet; dann heißen alle unbekannten Ebenen „Gebiet", und das ist zwar
hässlich, aber nicht falsch.

### 5 · Moderationsbeiträge

Erst die Kennung der Seite holen – **rate sie nicht**, sie steht in der Seite:

```bash
TOPIC=$(curl -s "$B/hildesheim/2026/nordstemmen/dashboard" \
  | grep -o 'topic=[^"&]*' | head -1 | sed 's/^topic=//' \
  | python3 -c 'import sys,urllib.parse;print(urllib.parse.unquote(sys.stdin.read().strip()))')
echo "$TOPIC"      # z. B. hildesheim/03254026/03254000

curl -s --get --data-urlencode termin=2026 --data-urlencode "topic=$TOPIC" \
     --data-urlencode seit=0 "$B/api/beitraege" \
  | jq '{topic, letzte, anzahl:(.beitraege|length),
         letzter:(.beitraege[-1].toasts[0].text), aufnahme:(.beitraege[-1].aufnahme)}'
```

`letzte` ist die höchste Kennung dieses Topics. **Stand 12.09. mittags in
Produktion: `letzte = 0`** – es ist noch nichts gezählt, also gibt es nichts zu
moderieren. Auf der Generalprobe lief sie zur selben Zeit bei 201.

Morgen: **Nach jeder Meldung, die auf der Leinwand steht, muss `letzte`
gewachsen sein.** Und:

- Jeder Beitrag hat `toasts[]` (Einblendertext) und **soll** `aufnahme` haben
  (`/api/beitrag/<id>.mp3`). Fehlt `aufnahme` durchgängig, klemmt der
  Sprachdienst – prüfe die Datei selbst:
  `curl -o /dev/null -w '%{http_code} %{size_download} %{content_type}\n' "$B/api/beitrag/<id>.mp3"`
  (erwartet: `200`, sechsstellige Bytezahl, `audio/mpeg`).
- **Kein `aufnahme` ist kein Grund, die Zahlen anzuhalten.** Die Beiträge
  laufen mit eigenem Auslöser neben den Zahlen her (`server/live.ts`,
  `pruefeBeitraege`); ein hängender Sprachdienst darf die Leinwand nie
  aufhalten. Wenn er das doch tut, ist das ein Befund erster Ordnung.
- Beiträge entstehen **nur für Topics, die jemand betrachtet** (`beiTopic` in
  `server/live.ts`) und nur für eine Kennung, die eine Wahlleitung enthält.
  `topic=hildesheim` allein bekommt nie einen. Wer also prüft, ohne dass die
  Leinwand offen ist, prüft ins Leere: **erst das Dashboard öffnen (oder eine
  SSE-Leitung offen halten), dann messen.**

### 6 · Die Leitung selbst

```bash
curl -sN --max-time 8 -H 'accept: text/event-stream' \
  "$B/api/live?termin=2026&topic=$(python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1]))' "$TOPIC")"
```

Erwartet: sofort `retry: 3000`, dann `event: stand`, dann `event: beitrag` mit
der Kennung, auf der der Kanal steht, alle 20 s ein `event: puls`, und bei
jeder neuen Zahl ein weiteres `event: stand`. Bleibt `event: beitrag` beim
Verbindungsaufbau aus, findet der Browser seinen Einstiegspunkt nicht und **der
erste Beitrag des Abends geht verloren**.

## Die Abdeckungsprüfung

Sie trennt die beiden Befunde, die am Abend ständig verwechselt werden:
**„unser Fehler"** und **„die Wahlleitung schweigt"**.

```bash
npm run abdeckung -- --termin 2026 --vergleich 2021 --api https://wahlergebnisse.levinkeller.de/api/v1
npm run abdeckung -- --termin 2026 --vergleich 2021 --api "$B/api/v1" --fall anwendung
```

Sie vergleicht das **Verzeichnis der Wahlgliederung**
(`src/data/wahlgliederung/2026.json`, aus den Bekanntmachungen erhoben und je
Eintrag mit Beleg) gegen das, was die Anwendung tatsächlich führt. Drei Fälle,
und nur einer gehört dir:

- **`anwendung`** – veröffentlicht, aber von uns nicht abgebildet. **Unser
  Fehler.** Der Rückgabewert ist `1`, solange hiervon etwas offen ist.
- **`wahlleitung`** – nicht veröffentlicht. Keine Lücke bei uns. Nicht fixen,
  sondern in den Bericht schreiben, damit sie nicht stillschweigend fehlt.
- **`verzeichnis`** – die Anwendung führt mehr, als das Verzeichnis kennt. Dann
  ist das **Verzeichnis** nachzuziehen, nicht die Anwendung.

Das ist die einzige Prüfung, die dir sagt, ob „Kreis X zeigt nichts" an uns
liegt. Lauf sie beim ersten Befund dieser Art, nicht in jedem Durchgang – über
`--api` geht sie 45 Kreise ab und dauert.

## Mit eigenen Augen

Was ein Werkzeug nicht sieht – jeder Durchgang:

- **Die Leinwand**: `…/hildesheim/2026/nordstemmen/dashboard` – stehen alle
  Folien, wandern die Zahlen, sagt die Standanzeige „Live"? Die vorgegebene
  Folienreihenfolge und der dunkle Hintergrund bleiben, wie sie sind.
- **Eine Wahlseite** mit Untergebieten und Kandidaten – stimmen Veränderung,
  Hochrechnung, Sitzverteilung?
- **Der Ticker**: `/api/v1/<kreis>/2026/ereignisse?limit=10` – wächst er, und
  lesen sich die Einträge wie echte Meldungen (`art`, `text`, `spitze`)?
- **Der Vergleich mit der Quelle**: Bei etwas Auffälligem die
  votemanager-Datei selbst ansehen (`quelle` in `/api/v1`), nicht raten.
- **Die Generalprobe** (`demo.wahlergebnisse.levinkeller.de`) ist dein
  Prüfstein, **solange sie läuft**: Was dort richtig aussieht und in Produktion
  falsch, liegt an den Daten, nicht am Code. Sie spielt einen früheren
  Wahlabend in einer Schleife (`WAHLEN_DEMO=1`, `src/lib/demo.ts`). Ist sie
  irgendwann weg oder zeigt sie andere Termine als die Produktion, ist das
  **kein Befund** – zieh daraus nur keine Schlüsse mehr.

## Protokolle lesen

Mit Cluster-Zugang:

```bash
ssh srv 'sudo kubectl -n wahlergebnisse get pods'
ssh srv 'sudo kubectl -n wahlergebnisse logs deploy/wahlergebnisse-poller --since=15m --tail=200'
ssh srv 'sudo kubectl -n wahlergebnisse logs deploy/wahlergebnisse --since=15m --tail=200'
```

Worauf du achtest:

- `2026/<ags>: N Wahlen, bisher M Anfragen, K Änderungen` – der normale
  Rundlauf des Pollers je Wahlleitung (`src/lib/poll.ts`).
- `2026/<ags>: kein termin.json (404)` – diese Wahlleitung hat für 2026 noch
  nichts stehen. Vor 18 Uhr normal, um 20 Uhr eine Frage an die Wahlleitung,
  kein Fix bei uns.
- `2026/<ags>/wahl_<id>: <Meldung>` – eine einzelne Wahl ist gescheitert. Das
  ist die Zeile, aus der Fixes entstehen. `DEBUG=1` hängt den Stacktrace an.
- `[<zeit>] ansage: …` – alles rund um Moderation und Aufnahme
  (`src/lib/ansage-datei.ts`). Ein Riegel wegen `401`/`403`/Guthaben ist
  endgültig und legt den Sprachdienst für den Abend still; die Zahlen laufen
  weiter.
- `2026: N Anfragen, M Änderungen, K Fehler in Xs` – die Bilanz eines Laufs.

Ohne Cluster-Zugang erkennst du dasselbe von außen: `geprueft` (Lauf),
`version` (neue Zahl), `/api/v1/<kreis>/2026/ereignisse` (was sich bewegt hat)
und die Kennzahlen oben. Das reicht für den Abend.

## Der Takt

Du bestimmst ihn selbst und passt ihn an, was tatsächlich passiert:

| Zeit | Abstand | Warum |
|---|---|---|
| bis 18:00 | 15–30 min | Es kommt nichts. Prüfe die Bereitschaft, nicht die Zahlen. |
| 18:00–18:30 | 3–5 min | Die ersten Meldungen – hier zeigt sich, ob die Felder liegen, wo wir denken, und ob die Wahlbezirke aus 232 herauswachsen. |
| 18:30–21:00 | 5 min | Der Schub. Jede Wahlleitung meldet anders schnell. |
| ab 21:00 | 10–20 min | Endergebnisse, Sitzverteilungen, Stichwahl-Fragen. |
| nach Mitternacht | 30–60 min | Nachzügler und Korrekturen. |

Wenn ein Durchgang unauffällig war und sich seit dem letzten nichts geändert
hat, warte länger. Wenn du einen Fehler behoben hast, geh **sofort** wieder
durch – ein Fix, der nicht nachgeprüft wurde, ist keiner.

## Wenn etwas kaputt ist

1. **Verstehen, bevor du tippst.** Zeigt die Seite es falsch an, oder liefert
   die Wahlleitung es anders? Beides kommt vor, und die Antworten sind
   entgegengesetzt. Die Abdeckungsprüfung beantwortet genau diese Frage.
2. **Den kleinsten Eingriff wählen.** Am Wahlabend wird eine Auswertung
   geradegebogen, nicht eine Struktur verbessert.
3. **Einen Test schreiben, der den Fehler zeigt** – mit den echten Zahlen, die
   ihn ausgelöst haben, als Fixture. Der Test prüft **Verhalten**, nicht dass
   eine Seite rendert. Danach den Fix. Ein Fehler, der einmal durchkam, kommt
   sonst um 21 Uhr wieder.
4. Grün müssen sein: `npm test`, `npm run ci`, `npm run check` – und die
   betroffenen E2E (`npm run e2e` baut vorher; `npm run e2e:ci`, wenn schon
   gebaut ist). Nichts geht ohne grüne Tests hinaus.
5. Zweig, Commit, PR, mergen (`gh pr merge --squash`). Die Begründung gehört in
   Commit und PR, nicht als Kommentar in den Code. Die CI baut, Argo CD rollt
   aus – rollend und ohne Unterbrechung (`docs/rollierendes-ausrollen.md`).
   **Es gibt keinen Deploy-Stopp: auch mitten im Abend darf ausgerollt werden.**
6. **Nach dem Ausrollen prüfen**: Läuft der neue Stand, sind die Zahlen
   weitergelaufen, ist der Befund weg? `gh run list --limit 3`, dann die
   Kennzahlen noch einmal. Erst dann ist es erledigt.

## Was du am Wahlabend nicht tust

- **Keine Schema-Migration, kein erhöhter `DATENSTAND`.** Das stößt ein
  vollständiges Neu-Einlesen des Archivs an – ausgerechnet an dem Abend, an
  dem der Poller mit den Live-Zahlen genug zu tun hat
  (`docs/rollierendes-ausrollen.md`, Regel 6).
- **Nichts an der Datenbank von Hand.** Der Poller ist der einzige Schreiber;
  die Web-Pods öffnen sie `readOnly` und bekommen eine Ausnahme, wenn doch
  jemand schreibt.
- **Keine Umbauten „bei der Gelegenheit".** Jede Änderung, die nicht einen
  Befund von heute Abend behebt, wartet bis morgen.
- **Den Poller nicht mitten im Schub neu starten**, wenn es sich vermeiden
  lässt: `Recreate` heißt ein paar Sekunden ohne neue Zahlen.
- **Nicht nach `/api/ansage…` greifen.** Die Wege sind gelöscht. Wenn du auf
  eine Anleitung stößt, die sie nennt, ist die Anleitung alt.
- **Nichts stillschweigend „reparieren", was du nicht verstanden hast.** Lieber
  ein Hinweis auf der Seite als eine erfundene Zahl.

## Wann du Levin holst

Schreib ihm (und mach weiter, was ohne Antwort geht), wenn:

- eine Wahlleitung ihre Daten grundlegend anders liefert als 2021 und der Fix
  eine Entscheidung verlangt (welche Auslegung ist die richtige?),
- Zahlen amtlich aussehen, aber unplausibel sind – dann entscheidet er, ob die
  Seite sie zeigt oder verschweigt,
- die Abdeckungsprüfung einen `wahlleitung`-Befund in einem Kreis meldet, der
  im Saal vorkommt (er kann dort anrufen, du nicht),
- ein Eingriff die Seite länger als ein paar Sekunden stören würde,
- du dreimal am selben Befund gescheitert bist.

## Der Bericht je Durchgang

Kurz und immer gleich, damit man ihn im Vorbeigehen liest. Die erste Zeile
trägt immer dieselben vier Zahlen: Auszählstand, Kreise mit Zahlen, Wahlbezirke
mit Gliederung, letzte Beitragskennung.

```
19:07 · Rundgang 12 · 3184/8500 Schnellmeldungen · 31 Kreise · 8912 Wahlbezirke · Beitrag 64
       unauffällig, Ticker wächst, Leinwand live, Aufnahmen kommen
19:12 · Rundgang 13 · BEFUND Alfeld/rat: Prozente summieren sich auf 91,4
       → Ursache: Wahlleitung liefert Briefwahlbezirke doppelt
       → Fix #47 gemerged, ausgerollt 19:21, Befund weg
19:40 · Rundgang 16 · Peine zeigt Kreiswahlbereiche als „Gebiet"
       → Abdeckung: fall=anwendung, Ebenennummer negativ (v26), menu_links trägt
       → Fix #48 gemerged, ausgerollt 19:52, Bereiche stehen benannt
```

Bei `noop` (nichts passiert, nichts geändert) reicht die erste Zeile.

## Werkzeuge, die du hast

- `node scripts/rundgang.mjs …` – der Durchgang gegen sich selbst
- `npm run abdeckung -- --termin 2026 --vergleich 2021 --api <basis>/api/v1` –
  unser Fehler oder Schweigen der Wahlleitung
- `curl` + `jq` auf `/api/v1`, `/api/version.json`, `/api/beitraege`,
  `/api/live` – die Kennzahlen oben
- `gh` – PRs, Merges, CI-Läufe (`gh run list`, `gh run view --log-failed`)
- `ssh srv 'sudo kubectl -n wahlergebnisse …'` – Pods, Protokolle,
  Rollout-Stand, **falls der Zugang steht**
- Die Wahlpräsentationen selbst (`quelle` in `/api/v1`) – die Wahrheit, gegen
  die alles andere geprüft wird
