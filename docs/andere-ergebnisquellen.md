# Kreise ohne votemanager beim KDO

Stand 07.09.2026, jede Angabe mit einem Abruf belegt (Status und Größe).
Wiederholen: `node --experimental-strip-types scripts/quellen-probe.ts`.

## votemanager auf eigenen Rechnern

Nur die Wurzel weicht ab; korrigiert in `BASIS_KORREKTUR`
(`scripts/kreise-erzeugen.ts`).

| Kreis | Wurzel | Termin-Index | 13.09.2026 |
|---|---|---|---|
| **Wolfsburg** (03103000) | `https://wahlen.wolfsburg.de/` | 200, 1 647 B | liegt vor – `20260913/03103000/daten/api/termin.json` → 200, 3 740 B |
| **Salzgitter** (03102000) | `https://wahlen.salzgitter.de/ergebnisse/` | 200, 2 125 B | noch 404, wird erst am Wahlabend freigeschaltet |
| **Heidekreis** (03358000) | `https://wahlen-heidekreis.de/` | 200, 1 937 B | noch 404 |

- **Wolfsburg** fehlt in `behoerden.json` und stand deshalb auf dem KDO-Spiegel,
  der 2022 endet.
- **Salzgitter**: `behoerden.json` nennt `www.salzgitter.de/wahlen/ergebnisse/`,
  das mit 302 auf einen toten Pfad antwortet. Die Landing Page
  `wahlen.salzgitter.de/` trägt im Quelltext ein `wahlergebnisseAktiv = false`;
  zu erwarten ist dann `ergebnisse/Wahl-2026-09-13/03102000/praesentation/`.
- **Heidekreis**: Die 2021er Dateien liegen unter einem Präfix-Ordner, der Index
  verweist weiter auf den alten Pfad (`/20210912/…` → 404). Abrufbar ist
  `KW2021/20210912/03358000/praesentation/index.html` (200, 16 705 B).
- **Region Hannover**: normaler votemanager, Termin im Index, Verzeichnis noch
  404. Die Landeshauptstadt (03241001, eigener Host
  `wahlergebnis.hannover-stadt.de`) hat ihren Teil freigeschaltet.
- **Harburg** (03353000): KDO-Spiegel, letzter Termin Juni 2024.

## Celle und Uelzen: IVU statt votemanager

Beide sind untereinander gleich aufgebaut; Celle beherbergt auch die gemeinsame
Bundestagswahl-Präsentation „Celle-Uelzen". Seit dem 12.09.2026 sind beide
angebunden – über `src/lib/ivu.ts` und `pollIvuKreis` in `src/lib/poll.ts`. Im
Katalog steht je Kreis nur das Verzeichnis je Wahl (`ivu` in
`src/data/kreis-katalog.ts`); alles Weitere kommt aus der Quelle.

| Kreis | Präsentation 13.09.2026 | Gebiete |
|---|---|---|
| **Uelzen** | `wahlen.landkreis-uelzen.de/ktw2026/` und `…/lrw2026/` | 216 (Kreistag), 212 (Landrat) |
| **Celle** | `wahl.landkreis-celle.de/ivu/kw2026/kreistagswahl/` und `…/kw2026/landrat/` | 345 (Kreistag), 294 (Landrat) |

Celles Adresse steht auf keiner öffentlichen Seite: Die verlinkende CMS-Seite
wird erst am Wahlabend freigeschaltet, `/ivu/` gibt kein Verzeichnis her, und
Wayback kennt `kw2026` nicht. Gefunden über den Link-Umleiter des iKISS-CMS:
`www.landkreis-celle.de/redirect.phtml?extlink=1&La=1&url_fid=3314.<N>.1`
antwortet mit 302 auf das Ziel; die 2026er Einträge liegen bei N = 1457…1490.
Dasselbe Verfahren liefert später die Adresse der Stichwahl. Ein Verzeichnis
`bgm_ber` (Bürgermeisterwahl Bergen) ist verlinkt, aber noch 404.

So liest der Adapter die Quelle:

- `ergebnisse.html` ist der Zwilling einer Gebietsseite aus dem Index; ihr
  `data-suchindex-url` nennt `idx_ergebnisse_gebiet_auswahl_<zahl>.json` mit
  jedem Gebiet (Schlüssel, Name, Seite).
- Je Gebiet eine Seite `ergebnisse_<typ>_<schlüssel>.html`. Die Zellen der
  Tabelle „Stimmen tabellarisch" tragen in `data-sort` den Rohwert in voller
  Genauigkeit (`35.5757002159`), dazu Kürzel, Langname (`abbr title`) und Farbe;
  darunter Stimmberechtigte, Wähler, Ungültige, Gültige.
