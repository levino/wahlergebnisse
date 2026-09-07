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
und `<wurzel>/<ordner>/<ags>/daten/api/…` für einen Termin. Weder die Wurzel
noch der Ordner noch das Schema lassen sich raten:

- **Der Ordner ist meist das Wahldatum, aber nicht immer.** Die
  Landeshauptstadt Hannover führt ihre Termine unter `Wahl-2026-09-13` und
  `Wahl-2021-09-12`. Wer `20260913` einsetzt, verliert sie am Wahlabend.
- **Das Schema gehört zur Behörde, nicht zum Jahr.** Die Region Hannover hat
  ihre 2021er Präsentation mit neuer Programmversion neu erzeugt und liefert
  sie unter `daten/api/` aus, während sie überall sonst unter
  `api/praesentation/` steht — und ebenso Braunschweig und Holzminden, deren
2021er Präsentationen beim KDO ebenfalls v26 sprechen.
- **`open_data.json` liegt in v22 bei der API, in v26 bei den CSVs**
  (`…/daten/opendata/open_data.json`). In v26 bei der API gesucht, gibt es
  404 – und damit keine Parteizuordnung zu den Spalten D1, D2, … und keine
  Listenplätze der Bewerber.

Deshalb löst der Poller den Fundort je Behörde über deren Termin-Index auf und
merkt ihn sich (`fundort:<termin>:<ags>` in `meta`, so lange wie eine
Strukturdatei). Gesucht wird über das **Wahldatum**, nicht über den Namen: Der
12.09.2021 heißt je nach Kreis „Kommunalwahlen“, „Kreiswahl 2021“, „Wahl des
Kreistages“ oder – bei Wilhelmshaven als einziger Eintrag des Tages – „Wahl
zum Seniorenbeirat“.

Die Wurzel ist ebenfalls nicht überall die Host-Wurzel:

| Wurzel | Kreise |
|---|---|
| `https://votemanager.kdo.de/` | 40 |
| `https://wahlergebnisse.region-hannover.de/` | Region Hannover |
| `http://wahlen.kreis-hi.de/wahlen/` | Hildesheim |
| `https://wahlen-heidekreis.de/` | Heidekreis |

**Die Wurzel gehört zur Behörde, nicht zum Kreis.** Bei drei Kreisen (03159,
03241, 03461) liegen Kreis und Gemeinden auf verschiedenen Hosts.

**Alle 2026er Termine sind v26** (`daten/api/`). Das alte Schema
(`api/praesentation/`) endet mit dem 09.10.2022 und wird noch für Archive
gebraucht – mit drei Ausnahmen: Braunschweig, Region Hannover und Holzminden
liefern ihre 2021er Präsentation schon in v26 aus. Geraten wird nichts: Schlägt das erwartete Schema fehl,
obwohl der Index den Wahltag kennt, probiert der Poller einmal das andere und
merkt sich das Ergebnis.

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

**Nicht alle sind erreichbar — aber „nicht vorhanden" ist kein Dauerzustand.**
Fünf Kreise hatten den 13.09.2026 am 07.09.2026 nicht angelegt (darunter die
Region Hannover mit 22 Behörden, deren Termin im Index steht, aber 404
liefert). `Kreis.vorhanden` im Katalog hält diesen Tag fest; es ist die
Ausgangsannahme, nicht die Wahrheit. Maßgeblich ist, was ankommt:

- Der Poller sieht bei einem Kreis ohne Daten **einmal je Viertelstunde** nach
  (eine Anfrage an die `termin.json` seiner Kreisbehörde) und führt ihn ab dem
  Augenblick normal weiter, in dem etwas kommt — im selben Lauf, nicht erst im
  nächsten. Am Wahlabend muss deshalb niemand ausrollen, damit ein Kreis
  auftaucht.
- Die Marke wird nie wieder gelöscht: Ein Server, der eine Weile schweigt,
  macht aus einem Kreis kein „liegt nicht vor".
- Die Anzeige richtet sich nach dem Bestand (`kreisVorhanden` in
  `src/lib/abfragen.ts`): Wo Zeilen in der Datenbank stehen, gibt es Zahlen zu
  sehen — unabhängig davon, was der Katalog einmal annahm.

