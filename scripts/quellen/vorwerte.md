# Vorwerte: die letzte Wahl vor dem 13.09.2026, je Behörde und je Amt

Erhoben am 07.09.2026 für alle 413 Behörden des Katalogs, Rohdaten in
`nds-vorwerte.json`, Erzeuger `scripts/vorwerte-erheben.ts`.

## Warum das erhoben wurde

Die Seite stellt jedes Ergebnis neben die jeweils passende frühere Wahl. Als
Archiv lud sie bis dahin **eine** Wahl: die Kommunalwahl vom 12.09.2021.

Für Räte, Kreistage und Ortsräte reicht das — die werden überall im gemeinsamen
Takt gewählt, und die Erhebung bestätigt das: 1 274 der 1 488 Ämter haben ihren
Vorwert am 12.09.2021. Für die Direktwahlen reicht es nicht. Bürgermeisterinnen,
Bürgermeister, Oberbürgermeister und Landräte haben eigene Amtszeiten; ihre
letzte Wahl liegt je nach Kommune 2013, 2019, 2022 oder 2025. Neben der
Bürgermeisterwahl 2026 stand deshalb bisher entweder gar nichts oder — beim
Rückfall auf den nächstälteren Termin — die Ratswahl 2021, also eine Zahl, die
mit ihr nichts zu tun hat.

## Wie erhoben wurde

Ein Termin-Index je Behörde (`<wurzel>/<ags>/api/termine.json`), danach die
`termin.json` der darin genannten Ordner, von neu nach alt — und abgebrochen,
sobald für jedes 2026 anstehende Amt ein Vorwert gefunden ist. Für die meisten
Behörden sind das vier Abrufe: Bundestagswahl 2025, Europawahl 2024,
Landtagswahl 2022 und dann der Ordner, in dem 2021 alles steht. Insgesamt
4 733 Anfragen in 109 Sekunden.

**Am Namen wird nichts ausgeschlossen.** Der erste Versuch tat das und war
falsch: Wendeburg führt seine Bürgermeisterwahl unter „Europawahl und Wahl
des/der Bürgermeisters/in“, Melle seine Landratswahl unter „Europawahl und
Landratswahl“. Wer solche Einträge wegen des Wortes „Europa“ überspringt, nimmt
als Vorwert die Wahl von 2016 statt der von 2019 — ein Fehlgriff, den niemand
bemerkt hätte. Vier Abrufe je Behörde sind billiger als diese Wette.

**Gearbeitet wird über den Ordner, nicht über den Index-Eintrag.** Mehrere
Einträge zeigen auf dieselbe Präsentation: Die Stichwahl vom 26.09.2021 steht
überall im Ordner der Hauptwahl. Ein Ordner ist ein Abruf, nicht zwei.

## Vier Dinge, die eine naive Erhebung falsch macht

**1. Das Datum, unter dem ein Ordner anzusprechen ist, ist nicht immer das
früheste.** Der Poller sucht den Ordner einer Behörde über das Wahldatum
(`findeOrdner`), das Datum muss ihn also eindeutig treffen. Goslar und Melle
führen ihre wiederholte Kommunalwahl (Ordner `0120210912`) sowohl unter dem
26.09.2021 als auch unter dem 03.10.2021 — und am 26.09.2021 liegt im Index
zusätzlich die Bundestagswahl in ihrem eigenen Ordner. Genommen wird deshalb
das früheste Datum, das **nur** auf diesen Ordner zeigt. Ohne diese Regel wäre
für beide Städte die Bundestagswahl als Vorwert der Ratswahl eingelesen worden.

**2. Wiederholungswahlen stehen in eigenen Ordnern, und die Präsentation darin
datiert weiter auf den ursprünglichen Wahltag.** Gifhorn, Goslar, Papenteich,
Peine, Melle und Esens haben Teile ihrer Kommunalwahl am 03.10.2021 wiederholt;
der Ordner heißt `0120210912`, sein `datum_string` sagt „12.09.2021“. Für Peine
heißt das: Im Ordner `20210912` stehen nur Landrats- und Kreistagswahl, Rat,
Bürgermeister und Ortsräte stehen im Wiederholungsordner. Wer nur `20210912`
lädt, hat für die Stadt Peine keine Ratswahl 2021 — und merkt es nicht.

