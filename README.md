# Wahlergebnisse

Amtliche Kommunalwahlergebnisse aus Niedersachsen – am Wahlabend live, danach
als Archiv.

- Produktion: <https://wahlergebnisse.levinkeller.de>
- Generalprobe: <https://demo.wahlergebnisse.levinkeller.de> – spielt den
  Wahlabend des 12.09.2021 in Schleife nach, verrauscht; spätere Termine kennt
  die Instanz nicht

**Privates Angebot ohne Gewähr.** Die Zahlen werden automatisch aus der
Wahlpräsentation der jeweiligen Wahlleitung übernommen; verbindlich sind allein
deren amtliche Bekanntmachungen. Sitzverteilungen vor dem vollständigen Ergebnis
sind eigene Rechnungen aus Teilergebnissen, keine Prognosen der Wahlleitung.

Adressen, die man sonst nicht findet:

- Dashboard für die Leinwand: `/<kreis>/<termin>/<behörde>/dashboard`
  (`?takt=` in Sekunden, 5 bis 300)
- Alle Wahlen eines Ortes: `/<kreis>/<termin>/<behörde>/ort/<ort>`
- Schnittstelle: REST `/api/v1/`, MCP `/mcp`, Kurzdoku `/api`

## Entwickeln

```bash
npm install
npm run poll     # Daten holen → data/wahlen.db
npm run dev      # http://localhost:4321
npm test
npm run e2e
```

Ohne Netz: `VOTEMANAGER_BASIS` auf `test/mock-votemanager.ts` zeigen lassen.

Generalprobe lokal:

```bash
WAHLEN_DEMO=1 WAHLEN_DEMO_ZYKLUS=120 \
  WAHLEN_DEMO_BESTAND=daten/demo-bestand.db.zst npm start
```

`npm run kassetten` nimmt die Kassetten des Ansagedienstes neu auf und braucht
dafür einen echten `OPENAI_API_KEY` – aus der Umgebung oder aus einer `.env` im
Projektverzeichnis. Ohne `KASSETTEN` verlässt kein Aufruf den Prozess.

Alle Umgebungsvariablen: `grep -rn "process\.env" src server`

## Woher die Daten kommen

- Schnellmeldungen aus der **votemanager**-Wahlpräsentation (vote iT) der
  jeweiligen Wahlleitung, als statische JSON-Dateien. Zwei Programmversionen:
  2021 unter `api/praesentation`, 2026 unter `daten/api`.
- Listenplätze aus der Open-Data-CSV desselben Gebiets; die Ergebnisdateien
  sind nach Stimmen sortiert und führen keinen Listenplatz.
- Geodaten als GeoJSON im Repo (`src/data/geo/`), erzeugt mit `scripts/`:
  Gemeindegrenzen vom BKG (VG250, ganz Niedersachsen), Ortsteile aus
  LGLN-Gemarkungen und OpenStreetMap, Wahllokale als geocodierte Adressen –
  Ortsteile und Wahllokale bisher nur für Hildesheim. votemanager liefert für
  42 der 45 Kreise keine Geometrien.
- Eigenheiten der einzelnen Wahlleitungen: [docs/ausbau-niedersachsen.md](docs/ausbau-niedersachsen.md).
  Kreise ohne votemanager: [docs/andere-ergebnisquellen.md](docs/andere-ergebnisquellen.md).

## Betrieb

Ein Cluster auf `server.levinkeller.de`: ein Knoten, `local-path`, Traefik,
cert-manager (ClusterIssuer `letsencrypt`).

- Bei jedem Merge auf `main` baut `.github/workflows/deploy.yml` das Image
  (`ghcr.io/levino/wahlergebnisse`, öffentlich) und trägt den Bildstand in beide
  Overlays auf dem Zweig **`ausgerollt`** ein. Dieser Zweig trägt nur `deploy/`.
  `main` ist geschützt, `ausgerollt` nicht.
- Ein Lauf rollt den **Kopf von `main`** aus, nicht den Commit, der ihn
  ausgelöst hat.
- `npm run ausrollstand` vergleicht `main`, den Ausrollzweig und den Cluster.
- Beide Argo-CD-Applications stehen im Repo `levino/server-config`
  (`apps/wahlergebnisse.yaml` und `apps/wahlergebnisse-demo.yaml`), je mit
  `targetRevision: ausgerollt`, `prune: false`, `selfHeal: true` und den Pfaden
  `deploy/overlays/production` bzw. `deploy/overlays/demo`. Den Namespace
  `wahlergebnisse` legt `server-config` an, nicht das Overlay.
- `demo.wahlergebnisse.levinkeller.de` braucht einen DNS-Eintrag auf dieselbe
  Adresse wie die Produktion.
- Das Export-Token steht versiegelt in `deploy/base/export-token.sealed.yaml`
  (kubeseal gegen den Sealed-Secrets-Controller dieses Clusters), auf dem Server
  unter `/root/wahlergebnisse-export-token` und als Repo-Secret `EXPORT_TOKEN`.
  Neu ausstellen: `kubectl create secret … --dry-run=client -o yaml | kubeseal
  -o yaml`, dann beide Stellen ersetzen.
- Der PVC (2 GiB) lässt sich nachträglich nicht vergrößern („only dynamically
  provisioned pvc can be resized"); ein Versuch hat Argo CD dauerhaft in den
  Fehlerzustand gebracht.

Zurückrollen, ohne `main` anzufassen:

```sh
gh workflow run zurueckrollen.yml -f schritte=1
```

Ein Rollback hält. Es legt die Marke `ANGEHALTEN` auf den Zweig; solange die
liegt, tragen Deploy-Läufe aus Pushes nichts ein und werden rot. Freigeben kann
nur ein Mensch, mit `gh workflow run deploy.yml --ref main`. `npm run
ausrollstand` meldet den Halt mit Rückgabewert 3.

- Ausgangsbestand und Einfrieren eines Termins:
  [docs/ausgangsbestand.md](docs/ausgangsbestand.md)
- Schemaänderungen, solange zwei Stände nebeneinander laufen:
  [docs/rollierendes-ausrollen.md](docs/rollierendes-ausrollen.md)

## Daten und Lizenz

Geodaten: © GeoBasis-DE/BKG (dl-de/by-2-0), © LGLN (dl-de/by-2-0),
© OpenStreetMap-Mitwirkende (ODbL). Code: MIT.
