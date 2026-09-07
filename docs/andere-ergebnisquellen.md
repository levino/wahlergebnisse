# Wo die Kreise ohne votemanager ihre Ergebnisse veröffentlichen

Stand 07.09.2026. Jede Angabe hier ist mit einem echten Abruf belegt (Status und
Größe stehen dabei); wiederholen lässt sich das mit
`node --experimental-strip-types scripts/quellen-probe.ts`.

## Der Anlass

Diese Anwendung hat für fünf Kreise geschrieben, es gebe keine Ergebnisse. Das
war falsch, und zwar nicht aus Unglück, sondern aus Bequemlichkeit: Die Erhebung
hat je Kreis **eine** Adresse befragt — den bundesweiten Behörden-Index und den
KDO-Spiegel — und aus deren Schweigen auf Abwesenheit geschlossen. Dass eine
Stadt ihre Wahlpräsentation auf dem eigenen Rechner betreibt, kam nicht vor.

Tatsächlich veröffentlichen **alle** diese Kreise ihre Ergebnisse, seit Jahren
und vollständig. Zwei Lehren stehen am Anfang:

1. **Ein Fehlschlag gegen eine Adresse belegt nicht, dass es die Daten nicht
   gibt.** Er belegt, dass diese eine Adresse nichts hergab.
2. **Ein fehlgeschlagener Abruf kann am Werkzeug liegen.** Siehe den Abschnitt
   zu TLS weiter unten — er hat genau diesen Fehler mitverursacht.

## Was tatsächlich wo liegt

### Nutzen doch votemanager — nur auf eigenen Rechnern

Diese drei brauchen keinen neuen Adapter, sondern nur die richtige Wurzel. Der
Katalog ist entsprechend korrigiert (`scripts/kreise-erzeugen.ts`,
`BASIS_KORREKTUR`).

| Kreis | Wurzel | Termin-Index | 13.09.2026 |
|---|---|---|---|
| **Wolfsburg** (03103000) | `https://wahlen.wolfsburg.de/` | 200, 1 647 B | **liegt bereits abrufbar vor** — `20260913/03103000/daten/api/termin.json` → 200, 3 740 B |
| **Salzgitter** (03102000) | `https://wahlen.salzgitter.de/ergebnisse/` | 200, 2 125 B | noch 404; die Stadt schaltet erst am Wahlabend frei |
| **Heidekreis** (03358000) | `https://wahlen-heidekreis.de/` | 200, 1 937 B | noch 404 |

Anmerkungen:

- **Wolfsburg** stand in `behoerden.json` gar nicht und wurde deshalb auf den
  KDO-Spiegel gesetzt, der 2022 endet. Der eigene Host führt den 13.09.2026 im
  Index und liefert die Präsentation aus. Der Kreis gilt jetzt als `vorhanden`.
- **Salzgitter**: `behoerden.json` nennt `www.salzgitter.de/wahlen/ergebnisse/`;
  das antwortet mit 302 auf einen toten Pfad — daher die Notiz „antwortet
  nicht“. Richtig ist `wahlen.salzgitter.de/ergebnisse/`. Die Landing Page
  `wahlen.salzgitter.de/` trägt im Quelltext ein `wahlergebnisseAktiv = false`,
  das am Wahlabend umgelegt wird; zu erwarten ist dann
  `ergebnisse/Wahl-2026-09-13/03102000/praesentation/`.
- **Heidekreis**: Die Dateien von 2021 sind nicht verschwunden, sondern in einen
  Präfix-Ordner gewandert. Der Index verweist weiter auf den alten Pfad
  (`/20210912/…` → 404), abrufbar ist
  `KW2021/20210912/03358000/praesentation/index.html` (200, 16 705 B).
- **Region Hannover**: normaler votemanager, der Termin steht im Index, das
  Verzeichnis fehlt noch (404). Die Landeshauptstadt (03241001, eigener Host
  `wahlergebnis.hannover-stadt.de`) hat ihren Teil bereits freigeschaltet. Hier
  ist nichts zu tun als abzuwarten — der Poller sieht ohnehin nach.
- **Harburg** (03353000): liegt auf dem KDO-Spiegel, letzter Termin Juni 2024.

### Celle und Uelzen: ein anderes System

Beide benutzen keinen votemanager, sondern eine IVU-Wahlpräsentation. Sie sind
untereinander gleich aufgebaut (Celle beherbergt sogar die gemeinsame
Bundestagswahl-Präsentation „Celle-Uelzen“).

| Kreis | Fundort | Umfang |
|---|---|---|
| **Celle** | `wahl.landkreis-celle.de/ivu/kreis2021_celle/` (200, 292 103 B) und `…/ivu/kreis_wiederholung_2022/` (200, 292 678 B) | Kreiswahl 2021 und die Wiederholungswahl 2022 |
| **Uelzen** | `wahlen.landkreis-uelzen.de/kw2021/kt/` (200, 69 051 B) | nur die Kreistagswahl 2021 |

