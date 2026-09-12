---
name: schlange
description: Merge-Warteschlange für offene PRs. Ordnet sie nach Dringlichkeit und bringt genau einen nach dem anderen durch – aufsetzen, grün machen, schieben, warten bis gemergt. Aufrufen mit /schlange, gedacht für /loop oder eine Cloud-Sitzung.
user-invocable: true
---

# Schlange

Acht offene PRs mit Auto-Merge kommen nicht schneller durch als einer. Sie
kommen gar nicht durch: Sobald einer merget, sind die anderen konfliktbehaftet,
und wer sie parallel aufsetzt, erzeugt beim Aufsetzen die nächsten Konflikte.

**Die eine Regel: Ein PR zur Zeit.** Du fasst den vordersten an und lässt die
übrigen unberührt liegen, bis er gemergt ist. Kein Rebase „schon mal auf
Vorrat", kein zweiter Zweig nebenher. Erst wenn `main` einen Schritt weiter
ist, weißt du überhaupt, wogegen der nächste aufzusetzen wäre.

## Die Reihenfolge

**Beim Aufruf mitgegebene Nummern gewinnen.** `/schlange 17 16 18` heißt: genau
diese, genau so. Der Mensch weiß, was heute eilt; er soll es sagen können, ohne
vorher Beschriftungen zu pflegen.

Ohne Angabe sortierst du selbst, in dieser Rangfolge:

1. **Beschriftung `dringend`** am PR.
2. **Schon `MERGEABLE` und grün** – am nächsten am Ziel, kostet die wenigste
   Arbeit und macht die wenigsten anderen schmutzig.
3. **Kleinster Eingriff zuerst**: wenige berührte Dateien vor vielen. Was wenig
   anfasst, kollidiert wenig; was viel anfasst, soll auf möglichst fertigem
   `main` aufsetzen.
4. Bei Gleichstand die **kleinere PR-Nummer**.

Beschriftung am PR, nicht Datei im Repo: Eine Prioritätsdatei läge auf `main`
und würde von jedem Zweig angefasst – sie wäre die erste Datei, die bei jedem
Rebase kollidiert. Die Warteschlange darf nicht selbst Konflikte erzeugen.

Die Beschriftungen legst du einmalig an, wenn es sie nicht gibt:

```bash
gh label create dringend --color d93f0b --description "Zuerst durch die Schlange" --repo levino/wahlergebnisse
gh label create wartet --color fbca04 --description "Von der Schlange zurückgestellt" --repo levino/wahlergebnisse
gh label create nicht-mergen --color ffffff --description "Gegenprobe, gehört nicht nach main" --repo levino/wahlergebnisse
```

**Nicht angefasst werden** – überspringen, nicht melden:

- Entwürfe (`isDraft`),
- alles mit `nicht-mergen` oder `wartet`,
- Titel, die „nicht mergen" enthalten (Gegenproben, die absichtlich rot sind),
- PRs, die nicht von uns stammen und ungeprüft sind.

Der Stand zum Sortieren:

```bash
gh pr list --repo levino/wahlergebnisse --state open --limit 50 \
  --json number,title,labels,isDraft,mergeable,mergeStateStatus,headRefName,files,statusCheckRollup
```

## Was dieses Repo verlangt

- `main` ist geschützt (Regelwerk `default`), **direkter Push geht nicht**.
  Alles über PR mit `gh pr merge <nr> --squash --auto`.
- **Erforderlich sind genau zwei Prüfungen**, seit dem Umbau in #19:
  `Typen, Lint, Tests` und `Browser-Tests`. Die vier Jobs
  `Browser-Teil neustart|1/3|2/3|3/3` laufen parallel; `Browser-Tests` ist das
  Tor dahinter, das mit `always()` läuft und rot wird, sobald ein Teil nicht
  erfolgreich war. Das Tor ist die Pflichtprüfung, nicht die Teile.
