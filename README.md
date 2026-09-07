# Wahlergebnisse

Aufbereitung der amtlichen Kommunalwahlergebnisse — für den Wahlabend als
Live-Auswertung, danach als Archiv. Läuft unter
**wahlergebnisse.levinkeller.de**.

Angefangen hat es mit dem Landkreis Hildesheim; der Ausbau auf ganz
Niedersachsen ist beschrieben in [docs/ausbau-niedersachsen.md](docs/ausbau-niedersachsen.md).

**Privates Angebot ohne Gewähr.** Die Zahlen werden automatisch aus der
Wahlpräsentation der jeweiligen Wahlleitung übernommen. Verbindlich sind
allein deren amtliche Bekanntmachungen; für Richtigkeit, Vollständigkeit und
Verfügbarkeit wird keine Haftung übernommen. Sitzverteilungen vor dem
vollständigen Ergebnis sind eigene Rechnungen aus Teilergebnissen, keine
Prognosen der Wahlleitung.

- **Karten** mit Gemeinden, Kreiswahlbereichen, Ortsteilen und Wahllokalen,
  eingefärbt nach stärkster Partei, klickbar bis zum einzelnen Wahlbezirk.
  Beim Durchklicken bleibt die Karte stehen und die Seite an ihrer Stelle.
- **Alle Wahlen**: Landrat, Kreistag, Bürgermeister, Räte, Ortsräte
- **Sitzverteilung** (amtlich oder Hochrechnung nach Hare-Niemeyer) und
  **Koalitionsrechner**
- **Bewerberinnen und Bewerber** mit Listenplatz, Stimmen, Anteil an allen
  gültigen Stimmen und Mandat — sortierbar nach Ergebnis oder Listenplatz
- **Ticker** der eingehenden Schnellmeldungen, Fortschritt je Gemeinde,
  Seiten laden sich bei neuen Daten selbst nach
- **Vergleich** mit der jeweils passenden früheren Wahl
- **Offene API**: REST unter `/api/v1/`, MCP unter `/mcp`, Kurzdoku unter `/api`

## Wie es funktioniert

```
wahlen.kreis-hi.de (votemanager)  ──HTTP──▶  Poller  ──▶  SQLite (/data)
                                                │
                           Astro-SSR-Seiten  ◀──┘   (ein Node-Prozess: server/main.ts)
```

Der Landkreis veröffentlicht die Schnellmeldungen mit **votemanager** (vote iT)
als statische JSON-Dateien. `src/lib/poll.ts` liest sie sparsam: pro Wahl ein
Verzeichnislisting, geänderte Dateien per ETag. Der Takt richtet sich nach dem
Tag — an gewöhnlichen Tagen alle 30 Minuten, am Wahltag alle fünf, ab 17 Uhr
(Berliner Zeit) jede Minute.

Zwei Programmversionen von votemanager sind abgedeckt (2021: `api/praesentation`,
2026: `daten/api`); die Termine stehen in `src/data/termine.ts`.

**Geodaten** liegen als GeoJSON im Repo (`src/data/geo/`), erzeugt mit den
Skripten unter `scripts/`: Gemeindegrenzen vom BKG (VG250), Ortsteile aus
LGLN-Gemarkungen und OpenStreetMap, Wahllokale als geocodierte Adressen.
Die Gemeindegrenzen decken ganz Niedersachsen ab und liegen je Kreis in einer
eigenen Datei (`src/data/geo/gemeinden/<kreis>.geo.json`), damit eine Seite nur
lädt, was sie zeichnet. Ortsteile und Wahllokale gibt es bisher nur für
Hildesheim; wo sie fehlen, zeigt die Karte einfach nur Gemeinden.
votemanager liefert für 42 der 45 niedersächsischen Kreise keine Geometrien —
deshalb bringt die App sie selbst mit.

**Listenplätze** stehen in keiner Ergebnisdatei — dort ist nach Stimmen
sortiert. Die Open-Data-CSV desselben Gebiets führt dieselben Zahlen in
Listenreihenfolge, worüber sich der Platz zuordnen lässt (`src/lib/liste.ts`),
und zwar je Gebiet: Bei der Kreistagswahl stellt jede Partei pro Wahlbereich
eine eigene Liste auf.

## Entwicklung

```bash
npm install
npm run poll     # Daten holen → data/wahlen.db
npm run dev      # http://localhost:4321
```

Offline entwickeln: `VOTEMANAGER_BASIS` auf den Mock zeigen lassen
(`test/mock-votemanager.ts`), der die eingecheckten Fixtures ausliefert.

## Tests

| Befehl | Was |
|---|---|
| `npm test` | Unit- und Integrationstests: Parser, Sitzverteilung, API-Schema und der ganze Datenweg gegen einen Mock-votemanager mit echten Fixture-Dateien, inklusive simuliertem Wahlabend |
| `npm run e2e` | Playwright gegen den gebauten Server: Karten, Koalitionsrechner, Live-Nachladen, Durchklicken, Mobilbreiten, API und MCP |
| `npm run check` | `astro check` |

## Betrieb

| Variable | Standard | Zweck |
|---|---|---|
| `PORT`, `HOST` | `8080`, `0.0.0.0` | HTTP |
| `DATABASE_PATH` | `./data/wahlen.db` | SQLite-Datei (WAL) |
| `POLL_INTERVAL_RUHIG_SEKUNDEN` | `86400` | Abstand je Kreis an Tagen ohne Wahl |
| `POLL_INTERVAL_SEKUNDEN` | `3600` | Abstand je Kreis am Wahltag vor 17 Uhr |
| `POLL_INTERVAL_WAHLABEND_SEKUNDEN` | `900` | Abstand je Kreis am Wahlabend |
| `POLL_INTERVAL_BETRACHTET_SEKUNDEN` | je Stufe | Abstand für den gerade angesehenen Kreis (900/300/60) |
| `POLL_INTERVAL_WAHLTAG_SEKUNDEN` | `60` | dasselbe für den angesehenen Kreis am Wahlabend |
| `POLL_KREISE_PRO_LAUF` | `8` | Höchstzahl Kreise je Durchgang |
| `POLL_PARALLEL` | `4` | Gleichzeitig bearbeitete Behörden |
| `POLL_STRUKTUR_MAX_ALTER_SEKUNDEN` | `21600` | Wie lange termin/wahl/open_data ohne Nachfrage gelten |
| `POLL_BEHOERDEN` | alle | Nur diese Behörden abfragen (AGS, komma-getrennt) |
| `VOTEMANAGER_BASIS` | je Kreis aus dem Katalog | Datenquelle umbiegen (Tests: Mock) |
| `EXPORT_TOKEN` | – | Schaltet `/export/wahlen.sqlite` frei |
| `PUBLIC_SITE_URL` | wahlergebnisse.levinkeller.de | Absolute URL |

Deployment: Image nach GHCR (`.github/workflows/deploy.yml`), Manifeste in
`deploy/` (Namespace `wahlergebnisse`, eine Replica, PVC), ausgerollt von
Argo CD auf `server.levinkeller.de`.

## Daten und Lizenz

Die Ergebnisse stammen aus der amtlichen Wahlpräsentation des Landkreises
Hildesheim. Maßgeblich sind allein die Bekanntmachungen der Wahlleitungen;
diese Seite ist eine private Aufbereitung. Geodaten: © GeoBasis-DE/BKG
(dl-de/by-2-0), © LGLN (dl-de/by-2-0), © OpenStreetMap-Mitwirkende (ODbL).

Code: MIT.
