# Eigenheiten der niedersächsischen Wahlleitungen

Erhoben aus allen 416 votemanager-Behörden
(`https://wahlen.votemanager.de/behoerden.json`) und einer Prüfung aller 45
Kreise; die Rohdaten liegen unter `scripts/quellen/`.

## Fundorte

- **Kein Verzeichnislisting.** Von 38 geprüften Instanzen antwortet jede mit
  403; offen ist allein `wahlen.kreis-hi.de`. Überall sonst ist
  `open_data.json` der einzige Weg zu den Dateien.
- Pfadmuster: `<wurzel>/<ags>/api/termine.json` für den Index,
  `<wurzel>/<ordner>/<ags>/daten/api/…` für einen Termin.
- **Der Ordner ist meist das Wahldatum, aber nicht immer.** Die
  Landeshauptstadt Hannover führt ihre Termine unter `Wahl-2026-09-13` und
  `Wahl-2021-09-12`.
- **Das Schema gehört zur Behörde, nicht zum Jahr.** Alle 2026er Termine sind
  v26 (`daten/api/`); v22 (`api/praesentation/`) endet mit dem 09.10.2022 – mit
  Ausnahme von Braunschweig, Region Hannover und Holzminden, die ihre 2021er
  Präsentation bereits in v26 ausliefern.
- **`open_data.json` liegt in v22 bei der API, in v26 bei den CSVs**
  (`…/daten/opendata/open_data.json`). Am falschen Ort gesucht, fehlen
  Parteizuordnung der Spalten D1, D2, … und die Listenplätze.
- Gesucht wird über das **Wahldatum**, nicht über den Namen: Der 12.09.2021
  heißt je nach Kreis „Kommunalwahlen", „Kreiswahl 2021", „Wahl des Kreistages"
  – bei Wilhelmshaven als einziger Eintrag des Tages „Wahl zum Seniorenbeirat".

| Wurzel | Kreise |
|---|---|
| `https://votemanager.kdo.de/` | 40 |
| `https://wahlergebnisse.region-hannover.de/` | Region Hannover |
| `http://wahlen.kreis-hi.de/wahlen/` | Hildesheim |
| `https://wahlen-heidekreis.de/` | Heidekreis |

**Die Wurzel gehört zur Behörde, nicht zum Kreis.** Bei 03159, 03241 und 03461
liegen Kreis und Gemeinden auf verschiedenen Hosts.

## Schlüssel und Zuordnung

- **Gebietsschlüssel sind 8- oder 9-stellig.** Samtgemeinden haben neun Stellen
  (`033555401`), und für sie ist das Feld in `behoerden.json` leer – der
  Schlüssel steht nur in der URL. Wer nach dem Feld gruppiert, verliert 107 von
  416 Behörden. Die ersten fünf Stellen sind immer der Kreis.
- **Gemeinde-Teilergebnisse kreisweiter Wahlen stehen bei der Gemeinde.** In
  `uebersicht_ebene_3_0.json` der Kreistags- oder Landratswahl trägt keine
  Gemeindezeile eine Gebiets-Id; ihr Verweis zeigt auf die fremde Präsentation
  (`../../03254026/praesentation/index.html`) – so bei Hildesheim, Peine und
  Göttingen, in beiden Programmversionen. Dieselben Zahlen führt jede Gemeinde
  in ihrer eigenen Präsentation, dort bis auf Ortsteile und Wahlbezirke hinunter.
- **Gebietsnamen liefert keine Quelle verlässlich.** Northeim schreibt in alle
  vierzehn Ortsratswahlen der Stadt Dassel „Ergebnis", Braunschweig bei allen
  dreizehn Stadtbezirksräten „Stadt Braunschweig", Wolfenbüttel „der Gemeinde
  Dahlum"; Hildesheim lässt den Ortsnamen im Wahltitel weg. Lemwerder führt
  seine Landratswahl doppelt.
- **Goslar führt „Stadt Langelsheim" zweimal**: `03153007` ist die alte Instanz
  ohne Kommunalwahl 2026, `03153019` trägt die Daten. Der stillgelegte Schlüssel
  steht in `STILLGELEGT` (`scripts/kreise-erzeugen.ts`).
- **Die Parteien kommen in Stimmzettel-Reihenfolge**, nicht nach Anteil. Wo die
  Anzeige kürzt, stünde sonst die falsche Partei oben – in 11 von 106 geprüften
  Wahlen.

## Wer wann veröffentlicht

- Fünf Kreise hatten den 13.09.2026 am 07.09.2026 nicht angelegt, darunter die
  Region Hannover mit 22 Behörden (Termin im Index, Verzeichnis 404).
  `Kreis.vorhanden` hält diesen Tag fest; maßgeblich ist, was ankommt.
- **Die Kommunalwahl 2021 gibt es in 40 der 45 Kreise** – nicht in Salzgitter
  und Wolfsburg (nie angelegt), nicht in Celle und Uelzen (kein votemanager,
  auch in keinem der 3 174 Einträge des bundesweiten Verzeichnisses) und nicht
  im Heidekreis, der sie im Index ankündigt, die Dateien aber nicht mehr hat.
  Region Hannover und Harburg haben umgekehrt 2021, aber noch nicht 2026.
- Für Wolfsburg und Harburg ist die Kreisbehörde nachgetragen, obwohl sie in
  `behoerden.json` fehlt; ihre Präsentation antwortet auf `votemanager.kdo.de`.
- **Sieben der 45 Kreise sind kreisfreie Städte**: eine einzige Wahlleitung, die
  zugleich Kreisbehörde ist, keine Kreiswahlen, keine Gemeinden. Emden liegt
  dafür in den Fixtures.

## Vorwerte der Direktwahlen

Räte, Kreistage und Ortsräte haben ihren Vorwert überall am 12.09.2021,
Direktwahlen nicht: **214 der 1 488 Ämter** haben ihn außerhalb dieses Tages,
verteilt auf 25 zusätzliche Wahltage (erhoben je Behörde und Amt in
`scripts/quellen/nds-vorwerte.json`, beschrieben in `scripts/quellen/vorwerte.md`).

**79 Ämter bei 67 Wahlleitungen haben gar keinen abrufbaren Vorwert**, fast
immer, weil der Termin-Index die Wahl ankündigt und die Präsentation weg ist
(beide Schemata 404): Hameln-Pyrmont (Landratswahl 08.03.2020), Schaumburg
(09.09.2018), die Bürgermeisterwahlen der Region Hannover im Sonderordner
`20190526BGM`. Der Index der Landeshauptstadt Hannover beginnt mit dem
12.09.2021; ihre Oberbürgermeisterwahl 2019 stand nie im votemanager.

## Archivlauf

Rund 160 Anfragen je Behörde, für die 402 Behörden der 40 Kreise also etwa
64 000 – davon 56 000 beim KDO, zusammen rund vier Stunden und rund 380 MB
Zuwachs. Die Vorwert-Termine kosten weitere rund 10 000 Anfragen.
