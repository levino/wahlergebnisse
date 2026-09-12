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
Bundestagswahl-Präsentation „Celle-Uelzen".

| Kreis | Fundort | Umfang |
|---|---|---|
| **Celle** | `wahl.landkreis-celle.de/ivu/kreis2021_celle/` (200, 292 103 B) und `…/ivu/kreis_wiederholung_2022/` (200, 292 678 B) | Kreiswahl 2021, Wiederholungswahl 2022 |
| **Uelzen** | `wahlen.landkreis-uelzen.de/kw2021/kt/` (200, 69 051 B) | nur Kreistagswahl 2021 |

- `idx_ergebnisse_gebiet_auswahl_<zahl>.json` listet jedes Gebiet mit Schlüssel,
  Name und Ergebnisseite (Celle: 304 Einträge).
- Ergebnisse als HTML-Tabellen je Gebiet
  (`ergebnisse_gemeinde_<schlüssel>.html`), Sitzverteilung als JSON in
  `data-chartdata`-Attributen.
- Daneben `parteistimmen.csv`, `gesamtergebnis.csv`, `kandidatenstimmen.zip` im
  Schema des votemanager-Exports; nur dort steht die Wahlbeteiligung.
  **Uelzens `parteistimmen.csv` ist eine Attrappe** – eine Zeile mit runden
  Testwerten (597 B); echte Zahlen stehen nur im HTML.
- Gebietsschlüssel sind AGS-nah, aber uneinheitlich: Uelzen achtstellig
  (`03360025`), Celle ohne führende `03` (`351012` = Hambühren) und mit eigenen
  Nummern für die geteilte Stadt Celle (`3510061`/`3510062`).
- Es gibt keine 2026er-Adressen, kein Termin-Verzeichnis und keinen
  Auszählfortschritt. Celles Startseite kündigt für den Wahlabend
  `https://landkreis-celle.de` an.

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
