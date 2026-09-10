# Ausgangsbestand und Einfrieren

Zwei Dinge, die zusammengehören: woher eine frische Instanz ihre Daten
bekommt, und wann sie aufhört, fremde Server danach zu fragen.

## Warum überhaupt

Ein Kaltstart mit leerem Volume kostet **rund 63 000 Anfragen an fremde Server
und etwa vier Stunden**, bis die Archive 2021 vollständig sind. Solange zeigt
die Seite nichts.

Schlimmer als die Wartezeit ist die Vergänglichkeit: **Die Quellen
verschwinden.** Der Heidekreis hat seine 2021er Dateien bereits entfernt. Was
einmal geladen war, ist nirgends sonst gesichert – ein zweiter Kaltstart bekäme
diese Zahlen nie wieder. Und nach dem 13.09.2026 soll die Seite als Archiv
laufen, ohne dass irgendjemand noch 400 Behörden abfragt.

Gemessen: 141 von 398 Behörden für 2021 sind rund 195 MB und komprimieren mit
`zstd -19` auf 17 MB (11:1). Der volle Bestand wird auf ~750 MB roh geschätzt,
also ~70 MB gepackt.

## Der Weg: Release-Anhang, ins Image gebacken

```
  Poller-Pod                GitHub-Release              Docker-Image
  /data/wahlen.db  ──┐      daten-2026-09-14      ┌──► /app/schnappschuss/
                     │      └ wahlen.db.zst       │       wahlen.db.zst
        VACUUM INTO  │              ▲             │            │
        (nur lesend) │              │ gh release  │ ARG        │ beim Start,
                     └──► packen ───┘   create    │ SCHNAPP-   │ nur im Poller
                          zstd -19                │ SCHUSS     ▼
                                                  └──► /data/wahlen.db
```

**Nicht ins Git-Repo.** 70 MB je Fassung blieben für immer in der Historie, und
der Ausgangsbestand wird oft aufgefrischt – jedes Mal DATENSTAND, jedes Mal ein
neuer Wahltermin. Ein Release-Anhang kostet nichts davon, ist versioniert und
lässt sich löschen. Für den viel kleineren **Demo-Bestand** ist die Rechnung
umgekehrt ausgefallen: Er liegt eingecheckt im Repo (`docs/demo.md`, und die
Begründung mitsamt LFS-Rechnung gleich unten).

### Und warum der Demo-Bestand trotzdem ins Repo darf – ohne LFS

Der Demo-Bestand (`daten/demo-bestand.db.zst`, 15,6 MB) ist die gefilterte
kleine Schwester: nur, was die Generalprobe liest. Er gehört ins Repo, weil die
Probe sonst an einem Release-Anhang hinge, den niemand vermisst, bis sie leer
bleibt. Die Frage war nur, **wie** – als gewöhnlicher Git-Blob oder über Git
LFS. Gerechnet mit den tatsächlichen Zahlen dieses Repos:

- **CI-Läufe:** 137 in 3,54 Tagen (`gh run list`, 07.09.–10.09.2026) – 71 CI
  und 66 Deploy, also rund 39 Läufe am Tag oder **1160 im Monat**.
- **Auschecken je Lauf:** Die CI hat zwei Jobs mit je einem `actions/checkout`,
  der Deploy einen. Macht **1764 Checkouts im Monat**.
- **LFS-Bandbreite:** 1764 × 15,6 MB = **27,5 GB im Monat**. Selbst wenn nur
  der Deploy die Datei zieht (er muss – ohne sie backt der Docker-Build eine
  130-Byte-Zeigerdatei ins Image), sind es 560 × 15,6 MB = **8,7 GB**.
- **Kostenlos sind 1 GB Speicher und 1 GB Bandbreite im Monat.** Die sparsame
  Variante überschreitet das um das Neunfache, die vollständige um das
  27-Fache. Ein Datenpaket (50 GB/50 GB) kostet 5 $ im Monat – **60 $ im Jahr
  für eine Datei, die zweimal im Jahr neu erzeugt wird.**