**3. Der Ordner ist nicht überall das Wahldatum.** Vier Schreibweisen kommen
vor: `20210912` (Regelfall), `Wahl-2021-09-12` und `Wahl-2019-09-01`
(Landeshauptstadt Hannover, Nordenham, Salzgitter, Duderstadt), `0120210912`
(Wiederholungswahlen), `2025072201` (Duderstadt, Ortsratswahl 05.10.2025). Auch
`20190526BGM` und `08092019` kommen vor. Geraten lässt sich das nicht.

**4. Das Pfadschema gehört zum Termin **und** zur Behörde.** 208 der Vorwerte
vor 2023 liegen in v26 (`daten/api/`), obwohl das alte Schema erst im Oktober
2022 endete: Das KDO hat viele alte Präsentationen neu erzeugt. Wendeburgs
Bürgermeisterwahl von 2019 antwortet nur unter v26 (`file_version` 24.06.02),
die von Bad Salzdetfurth 2018 nur unter v22. Beide Schemata müssen probiert
werden.

## Ergebnis

**214 der 1 488 Ämter haben ihren Vorwert außerhalb des 12.09.2021**, verteilt
auf **25 zusätzliche Wahltage**. 223 Ämter wurden in einer Stichwahl entschieden;
sie liegt in allen Fällen in derselben Präsentation wie der erste Wahlgang.

Die Tabelle steht in `nds-vorwerte.json`; hier die Zusammenfassung je Wahltag.

| Wahltag | Ordner | Schema | Ämter | Wahlleitungen |
|---|---|---|---|---|
| 2013-09-22 | `20130922` | v26 | landrat 1 | Stadt Hameln |
| 2014-05-25 | `20140525` | v26 | buergermeister 4 | Liebenau, Bleckede, Zeven, Saterland |
| 2017-09-24 | `20170924` | v22 | buergermeister 2 | Langwedel, Berne |
| 2018-12-16 | `20181216` | v22 | buergermeister 1 | Bad Salzdetfurth |
| 2019-05-26 | `20190526` | v26/v22 | landrat 114, buergermeister 47 | 137 |
| 2019-09-01 | `Wahl-2019-09-01` | v26 | buergermeister 1 | Duderstadt |
| 2019-09-15 | `20190915` | v22 | buergermeister 2 | Elm-Asse, Osterode am Harz |
| 2019-12-01 | `20191201` | v26 | buergermeister 1 | Garrel |
| 2020-02-09 | `20200209` | v22 | buergermeister 1 | Bersenbrück |
| 2020-02-23 | `20200223` | v22 | buergermeister 1 | Dissen a. T. W. |
| 2020-09-13 | `20200913` | v22 | buergermeister 1 | Nordstemmen |
| 2020-09-20 | `20200920` | v22 | buergermeister 1 | Elze |
| 2020-10-25 | `20201025` | v22 | buergermeister 1 | Uslar |
| 2020-11-08 | `20201108` | v22 | buergermeister 1 | Hilter a. T. W. |
| 2021-10-03 | `0120210912` | v22 | rat 6, ortsrat 4, buergermeister 4 | 6 (Wiederholungswahlen) |
| 2022-01-23 | `20220123` | v22 | buergermeister 1 | Bodenfelde |
| 2022-02-27 | `20220227` | v22 | kreistag 8, buergermeister 2, rat 1 | 10 |
| 2022-03-06 | `20220306` | v22 | ortsrat 1 | Aerzen |
| 2022-10-09 | `20221009` | v22 | landrat 1 | Landkreis Harburg |
| 2023-03-05 | `20230305` | v26 | buergermeister 1 | Algermissen |
| 2024-06-09 | `20240609` | v26 | ortsrat 1 | Salzhemmendorf |
| 2024-10-27 | `20241027` | v26 | ortsrat 1 | Uslar |
| 2025-02-23 | `20250223` | v26 | buergermeister 1 | Soltau |
| 2025-10-05 | `2025072201` | v26 | ortsrat 1 | Duderstadt |
| 2025-10-12 | `20251012` | v26 | buergermeister 1 | Wietzendorf |
| 2025-12-14 | `20251214` | v26 | ortsrat 1 | Söhlde |

