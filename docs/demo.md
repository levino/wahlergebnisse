# Die Generalprobe

`demo.wahlergebnisse.levinkeller.de` – dieselbe Anwendung, dasselbe Image,
andere Datenquelle: ein Wahlabend, der sich alle zehn Minuten wiederholt.

## Wozu

Am 13.09.2026 läuft der Beamer im Saal, und dann muss alles sitzen: Dashboard,
Hochrechnung, Ticker, das stille Nachladen bei neuen Zahlen. Vorher lässt sich
das nur an einem Abend prüfen, den es noch nicht gibt. Also bauen wir ihn nach.

## Woher die Zahlen kommen

Je Wahl aus dem Vorwert desselben Amtes bei derselben Wahlleitung – für Rat,
Ortsräte, Kreistag und Landrat also 2021, für die Bürgermeisterwahl
Nordstemmen die von 2020. Das ist dieselbe Zuordnung, nach der die Wahlseiten
ihre Veränderungswerte suchen, und sie hat einen angenehmen Nebeneffekt:
Niemand muss Namen erfinden. Es sind echte Bewerberinnen und Bewerber mit
echten Zahlen, nur eben von der letzten Wahl.

**Erfunden ist die Zuordnung zu 2026 und ein leichtes Rauschen**: Je Amt und
Partei verschiebt ein Faktor die Stimmen um wenige Prozent. Ohne das stünde in
jeder Veränderungsspalte „±0,0“ und die Hochrechnung hätte nichts zu tun. Mit
dem Rauschen bewegt sich das Bild, wie es sich an einem echten Abend bewegt –
und es ist zugleich der Beleg, dass hier nichts Amtliches steht.

**Jeder Durchlauf spielt denselben Abend.** Der Startwert für Rauschen und
Eingangszeiten kennt die Nummer des Durchlaufs nicht; er besteht aus
Wahlleitung, Amt und Gebiet. Anfangs war es umgekehrt gedacht – „der zehnte
Durchlauf soll nicht aussehen wie der erste" –, und das ist teuer: Der Abend
wird angesagt, die Ansagen entstehen über einen Sprachdienst, und **jede neue
Prozentzahl ist ein neuer Satz und damit eine neue, bezahlte Aufnahme**. Bei
gleichen Durchläufen wird jeder Satz genau einmal erzeugt und danach für immer
aus dem Zwischenspeicher gespielt. Zufällig bleibt das Bild trotzdem: Es ist
nur ein für allemal ausgewürfelt.

**Wo am Zieltermin gar nichts angelegt ist, spielt die Probe die Ämter des
Vorwerts.** Für die Produktion gilt die strengere Regel – in Alfeld gibt es
2026 keine Bürgermeisterwahl, also darf dort auch keine auf der Leinwand
stehen –, und sie gilt in der Probe für jede Wahlleitung, die überhaupt eine
2026er Präsentation angelegt hat. 31 Wahlleitungen haben das nicht, darunter
alle 22 der Region Hannover: Dort liegen 7099 Ergebniszeilen aus 2021 und kein
einziges 2026er Amt. Sie fielen sonst ganz aus der Probe. Was dort auf der
Leinwand steht, ist deshalb ein Abend unter einer Annahme: **wie es aussähe,
wenn dieselben Ämter gewählt würden wie beim letzten Mal.** Gemischt wird nie
– der Unterschied ist „gar nichts angelegt" gegen „etwas angelegt", und nur
der erste Fall rechtfertigt den Rückfall.

## Wie sie in die Anwendung kommt

Über denselben Schreibweg wie der Poller (`speichereErgebnis` in `poll.ts`).
Alles Weitere – Ticker, Auszählstand, Hochrechnung, die Zustellung an offene
Seiten – entsteht daraus von selbst. **Die Simulation ist eine Datenquelle,
kein zweiter Programmzweig**; nur deshalb prüft sie wirklich, was am Wahlabend
läuft, und nicht einen Nachbau davon.

```
 Demo-Bestand (2021, 2020, …)        Zeitplan aus der Uhr
   │  Wahlbezirke der Vorwahl          │  Vorlauf 8 % · zählen · Nachlauf 12 %
   ▼                                   ▼
 demo-abend.ts ──── zaehleZusammen ──► speichereErgebnis ──► SQLite
                    (+ Rauschen)              │
                                              ▼
                                    Ticker · Hochrechnung · SSE
```

**Ohne eigenen Zustand, aber mit Nullpunkt.** Welcher Wahlbezirk wann eingeht,
ergibt sich aus dem Start des Poller-Prozesses, der Uhr und einer Zufallsfolge
mit festem Startwert; zwei Anfragen im selben Augenblick sehen denselben Abend.
Der Nullpunkt ist der Start: Ein Wahlabend fängt beim leeren Saal an, auch der
nachgespielte – wer die Demo kurz nach dem Ausrollen aufruft, sähe sonst einen
Saal, in dem schon die Hälfte ausgezählt ist. Ein Neustart des Pods beginnt
deshalb von vorn.