Ein gewöhnlicher Git-Blob zählt gegen **keine** dieser Quoten. Und er spart
nichts ein, was LFS spart: `actions/checkout` holt ohnehin flach
(`--depth=1`), es geht also so oder so genau eine Fassung über die Leitung –
LFS macht sie nur kostenpflichtig. Dazu die Falle, die es geschenkt dazugibt:
Ohne `lfs: true` checkt die CI eine Zeigerdatei aus, der Docker-Build backt sie
ins Image, und die Generalprobe scheitert beim Entpacken – an einer Stelle, an
der niemand sucht.

**Entschieden: gewöhnlicher Git-Blob, kein LFS.** Der Preis dafür ist ehrlich
zu nennen: Jede Auffrischung legt 15,6 MB dauerhaft in die Historie. Deshalb
wird der Demo-Bestand selten erneuert – er muss es auch nur, wenn ein
Vorwert-Termin dazukommt oder der `DATENSTAND` steigt. (Bei LFS wären es
dieselben 15,6 MB je Fassung, nur zusätzlich gegen die 1-GB-Speicherquote.)

**Kein Download zur Laufzeit.** Der Build lädt den Anhang, die Anwendung nicht.
Ein Pod, der beim Start ins Netz greifen muss, ist ein Pod, der beim Start
scheitern kann – und das Release ist öffentlich, also braucht auch der Build
kein Token.

**Der Layer hängt an der Fassung, nicht am Commit.** Der Download steht in
einer eigenen Docker-Stufe **vor** jedem `COPY` des Quellcodes. Ein
gewöhnlicher Push zieht die 70 MB deshalb nicht neu; nur eine geänderte
`ARG SCHNAPPSCHUSS`-Zeile tut das.

## Einen Schnappschuss ziehen und veröffentlichen

### Der einfache Weg: der Workflow

`.github/workflows/schnappschuss.yml`, von Hand angestoßen
(*Actions → Ausgangsbestand veröffentlichen → Run workflow*). Er holt den
Bestand über den Export-Endpunkt (`EXPORT_TOKEN` als Secret), packt ihn, macht
eine Gegenprobe und legt das Release `daten-JJJJ-MM-TT` an. `contents: write`
genügt dafür – `GITHUB_TOKEN` darf damit Releases anlegen und Anhänge
hochladen, ein PAT ist nicht nötig.

### Der Weg für den großen Bestand: von Hand

Der Export-Endpunkt wird von einem **Web-Pod** beantwortet (384 MiB), und die
Kopie landet neben der Datenbank auf demselben 2-GiB-Volume. Für den
vollständigen Bestand ist der Weg über den Poller-Pod der ruhigere:

```sh
# 1. Kopie im Pod ziehen – nur lesend, der Poller läuft weiter
kubectl -n wahlergebnisse exec deploy/wahlergebnisse-poller -- \
  node --no-warnings --experimental-strip-types scripts/schnappschuss.ts \
  --roh --db /data/wahlen.db --ziel /data/schnappschuss.db

# 2. Herausstreamen und im Pod wieder aufräumen
kubectl -n wahlergebnisse exec deploy/wahlergebnisse-poller -- \
  cat /data/schnappschuss.db > wahlen.db
kubectl -n wahlergebnisse exec deploy/wahlergebnisse-poller -- \
  rm -f /data/schnappschuss.db

# 3. Außerhalb packen und prüfen
npm run schnappschuss -- --packen wahlen.db --ziel wahlen.db.zst
npm run schnappschuss -- --pruefen wahlen.db.zst

# 4. Veröffentlichen. Der Dateiname wahlen.db.zst ist Teil der Adresse,
#    unter der das Dockerfile ihn sucht – er darf sich nicht ändern.
gh release create daten-$(date -u +%Y-%m-%d) wahlen.db.zst \
  --title "Ausgangsbestand daten-$(date -u +%Y-%m-%d)"
```

**Warum gepackt wird, wo gepackt wird.** `zstd -19` braucht gut 100 MB
Arbeitsspeicher für sein Fenster. Der Poller-Pod hat 512 MiB im Ganzen, und
dort ist bereits ein `gzip -9` mit OOM gestorben. Im Pod passiert deshalb nur
das `VACUUM INTO` (SQLite schreibt sequenziell und hält nichts im Speicher),
gepackt wird außerhalb – und zwar streamend, mit dem zstd aus `node:zlib`:
Es liegt nie mehr als ein Puffer im Speicher, egal wie groß die Datei ist.