**Celle und Uelzen benutzen gar keinen votemanager** und stehen in keinem der
3 174 Einträge des bundesweiten Verzeichnisses. Sie haben keine Behörde im
Katalog, werden nie angefragt und sagen das dauerhaft so. Für Wolfsburg und
Harburg ist umgekehrt die Kreisbehörde nachgetragen, obwohl sie in
`behoerden.json` fehlt: Ihre Präsentation antwortet auf `votemanager.kdo.de`,
also gibt es eine Stelle, an der nachgesehen werden kann.

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

**Der Wahl-Slug ist der Wahltyp, bei Bedarf mit Gebiet.** `kreistag`,
`landrat`, `buergermeister` und `rat` reichen, solange eine Behörde von jeder
Art nur eine Wahl führt. Eine Samtgemeinde wählt aber auch den Rat jeder
Mitgliedsgemeinde, eine Stadt jeden Ortsrat: Dann tritt der Gebietsname hinzu
(`rat-dahlum`, `ortsrat-roessing`). Ob das Gebiet ein anderes ist als das der
Behörde, entscheidet der Vergleich mit dem Behördennamen — deshalb heißt die
Nordstemmer Gemeindewahl weiter `rat` und die Duinger innerhalb der
Samtgemeinde Leinebergland `rat-duingen`.

Den Gebietsnamen liefert keine Quelle allein. Northeim schreibt in den
Gebietsnamen aller vierzehn Ortsratswahlen der Stadt Dassel „Ergebnis“,
Braunschweig bei allen dreizehn Stadtbezirksräten „Stadt Braunschweig“, und
Wolfenbüttel „der Gemeinde Dahlum“; Hildesheim lässt umgekehrt den Ortsnamen im
Wahltitel weg. `wahlGebiet()` in `src/lib/wahltyp.ts` nimmt deshalb den
Gebietsnamen, den Titelkern und den Mittelteil des Titels der Reihe nach und
streicht aus jedem das Wahl-Vokabular heraus. Bleiben zwei Wahlen danach immer
noch namensgleich — Lemwerder führt seine Landratswahl doppelt —, hängt
`wahlSlugs()` die Wahl-Id an. Sie steht in der Präsentation der Wahlleitung und
übersteht ein Neubefüllen der Datenbank; eine laufende Nummer täte das nicht.

**Eine Behörde je Name und Kreis.** Goslar führt „Stadt Langelsheim“ zweimal:
`03153007` ist die alte Instanz ohne Kommunalwahl 2026, `03153019` trägt die
Daten. Der stillgelegte Schlüssel steht in `STILLGELEGT`
(`scripts/kreise-erzeugen.ts`) und fällt aus dem Katalog — sonst wäre
`/goslar/2026/langelsheim/` eine Sackgasse und die gesuchte Seite versteckte
sich hinter `langelsheim-2`. Nicht gemeint sind Behörden, die den Termin nur
noch nicht angelegt haben: Die bleiben sichtbar und heißen „liegt nicht vor“.

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
Apache-Instanzen ohne CDN sind. Bedingte Abfragen (ETag) bleiben Pflicht.

**Gedeckelt wird je Host, nicht je Kreis.** Die Last fällt beim Server an, und
die 371 abfragbaren Behörden verteilen sich sehr ungleich: 350 auf
`votemanager.kdo.de` (CDN davor), 19 auf `wahlen.kreis-hi.de` (Apache ohne
CDN), zwei einzelne auf eigenen Hosts. Ein Deckel je Kreis behandelt beide
gleich und trifft damit keinen von beiden richtig. Deshalb hat jeder Host ein
Anfragenkonto (`src/lib/drossel.ts`): 60 Anfragen je Sekunde beim KDO, 10 bei
allen anderen. Wer zu schnell ist, wartet — der Poller wird langsamer, nicht
die Wahlleitung.

**Der Takt darf deshalb eng sein.** Die erste Fassung hat den übrigen Kreisen
am Wahlabend 900 Sekunden gegeben und an gewöhnlichen Tagen einen ganzen Tag.
Das war an der falschen Stelle vorsichtig: Ein Kreis, den gerade niemand
ansieht, kann jede Sekunde geöffnet werden, und wer um 20:05 Uhr Zahlen von
19:50 Uhr sieht, hält die Seite für kaputt. Jetzt gilt am Wahlabend 60 Sekunden
für den betrachteten Kreis und 180 für alle übrigen; am Wahltag davor 300/1800,
sonst 900/21600. Die Rechnung — Anfragen je Lauf, je Sekunde, je Host — steht
im Kopfkommentar von `src/lib/takt.ts` und wird von
`src/lib/wahlabend-takt.test.ts` nachgerechnet.

