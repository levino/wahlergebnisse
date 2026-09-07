# votemanager in Niedersachsen — Eckdaten je Kreis (Stand 07.09.2026)

Erhoben für alle 45 niedersächsischen Kreise (37 Landkreise, 7 kreisfreie Städte,
Region Hannover) auf Basis von `nds-behoerden.json` (416 Behörden aus
`wahlen.votemanager.de/behoerden.json`). Ergebnisdatei: `nds-kreise.json`.

**Kurzfassung: 38 von 45 Kreisen sind für den 13.09.2026 vollständig ausgeliefert**
(90 Wahlen, 256 Open-Data-CSVs). 7 sind es nicht — Details unten.

## Die Behördenliste ist unvollständiger als gedacht

107 der 416 Einträge haben `ags: null`. Das sind durchweg Samtgemeinden, deren
Kennung 9-stellig ist (`03355` + `5401`); sie steht nur in der `url`. Wer nach
`ags` gruppiert, verliert ein Viertel des Landes. Nach Rekonstruktion aus der URL
lassen sich 414 von 416 Einträgen einem Kreis zuordnen (Ausnahmen: „Land
Niedersachsen" 03000000 und Stadt Wolfsburg ohne jede Kennung).

Anders als vermutet **fehlt der Eintrag auf `…000` fast nirgends**: 40 der 43
gefundenen Kreisschlüssel haben ihn. Es fehlen genau vier Kreisbehörden —
Wolfsburg (03103), Celle (03351), Harburg (03353), Uelzen (03360) — und davon
existieren die Präsentationen von Wolfsburg und Harburg auf `votemanager.kdo.de`
trotzdem. Celle und Uelzen tauchen dagegen nirgends auf; sie nutzen offenbar
keinen votemanager.

## Pfadmuster

Einheitlich über alle Hosts:

```
<root>/<ags>/api/termine.json                  ← Terminindex der Behörde
<root>/<YYYYMMDD>/<ags>/daten/api/termin.json  ← v26 (ab ~2023)
<root>/<YYYYMMDD>/<ags>/api/praesentation/…    ← v22 (bis 09.10.2022)
```

Die relativen URLs in `termine.json` (`../20260913/<ags>/praesentation/`) sind
relativ zu `<root>/<ags>/index.html`, also zu `<root>/`, **nicht** zum
`api/`-Verzeichnis. Wer sie naiv gegen die JSON-URL auflöst, landet eine Ebene
zu tief.

`<root>` ist nicht überall die Host-Wurzel. Belegt mit 200ern:

| Host | root | Kreise |
|---|---|---|
| `votemanager.kdo.de` | `/` | 37 (+ Wolfsburg, Harburg als Altbestand) |
| `wahlergebnisse.region-hannover.de` | `/` | Region Hannover |
| `wahlen.kreis-hi.de` | `/wahlen/` | Hildesheim (nur **http**, kein TLS) |
| `wahlen-heidekreis.de` | `/` | Heidekreis |
| `wahlen.hann.muenden.de` | `/prod/` | eine Gemeinde in 03159 |
| `www.nordenham.de` | `/wahl/votemanager/produktiv/` | eine Gemeinde in 03461, nur http |
| `wahlergebnis.hannover-stadt.de` | `/` | Stadt Hannover (in 03241) |

Verifiziert habe ich `api/termine.json` und `daten/api/termin.json` einzeln für
jeden der 45 Kreisschlüssel. Das Muster auf die ~370 Gemeinden desselben Hosts zu
übertragen, ist nicht geprüft, aber durch die identische `root`-Herleitung aus
der `url` in `behoerden.json` gedeckt — mit der Ausnahme Heidekreis (s. u.).

### v22 vs. v26

Alle 2026er Termine laufen auf **v26** (`daten/api/`). Der Umstieg lag zwischen
Oktober 2022 und Juni 2024: für Landkreis Osnabrück liefert `20221009` noch
`api/praesentation/termin.json` (`file_version` 22.09.05.03), `20240609` schon
`daten/api/termin.json` (24.06.03). Das „22er"/„26er" im Sprachgebrauch ist
schlicht das Präfix von `file_version` (Release-Jahr). Wer historische Termine
mitpollen will, braucht beide Schemata; für den 13.09.2026 reicht v26.

## Stand der 2026er Auslieferung

37 der 38 vorbereiteten Kreise stehen auf `file_version` **26.08.03**, fast alle
mit `file_timestamp` 31.08.2026 zwischen 12:39 und 13:03 — offenkundig ein
Massen-Rollout des KDO an einem Nachmittag. Nachgezogen wurden seither nur
Gifhorn und Osterholz (03.09.2026).

**Landkreis Hildesheim ist der Ausreißer**: `26.01.04`, Stand 17.02.2026. Die
eigene Instanz des Kreises hängt gut ein halbes Jahr hinter dem KDO-Stand. Für
den Ausbau heißt das: nicht davon ausgehen, dass alle Instanzen dieselbe
Programmversion sprechen.

Wahlenzahl pro Kreis: meist 2 (Landrats- + Kreiswahl). Ausreißer nach oben sind
kreisfreie Städte mit Bezirksräten — Braunschweig 14 Wahlen und 60 CSVs,
Delmenhorst 4, Wilhelmshaven und Friesland je 3. Nur eine Wahl haben Gifhorn,
Diepholz und Cuxhaven (dort steht 2026 keine Landratswahl an).

## Die sieben Kreise ohne 13.09.2026

- **Region Hannover** — der Termin steht im Index, aber `/20260913/03241000/`
  liefert 404. Angekündigt, nicht ausgeliefert. Gegenprobe auf `20250223`
  funktioniert (v26). Der Host läuft auf Tomcat, nicht Apache; Fehlerseiten sehen
  anders aus als beim Rest. Betrifft 22 Behörden inkl. Stadt Hannover.
- **Heidekreis** — letzter Termin 23.02.2025 (v26, 25.03.01). Zusätzlich ein
  Datenfehler: `behoerden.json` nennt für alle 13 Behörden den Pfad
  `/BEHKK2021/<ags>/`, der 404 liefert. Richtig ist der Host-Root
  `https://wahlen-heidekreis.de/<ags>/`. Das ist der einzige Host, bei dem die
  Behördenliste selbst falsch liegt.
- **Landkreis Harburg** — Präsentation existiert auf `votemanager.kdo.de`, ist
  aber nicht in `behoerden.json`. Letzter Termin 09.06.2024.
- **Stadt Salzgitter** — die in `behoerden.json` genannte eigene Instanz
  (`www.salzgitter.de/wahlen/ergebnisse/`) leitet per 302 auf
  `www2.salzgitter.de` und läuft dort ins 404; obendrein liefert `www2` eine
  unvollständige Zertifikatskette (curl/Node brechen mit Verify-Fehler ab).
  Nutzbar ist nur der KDO-Spiegel, letzter Termin dort 09.10.2022 (v22).
- **Stadt Wolfsburg** — Eintrag ohne AGS, URL `wahlen.wolfsburg.de/praesentation`
  liefert 404 (Root 403, nginx). KDO-Spiegel `03103000` endet 2022.
- **Landkreis Celle, Landkreis Uelzen** — kommen in `behoerden.json` gar nicht
  vor, `votemanager.kdo.de/03351000/` bzw. `/03360000/` sind 404. Kein
  votemanager. Für diese beiden brauchen wir eine andere Quelle oder verzichten.

## Was einen Poller überraschen wird

1. **Kein Verzeichnislisting, nirgends.** Alle 38 geprüften opendata-Verzeichnisse
   antworten mit **403** — sowohl `daten/opendata/` (v26) als auch `kdo.de`,
   `region-hannover.de` und `kreis-hi.de`. Ein Poller, der die CSVs über einen
   Apache-Autoindex findet, findet in ganz Niedersachsen nichts.
   **`open_data.json` ist der einzige Weg** und ist bei allen 38 vorhanden
   (`daten/opendata/open_data.json`, mit `csvs[].url` relativ zu diesem
   Verzeichnis). Das sollte der Discovery-Pfad werden.
2. **`file_timestamp` ist kein ISO-Datum**: `"31.08.2026 13:00:35 755"` —
   DD.MM.YYYY, Uhrzeit, Millisekunden durch Leerzeichen getrennt. Ebenso
   `datum_string: "13.09.2026"`. Beides muss deutsch geparst werden.
3. **`seitentitel` ist teils fehlerhaft** — z. B. „Kommunalwahlen 2026 2026 -
   Wahlenübersicht" (Landkreis Osnabrück). Nicht als Anzeigename verwenden.
4. **Cache-Busting ist eingebaut**: die Präsentation hängt an jede Ergebnis-JSON
   ein `?ts=<epoch>`. Ohne das liefern manche Instanzen alte Stände aus dem
   Zwischenspeicher.
5. **http statt https** bei Hildesheim (`wahlen.kreis-hi.de`) und Nordenham.
   Ein Client mit erzwungenem HTTPS verliert 19 bzw. 1 Behörde.
6. **TLS-Kette kaputt** bei `www2.salzgitter.de`.
7. **Kreis und Gemeinden auf verschiedenen Hosts**: 03159 (Hann. Münden), 03241
   (Stadt Hannover), 03461 (Nordenham). Der Host darf nicht pro Kreis fest
   verdrahtet werden, sondern muss pro Behörde aus `behoerden.json` kommen.

## Kartenebenen (`geografik_ebenen`)

Wie erwartet fast überall leer. **Drei Ausnahmen**, jeweils für alle Wahlen des
Kreises:

- **Stadt Braunschweig** (03101000) — alle 14 Wahlen, 37 Ebenen-IDs
- **Landkreis Holzminden** (03255000) — `[-1907, -1906, 3]`
- **Landkreis Leer** (03457000) — `[-4436, -4435, -4430, 3]`

Das Feld steht in `<termin>/<ags>/daten/api/wahl_<id>/wahl.json`, nicht in
`termin.json`. Geprüft habe ich pro Kreis die ersten drei Wahlen, bei Braunschweig
und Delmenhorst zusätzlich alle übrigen.

## Nachtrag 07.09.2026: die Kommunalwahl 2021

Für den Archivausbau wurde der Termin-Index aller 45 Kreisbehörden noch einmal
abgerufen und der Eintrag zum **12.09.2021** herausgezogen
(`nds-termine-2021.json`, Erzeuger siehe `scripts/archiv-probe.ts` für die
Gegenprobe am Bestand).

**41 der 45 Kreise nennen den 12.09.2021, 40 liefern ihn auch aus.** Es fehlen
Salzgitter und Wolfsburg (im Index steht 2021 nur die Bundestagswahl) sowie
Celle und Uelzen (kein votemanager). Der **Heidekreis kündigt den Termin an und
hat die Dateien nicht mehr** – beide Pfadschemata 404, während sein 23.02.2025
antwortet. Der Index allein ist also keine Zusage; jeder Eintrag ist gegen die
`termin.json` der Kreisbehörde gegengeprüft. Bemerkenswert: Region Hannover und
Harburg haben die Kommunalwahl 2021, obwohl ihnen der 13.09.2026 fehlt.

**Der Name taugt nicht als Schlüssel.** Derselbe Wahltag heißt
„Kommunalwahlen", „Kommunalwahl", „Kreiswahl", „Kreiswahl 2021", „Wahl des
Kreistages", „Kreistagswahl", „Kreistags- & Landratswahl 2021", „Landratswahl /
Kreiswahl", „Stadtratswahl", „Allgemeine Kommunalwahlen 2021", „Kommunalwahlen
am 12.09.2021", „Kreiswahl 12.09.2021" – und bei Wilhelmshaven steht als
einziger Eintrag des Tages „Wahl zum Seniorenbeirat der Stadt Wilhelmshaven".
Gesucht wird deshalb über das Datum.

**Der Ordner ist auf Kreisebene überall `20210912`** – aber nicht auf
Behördenebene: Die Landeshauptstadt Hannover (03241001) führt ihre Termine
unter `Wahl-2021-09-12` bzw. `Wahl-2026-09-13`. Deshalb wird der Ordner je
Behörde aus deren eigenem Index gelesen, nicht vom Kreis übernommen.

**Auch das Schema gehört zur Behörde.** 2021 ist fast überall v22; **drei
Kreisbehörden sprechen v26**: Braunschweig (03101000), Region Hannover
(03241000) und Holzminden (03255000). Nachgeprüft je Kreis, nicht angenommen –
und zur Laufzeit noch einmal je Behörde, weil eine Gemeinde ein anderes Schema
haben kann als ihr Kreis.

**`open_data.json` liegt je Schema woanders**: v22 unter
`…/api/praesentation/open_data.json`, v26 unter
`…/daten/opendata/open_data.json`. Für v26 (also für den ganzen 13.09.2026)
wurde sie bis dahin an der falschen Stelle gesucht – ohne sie gibt es keine
Listenplätze der Bewerber.

**Was ein Archivlauf kostet** (gemessen gegen die echten Server): Peine und
Holzminden zusammen (15 Behörden) 2 369 Anfragen in 590 s, ohne Fehler – 64
Wahlen, 1 935 Gebiete, 96 Sitzverteilungen, 24 212 Listenplätze, 14 MB
Datenbank. Also rund 160 Anfragen und 0,9 MB je Behörde; für die 402 Behörden
der 40 Kreise etwa 64 000 Anfragen und 380 MB. Region und Stadt Hannover
zusammen (2 Behörden) 765 Anfragen und 4,1 MB.