- Den Stand der Pflichtprüfungen nachschlagen, statt ihn zu glauben:

  ```bash
  regel=$(gh api repos/levino/wahlergebnisse/rulesets --jq '.[] | select(.name=="default") | .id')
  gh api "repos/levino/wahlergebnisse/rulesets/$regel" \
    --jq '.rules[] | select(.type=="required_status_checks") | .parameters.required_status_checks[].context'
  ```

- **Grün heißt lokal**: `npm run ci`, `npm run check`, `npm test`,
  `npm run e2e` – vollständig, nicht ausgewählt. `npm run e2e` baut selbst
  vorher; ein zusätzliches `npm run build` brauchst du nur, wenn du den Bau
  ohne E2E prüfen willst.
- **Eigener Worktree, immer.** Nie im geteilten Baum arbeiten – dort haben sich
  Agenten schon zweimal gegenseitig die Arbeit weggeräumt.
- Keine Kommentare im Code, auch nicht in YAML. Begründungen in Commit und PR.

## Ein Durchgang

### 1. Aufsetzen

```bash
git -C /workspaces/worktrees/main fetch origin
git -C /workspaces/worktrees/main worktree list
git -C /workspaces/worktrees/main worktree add -B schlange-<nr> /workspaces/worktrees/schlange-<nr> origin/<zweig>
cd /workspaces/worktrees/schlange-<nr>
```

Der eigene Zweigname `schlange-<nr>` ist Absicht: Zu vielen Zweigen gibt es
schon einen fremden Worktree, und `worktree add` auf einen bereits
ausgecheckten Zweig schlägt fehl. Du arbeitest auf einer eigenen Spur und
schiebst am Ende gezielt auf den PR-Zweig. In einen fremden Worktree steigst du
nicht ein, auch wenn er verwaist aussieht.

**Vor dem Rebase den Abzweigpunkt festhalten** – danach ist er nicht mehr zu
bekommen, und ohne ihn kannst du Schritt 2 nicht prüfen:

```bash
basis=$(git merge-base origin/main HEAD)
echo "$basis"
```

Dann aufsetzen: `git rebase origin/main`. Konflikte richtest du hier, nicht
später. **Noch nicht schieben** – erst Schritt 2 und 3.

### 2. Die Falle des alten Zweigs

Ein Zweig, der auf altem Stand gebaut wurde, **bringt beim Rebase Dateien
zurück, die `main` bewusst gelöscht hat**, oder löscht welche, die `main`
inzwischen angelegt hat. Git meldet das nicht als Konflikt – es sieht aus wie
eine gewollte Änderung des Zweigs. **Nach jedem Rebase**, bevor du irgendetwas
anderes tust:

```bash
while read -r p; do
  git log --diff-filter=D --oneline "$basis"..origin/main -- "$p" | sed "s|^|WIEDERAUFERSTANDEN $p <- |"
done < <(git diff --diff-filter=A --name-only origin/main..HEAD)

while read -r p; do
  git log --diff-filter=A --oneline "$basis"..origin/main -- "$p" | sed "s|^|VERSCHWUNDEN $p <- |"
done < <(git diff --diff-filter=D --name-only origin/main..HEAD)
```

Jede Zeile Ausgabe ist ein Befund: `main` hat diese Datei nach dem Abzweig
absichtlich gelöscht bzw. angelegt, und dein Zweig macht es rückgängig. Lies
die genannte Begründung (`git show <sha>`) und **folge `main`** – die Datei
gehört gelöscht bzw. übernommen. Trage die Entscheidung in die
PR-Beschreibung ein.

Den **ersten** Block kannst du schon vor dem Rebase laufen lassen – gegen
`origin/main..origin/<zweig>` statt `origin/main..HEAD`. Dann weißt du vorher,
worauf du dich einlässt. Der zweite Block ist vor dem Rebase wertlos: Er würde
jede Datei melden, die `main` seit dem Abzweig neu hat, und die bringt der
Rebase ohnehin mit.

Hast du den Rebase schon gemacht und `basis` vergessen: Solange du nicht
force-geschoben hast, steht der alte Stand noch unter `origin/<zweig>`, also
`basis=$(git merge-base origin/main origin/<zweig>)`.

