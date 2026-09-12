# Die Generalprobe

`demo.wahlergebnisse.levinkeller.de` – dieselbe Anwendung, dasselbe Image,
andere Datenquelle: ein Wahlabend, der sich alle zehn Minuten wiederholt.

## Wozu

Am 13.09.2026 läuft der Beamer im Saal, und dann muss alles sitzen: Dashboard,
Hochrechnung, Ticker, das stille Nachladen bei neuen Zahlen. Vorher lässt sich
das nur an einem Abend prüfen, den es noch nicht gibt. Also spielen wir einen
nach, den es gab.

## Sie spielt 2021, und zwar als 2021

Die Probe nimmt die amtlichen Ergebnisse der Kommunalwahl vom **12.09.2021**,
verrauscht sie und spielt sie zeitlich gestaffelt unter **demselben Termin**
wieder ein, zu dem sie gehören. Dieselben Wahlen, dieselben Gebiete, dieselben
Bewerberinnen und Bewerber, dieselben Wahllokale. Es gibt nichts umzuhängen
und nichts zuzuordnen: Erfunden ist allein das Rauschen und die Reihenfolge,
in der die Wahlbezirke hereinkommen.

**Unter `WAHLEN_DEMO=1` endet die Welt am 12.09.2021.** `TERMINE` in
`src/data/termine.ts` führt dann nur noch den Probentermin – als laufenden –
und alles, was davor liegt. Spätere Termine gibt es in dieser Instanz nicht:
keine Seite, kein Menüeintrag, keine API-Antwort, kein Eintrag in einer
Terminliste. Das ist eine Stelle und nicht zehn; jede Liste, jede Navigation
und jede Route baut auf `TERMINE` auf. Der Poller fragt in dieser Rolle
ohnehin niemanden ab.

Damit zeigen Probe und Produktion nie dieselbe Adresse mit verschiedenem
Inhalt. Sie haben keine gemeinsame Adresse mehr.

**Die Stichwahlen bleiben leer.** Sie standen am 12.09.2021 noch aus – die
Probe spielt den ersten Wahlgang und lässt die Stichwahl-Wahlen unbespielt,
wie an einem echten Wahlabend.

## Der leere Saal

Ein Wahlabend fängt bei null an. Beim Start des Pollers legt
`bereiteProbeVor` (`demo-abend.ts`) deshalb landesweit alle echten Zahlen des
Probentermins in die Tabelle **`demo_quelle`** und räumt danach `ergebnisse`,
`ereignisse` und `uebersichten` zu diesem Termin ab. Erst daraus baut die
Probe ihren Abend.

Die zweite Ablage ist Bedingung, nicht Beiwerk: Die Probe schreibt in dieselbe
Zeile, aus der sie liest. Ohne `demo_quelle` wäre die Vorlage nach dem ersten
Takt überschrieben und nach einem Neustart verloren. `INSERT OR IGNORE` macht
den Schritt wiederholbar – was einmal gesichert ist, bleibt gesichert, auch
wenn in `ergebnisse` längst simulierte Zahlen stehen.

Ein Neustart oder Deploy räumt den Saal also erneut leer; wo im Abend die Uhr
steht, sagt danach der gemerkte Nullpunkt. Halb ausgezählt startet niemand.

## Wie sie in die Anwendung kommt

Über denselben Schreibweg wie der Poller (`speichereErgebnis` in `poll.ts`).
Alles Weitere – Ticker, Auszählstand, Hochrechnung, die Zustellung an offene
Seiten – entsteht daraus von selbst. **Die Simulation ist eine Datenquelle,
kein zweiter Programmzweig**; nur deshalb prüft sie wirklich, was am Wahlabend
läuft, und nicht einen Nachbau davon.

```
 demo_quelle (2021, amtlich)         Zeitplan aus der Uhr
   │  Wahllokale des Abends            │  Vorlauf 8 % · zählen · Nachlauf 12 %
   ▼                                   ▼
 demo-abend.ts ──── zaehleZusammen ──► speichereErgebnis ──► SQLite (2021)
                    (+ Rauschen)              │
                                              ▼
                                    Ticker · Hochrechnung · SSE
```

