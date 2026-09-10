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

**Erfunden ist die Zuordnung zu 2026 und ein leichtes Rauschen**: Je Durchlauf
und Partei verschiebt ein Faktor die Stimmen um wenige Prozent. Ohne das
stünde in jeder Veränderungsspalte „±0,0“, die Hochrechnung hätte nichts zu
tun, und der zehnte Durchlauf sähe aus wie der erste. Mit dem Rauschen bewegt
sich das Bild, wie es sich an einem echten Abend bewegt – und es ist zugleich
der Beleg, dass hier nichts Amtliches steht.

## Wie sie in die Anwendung kommt

Über denselben Schreibweg wie der Poller (`speichereErgebnis` in `poll.ts`).
Alles Weitere – Ticker, Auszählstand, Hochrechnung, die Zustellung an offene
Seiten – entsteht daraus von selbst. **Die Simulation ist eine Datenquelle,
kein zweiter Programmzweig**; nur deshalb prüft sie wirklich, was am Wahlabend
läuft, und nicht einen Nachbau davon.

```
 Ausgangsbestand (2021, 2020)        Zeitplan aus der Uhr
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

**Die Zeiten sind die des nachgespielten Abends.** „Stand 20:14" gehört zur
letzten eingegangenen Schnellmeldung und steht still, bis die nächste kommt;
„geprüft" schreibt die Simulation nach jedem Schritt fort, obwohl sie
niemanden fragt. Beides ist nicht Kosmetik: Ein Zeitstempel, der bei jedem
Schreibvorgang auf die Uhr springt, ließe jede Zeile im Fünf-Sekunden-Takt als
geändert gelten – der Ticker liefe über, und die Seite lüde ständig nach.

**Kein Aufruf geht nach außen.** Die Demo fragt keine Wahlleitung ab und lädt
kein Archiv nach; sie stört niemanden und braucht nichts.

## Der Schalter

| Variable | Standard | Zweck |
|---|---|---|
| `WAHLEN_DEMO` | – | `1` schaltet die Generalprobe ein |
| `WAHLEN_DEMO_ZYKLUS` | `600` | Sekunden je Durchlauf (mindestens 60) |
| `WAHLEN_DEMO_BEHOERDEN` | alle des Standard-Kreises | Nur diese Wahlleitungen (AGS, komma-getrennt) |

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
# Vorlage laden (einmal): die Archivtermine, aus denen die Demo schöpft
npm run poll -- 2021 2020

# und laufen lassen – hier mit zwei Minuten je Durchlauf
WAHLEN_DEMO=1 WAHLEN_DEMO_ZYKLUS=120 npm start
```

## Ausrollen

`deploy/overlays/demo/` – eigener Namespace (`wahlergebnisse-demo`), eigenes
PVC, eigene Adresse, ohne Export-Token. Es braucht dazu noch zweierlei von
Hand: einen **DNS-Eintrag** für `demo.wahlergebnisse.levinkeller.de` auf
dieselbe Adresse wie die Produktion und eine **Argo-CD-Application**, die auf
dieses Overlay zeigt.

Der Bildstand steht im Overlay wie in der Produktion; die CI schreibt ihn dort
nicht mit, damit die Demo nicht bei jedem Deploy durchstartet. Wer sie auf den
neuesten Stand bringen will, setzt den Tag von Hand.