- Die Verschachtelung steht als „Untergeordnete Gebiete" auf jeder Seite. Die
  Gemeinden haben keine eigene Präsentation, deshalb hängen alle Gebiete an der
  Kreisbehörde; die Gebiets-Ids tragen den Schlüssel der Wahlleitung
  (`ebene_6_id_03360025b_46`, `ebene_6_id_03351012-01-101`).
- Gebietsschlüssel sind AGS-nah, aber uneinheitlich: Uelzen achtstellig
  (`03360025`), Celle ohne führende `03` (`351012` = Hambühren) und mit eigenen
  Nummern für die geteilte Stadt Celle (`3510061`/`3510062`). Celle führt
  zusätzlich Ortschaften, Uelzen nicht.

Was die Quelle nicht hergibt und was deshalb unbekannt bleibt:

- **Stimmen je Bewerber.** Die Wahlvorschläge nennen nur Nummer und Namen; die
  Listenplätze stehen, die Stimmenzahl bleibt leer (`Kandidat.stimmen`
  entfällt). 2021 war es genauso.
- **„x von y ausgezählt".** Der Kopf trägt nur einen Status-Text – heute „Kein
  Eingang", 2021 „Endergebnis". Der Text wird unverändert übernommen; `anz` und
  `max` zählt der Adapter aus den Wahlbezirken, die die Quelle unter dem Gebiet
  verlinkt.
- **Zahlen vor dem ersten Eingang.** Bei „Kein Eingang" schreibt IVU überall
  eine 0, auch bei den Stimmberechtigten. Das Gebiet gilt dann als `leer`;
  Parteien und Kennzahlen bleiben weg, statt Nullen zu behaupten.

Sitze gibt es erst mit dem Ergebnis: Die Tabelle „Gewählte" nennt Person,
Partei und Stimmen; die Sitzverteilung zählt der Adapter daraus ab.

Daneben liegen `parteistimmen.csv`, `gesamtergebnis.csv`,
`kandidatenstimmen.zip` im Schema des votemanager-Exports.
**Uelzens `parteistimmen.csv` ist eine Attrappe** – eine Zeile mit runden
Testwerten (597 B); echte Zahlen stehen nur im HTML. Deshalb liest der Adapter
ausschließlich HTML.

### Takt

Die Kreisseite jeder Wahl wird bedingt nachgefragt; IVU schreibt die
Präsentation in einem Zug, deshalb heißt „an der Wurzel nichts Neues" auch
„darunter nichts Neues". Im Ruhezustand kostet ein Lauf also **zwei Anfragen je
Kreis** (eine je Wahl). Ändert sich die Wurzel, kommen zuerst die Gebiete
oberhalb der Wahlbezirke (Uelzen 35, Celle 76 je Wahl); die Wahlbezirke zieht
nur nach, wessen eigene Gebietsseite sich geändert hat. Obergrenze bei einer
Veröffentlichung, in der sich alles ändert: 218 + 214 Anfragen für Uelzen,
347 + 296 für Celle. Gleichzeitig laufen davon `POLL_IVU_PARALLEL` (6); die
eigentliche Bremse ist die Warteschlange je Host, die sich am Antwortverhalten
des Servers nachregelt.

## TLS: unvollständige Kette bei Celle

`wahl.landkreis-celle.de` schickt sein Zertifikat und das Zwischenzertifikat
„Sectigo Public Server Authentication CA DV R36", dessen Aussteller „Sectigo …
Root R46" aber nicht mit. `curl` bricht deshalb ab
(`verify error:num=20`, HTTP 000), **Node kommt durch** – R46 steht in seinem
eingebauten Wurzelspeicher, nur nicht in Debians `ca-certificates`. Ein
fehlgeschlagener Abruf heißt hier also „mein Werkzeug kommt nicht heran", nicht
„der Server hat nichts".

`scripts/tls-probe.ts` prüft alle 13 Hosts des Katalogs mit Nodes Speicher.

Für `curl` und `openssl` das fehlende Glied nachreichen statt `-k`:

```sh
curl -sO http://crt.sectigo.com/SectigoPublicServerAuthenticationRootR46.p7c
openssl pkcs7 -inform DER -in SectigoPublicServerAuthenticationRootR46.p7c \
  -print_certs -out r46.pem
cat /etc/ssl/certs/ca-certificates.crt r46.pem > bundle.pem
curl --cacert bundle.pem https://wahl.landkreis-celle.de/...
```

## Landesweite Gegenprobe

`wahlen.statistik.niedersachsen.de/KW2021/` liefert flächendeckend
`kreiswahlergebnis.csv` (200, 9 885 B, alle 45 Kreise mit Stimmen und Sitzen) und
`wahlergebnis.xml` (200, ~2,1 MB) – nur Kreisebene. `KW2026/` gibt es noch nicht.