**Der Deckel je Lauf bleibt**, aber mit einer anderen Aufgabe: Er verteilt
einen Rückstand (Neustart, Störung) über mehrere Minuten und hält die 38
Kreise am Wahlabend in drei gleich großen Gruppen, statt sie in jedem dritten
Lauf zusammenfallen zu lassen. Altern lässt er die Daten nicht mehr.

**Geprobt wird der Abend mit mehreren Kreisen gleichzeitig.**
`test/wahlabend-viele-kreise.test.ts` spiegelt die Hildesheimer Fixtures in
weitere Kreise, lässt den Mock in allen gleichzeitig melden und prüft
Ergebnisse, Ticker und den Fall eines Kreises ganz ohne Präsentation;
`e2e/wahlabend.e2e.ts` tut dasselbe im Browser.
Apache-Instanzen ohne CDN sind. Deshalb gestaffelt: der Kreis, den gerade
jemand ansieht, häufig; die übrigen selten; am Wahlabend alle. Bedingte
Abfragen (ETag) bleiben Pflicht.

## Was die Übersicht zeigt

**Kreisfreie Städte haben keine Kreiswahlen und keine Gemeinden.** Sieben der
45 Kreise sind kreisfreie Städte: Ihre einzige Wahlleitung ist zugleich die
Kreisbehörde, gewählt werden Oberbürgermeister, Rat und die Ortsräte bzw.
Stadtbezirksräte. Die Startseite eines Termins sucht deshalb nicht mehr nach
Landrat und Kreistag, sondern zeigt als Karten schlicht **die Wahlen der
Kreisbehörde** — beim Landkreis sind das Landrat und Kreistag, bei der Stadt
Oberbürgermeister und Rat. Ortsratswahlen stehen darunter als Liste, Gemeinden
nur dort, wo es welche gibt. Emden liegt als kreisfreie Stadt in den Fixtures;
ohne sie prüfte das nie jemand.

**Gekürzte Listen werden vorher sortiert.** Die Wahlpräsentation liefert die
Parteien in Stimmzettel-Reihenfolge, nicht nach Anteil. Wo die Anzeige auf
fünf oder sechs Einträge kürzt (Übersichtskarten, Behördenseite, Ticker),
stünde sonst die falsche Partei da — in 11 von 106 geprüften Wahlen war das
so. Die vollständigen Balken einer Wahlseite behalten die amtliche
Reihenfolge.

**Direktwahlen haben ihren Vorwert außerhalb der Kommunalwahl.** Die Seite
stellt jedes Ergebnis neben die passende frühere Wahl. Für Räte, Kreistage und
Ortsräte ist das überall der 12.09.2021 – die laufen im gemeinsamen Takt.
Bürgermeisterinnen, Bürgermeister, Oberbürgermeister und Landräte nicht: Ihre
Amtszeiten sind eigene, und die letzte Wahl liegt je nach Kommune 2013, 2019,
2022 oder 2025. Erhoben ist das je Behörde und je Amt
(`scripts/vorwerte-erheben.ts` → `scripts/quellen/nds-vorwerte.json`,
beschrieben in `scripts/quellen/vorwerte.md`): **214 der 1 488 Ämter haben
ihren Vorwert außerhalb des 12.09.2021**, verteilt auf 25 zusätzliche Wahltage.
Ohne sie stünde neben der Bürgermeisterwahl 2026 entweder nichts oder – über
den Rückfall auf den nächstälteren Termin – die Ratswahl 2021.