**Warum nur lesend.** Auf dem Volume schreibt der Poller, und ein zweiter
Schreiber ist dort das Einzige, was nicht sein darf
(`docs/rollierendes-ausrollen.md`). `VACUUM INTO` geht von einer nur lesenden
Verbindung aus; `test/schnappschuss.test.ts` hält das fest, damit die Annahme
nicht stillschweigend zerbricht.

### Einbacken

Im `Dockerfile` die eine Zeile ändern und committen:

```dockerfile
ARG SCHNAPPSCHUSS=daten-2026-09-14
```

`keiner` (die Voreinstellung) baut ohne Ausgangsbestand.

## Was beim Start passiert

`server/main.ts` ruft `uebernimmSchnappschuss` **vor** `oeffneDb`, und zwar nur
in der Rolle `poller`: Die Web-Pods öffnen die Datei nur lesend und dürfen hier
nichts tun. Entpackt wird nach `<ziel>.neu` und erst dann umbenannt – ein
Abbruch mittendrin hinterlässt keine halbe Datenbank.

Gleich dahinter steht `uebernimmDemoBestand` – der Boden unter dem
Ausgangsbestand, und nur für die Generalprobe (`docs/demo.md`). Er greift erst,
wenn danach immer noch keine Vorwerte dastehen, und außerhalb von
`WAHLEN_DEMO=1` überhaupt nicht.

Danach läuft alles wie immer: Schema anlegen, Spalten ergänzen,
`migriereDatenstand`. Der Schnappschuss umgeht nichts davon, er tritt nur an
die Stelle eines leeren Volumes.

### Wann er übernommen wird – und wann nicht

Die Grundregel ist absolut: **Es wird nie etwas überschrieben, das nur dort
steht.** Der Ausgangsbestand ist ein Startkapital, kein Wiederherstellen aus
einer Sicherung. Am Wahlabend eine Datenbank mit Live-Zahlen gegen einen
Schnappschuss von letzter Woche zu tauschen, wäre der teuerste denkbare Fehler
– und er passierte lautlos.

Übernommen wird deshalb in genau zwei Fällen:

1. **Es ist nichts da.** Keine Ergebniszeile – frisches Volume, abgebrochener
   erster Lauf, angelegte aber leere Datei.
2. **Die vorhandene Datei stammt selbst aus einem Schnappschuss und hat
   seitdem nichts Eigenes gesammelt** (Marke `schnappschuss:erzeugt` vorhanden,
   keine Zeile zu einem laufenden Termin). Dann steht in ihr nichts, was im
   neueren Schnappschuss nicht auch stünde.

Beim Ersetzen liegen kurz beide Dateien nebeneinander (entpacken nach
`<ziel>.neu`, dann umbenennen) – bei den erwarteten 750 MB also rund 1,5 GB auf
einem 2-GiB-Volume. Wer den Bestand deutlich wachsen lässt, vergrößert vorher
den PVC.

Ein Bestand, den der Poller selbst zusammengetragen hat, bleibt stehen. Was
ihm zum Archiv fehlt, holt er nach; das dauert, kostet aber nichts
Unwiederbringliches. Es wird auch **nicht zusammengeführt** – ein Mischen von
Zeilen zweier Generationen wäre schwerer zu durchschauen als der eine Lauf, den
es ersetzt.

### Der Datenstand darf nicht rückwärts

Im Schnappschuss reist der `DATENSTAND` mit, auf dem seine Ableitungen beruhen.
Zwei Regeln folgen daraus:

- **Ein älterer Schnappschuss gewinnt nicht.** Ist die vorhandene Datei bereits
  auf einem höheren Datenstand, bleibt sie – `migriereDatenstand` setzt den
  Stand nie herab, die alten Zeilen liefen also unter neuer Nummer mit.
- **Auf ein leeres Volume darf er trotzdem**, denn dort ist er die
  Verbesserung. `migriereDatenstand` sieht dann den niedrigeren Stand, löscht
  die `vollstaendig`-Marken und liest die Archive einmal neu ein. Das
  funktioniert, kostet aber genau die vier Stunden, die der Schnappschuss
  sparen sollte – der Start protokolliert es deshalb ausdrücklich.

