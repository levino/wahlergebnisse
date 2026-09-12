# Ausgangsbestand und Einfrieren

Ein Kaltstart mit leerem Volume kostet rund 63 000 Anfragen an fremde Server und
etwa vier Stunden, bis die Archive 2021 vollständig sind. Und die Quellen
verschwinden: Der Heidekreis hat seine 2021er Dateien bereits entfernt. Deshalb
liegt eine fertige Datenbank als Anhang eines GitHub-Release (`daten-JJJJ-MM-TT`,
Datei `wahlen.db.zst` – der Name ist Teil der Adresse, unter der das Dockerfile
sie sucht), die der Docker-Build über `ARG SCHNAPPSCHUSS` ins Image backt.
`keiner` baut ohne Ausgangsbestand.

Der volle Bestand liegt bei rund 750 MB roh, gepackt bei etwa 70 MB
(`zstd -19`, gemessen 11:1).

## Schnappschuss ziehen und veröffentlichen

Der einfache Weg: `.github/workflows/schnappschuss.yml` von Hand anstoßen
(*Actions → Ausgangsbestand veröffentlichen → Run workflow*). Er zieht den
Bestand über den Export-Endpunkt (`EXPORT_TOKEN` als Secret) und legt das
Release an.

Für den großen Bestand über den Poller-Pod, weil der Export-Endpunkt von einem
Web-Pod (384 MiB) beantwortet wird und die Kopie auf demselben Volume landet:

```sh
kubectl -n wahlergebnisse exec deploy/wahlergebnisse-poller -- \
  node --no-warnings --experimental-strip-types scripts/schnappschuss.ts \
  --roh --db /data/wahlen.db --ziel /data/schnappschuss.db
kubectl -n wahlergebnisse exec deploy/wahlergebnisse-poller -- \
  cat /data/schnappschuss.db > wahlen.db
kubectl -n wahlergebnisse exec deploy/wahlergebnisse-poller -- \
  rm -f /data/schnappschuss.db

npm run schnappschuss -- --packen wahlen.db --ziel wahlen.db.zst
npm run schnappschuss -- --pruefen wahlen.db.zst

gh release create daten-$(date -u +%Y-%m-%d) wahlen.db.zst \
  --title "Ausgangsbestand daten-$(date -u +%Y-%m-%d)"
```

Gepackt wird außerhalb des Pods: `zstd -19` braucht gut 100 MB Arbeitsspeicher,
der Poller-Pod hat 512 MiB im Ganzen, und dort ist bereits ein `gzip -9` mit OOM
gestorben.

Danach die Fassung im `Dockerfile` eintragen:

```dockerfile
ARG SCHNAPPSCHUSS=daten-2026-09-14
```

**Wer `DATENSTAND` erhöht, veröffentlicht danach einen neuen Schnappschuss.**
Sonst löscht `migriereDatenstand` beim Kaltstart die `vollstaendig`-Marken und
liest die Archive einmal neu ein – die vier Stunden, die der Schnappschuss
sparen sollte. Für eingefrorene Termine entfällt das.

## Demo-Bestand auffrischen

Eine neue Fassung von `daten/demo-bestand.db.zst` (17,3 MB) wird nötig, wenn ein
früherer Termin dazukommt oder der `DATENSTAND` steigt.

Quelle ist die **Produktionsdatenbank**, nicht die der Demo: Im Demo-Namespace
sind die Zeilen des Probentermins längst mit simulierten Zahlen überschrieben.
Herausgeholt wird mit `cp` statt `exec … cat >` – der rohe Stream hat bei 270 MB
das letzte MB verschluckt, ohne einen Fehler zu melden; Prüfsumme vergleichen.

```sh
kubectl -n wahlergebnisse exec deploy/wahlergebnisse-poller -- \
  node --no-warnings --experimental-strip-types scripts/demo-bestand.ts \
  --roh --db /data/wahlen.db --ziel /data/demo-bestand.db
kubectl -n wahlergebnisse cp <pod>:/data/demo-bestand.db ./demo-bestand.db
kubectl -n wahlergebnisse exec deploy/wahlergebnisse-poller -- \
  rm -f /data/demo-bestand.db

npm run demo-bestand -- --packen demo-bestand.db --ziel daten/demo-bestand.db.zst
npm run demo-bestand -- --pruefen daten/demo-bestand.db.zst
```

Lokal, ohne gedeckelten Speicher, macht `npm run demo-bestand` alles am Stück.

## Der Vergleichstermin 2016

Die Generalprobe spielt den 12.09.2021. Ohne die Bezirksergebnisse der
Kommunalwahl 2016 hat diese Wahl keinen Vorwert, und die Sitzverteilung kommt
den ganzen Abend als Fortschreibung mit „Unsicherheit hoch“ heraus – die
Hochrechnung, die am Wahlabend laufen soll, ist dann nirgends zu sehen.

2016 steht deshalb in `daten/demo-bestand.db.zst` und sonst nirgends:
`nurProbe: true` in `src/data/termine.ts` hält den Termin aus der Produktion
heraus. Die vergleicht 2026 gegen 2021 und käme an 2016 nie vorbei. Im
Ausgangsbestand kostete er nur: 10 310 Anfragen, bei den 4 Anfragen je Sekunde
eines Archivlaufs gut 40 Minuten Kaltstart, dazu 27,5 MB roh. Im Demo-Bestand
sind es 1,7 MB mehr gepackt (15,6 → 17,3 MB).

Abrufbar ist 2016 bei 132 von 413 Wahlleitungen in 26 Kreisen – dort trägt der
Katalog `archive: ["2016"]`, kreisweit, wo alle liefern, sonst je Wahlleitung.

Weil der Poller der Produktion diesen Termin nicht kennt, wird er mit
`WAHLEN_DEMO=1` nachgeladen, und zwar in die Kopie, aus der gepackt wird:

```sh
WAHLEN_DEMO=1 DATABASE_PATH=./demo-bestand.db npm run poll -- 2016
WAHLEN_DEMO=1 npm run demo-bestand -- \
  --packen demo-bestand.db --ziel daten/demo-bestand.db.zst
```

Auch beim Filtern gilt das: Ohne `WAHLEN_DEMO=1` führt `probenTermine()` den
Termin 2016 nicht, und `filtereFuerProbe` löscht seine Zeilen wieder heraus.

## Einfrieren

Ein Termin, dessen Ergebnis amtlich und endgültig ist, wird nicht mehr
abgefragt. Zwei Wege:

```ts
// src/data/termine.ts
{ id: "2021", …, abgeschlossen: "2021-09-30T12:00:00.000Z" }
```

```sh
WAHLEN_ABGESCHLOSSEN=2026,2021
```

Die Variable kann nur einfrieren, nie auftauen. Ein eingefrorener Termin, der
wirklich eine neue Ableitung braucht, bekommt sie aus einem neuen Schnappschuss
oder über `server/poll.ts <id> --force`.