Heute konkret: `naehte-absichern` (#20) bringt `src/pages/api/ansage/moderation.ts`,
`server/ansage.ts` und `test/ansage-endpunkt.test.ts` wieder mit. Commit
`3c56e34` hat diese Endpunkte zugemauert, weil sie ohne Anmeldung bezahlte
Sprachaufnahmen erzeugten. Wer sie durch einen Rebase zurückholt, reißt das
Loch wieder auf.

Prüf zusätzlich das Gegenstück in der Anwendung: Wenn `main` ein Modul entfernt
hat, bringt ein alter Zweig oft noch dessen Importe mit. `npm run check` findet
das; `npm run ci` findet ungenutzte Reste.

### 3. Lokal grün machen

```bash
npm ci --prefer-offline --no-audit --fund=false
npm run ci && npm run check && npm test && npm run e2e
```

Erst wenn das durch ist, wird geschoben. Die CI ist keine Suchmaschine für
Fehler, die dein Rechner schon kennt.

### 4. Schieben und Auto-Merge setzen

```bash
git push --force-with-lease=<zweig> origin HEAD:<zweig>
gh pr merge <nr> --squash --auto --repo levino/wahlergebnisse
```

`--force-with-lease=<zweig>` erwartet `origin/<zweig>` so, wie du ihn geholt
hast. Hat inzwischen jemand anders daran gearbeitet, bricht der Push ab, statt
dessen Arbeit zu überschreiben. Dann neu holen und Schritt 1 von vorn.

### 5. Warten

Prüfungen brauchen hier 6–12 Minuten. Nicht in einer Schleife im Vordergrund
nachsehen – ein Aufruf, der von selbst endet, und du bekommst die Nachricht:

```bash
gh pr checks <nr> --repo levino/wahlergebnisse --watch --fail-fast
```

Das startest du mit **Bash `run_in_background`**; es endet, sobald alle
Prüfungen entschieden sind, und meldet sich von allein. Willst du jeden
einzelnen Teil einzeln gemeldet bekommen, statt nur das Ende, nimm **Monitor**
mit einer Schleife, die neue Ergebnisse ausgibt und beim letzten abbricht.

Danach wartest du auf den Merge selbst – Auto-Merge braucht nach dem letzten
grünen Haken meist unter einer Minute. Auch das im Hintergrund, mit einer
Schleife, die von selbst endet:

```bash
until [ "$(gh pr view <nr> --repo levino/wahlergebnisse --json state --jq .state)" != OPEN ]; do sleep 30; done
gh pr view <nr> --repo levino/wahlergebnisse --json state,mergeStateStatus --jq '.state, .mergeStateStatus'
```

Ein `sleep` im Vordergrund läuft hier nicht; jedes Warten gehört in
`run_in_background` oder in einen Monitor.

**Durch ist er**, wenn `state` `MERGED` sagt – nicht, wenn die Haken grün sind.

**Er hängt**, wenn eins davon zutrifft:

| Beobachtung | Bedeutung | Antwort |
|---|---|---|
| Alle Prüfungen grün, `mergeStateStatus` bleibt `BLOCKED` | Eine **erforderliche** Prüfung fehlt ganz – der Zweig fährt noch die alte Workflow-Fassung und liefert z. B. `Browser-Tests (Playwright)` statt `Browser-Tests` | Auf `main` aufsetzen (Schritt 1), neu schieben |
| `mergeStateStatus` `DIRTY` / `mergeable` `CONFLICTING` | Konflikt mit `main` | Schritt 1 von vorn |
| `mergeStateStatus` `BEHIND` | Zweig hinter `main` | aufsetzen |
| Keine Prüfung hat 25 Minuten lang ihren Zustand geändert | Lauf steckt oder wurde nie ausgelöst | `gh run list --branch <zweig>`; nichts da → leerer Commit und Push, sonst `gh run rerun` |
| Alles grün, `MERGEABLE`, aber nach 5 Minuten nicht gemergt | Auto-Merge ist nicht gesetzt oder wurde abgeräumt | `gh pr merge <nr> --squash --auto` erneut |

Vergleich der Pflichtprüfungen mit dem, was wirklich läuft:

```bash
gh pr view <nr> --repo levino/wahlergebnisse --json statusCheckRollup \
  --jq '.statusCheckRollup[] | "\(.name // .context) \(.status) \(.conclusion)"'
```

### 6. Wenn es rot wird

1. **Ansehen, nicht raten.**

   ```bash
   gh run list --repo levino/wahlergebnisse --branch <zweig> --limit 3 \
     --json databaseId,status,conclusion
   gh run view <id> --repo levino/wahlergebnisse --log-failed
   ```

2. **Unter Last rot ist noch kein Befund.** Die Browser-Teile laufen zu viert
   gleichzeitig; ein E2E, der dort fällt und allein durchläuft, ist wackelig,
   nicht kaputt. **Immer erst einzeln gegenprüfen**, bevor du am Code etwas
   änderst:

   ```bash
   npx playwright test e2e/<datei>.e2e.ts --project=chromium --workers=1
   ```

   Läuft er allein durch, schieb keinen Fix – lass **einmal** den roten Job neu
   laufen (`gh run rerun <id> --failed`). Fällt er auch allein, ist es ein
   echter Fehler: Test schreiben, der ihn zeigt, dann beheben.

3. **Reparieren im selben Worktree**, lokal komplett grün machen (Schritt 3),
   mit demselben Push aus Schritt 4 nachschieben. Ein Fix ohne lokalen
   Durchlauf kostet zehn Minuten CI für nichts.

### 7. Aufgeben

Zähl pro PR mit:

- **Höchstens 3 Schiebevorgänge** (der erste plus zwei Reparaturen).
- **Höchstens 1 Wiederholung je wackeligem Job**, und nur für den ersten
  Verdacht; beim zweiten Mal derselbe Job rot heißt: echter Fehler.
- **Zweimal dieselbe Ursache rot → Schluss.** Kein dritter Versuch.

Dann: `gh pr edit <nr> --add-label wartet`, einen Kommentar an den PR mit
Befund und dem, was du versucht hast, eine Zeile im Bericht – und **weiter mit
dem nächsten**. Die Schlange steht nicht still, weil einer klemmt.

Levin holst du sofort, ohne die drei Versuche auszureizen, wenn:

- der Rebase eine **inhaltliche Entscheidung** verlangt (zwei Fassungen
  derselben Auswertung, und es ist nicht klar, welche gilt),
- ein PR eine bewusste Entfernung von `main` rückgängig machen würde und die
  Absicht des PR das offenbar so will,
- eine Pflichtprüfung fehlt, weil das Regelwerk geändert wurde.

### 8. Aufräumen und weitermachen

```bash
git -C /workspaces/worktrees/main worktree remove /workspaces/worktrees/schlange-<nr>
git -C /workspaces/worktrees/main branch -D schlange-<nr>
git -C /workspaces/worktrees/main fetch origin --prune
```

Dann die Liste **neu holen und neu sortieren** – nicht die alte weiterarbeiten.
Nach einem Merge kann ein anderer PR schmutzig geworden oder ein neuer
dazugekommen sein.

## Der Bericht

Eine Zeile **nach jedem gemergten PR**, nicht gesammelt am Ende. Wer nach zwei
Stunden fragt, soll den Stand sehen, ohne zu warten.

```
12:04 · #17 gemergt · aufgesetzt (Workflow-Fassung), 1× CI, 11 min
12:31 · #16 gemergt · Konflikt in src/lib/demo.ts gerichtet, zustellung.e2e.ts
        unter Last rot → allein grün → Wiederholung, 2 Läufe, 24 min
12:48 · #20 ZURÜCKGESTELLT · Rebase holt src/pages/api/ansage/moderation.ts
        zurück (von 3c56e34 bewusst entfernt) → Beschriftung wartet, Kommentar am PR
```

Zum Schluss eine Zeile mit dem Stand der Schlange: was durch ist, was
zurückgestellt liegt, was unberührt wartet.