**Praktisch heißt das: Wer `DATENSTAND` erhöht, veröffentlicht danach einen
neuen Schnappschuss und trägt ihn ins Dockerfile ein.** Für eingefrorene
Termine entfällt das (siehe unten) – die werden ohnehin nicht mehr geladen.

## Einfrieren

Ein Termin, dessen Ergebnis amtlich und endgültig ist, wird **nicht mehr
abgefragt**. Zwei Wege, beide ohne Handarbeit an der Datenbank:

```ts
// src/data/termine.ts – der Katalog ist die Wahrheit
{ id: "2021", …, abgeschlossen: "2021-09-30T12:00:00.000Z" }
```

```sh
# WAHLEN_ABGESCHLOSSEN – der Hebel für den Abend, an dem es feststeht
WAHLEN_ABGESCHLOSSEN=2026,2021
```

Die Variable kann nur einfrieren, nie auftauen: Was im Katalog abgeschlossen
ist, bleibt es.

Was sich dadurch ändert (`istAbgeschlossen`/`istLive` in `src/data/termine.ts`):

- **Der Poller fasst ihn nicht mehr an** – weder im Live-Takt noch im
  Archivlauf. `server/poll.ts` sagt das ausdrücklich und lädt ihn nur noch mit
  `--force` nach.
- **Die Seite führt ihn als Archiv**: kein Ticker, keine SSE-Leitung, langer
  Zwischenspeicher. Die Schnittstelle nennt `live: false` und
  `abgeschlossen: <Zeitpunkt>`.
- Sind alle Termine eingefroren, tut der Poller nichts mehr. Die Seite läuft
  als Archiv ohne Laufzeitlast.

### Einfrieren und Datenstand

Das ist der Punkt, an dem beide Mechanismen sich berühren. `migriereDatenstand`
löscht bei einer Erhöhung die `termin:*:vollstaendig`-Marken, damit der Poller
neue Ableitungen nachträgt. Bei einem eingefrorenen Termin passiert das
**nicht**: Die Prüfung auf „abgeschlossen“ steht vor der auf „vollständig“, der
Termin wird also gar nicht erst angesehen. Die gelöschte Marke bleibt folgenlos.

Braucht ein eingefrorener Termin wirklich einmal eine neue Ableitung, weil sich
der Code geändert hat, dann kommt sie **aus einem neuen Schnappschuss** – auf
einer Maschine erzeugt, auf der der Termin nicht eingefroren ist, oder mit
`server/poll.ts <id> --force` gegen eine Quelle, die es noch gibt. Aus der
laufenden Anwendung heraus wird eine verschwundene Wahlpräsentation nicht
wieder herbeigeholt.

## Was geprüft ist

`test/schnappschuss.test.ts` baut den Schnappschuss so, wie er in Wirklichkeit
entsteht – Poller gegen die Fixtures, `VACUUM INTO`, packen – und lässt eine
„frische Instanz“ damit starten: Die Zahlen stehen da, ohne dass eine einzige
Anfrage gestellt wurde. Dazu die Sicherungen: eigene Daten bleiben, Live-Zahlen
bleiben, ein alter Datenstand gewinnt nicht, ein älterer Schnappschuss ohne
eigene Daten wird ersetzt.

`test/demo-bestand.test.ts` tut dasselbe für den Demo-Bestand und misst ihn an
der einzigen Frage, die zählt: Baut `baueVorlage` daraus noch Ämter mit
Bausteinen? Dazu die Sicherungen – außerhalb der Generalprobe passiert nichts,
eine Datenbank mit Vorwerten bleibt stehen, und der Zieltermin trägt hinterher
keine echte Zahl mehr.

`test/einfrieren.test.ts` misst das Einfrieren an der einzigen Zahl, die zählt:
**null Anfragen**. Der echte Abgleich läuft dafür als eigener Prozess gegen den
Mock, der mitzählt – und die Gegenprobe mit `--force` zeigt, dass die Null
nicht daher kommt, dass gar nichts mehr läuft.

**Nicht geprüft:** der Download aus dem Release im Docker-Build (er braucht ein
veröffentlichtes Release) und das Verhalten bei wirklich 750 MB. Beides zeigt
sich beim ersten echten Schnappschuss.
