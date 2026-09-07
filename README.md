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
- **Offene API**: REST unter `/api/v1/`, MCP unter `/mcp`, Kurzdoku unter `/api`.
  Beide führen den Kreis mit — die REST-Pfade als erstes Segment, die
  MCP-Werkzeuge als Pflichtangabe. Zu einem bloßen Ortsnamen finden ihn dort
  `kreise` und `gemeinde_suchen`

## Wie es funktioniert

```
wahlen.kreis-hi.de (votemanager)  ──HTTP──▶  Poller  ──▶  SQLite (/data)
                                                              │  nur lesend
                                            Astro-SSR-Seiten  ◀┘
```

Dasselbe Programm (`server/main.ts`) in zwei Rollen: In Produktion läuft der
Poller in einem eigenen Pod und die Auslieferung in mehreren, damit ein Deploy
die Seite nicht unterbricht (`WAHLEN_ROLLE`, s. u.). Lokal macht ein einziger
Prozess beides — die Voreinstellung.

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
eine eigene Liste auf. Gleichnamige Wahlen — die neun Ortsratswahlen einer
Gemeinde heißen in der CSV-Liste alle nur „Ortsratswahl“ — bekommen ihre Datei
über den Ortsnamen; bleibt der zweideutig, gibt es lieber keinen Listenplatz
als einen aus der falschen Ortschaft.

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
| `WAHLEN_ROLLE` | `beides` | `poller` (fragt ab, schreibt), `web` (liefert aus, liest nur), `beides` (ein Prozess wie bisher) |
| `PORT`, `HOST` | `8080`, `0.0.0.0` | HTTP |
| `DATABASE_PATH` | `./data/wahlen.db` | SQLite-Datei (WAL); daneben `betrachtet/` für die Meldungen der Web-Pods |
| `SHUTDOWN_FRIST_MS` | `10000` | Wie lange angefangene Antworten nach SIGTERM noch fertig werden dürfen |
| `POLL_INTERVAL_RUHIG_SEKUNDEN` | `21600` | Abstand je Kreis an Tagen ohne Wahl |
| `POLL_INTERVAL_SEKUNDEN` | `1800` | Abstand je Kreis am Wahltag vor 17 Uhr |
| `POLL_INTERVAL_WAHLABEND_SEKUNDEN` | `180` | Abstand je Kreis am Wahlabend |
| `POLL_INTERVAL_BETRACHTET_SEKUNDEN` | je Stufe | Abstand für den gerade angesehenen Kreis (900/300/60) |
| `POLL_INTERVAL_WAHLTAG_SEKUNDEN` | `60` | dasselbe für den angesehenen Kreis am Wahlabend |
| `POLL_KREISE_PRO_LAUF` | je Stufe (8/12/15) | Höchstzahl Kreise je Durchgang |
| `POLL_HOST_GRENZEN` | s. u. | Anfragen je Sekunde und Host, `host=rate[:spitze]`, komma-getrennt |
| `POLL_PARALLEL` | `16` | Gleichzeitig bearbeitete Behörden |
| `POLL_STRUKTUR_MAX_ALTER_SEKUNDEN` | `21600` | Wie lange termin/wahl/open_data ohne Nachfrage gelten |
| `POLL_BEHOERDEN` | alle | Nur diese Behörden abfragen (AGS, komma-getrennt) |
| `VOTEMANAGER_BASIS` | je Kreis aus dem Katalog | Datenquelle umbiegen (Tests: Mock) |
| `EXPORT_TOKEN` | – | Schaltet `/export/wahlen.sqlite` frei |
| `PUBLIC_SITE_URL` | wahlergebnisse.levinkeller.de | Absolute URL |

**Wie viel beim fremden Server ankommt**, begrenzt nicht der Takt, sondern ein
Anfragenkonto je Host (`src/lib/drossel.ts`): `votemanager.kdo.de` 60 Anfragen
je Sekunde (CDN davor, 351 der 372 abfragbaren Behörden), jeder andere Host 10.
Ein Rückstand bremst dadurch den Poller, nicht die Wahlleitung. Die Abstände
oben sind deshalb kurz genug, dass am Wahlabend auch ein Kreis, den gerade
niemand ansieht, höchstens drei Minuten alt ist. Die Rechnung dazu steht im
Kopfkommentar von `src/lib/takt.ts`; `src/lib/wahlabend-takt.test.ts` spielt
den Abend nach und `test/wahlabend-viele-kreise.test.ts` prüft ihn mit echten
Daten in mehreren Kreisen gleichzeitig.

Deployment: Image nach GHCR (`.github/workflows/deploy.yml`), Manifeste in
`deploy/` (Namespace `wahlergebnisse`, PVC), ausgerollt von Argo CD auf
`server.levinkeller.de`.

**Ein Deploy unterbricht die Seite nicht.** Aus einem Prozess sind zwei Rollen
geworden (`WAHLEN_ROLLE`, s. o.): ein Poller, der abfragt und schreibt, und
mehrere Web-Pods, die nur lesen und rollend getauscht werden. Warum das geht,
was aus dem gemeinsamen Prozesszustand geworden ist und welche Regel für
Änderungen an den Datenstrukturen gilt, steht in
[docs/rollierendes-ausrollen.md](docs/rollierendes-ausrollen.md). Belegt ist es
in `e2e/ausrollen.e2e.ts`: Der Test vollzieht den Wechsel und fragt dabei ohne
Pause ab — eine einzige fehlgeschlagene Anfrage lässt ihn scheitern.

**Eine frische Instanz startet nicht bei null.** Ein Kaltstart mit leerem
Volume kostet sonst rund 63 000 Anfragen an fremde Server und vier Stunden —
und manche Quelle gibt es dann gar nicht mehr (der Heidekreis hat seine 2021er
Dateien entfernt). Deshalb liegt ein **Ausgangsbestand** als Anhang eines
GitHub-Release bereit, den der Docker-Build ins Image backt (`ARG
SCHNAPPSCHUSS`) und den der Poller beim Start übernimmt, wenn auf dem Volume
noch nichts steht. Nach der Wahl lässt sich ein Termin **einfrieren**
(`abgeschlossen` im Katalog oder `WAHLEN_ABGESCHLOSSEN`): Er wird dann nicht
mehr abgefragt und gilt als amtliches Endergebnis. Beides — wie man einen
Schnappschuss zieht, veröffentlicht und einbackt, und wie das Einfrieren mit
dem DATENSTAND zusammengeht — steht in
[docs/ausgangsbestand.md](docs/ausgangsbestand.md).

## Daten und Lizenz

Die Ergebnisse stammen aus der amtlichen Wahlpräsentation des Landkreises
Hildesheim. Maßgeblich sind allein die Bekanntmachungen der Wahlleitungen;
diese Seite ist eine private Aufbereitung. Geodaten: © GeoBasis-DE/BKG
(dl-de/by-2-0), © LGLN (dl-de/by-2-0), © OpenStreetMap-Mitwirkende (ODbL).

Code: MIT.