**Ohne eigenen Zustand, aber mit gemerktem Nullpunkt.** Welches Wahllokal wann
eingeht, ergibt sich aus dem Nullpunkt, der Uhr und einer Zufallsfolge mit
festem Startwert; zwei Anfragen im selben Augenblick sehen denselben Abend.

Der Nullpunkt ist der Augenblick, in dem der erste Durchlauf beim leeren Saal
anfängt. Er steht in der Meta-Tabelle (`demo:nullpunkt`): Beim ersten Start in
eine leere Datenbank schreibt der Poller ihn einmal, jeder spätere Start liest
ihn. Geschrieben wird nur in der Rolle, die schreiben darf – die Web-Pods
haben die Datenbank nur lesend offen. Absichtlich neu anfangen geht mit
`WAHLEN_DEMO_NEUSTART=1`.

## Das Rauschen

Je **Wahllokal** und Partei verschiebt ein Faktor die Stimmen um wenige
Prozent (`verrausche` in `demo.ts`). Ohne das stünde in jeder
Veränderungsspalte „±0,0" und die Hochrechnung hätte nichts zu tun. Mit dem
Rauschen bewegt sich das Bild, wie es sich an einem echten Abend bewegt – und
es ist zugleich der Beleg, dass hier nichts Amtliches steht.

**Jeder Durchlauf spielt denselben Abend.** Der Startwert für Rauschen und
Eingangszeiten kennt die Nummer des Durchlaufs nicht; er besteht aus Wahlart,
Gemeinde und Wahllokal – und ausdrücklich nicht aus der Wahlleitung, die
gerade zusieht. Das ist keine Sparsamkeit um ihrer selbst willen: Der Abend
wird angesagt, die Ansagen entstehen über einen Sprachdienst, und **jede neue
Prozentzahl ist ein neuer Satz und damit eine neue, bezahlte Aufnahme**. Bei
gleichen Durchläufen wird jeder Satz genau einmal erzeugt und danach für immer
aus dem Zwischenspeicher gespielt. Zufällig bleibt das Bild trotzdem: Es ist
nur ein für allemal ausgewürfelt.

**Das Rauschen gehört zum Wahllokal, nicht zum Amt der Wahlleitung.** Sonst
lieferte dasselbe Wahllokal an die Gemeindesicht andere Stimmen als an die
Kreissicht. Es wird einmal je Wahllokal und Partei aufgelegt und dabei
gerundet; danach ist jede Zeile die Summe genau der ganzen Zahlen, die in den
Wahlbezirkszeilen stehen.

## Simuliert wird genau eine Größe

**Wann welches Wahllokal seine Zahlen einträgt – landesweit.** Jede Zeile,
jede Folie, jeder Auszählstand und jede Kennzahl ist eine Auswertung darüber.
Die Gemeindezeile beim Kreis und die eigene Wahl der Gemeinde sind zwei
Sichten auf dieselben 23 Wahllokale, nicht zwei Abende.

**„Welche Ebene stellt die Einheiten" ist eine Frage der Wahl, nicht der
Behörde.** Die Kreisbehörde führt zum Kreistag nur Gemeindezeilen; ausgezählt
wird trotzdem in Wahllokalen. Jede Gemeindezeile löst sich deshalb über den
Behördennamen auf den AGS und von dort auf die Wahllokale derselben Gemeinde
auf – dieselbe Wahl, nur bei der Wahlleitung, die sie auszählt. Nordstemmens
Kreiszeile führt 23 Wahllokale, der Wahlbereich B (Elze und Nordstemmen) 37,
der Kreis 426. Liegt von einer Gemeinde gar nichts vor, bleibt ihre Kreiszeile
ihre eigene Einheit; zwei Sichten können dann nicht auseinanderlaufen, weil es
nur eine gibt.