Daraus entstehen 25 erzeugte Termine (`src/data/vorwert-termine.ts`), und die
Zuordnung steht **je Behörde** in `Behoerde.archive`, nicht beim Kreis: Am
26.05.2019 hat der Landkreis Emsland seinen Landrat gewählt und acht seiner
Gemeinden zusätzlich ihren Bürgermeister, die übrigen keine einzige Wahl. Der
Poller fragt deshalb `terminGiltFuerBehoerde` und nicht nur `terminGiltFuer`;
sonst holte er sich für zwei Drittel der Behörden ein 404 ab und hielte den
Kreis wegen der Fehler nie für vollständig. Der Archivlauf wächst dadurch um
181 Behörden-Termine. Gemessen gegen die echten Server: 37 Anfragen für die
Bürgermeisterwahl Wendeburg 2019, 67 für Duderstadt 2019 mit Stichwahl, und
etwa 160 für eine der sechs wiederholten Kommunalwahlen vom 03.10.2021. Macht
rund 10 000 Anfragen zusätzlich zu den 64 000 für 2021 – gut eine halbe Stunde.

**Der Vergleich sucht nach dem Amt, nicht nach der Wahlart** (`amtVon` in
`src/lib/wahltyp.ts`, angewandt in `ladeWahlSeite`). Haupt- und Stichwahl
besetzen denselben Posten; wer für die Stichwahl 2026 nach einem früheren
Termin *mit Stichwahl* suchte, überspränge eine Wahl, die im ersten Wahlgang
entschieden wurde, und landete Jahre weiter hinten. Welche Zahlen dann
verglichen werden, entscheidet weiterhin der Wahltyp – gibt es im gefundenen
Termin keinen zweiten Wahlgang, bleibt die Anzeige ohne Vergleichszahlen.

**Und wo es wirklich keinen gibt, steht das da.** 79 Ämter bei 67
Wahlleitungen haben keinen abrufbaren Vorwert, fast immer aus demselben Grund:
Der Termin-Index kündigt die Wahl an, die Präsentation ist weg (beide Schemata
404) – so beim Landkreis Hameln-Pyrmont (Landratswahl 08.03.2020), beim
Landkreis Schaumburg (09.09.2018) und bei den Bürgermeisterwahlen der Region
Hannover im Sonderordner `20190526BGM`. Die Landeshauptstadt Hannover ist der
Sonderfall darunter: Ihr Index beginnt mit dem 12.09.2021, die
Oberbürgermeisterwahl 2019 hat sie nie im votemanager geführt. Statt zu
schweigen sagt die Wahlseite dort „Kein Vergleichswert“
(`src/components/WahlSeite.astro`) – eine Seite ohne Veränderungswerte sah
sonst aus wie eine, bei der etwas kaputt ist.

**Kein neuer DATENSTAND.** Die Ableitung aus vorhandenen Quelldateien ändert
sich nicht; es kommen nur Termine dazu. Neue Termine haben noch keine
`vollstaendig`-Marke und werden beim nächsten Start von `ladeArchiv` von selbst
geholt (`server/main.ts`). Den Stand zu erhöhen hätte das Archiv 2021 ohne
Grund noch einmal eingelesen – vier Stunden für nichts.

**Ein Termin gilt nur für die Kreise, für die es ihn gibt.** Welche Wahltage
eine Wahlleitung führt, steht in ihrem Termin-Index; für die Archivtermine ist
das je Kreis erhoben und steht im Katalog (`Kreis.archive`, Quelle
`scripts/quellen/nds-termine-2021.json`). Die Kommunalwahl 2021 gibt es in 40
der 45 Kreise — nicht in Salzgitter und Wolfsburg (nie angelegt), nicht in
Celle und Uelzen (kein votemanager) und nicht im Heidekreis, der sie in seinem
Index ankündigt, die Dateien aber nicht mehr hat. Der Index allein reicht
deshalb nicht: Es zählt nur, was die Gegenprobe bestätigt — ein Termin, der
angeboten wird und nichts zeigt, ist schlimmer als keiner. Die
Bürgermeisterwahl Nordstemmen 2020 steht dagegen nicht mehr beim Kreis, sondern
bei der Gemeinde (`Behoerde.archive`) – sie war immer der Vorwert einer
einzigen Wahlleitung, und als Kreistermin fragte der Poller neunzehn Behörden
nach einer Wahl, die es bei achtzehn von ihnen nie gab.

**Ein Termin erscheint auf der Ebene, auf der er stattfindet.** Das ist die
Regel für alles, was Termine anzeigt oder über sie Auskunft gibt, und
`src/data/termine.ts` stellt dafür drei Fragen bereit:

- `terminGiltFuerKreis` – **Kreisebene**: Kreisseite, Kopfzeile dort,
  Terminseiten `/<kreis>/<termin>/`, die kreisweiten Endpunkte. Es zählt
  allein, was die **Kreisbehörde** führt: die Kommunalwahl und, wo es sie
  gibt, ihre eigene Landrats- oder Oberbürgermeisterwahl (Emsland,
  26.05.2019). Eine Bürgermeisterwahl einer Gemeinde ist kein Kreistermin.
- `terminGiltFuerBehoerde` – **Behördenebene**: Seiten und Kopfzeile unter
  `/<kreis>/<termin>/<behoerde>/…` und alles, was der Poller abfragt.
- `terminGiltIrgendwoImKreis` – die grobe Frage, ob überhaupt jemand im
  Kreisgebiet den Termin führt. Nur zwei Dinge stellen sie: der Poller, wenn
  er entscheidet, ob ein Kreis in einem Lauf vorkommt, und eine
  Fehlermeldung, die auf die richtige Ebene weiterweist.

Vorher gab es nur die grobe Frage. Seit die 25 Vorwert-Termine dazukamen, bot
die Kopfzeile von `/hildesheim/` sieben Wahltage an, fünf davon Wahlen einer
einzigen Gemeinde, und `/hildesheim/2023-03-05/` stand mit der Überschrift
„Betroffene Kommunen“ da, ohne eine zu nennen.

Die Kreis-Terminseite eines Gemeinde-Wahltags gibt es deshalb nicht mehr. Wo
genau **eine** Wahlleitung ihn führt (39 der 47 Fälle), leitet die Adresse zu
ihr weiter (302) – sie war eine Weile im Umlauf, und ein Umweg ist besser als
eine Sackgasse. Wo mehrere ihn führen (acht Fälle), meint sie keine bestimmte
Seite: 404 wie bei jedem unbekannten Termin. Auf einer Behördenseite verweist
die Kopfzeile auf die Behördenseite desselben Termins, nicht über die
Kreisseite.

Schnittstelle und MCP folgen derselben Regel. `/api/v1/<kreis>` nennt unter
`termine` die kreisweiten Wahltage und je Wahlleitung unter
`behoerden[].termine` die, die nur sie führt; ein kreisweiter Aufruf mit einem
Gemeinde-Wahltag antwortet 404 und sagt im Hinweis, bei welcher Wahlleitung er
liegt. `/api/v1/<kreis>/<termin>/wahlen?behoerde=…` und alle
`…/<behoerde>/…`-Endpunkte prüfen auf der Behördenebene. Im MCP trennt
`wahltermine` die Listen (`termine` und `weitereTermine` mit `nurBei`), und
`lueckeHinweis` nennt die Wahlleitung, statt bloß „gibt es hier nicht“ zu
sagen.

Was sich dabei **nicht** ändert: die Vergleichslogik. `ladeWahlSeite` sucht den
Vorwert eines Amtes über `terminGiltFuerBehoerde` und `amtVon`, also über die
Wahlleitung und nicht über die Kopfzeile – die Bürgermeisterwahl 2026 in Bad
Salzdetfurth steht weiter neben der vom 16.12.2018 (`test/vorwerte.test.ts`).

Bemerkenswert: Region Hannover und Harburg haben zwar den 13.09.2026 noch
nicht, ihre Kommunalwahl 2021 aber sehr wohl. Gerade dort ist das Archiv
vorerst das Einzige, was es zu zeigen gibt — deshalb hängt der Archivlauf nicht
an `vorhanden`.

**Wie das Archiv eingelesen wird.** Kreis für Kreis, mit zwei Behörden
gleichzeitig statt sechzehn, mit einem eigenen Anfragenkonto von vier je
Sekunde und Host (zusätzlich zu dem, das für alle gilt), und mit Rückzug,
solange ein Live-Lauf unterwegs ist. Gemessen an den echten Servern kostet eine
Behörde rund 160 Anfragen; für die 402 Behörden der 40 Kreise sind das etwa
64 000, davon 56 000 beim KDO — also rund vier Stunden, weil die übrigen Hosts
nebenher laufen und in Minuten fertig sind. Der Bestand wächst dabei um rund
380 MB (gemessen: 14 MB für 15 Behörden). Fertige Kreise werden vermerkt
(`termin:<id>:kreis:<slug>:vollstaendig`), ein Neustart mitten im Lauf beginnt
deshalb beim nächsten offenen Kreis und nicht von vorn.