Der 26.05.2019 trägt allein 161 der 214 Ämter. Neun Landkreise — Aurich,
Emsland, Friesland, Grafschaft Bentheim, Holzminden, Lüneburg, Nienburg,
Osnabrück und Verden — haben an dem Tag ihren Landrat gewählt, und weil eine
Kreiswahl in jeder Gemeinde mitgeführt wird, steht sie dort bei jeder Behörde
des Kreises: 114 Landrats-Einträge für neun Wahlen. Dazu 47 Bürgermeisterwahlen,
die vielerorts am selben Tag wie die Europawahl stattfanden.

## Was 2026 keinen Vergleichswert bekommt

**79 Ämter bei 67 Wahlleitungen** haben keinen abrufbaren Vorwert. Das ist fast
immer dieselbe Ursache, und es ist keine Lücke dieser Erhebung: **Der Index
kündigt die Wahl an, die Präsentation ist weg** (beide Pfadschemata 404). 189
solcher Ordner mit kommunalem Namen sind dabei — die Wahlleitungen räumen ihre
alten Termine ab, der Index bleibt stehen.

Die größten Fälle:

- **Landkreis Hameln-Pyrmont**, Landratswahl vom 08.03.2020 mit Stichwahl am
  05.04.2020: Ordner `20200308`, für alle neun Behörden des Kreises 404.
- **Landkreis Schaumburg**, Landratswahl vom 09.09.2018 (`20180909`): dasselbe,
  13 Behörden. Auch die von 2006 ist weg.
- **Region Hannover**, Bürgermeisterwahlen vom 26.05.2019 im Sonderordner
  `20190526BGM` (Burgdorf, Lehrte, Neustadt, Sehnde): weg.
- **Heidekreis**: die ganze Kommunalwahl 2021 — schon vorher bekannt.

Für diese Ämter ist „kein Vergleichswert“ die richtige Auskunft. Etwas anderes
danebenzustellen wäre schlechter als nichts.

## Hannover

Die Frage, die diese Erhebung ausgelöst hat, hat zwei Antworten.

**Landeshauptstadt Hannover (03241001): kein Vorwert für die
Oberbürgermeisterwahl 2026.** Ihr Termin-Index
(`wahlergebnis.hannover-stadt.de/03241001/api/termine.json`, nach 301 auf
`hannover.gov.de`) beginnt mit dem 12.09.2021 und führt genau sieben Einträge.
Die Oberbürgermeisterwahl 2019, bei der Belit Onay in der Stichwahl im November
2019 gewählt wurde, steht **nicht** darin — es gibt keinen Ordner, kein 404,
keinen verwaisten Eintrag, sondern schlicht keinen Hinweis darauf, dass die
Stadt sie je im votemanager geführt hat. Am 12.09.2021 wurde in Hannover kein
Oberbürgermeister gewählt; die Stadt führt dort Rat und Stadtbezirksräte. Für
den 13.09.2026 heißt das: kein Vergleichswert, und zwar dauerhaft, solange
niemand die Zahlen von 2019 von Hand nachträgt. Ein solcher Datensatz ließe sich
anlegen, wäre aber ein Fremdkörper — er käme aus einer anderen Quelle, hätte
keine Wahlbezirke und keine Listenplätze, und die Hochrechnung könnte nichts
damit anfangen. Er ist deshalb bewusst **nicht** eingebaut.