**Jede Auszähleinheit hat ihre eigene Eingangszeit.** Sie wird aus dem
Startwert gezogen und liegt irgendwo in der Zählphase (`eingangsAnteil` in
`demo.ts`); eine Einheit ist eingegangen, wenn ihr Zeitpunkt erreicht ist.
Damit hat der Abend Klumpen und Lücken, wie ein Abend sie hat. Die Verteilung
ist bewusst nicht gleichmäßig, sondern zieht nach vorn (`u ** 1,3`): Die
kleinen Urnenwahlbezirke melden früh, die großen und die Briefwahl brauchen
länger.

**Gespielt wird, wo jemand zusieht.** Je Takt kommen die Wahlleitungen der
gerade betrachteten Kreise dran – wer einen Kreis aufruft, wird sofort in die
Runde aufgenommen und nicht erst nach einem vollen Umlauf. Sieht niemand zu,
läuft der Standard-Kreis mit. Landesweit alle vierhundert alle fünf Sekunden
durchzurechnen wäre Arbeit für niemanden; was das kostet, misst
`scripts/demo-messung.ts`.

**Die Zeiten sind die des nachgespielten Abends.** „Stand 20:14" gehört zur
letzten eingegangenen Schnellmeldung und steht still, bis die nächste kommt;
„geprüft" schreibt die Simulation nach jedem Schritt fort, obwohl sie
niemanden fragt. Beides ist nicht Kosmetik: Ein Zeitstempel, der bei jedem
Schreibvorgang auf die Uhr springt, ließe jede Zeile im Fünf-Sekunden-Takt als
geändert gelten – der Ticker liefe über, und die Seite lüde ständig nach.

**Kein Aufruf geht nach außen.** Die Demo fragt keine Wahlleitung ab und lädt
kein Archiv nach; sie stört niemanden und braucht nichts.

## Der Demo-Bestand: die Daten liegen im Repo

`daten/demo-bestand.db.zst` – eingecheckt, landesweit.

Der Ausgangsbestand der Produktion ist ein 70-MB-Anhang eines GitHub-Release,
den der Docker-Build ins Image backt (`docs/ausgangsbestand.md`). Für die
Produktion ist das richtig. Für die Generalprobe wäre es eine Abhängigkeit zu
viel: Wer das Release löscht oder ohne Ausgangsbestand baut
(`SCHNAPPSCHUSS=keiner`), hätte eine Probe, die nichts probt – und das sieht
man ihr nicht an, denn eine leere Generalprobe sieht aus wie eine, die noch
nicht angefangen hat.

Der Poller übernimmt die Datei beim Start, wenn er in der Generalprobe **keine
Zahlen zum Probentermin** in seiner Datenbank findet – nach
`uebernimmSchnappschuss` und vor `oeffneDb`, in `server/main.ts`. Die
Reihenfolge ist die Aussage: Ist ein Ausgangsbestand da, gilt der, er ist der
vollständige. Der Demo-Bestand ist der Boden darunter, kein Ersatz. Außerhalb
von `WAHLEN_DEMO=1` tut er nichts.

### Was drin ist

| | |
|---|---|
| **Probentermin 2021** | die amtlichen Ergebnisse landesweit, mit echten Bewerberinnen und Bewerbern, dazu Wahlen, Wahleinträge und Wahlräume. Das ist alles, woraus die Probe ihren Abend spielt. |
| **Frühere Termine** | 2020 und die Direktwahl-Termine davor – die Vergleichswerte, aus denen die Wahlseiten ihre Veränderungsspalten ziehen. |

Draußen bleibt, was die Probe nicht liest: alles, was **nach** dem
Probentermin liegt (die Anwendung kennt es unter dem Schalter ohnehin nicht),
die Tabelle `dateien` (der HTTP-Zwischenspeicher des Pollers – die Probe fragt
keinen fremden Server ab), die Laufprotokolle (`laeufe`), der Ticker
(`ereignisse`, der fängt leer an), die Übersichten (`uebersichten`, sie tragen
echte Zahlen und stünden neben den simulierten) und die Listenplätze
(`wahlvorschlaege`, die größte Tabelle und für den Wahlabend entbehrlich).

