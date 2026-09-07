# Ausbau auf ganz Niedersachsen

Die App deckt bisher den Landkreis Hildesheim ab. Sie soll alle Landkreise und
kreisfreien Städte Niedersachsens abdecken. Dieses Dokument hält die
Entscheidungen fest, damit mehrere Leute gleichzeitig daran arbeiten können,
ohne sich zu widersprechen.

## Was die Erhebung ergeben hat

Grundlage ist ein Abzug aller 416 niedersächsischen votemanager-Behörden
(`https://wahlen.votemanager.de/behoerden.json`) und eine Prüfung aller 45
Kreise. Die Rohdaten liegen unter `scripts/quellen/`.

**Kein Verzeichnislisting.** Das ist der wichtigste Punkt. Der Poller findet
die Open-Data-Dateien bisher über den Apache-Autoindex des opendata-
Verzeichnisses. Von 38 geprüften Instanzen liefert **keine einzige** ein
Listing — alle antworten mit 403. Nur `wahlen.kreis-hi.de` hat es offen, und
genau daran ist der Poller gewachsen. Überall sonst ist `open_data.json` der
einzige Weg, die Dateien zu finden. Der Poller muss darauf umgestellt werden,
sonst sieht er außerhalb Hildesheims nichts.

**Pfadmuster.** Einheitlich `<wurzel>/<ags>/api/termine.json` für den Index
und `<wurzel>/<termin>/<ags>/daten/api/…` für einen Termin. Die Wurzel ist
aber nicht überall die Host-Wurzel:

| Wurzel | Kreise |
|---|---|
| `https://votemanager.kdo.de/` | 40 |
| `https://wahlergebnisse.region-hannover.de/` | Region Hannover |
| `http://wahlen.kreis-hi.de/wahlen/` | Hildesheim |
| `https://wahlen-heidekreis.de/` | Heidekreis |

**Die Wurzel gehört zur Behörde, nicht zum Kreis.** Bei drei Kreisen (03159,
03241, 03461) liegen Kreis und Gemeinden auf verschiedenen Hosts.

**Alle 2026er Termine sind v26** (`daten/api/`). Das alte Schema
(`api/praesentation/`) endet mit dem 09.10.2022 und wird nur noch für Archive
gebraucht.

**Gebietsschlüssel sind 8- oder 9-stellig.** Samtgemeinden haben neun Stellen
(`033555401`), und für sie ist das Feld in `behoerden.json` leer — der
Schlüssel steht nur in der URL. Wer nach dem Feld gruppiert, verliert 107 von
416 Behörden. Die ersten fünf Stellen bleiben in beiden Fällen der Kreis.

**Gemeinde-Teilergebnisse kreisweiter Wahlen stehen bei der Gemeinde.** In der
Übersicht des Kreises (`uebersicht_ebene_3_0.json` der Kreistags- oder
Landratswahl) trägt keine Gemeindezeile eine Gebiets-Id; ihr Verweis zeigt
stattdessen auf die fremde Präsentation
(`../../03254026/praesentation/index.html`) – gleichermaßen bei Hildesheim,
Peine und Göttingen und in beiden Programmversionen. Die Ergebnisdatei des
Kreises zu einer Gemeinde gibt es zwar, sie steht aber in keiner lesbaren
Datei und wäre nur über ein Verzeichnislisting zu finden. Dieselben Zahlen
führt jede Gemeinde in ihrer eigenen Präsentation mit, dort zusätzlich bis auf
Ortsteile und Wahlbezirke hinunter – nachgesehen bei Edemissen
(votemanager.kdo.de), Hann. Münden (eigener Host) und Nordstemmen
(wahlen.kreis-hi.de). **Deshalb führt eine Gemeinde bei einer kreisweiten Wahl
überall auf ihre eigene Seite dieser Wahl** (`src/lib/kreiswahl.ts`); nur wo
die Gemeinde noch keine Präsentation angelegt hat, bleibt die Gebiets-Id des
Kreises, und wo auch die fehlt, gibt es keinen Verweis. Der
Gebietsschlüssel im Verweis ordnet die Zeile eindeutig zu – Namen tun das
nicht.

**Nicht alle sind erreichbar.** Sechs Kreise haben den 13.09.2026 nicht
angelegt (darunter die Region Hannover mit 22 Behörden, deren Termin im Index
steht, aber 404 liefert). Celle und Uelzen benutzen gar keinen votemanager.
Solche Kreise werden angezeigt, aber als „liegt nicht vor" — sie dürfen die
Anwendung nicht zum Absturz bringen und nicht in eine Fehlerschleife führen.

## Adressen

Der Kreis wird das erste Segment. Ohne ihn wären Ergebnisse nicht verlinkbar,
und zwei Kreise mit gleichnamigen Gemeinden ließen sich nicht auseinanderhalten.

```
/                                  Auswahl bzw. Weiterleitung auf den gemerkten Kreis
/<kreis>/                          Startseite des Kreises
/<kreis>/<termin>/                 Termin
/<kreis>/<termin>/<behoerde>/      Behörde
/<kreis>/<termin>/<behoerde>/<wahl>/[<gebiet>]
```

**In der Anzeige taucht der Kreis nicht als Brotkrume auf.** Wer ihn einmal
gewählt hat, arbeitet darin weiter; ihn in jeder Zeile mitzuführen, kostet nur
Platz. Er steht stattdessen als Umschalter im Kopf, und die Wahl wird gemerkt
(Cookie, ein Jahr). Die Brotkrumen beginnen beim Termin.

**Alte Adressen bleiben gültig.** `/2021/kreis/kreistag/` und alles darunter
leitet dauerhaft (301) nach `/hildesheim/2021/…` um.

## Aufteilung der Arbeit

1. **Daten und Poller** — Katalog aller Kreise und Behörden erzeugen,
   Discovery über `open_data.json`, Wurzel je Behörde, Takt staffeln.
2. **Adressen und Bedienung** — Kreis-Segment, Umschalter, Merken,
   Weiterleitungen.
3. **Geodaten** — Gemeindeflächen für ganz Niedersachsen; Ortsteile und
   Wahllokale bleiben vorerst auf Hildesheim beschränkt.

## Was der Poller aushalten muss

Bisher fragt er 19 Behörden ab, künftig bis zu 416. Derselbe Takt wäre das
Zweiundzwanzigfache — auf fremden Servern, von denen einige nackte
Apache-Instanzen ohne CDN sind. Deshalb gestaffelt: der Kreis, den gerade
jemand ansieht, häufig; die übrigen selten; am Wahlabend alle. Bedingte
Abfragen (ETag) bleiben Pflicht.