**Region Hannover und ihr Umland.** Die Regionspräsidentenwahl 2026 hat ihren
Vorwert am 12.09.2021 (mit Stichwahl am 26.09.2021) — den lädt das Archiv
ohnehin. Bei den Bürgermeisterwahlen der 20 Umlandkommunen ist das Bild
zweigeteilt:

- **14 haben ihren Vorwert am 12.09.2021** — Burgwedel, Garbsen, Isernhagen,
  Laatzen, Langenhagen, Pattensen, Ronnenberg, Seelze, Springe, Uetze,
  Wedemark, Wennigsen, Wunstorf und Hemmingen. Für sie ist nichts zu tun.
- **Sechs haben außerhalb von 2021 gewählt, und bei allen sechs ist die
  Präsentation verschwunden**: Burgdorf, Lehrte, Neustadt am Rübenberge und
  Sehnde am 26.05.2019 im Sonderordner `20190526BGM`, Barsinghausen am
  01.11.2020 (`20201101`), Gehrden am 25.09.2022 (`20220925`). Alle sechs
  Ordner antworten in beiden Schemata mit 404. Auch für sie gilt: kein
  Vergleichswert.

Erschwerend: 22 der 23 Behörden der Region liefern den 13.09.2026 noch gar nicht
aus (nur die Landeshauptstadt tut es), sodass für sie auch nicht feststeht,
welche Ämter überhaupt zur Wahl stehen — die Erhebung hat dort sicherheitshalber
nach allen fünf gesucht.

## Gegenprobe gegen die echten Server

Drei Fälle, an denen die Auflösung des Fundorts scheitern könnte, sind mit
`scripts/archiv-probe.ts` gegen die Wahlleitungen geprüft — alle drei ohne
Fehler:

| Termin | Behörde | Ordner | Ergebnis |
|---|---|---|---|
| 2019-05-26 | Gemeinde Wendeburg | `20190526` (v26 statt v22) | 2 Wahlen, 28 Gebiete, 37 Anfragen |
| 2019-09-01 | Stadt Duderstadt | `Wahl-2019-09-01` | Bürgermeisterwahl + Stichwahl, 58 Gebiete, 67 Anfragen |
| 2021-10-03 | Stadt Goslar | `0120210912` | Stadtrat, Ortsrat, OB-Wahl + Stichwahl, 236 Gebiete, 2 711 Listenplätze |

Hochgerechnet auf alle 181 Behörden-Termine: rund 10 000 Anfragen, gut eine
halbe Stunde — neben den 64 000 der Kommunalwahl 2021 fällt das kaum ins
Gewicht.

**Nebenwirkung, bewusst in Kauf genommen:** Ein Vorwert-Termin lädt die ganze
Präsentation seines Ordners, also auch, was sonst noch an dem Tag gewählt
wurde. Bei Wendeburg steht deshalb die Europawahl 2019 mit im Bestand. Das ist
amtliche Zahlen der zuständigen Wahlleitung an der richtigen Adresse — sie
herauszufiltern hieße, die Präsentation zu beschneiden, und das wäre die
größere Anmaßung.

## Was offen bleibt

- **39 Behörden ohne 2026er Präsentation** — Region Hannover 21, Heidekreis 12,
  Nienburg 2, dazu je eine in Salzgitter, Göttingen, Harburg und Wesermarsch.
  Für sie ist nicht bekannt, welche Ämter 2026 zur Wahl stehen; die Erhebung hat
  deshalb nach allen fünf gesucht und die gefundenen Vorwerte eingetragen. Die
  in dieser Liste als „ohne Vorwert“ geführten Ämter sind dort **nicht
  belastbar** — sie können schlicht Ämter sein, die es bei dieser Behörde gar
  nicht gibt (die Region Hannover wählt keinen Bürgermeister). Sobald die
  Präsentationen stehen, lohnt ein zweiter Lauf.
- Die Erhebung endet bei Wahltagen ab dem 01.01.2006. Wer 2005 gewählt wurde,
  ist 2026 sicher nicht mehr im Amt.