Der Preis dafür ist benannt: Die Archivseiten der Demo-Instanz zeigen keine
Untergebiets-Übersichten und keine Listenplätze. Das ist der Teil, um den es
nicht geht.

**Erfunden ist nur das Rauschen.** Die Zahlen im Bestand sind die echten,
amtlichen Ergebnisse vom 12.09.2021.

### Auffrischen

Nötig, wenn ein früherer Termin dazukommt oder wenn der `DATENSTAND` steigt.
Der Weg ist der des Ausgangsbestands – filtern im Pod, packen draußen, denn
`zstd -19` will gut 100 MB Arbeitsspeicher und der Poller-Pod hat 512 MiB im
Ganzen:

```sh
# 1. Im Pod: Kopie ziehen (nur lesend), filtern, VACUUM
kubectl -n wahlergebnisse exec deploy/wahlergebnisse-poller -- \
  node --no-warnings --experimental-strip-types scripts/demo-bestand.ts \
  --roh --db /data/wahlen.db --ziel /data/demo-bestand.db

# 2. Herausholen und im Pod aufräumen. `cp` und nicht `exec … cat >`:
#    Der rohe Stream hat bei 270 MB das letzte MB verschluckt, ohne einen
#    Fehler zu melden. `cp` packt in tar und merkt es. Prüfsumme vergleichen.
kubectl -n wahlergebnisse cp <pod>:/data/demo-bestand.db ./demo-bestand.db
kubectl -n wahlergebnisse exec deploy/wahlergebnisse-poller -- \
  rm -f /data/demo-bestand.db

# 3. Draußen packen und gegenprüfen
npm run demo-bestand -- --packen demo-bestand.db --ziel daten/demo-bestand.db.zst
npm run demo-bestand -- --pruefen daten/demo-bestand.db.zst
```

Die Quelle ist die **Produktionsdatenbank**, nicht die der Demo: Im
Demo-Namespace hat die Probe die Zeilen des Probentermins längst mit
simulierten Zahlen überschrieben. Was von dort käme, wäre nicht der amtliche
Abend, sondern das Abbild eines nachgespielten.

Lokal, wo der Speicher nicht gedeckelt ist, macht `npm run demo-bestand` alles
am Stück.

## Der Schalter

| Variable | Standard | Zweck |
|---|---|---|
| `WAHLEN_DEMO` | – | `1` schaltet die Generalprobe ein |
| `WAHLEN_DEMO_ZYKLUS` | `600` | Sekunden je Durchlauf (mindestens 60; im Demo-Overlay 3600) |
| `WAHLEN_DEMO_BEHOERDEN` | alle der betrachteten Kreise | Nur diese Wahlleitungen (AGS, komma-getrennt) |
| `WAHLEN_DEMO_NEUSTART` | – | `1` setzt den gemerkten Nullpunkt beim Start einmal auf jetzt |
| `WAHLEN_DEMO_BESTAND` | `/app/daten/demo-bestand.db.zst` | Pfad des eingecheckten Bestands |

Er muss in **beiden** Rollen stehen. Der Poller spielt damit den Abend nach
statt abzufragen; die Web-Pods setzen Banner, `noindex` und die Terminliste,
in der 2026 nicht vorkommt. Stünde er nur beim Poller, sähe die Seite echt aus
und wäre es nicht – der gefährlichste aller Zustände.
`test/demo-deploy.test.ts` prüft genau das am Manifest, und ebenso, dass er in
der Produktion nirgends auftaucht.

## Dass es eine Demo ist, steht überall