**Jede Auszähleinheit hat ihre eigene Eingangszeit.** Sie wird aus dem
Startwert gezogen und liegt irgendwo in der Zählphase (`eingangsAnteil` in
`demo.ts`); eine Einheit ist eingegangen, wenn ihr Zeitpunkt erreicht ist.
Damit hat der Abend Klumpen und Lücken, wie ein Abend sie hat. Vorher wurden
die Einheiten gemischt und dann bei „Fortschritt mal Anzahl" abgeschnitten –
alle Wahlen einer Wahlleitung rückten im Gleichschritt vor, und weil der Takt
die Wahlleitungen reihum bedient, sprang eine beim Drankommen gleich um
mehrere Einheiten: erst Stille, dann ein Schwall. Die Verteilung ist bewusst
nicht gleichmäßig, sondern zieht nach vorn (`u ** 1,3`): Die kleinen
Urnenwahlbezirke melden früh, die großen und die Briefwahl brauchen länger.

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

`daten/demo-bestand.db.zst` – **15,6 MB**, eingecheckt, landesweit.

Bisher kamen die Vorwerte aus dem Ausgangsbestand: einem 70-MB-Anhang eines
GitHub-Release, den der Docker-Build ins Image backt
(`docs/ausgangsbestand.md`). Für die Produktion ist das richtig. Für die
Generalprobe war es eine Abhängigkeit zu viel: Wer das Release löscht oder
ohne Ausgangsbestand baut (`SCHNAPPSCHUSS=keiner`), hat eine Probe, die nichts
probt – und das sieht man ihr nicht an, denn eine leere Generalprobe sieht aus
wie eine, die noch nicht angefangen hat.

Deshalb liegen die Daten jetzt im Repo. Der Poller übernimmt sie beim Start,
wenn er in der Generalprobe **keine Vorwerte** in seiner Datenbank findet –
nach `uebernimmSchnappschuss` und vor `oeffneDb`, in `server/main.ts`. Die
Reihenfolge ist die Aussage: Ist ein Ausgangsbestand da, gilt der, er ist der
vollständige. Der Demo-Bestand ist der Boden darunter, kein Ersatz. Außerhalb
von `WAHLEN_DEMO=1` tut er nichts – auf einem Produktions-Volume wäre die
kleine, gefilterte Fassung ein Rückschritt, und einer, der lautlos passierte.

### Was drin ist

| | |
|---|---|
| **Zieltermin 2026** | die Ämter, wie die Wahlleitungen sie angelegt haben – Wahlen, Wahleinträge, leere Ergebniszeilen. **Keine einzige echte Zahl**: Was eine Wahlleitung dort schon veröffentlicht hat, wäre in einer Simulation von den erfundenen Zahlen nicht zu unterscheiden. |
| **Vorwert-Termine** | die amtlichen Ergebnisse von 2021, 2020 und den 25 Direktwahl-Terminen – landesweit, mit echten Bewerberinnen und Bewerbern. Daraus baut `baueVorlage` ihre Vorlage. |
| **Wahlräume** | die Kreiswahlbereiche hängen daran, und zwar ausdrücklich die von 2021 (`RUECKFALL_TERMIN` in `wahlbereiche.ts`). |