Aufbau (für beide gleich):

- **Gebietsbaum als JSON.** `idx_ergebnisse_gebiet_auswahl_<zahl>.json` listet
  jedes Gebiet mit Schlüssel, Name und Ergebnisseite. Celle: 304 Einträge
  (1 Kreis, 5 Wahlbereiche, 22 Gemeinden, 3 Samtgemeinden, 32 Ortschaften,
  177 Stimmbezirke, 61 Briefwahlbezirke).
- **Ergebnisse als HTML-Tabellen**, je Gebiet eine Seite
  (`ergebnisse_gemeinde_<schlüssel>.html` usw.): Parteistimmen absolut und in
  Prozent, Kandidatenstimmen je Liste, auf Kreisebene zusätzlich die Gewählten.
- **Sitzverteilung als eingebettetes JSON** in `data-chartdata`-Attributen —
  Partei, Sitze, voller Name, Farbe, dazu Prozente in voller Genauigkeit.
- **Presse-/Open-Data-Dateien** neben der Präsentation: `parteistimmen.csv`,
  `gesamtergebnis.csv`, `kandidatenstimmen.zip`. Das Schema ist dasselbe wie
  beim votemanager-Export (`Gebietsart;Gebietsnummer;Wahlberechtigte …;
  Gruppenschlüssel;Stimmen;…`) und enthält als Einziges die Wahlbeteiligung.

Gebietsschlüssel sind AGS-nah, aber nicht einheitlich: Uelzen führt Gemeinden
achtstellig (`03360025`), Celle ohne die führende `03` (`351012` = Hambühren) und
erfindet für die geteilte Stadt Celle eigene Nummern (`3510061`/`3510062`).

## Warum kein zweiter Adapter gebaut wurde

Das Format trägt einiges — aber nicht das, wofür diese Anwendung da ist. Gegen
eine vollwertige Anbindung sprach:

1. **Es gibt keine 2026er-Adressen.** Beide Präsentationen sind Archive von
   2021/2022. Celles Startseite kündigt für den Wahlabend ausdrücklich einen
   anderen Weg an („Aktuelle Ergebnisse am Wahl-Sonntag auf
   https://landkreis-celle.de“). Ein Adapter gegen die Archivpfade würde am
   13.09.2026 nichts liefern.
2. **Uelzens CSV-Export ist eine Attrappe.** `parteistimmen.csv` enthält eine
   einzige Zeile mit runden Testwerten (`STIMMBEZIRK;033600250001;100;20;0;80;
   0;0;200;0;CDU;70;SPD;130;…`, 597 B). Echte Zahlen stehen dort nur im HTML —
   also zwei verschiedene Code-Wege für zwei Kreise.
3. **Kein Termin-Verzeichnis.** Es gibt nichts wie `termine.json`; jede Adresse
   müsste von Hand eingetragen werden, und der Poller könnte nicht von selbst
   bemerken, dass etwas Neues da ist.
4. **Kein Auszählfortschritt.** Es gibt kein Gegenstück zu
   `anz-/max-schnellmeldungen`. Hochrechnung und Wahlabend-Takt hängen daran.
5. **Der Umfang ist schmal.** Nur die Kreiswahl, keine Gemeinderats-, Bürger-
   meister- oder Ortsratswahlen.

Dazu kommt, wo der Nutzen wirklich lag: Die Zeit war besser in Wolfsburg,
Salzgitter und Heidekreis investiert — drei Kreise, die mit dem **vorhandenen**
Adapter vollständig funktionieren, sobald die Wurzel stimmt. Wolfsburg liefert
damit ab sofort.

Bliebe der Archivnutzen. Wer ihn heben will, findet oben alles Nötige; der
Einstieg wäre ein reiner Parser `src/lib/ivu.ts` neben `votemanager.ts` (dieselbe
Bauart: kein I/O, Rückgabe `Ergebnis`/`Uebersicht`), gefüttert aus Celles
`parteistimmen.csv` und Uelzens HTML. Die Datenschicht selbst ist quellenneutral
genug: `speichereErgebnis` und die `wahleintraege`-Transaktion in `poll.ts`
nehmen nur die Typen aus `votemanager.ts`. Zu beachten wäre, dass `gebiet_id`
überall die Form `ebene_<n>_id_<m>` hat (`ebeneVonGebietId`, `istGebietId`,
`ebeneName`) — der Adapter müsste solche Schlüssel erzeugen.

## Die Mindestlösung, die stattdessen gebaut wurde

Jeder Kreis ohne eigene Zahlen verweist jetzt auf die Stelle, an der es sie gibt.

- `Kreis.quellen` im Katalog (`src/data/kreise.ts`), gepflegt in
  `AMTLICHE_QUELLEN` in `scripts/kreise-erzeugen.ts`.
- Angezeigt in `src/components/KreisOhneDaten.astro` — der Link steht oben, nicht
  als Nachsatz.
- Der Erzeuger **bricht ab**, wenn ein Kreis ohne Präsentation keine Fundstelle
  hat; ein Test in `src/data/kreise.test.ts` hält dasselbe fest. Der alte Zustand
  lässt sich damit nicht versehentlich wiederherstellen.

## Das TLS-Problem — und warum nichts nachgeliefert wird

`wahl.landkreis-celle.de` liefert eine unvollständige Kette: Es schickt sein
Zertifikat und das Zwischenzertifikat „Sectigo Public Server Authentication CA DV
R36“, dessen Aussteller „Sectigo … Root R46“ aber nicht mit. `curl` bricht
deshalb ab:

```
verify error:num=20:unable to get local issuer certificate
HTTP 000, 0 Bytes          # mit -k dagegen: 200, 292 678 Bytes
```

Das ist die Falle, die den ganzen Irrtum mitverursacht hat: Der Abbruch **sieht
aus wie** „der Server hat nichts“ und **heißt** „mein Werkzeug kommt nicht
heran“.

Naheliegend wäre nun, Sectigos gegenquittiertes R46 mitzuliefern und über
`NODE_EXTRA_CA_CERTS` einzuhängen. Das wäre hier aber ein Mittel gegen eine
Krankheit, die die Anwendung nicht hat: **Node bringt R46 in seinem eingebauten
Wurzelspeicher schon mit.** Nur der Speicher des Betriebssystems (Debians
`ca-certificates`, den `curl` und `openssl` benutzen) kennt es nicht. Aus Node
heraus — der Laufzeit, in der der Poller läuft — gelingt der Abruf anstandslos:

```
fetch("https://wahl.landkreis-celle.de/ivu/kreis2021_celle/parteistimmen.csv")
  → 200, 46 221 Bytes
```

`scripts/tls-probe.ts` prüft alle 13 Hosts des Katalogs mit Nodes Speicher: alle
in Ordnung, keiner mit unvollständiger Kette. Das Abbild ist `node:22-alpine` und
setzt weder `--use-openssl-ca` noch `NODE_OPTIONS`, es gilt also derselbe
Speicher wie hier.

Ein zusätzliches Zertifikat einzuhängen hieße darum, einen Vertrauensanker mehr
zu pflegen, ohne dass er etwas löst. Stattdessen hält
`src/lib/zertifikate.ts` fest, **welche** Wurzeln gebraucht werden und warum;
`pruefeWurzelspeicher()` und der Test dazu schlagen an, falls Node eine davon
einmal nicht mehr mitbringt. Dann ist die richtige Meldung „nicht erreichbar“ —
nicht „keine Daten“.

Für Werkzeuge am Betriebssystem (`curl`, `openssl`, auch in der CI) ist der
saubere Weg nicht `-k`, sondern das Glied nachzureichen, das der Server vergisst.
Sectigo veröffentlicht es unter genau der Adresse, die das Zwischenzertifikat in
seiner `Authority Information Access`-Erweiterung nennt:

```sh
curl -sO http://crt.sectigo.com/SectigoPublicServerAuthenticationRootR46.p7c
openssl pkcs7 -inform DER -in SectigoPublicServerAuthenticationRootR46.p7c \
  -print_certs -out r46.pem
cat /etc/ssl/certs/ca-certificates.crt r46.pem > bundle.pem
curl --cacert bundle.pem https://wahl.landkreis-celle.de/...   # 200
```

Die Prüfung bleibt dabei eingeschaltet: Das nachgereichte R46 ist von „USERTrust
RSA Certification Authority“ signiert, die ohnehin in jedem Speicher steht — wir
fügen keine Wurzel hinzu, sondern schließen die Kette. Dass das der richtige Weg
ist, zeigt der Heidekreis: `wahlen-heidekreis.de` benutzt dieselbe Sectigo-Kette
und schickt genau dieses Zertifikat als viertes Glied mit.

## Landesweite Gegenprobe

Das Landesamt für Statistik veröffentlicht unter
`wahlen.statistik.niedersachsen.de/KW2021/` flächendeckend
`kreiswahlergebnis.csv` (200, 9 885 B; alle 45 Kreise mit Stimmen und Sitzen) und
`wahlergebnis.xml` (200, ~2,1 MB). Nur Kreisebene, keine Gemeinden oder
Wahlbezirke — als Ersatz untauglich, als Kreuzprobe brauchbar. `KW2026/` gibt es
noch nicht.