- ein **Banner** über jeder Seite, nicht wegzuklicken
- **„Demo – keine echten Ergebnisse"** in **jeder Dashboard-Folie**, denn was
  von der Leinwand weitergereicht wird, ist ein Foto dieser Fläche, und ein
  Balken am oberen Rand ist weggeschnitten, bevor jemand ihn gelesen hat
- `DEMO ·` vor jedem Seitentitel, also auch im Browser-Reiter
- `noindex, nofollow`

Alle vier hängen an `demoAn()` und an `Layout.astro`, also an jeder Seite der
Instanz – auch an denen des Archivs. Das ist hier wichtiger als sonst: Unter
`/…/2021/…` stehen Zahlen, die wie amtliche aussehen und es nicht mehr sind.

## Lokal ausprobieren

```bash
# Nichts vorzubereiten: Auf einem leeren ./data holt sich der Start den
# eingecheckten Demo-Bestand – hier mit zwei Minuten je Durchlauf.
WAHLEN_DEMO=1 WAHLEN_DEMO_ZYKLUS=120 \
  WAHLEN_DEMO_BESTAND=daten/demo-bestand.db.zst npm start
```

`WAHLEN_DEMO_BESTAND` zeigt in der Entwicklung auf die Datei im Repo; im Image
liegt sie unter `/app/daten/demo-bestand.db.zst`, und dort ist es die Vorgabe.
Wer die Zahlen lieber selbst zieht, kann es zu Fuß:

```bash
npm run poll -- 2021 2020
WAHLEN_DEMO=1 WAHLEN_DEMO_ZYKLUS=120 npm start
```

## Was ein Takt kostet

`scripts/demo-messung.ts` misst es an einer echten Datenbank aus den Fixtures
(Mock-votemanager, `pollTermin` für 2021 und 2020) – ohne Netz und ohne etwas
anzufassen, was bleibt:

```bash
node --experimental-strip-types --expose-gc scripts/demo-messung.ts
node --experimental-strip-types --expose-gc scripts/demo-messung.ts --kreis region-hannover
```

Gemessen werden Vorlagenbau, ein Takt (`spieleStand`), ein Takt ohne jede
Änderung und der Speicher, den die Vorlagen halten. Die Zahlen gehören in jede
Diskussion darüber, wie viele Wahlleitungen je Takt drankommen sollen –
`DEMO_JE_TAKT` in `server/main.ts` steht auf 30.

Gemessen am Landkreis Hildesheim, Median über fünf Runden; der Takt sind fünf
Sekunden:

| | Vorlagenbau | Takt | Takt ohne Änderung | Vorlagen im Speicher |
|---|---|---|---|---|
| eine Gemeinde (12 Ämter, 91 Wahllokale) | 5,1 ms | 7,2 ms | 2,7 ms | 0,03 MB |
| Kreisbehörde (Kreistag und Landrat, 828 Wahllokale) | 12,9 ms | 73,3 ms | 2,8 ms | 0,37 MB |
| alle 19 Wahlleitungen des Kreises (218 Ämter) | 98,7 ms | 165,1 ms | 49,0 ms | 1,20 MB |

Gerechnet wird ohnehin nur für Kreise, die jemand ansieht.

## Ausrollen

`deploy/overlays/demo/` – eigener Namespace (`wahlergebnisse-demo`), eigenes
PVC, eigene Adresse, ohne Export-Token. Es braucht dazu noch zweierlei von
Hand: einen **DNS-Eintrag** für `demo.wahlergebnisse.levinkeller.de` auf
dieselbe Adresse wie die Produktion und eine **Argo-CD-Application**, die auf
dieses Overlay zeigt.

**Beide Overlays tragen denselben Bildstand**, und die CI schreibt ihn in
beide (`.github/workflows/deploy.yml`). Eine Probe auf einem älteren Bild
prüft einen Stand, den es nicht mehr gibt. Dass die Demo bei jedem Deploy neu
beginnt, ist kein Verlust – ein Wahlabend fängt beim leeren Saal an, und genau
das soll sie zeigen.