Draußen bleibt, was die Probe nicht liest: die Tabelle `dateien` (der
HTTP-Zwischenspeicher des Pollers, 70 MB – die Probe fragt keinen fremden
Server ab), die Laufprotokolle (`laeufe`, sie wiesen in der Demo einen „letzten
Lauf" aus, den es dort nie gab) und die Übersichten und Listenplätze der
Vorwert-Termine (130 MB; beides liest die Anwendung nur zum *angezeigten*
Termin). Aus 470 MB werden so 270 MB roh und 15,6 MB gepackt – 17,4:1 mit
`zstd -19`.

Der Preis dafür ist benannt: Die **Archivseiten** der Demo-Instanz zeigen dann
keine Untergebiets-Übersichten und keine Listenplätze mehr. Das ist der Teil
der Demo, um den es nicht geht – geprobt wird der Wahlabend 2026, und für den
fehlt nichts.

**Erfunden ist nur die Zuordnung.** Die Zahlen im Bestand sind die echten,
amtlichen Ergebnisse früherer Wahlen. Erfunden ist allein, dass sie am
13.09.2026 noch einmal so ausfielen – und das Rauschen, das die Probe
darüberlegt.

### Auffrischen

Nötig, wenn ein Vorwert-Termin dazukommt, wenn die Wahlleitungen ihre
2026er Ämter ändern oder wenn der `DATENSTAND` steigt. Der Weg ist der des
Ausgangsbestands – filtern im Pod, packen draußen, denn `zstd -19` will gut
100 MB Arbeitsspeicher und der Poller-Pod hat 512 MiB im Ganzen:

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
Demo-Namespace hat die Probe den Zieltermin längst überschrieben – ihre 2026er
Wahleinträge tragen die Gebiete des Vorwerts und ihre Ergebnisse die
simulierten Zahlen. Was von dort käme, wäre nicht die Struktur, die die
Wahlleitungen angelegt haben, sondern das Abbild eines nachgespielten Abends.

Lokal, wo der Speicher nicht gedeckelt ist, macht `npm run demo-bestand` alles
am Stück.

## Der Schalter

| Variable | Standard | Zweck |
|---|---|---|
| `WAHLEN_DEMO` | – | `1` schaltet die Generalprobe ein |
| `WAHLEN_DEMO_ZYKLUS` | `600` | Sekunden je Durchlauf (mindestens 60; im Demo-Overlay 3600) |
| `WAHLEN_DEMO_BEHOERDEN` | alle der betrachteten Kreise | Nur diese Wahlleitungen (AGS, komma-getrennt) |

Er muss in **beiden** Rollen stehen. Der Poller spielt damit den Abend nach
statt abzufragen; die Web-Pods setzen Banner und `noindex`. Stünde er nur beim
Poller, sähe die Seite echt aus und wäre es nicht – der gefährlichste aller
Zustände. `test/demo-deploy.test.ts` prüft genau das am Manifest, und ebenso,
dass er in der Produktion nirgends auftaucht.

## Dass es eine Demo ist, steht überall

- ein **Banner** über jeder Seite, nicht wegzuklicken
- **„Demo – keine echten Ergebnisse"** in **jeder Dashboard-Folie**, denn was
  von der Leinwand weitergereicht wird, ist ein Foto dieser Fläche, und ein
  Balken am oberen Rand ist weggeschnitten, bevor jemand ihn gelesen hat
- `DEMO ·` vor jedem Seitentitel, also auch im Browser-Reiter
- `noindex, nofollow`

## Lokal ausprobieren

```bash
# Nichts vorzubereiten: Auf einem leeren ./data holt sich der Start den
# eingecheckten Demo-Bestand – hier mit zwei Minuten je Durchlauf.
WAHLEN_DEMO=1 WAHLEN_DEMO_ZYKLUS=120 \
  WAHLEN_DEMO_BESTAND=daten/demo-bestand.db.zst npm start
```

`WAHLEN_DEMO_BESTAND` zeigt in der Entwicklung auf die Datei im Repo; im Image
liegt sie unter `/app/daten/demo-bestand.db.zst`, und dort ist es die Vorgabe.
Wer die Vorwerte lieber selbst zieht, kann es weiter zu Fuß:

```bash
npm run poll -- 2026 2021 2020
WAHLEN_DEMO=1 WAHLEN_DEMO_ZYKLUS=120 npm start
```

## Was ein Takt kostet

`scripts/demo-messung.ts` misst es an einer echten Datenbank aus den Fixtures
(Mock-votemanager, `pollTermin` für 2026, 2021 und 2020) – ohne Netz und ohne
etwas anzufassen, was bleibt:

```bash
node --experimental-strip-types --expose-gc scripts/demo-messung.ts
node --experimental-strip-types --expose-gc scripts/demo-messung.ts --kreis region-hannover
```

Gemessen werden Vorlagenbau, ein Takt (`spieleStand`), ein Takt ohne jede
Änderung und der Speicher, den die Vorlagen halten. Die Zahlen gehören in jede
Diskussion darüber, wie viele Wahlleitungen je Takt drankommen sollen –
`DEMO_JE_TAKT` in `server/main.ts` steht auf 30.

## Ausrollen

`deploy/overlays/demo/` – eigener Namespace (`wahlergebnisse-demo`), eigenes
PVC, eigene Adresse, ohne Export-Token. Es braucht dazu noch zweierlei von
Hand: einen **DNS-Eintrag** für `demo.wahlergebnisse.levinkeller.de` auf
dieselbe Adresse wie die Produktion und eine **Argo-CD-Application**, die auf
dieses Overlay zeigt.

**Beide Overlays tragen denselben Bildstand**, und die CI schreibt ihn in
beide (`.github/workflows/deploy.yml`). Eine Zeit lang hing die Demo an einem
von Hand gesetzten Tag – „damit sie nicht bei jedem Deploy durchstartet". Der
Preis dafür war hoch: Sie probte einen Stand, den es nicht mehr gab, und ein
Fehler, der in Produktion längst behoben war, stand in der Probe weiter da.
Damit war die Generalprobe keine Aussage über den Wahlabend mehr, sondern über
einen vergangenen Nachmittag. Dass die Demo bei jedem Deploy neu beginnt, ist
kein Verlust – ein Wahlabend fängt beim leeren Saal an, und genau das soll sie
zeigen.
