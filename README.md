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
- **Wahlabend-Dashboard** je Wahlleitung (`/<kreis>/<termin>/<behörde>/dashboard`):
  alle Wahlen im Wechsel, für Beamer und Vollbild
- **Ortsseiten** (`/<kreis>/<termin>/<behörde>/ort/<ort>`): alle Wahlen eines
  Abends an einem Ort – nicht „wie ging diese Wahl aus“, sondern „was ist in
  diesem Dorf passiert“
- **Ticker** der eingehenden Schnellmeldungen, Fortschritt je Gemeinde,
  Seiten laden sich bei neuen Daten selbst nach
- **Vergleich** mit der jeweils passenden früheren Wahl
- **Offene API**: REST unter `/api/v1/`, MCP unter `/mcp`, Kurzdoku unter `/api`.
  Beide führen den Kreis mit — die REST-Pfade als erstes Segment, die
  MCP-Werkzeuge als Pflichtangabe. Zu einem bloßen Ortsnamen finden ihn dort
  `kreise` und `gemeinde_suchen`

## Das Dashboard für den Wahlabend

`/<kreis>/<termin>/<behörde>/dashboard` – erreichbar über den Knopf auf jeder
Behördenseite und neben jeder Gemeinde auf der Terminseite.

Gedacht ist es für die Leinwand im Saal: eine Wahl je Folie, der Ort als
größte Schrift, darunter Balken, Auszählstand, Wahlbeteiligung und – wo es
etwas zu verteilen gibt – die Sitze mit Mehrheitslinie. Die Folien wechseln
von selbst; „Vollbild“ blendet Menü, Brotkrumen und Fußzeile aus. Stehen
bleibt allein die Standanzeige: Eine Leinwand, die stillsteht und dabei „Live“
behauptet, wäre das Schlechteste, was an so einem Abend passieren kann.

| | |
|---|---|
| Reihenfolge | Überblick, Bürgermeister, Rat, Ortsräte (alphabetisch), Kreistag, Landrat |
| Zuschnitte | Kreisweite Wahlen laufen von innen nach außen: das eigene Gemeindegebiet, der eigene **Kreiswahlbereich**, der ganze Kreis |
| Bedienung | Leertaste hält an, Pfeiltasten blättern, `F` schaltet ins Vollbild, Doppelklick auf die Fläche hält ebenfalls an; ein Klick auf die Überschrift führt in die volle Wahlseite |
| Takt | 18 Sekunden je Folie, über `?takt=` einstellbar (5 bis 300) |
| Live | Neue Schnellmeldungen kommen wie überall über die Zustellung an; das Karussell behält dabei Stelle und Pause (`src/components/Dashboard.astro`) |
| Meine Partei | Auswahl in der Bedienleiste: färbt die Oberfläche und meldet, was mit dieser Partei passiert (`src/lib/partei.ts`) |

**Der Kreiswahlbereich bekommt eine eigene Folie, und auf ihr stehen Namen.**
Die Kreistagssitze werden je Wahlbereich vergeben – Nordstemmen liegt mit Elze
im Bereich B –, und dort entscheidet sich nicht, wie der Kreistag
zusammengesetzt ist, sondern wer aus dieser Gegend hineinkommt. Solange gezählt
wird, zeigt die Folie die Bewerber mit ihren Stimmen; sobald die Wahlleitung
die Sitze verteilt hat, die Gewählten mit ihrem Mandat („direkt“,
„Listenplatz 1“). Wie viele Sitze auf einen Wahlbereich entfallen,
veröffentlicht die Quelle nirgends – deshalb wird das auch nicht geschätzt.

**Das Ergebnis ist die Folie, der Auszählstand ist die Fußnote.** Beides gehört
auf die Leinwand, aber nicht gleich groß: Wie viele Schnellmeldungen vorliegen,
steht klein in derselben Zeile wie „Zwischenstand“ oder „Hochrechnung“ – dort
ordnet es die Zahlen ein. Die Fläche gehört den Balken.

**„Meine Partei“ macht aus der Auswertung einen Abend.** Wer in der
Bedienleiste seine Partei einstellt, bekommt die Oberfläche in ihrer Farbe –
Kopf, Bedienleiste und Akzente, nicht die Balken: Die tragen die Farbe der
jeweiligen Partei, und eine Leinwand, die je nach Zuschauer ein anderes
Ergebnis zeigt, wäre kein Ergebnis mehr. Dazu meldet die Leinwand, was mit
dieser Partei geschieht: ein Platz nach vorn, ein gewonnener Sitz, ein
deutlicher Sprung im Anteil – mit Fanfare und Ansage, und rückwärts mit einem
tiefen Ton. Die Einstellung steht im Browser (`localStorage`), nicht in der
Adresse: Ein Verweis auf eine Folie, den jemand im Saal weiterschickt, soll
nicht die Parteifarbe des Absenders mitbringen. Die Regel, welche Veränderung
eine Meldung wert ist, steht als reine Funktion in `src/lib/meldungen.ts`; die
Aufhellung dunkler Parteifarben – Schwarz und Dunkelblau verschwinden auf dem
dunklen Grund – in `src/lib/farben.ts`.

Am Wahlabend selbst zeigt das Dashboard auch die Wahlen, aus denen noch keine
Zahl vorliegt – um 18 Uhr ist die leere Aufstellung die Wahrheit. Im Archiv
fallen sie weg: Eine Stichwahl, zu der es nie ein Ergebnis gab, ist im
Rückblick kein Bild für die Leinwand.

## Ortsseiten

`/<kreis>/<termin>/<behörde>/ort/<ort>` – verlinkt von der Behördenseite
(„Ergebnisse nach Ortschaft“) und aus jeder Ortsratswahl.

Die Wahlseiten sind nach Wahlen geordnet. Am Wahlabend fragt im Saal aber
niemand nach einer Wahl, sondern nach einem Ort: „Was ist in Rössing
passiert?“ Diese Seite dreht die Sicht um und trägt zusammen, was sonst an
fünf Stellen steht – die Ortsratswahl, dazu der Anteil des Ortes an
Gemeinderats-, Bürgermeister-, Kreistags- und Landratswahl, die Bewerber des
Ortsrats und die Wahlbezirke des Ortes.

Möglich ist das, weil die Wahlleitung jedem Ortsteil dieselbe Gebiets-Id gibt,
gleich in welcher Wahl – und diese Id zugleich das Wahlgebiet der
Ortsratswahl ist. Wo eine Quelle keine Ortsteile führt (die meisten Kreise),
gibt es keine Ortsseiten und auf der Behördenseite keinen Abschnitt dazu.

**Sitze gibt es nur im eigenen Ortsrat.** Bei allen anderen Wahlen ist der Ort
ein Ausschnitt eines größeren Wahlgebiets und vergibt nichts. Das galt vorher
nicht: Die Seite „Gemeindewahl in Rössing“ verteilte den kompletten
30-köpfigen Gemeinderat nach den Stimmen eines einzigen Ortsteils. Das sah
amtlich aus und war frei erfunden; `sitzeFuer` in `src/lib/seite.ts` rechnet
jetzt nur noch für das Wahlgebiet selbst.

## Generalprobe

Ein zweites Deployment unter `demo.wahlergebnisse.levinkeller.de` spielt den
Wahlabend der Kommunalwahl 2021 noch einmal durch, alle zehn Minuten von vorn:
dieselben Wahlen, dieselben Gebiete, dieselben Bewerberinnen und Bewerber,
Wahlbezirk für Wahlbezirk hereintröpfelnd, mit leichtem Rauschen damit sich
etwas bewegt. Eingeschaltet wird sie mit `WAHLEN_DEMO=1` in beiden Rollen.
Unter dem Schalter endet die Welt am 12.09.2021 – spätere Termine kennt die
Instanz nicht. Sie fragt keine Wahlleitung ab und schreibt über denselben Weg
wie der Poller, weshalb Ticker, Hochrechnung und Live-Zustellung echt
entstehen.

Dass es eine Demo ist, steht im Banner, im Seitentitel und **in jeder
Dashboard-Folie** – was von der Leinwand weitergereicht wird, ist ein Foto
dieser Fläche. Alles Weitere: [docs/demo.md](docs/demo.md).

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

**Das Verzeichnis der Wahlgliederung** (`src/data/wahlgliederung/<termin>.json`)
hält je Wahltermin fest, welche Kreise, Wahlleitungen, Kreiswahlbereiche,
Ortschaften und Wahlbezirke es gibt — und woher jeder Eintrag stammt
(`beleg.herkunft`, `beleg.quelle`). Es gilt **je Termin**: Kreiswahlbereiche und
Ortschaften werden vor Wahlen neu geschnitten, deshalb steht der Zuschnitt von
2021 nur im Verzeichnis von 2021 und wird nie für 2026 herangezogen. Was für
einen Termin nicht veröffentlicht ist, bleibt `unbekannt` und leer statt geraten.
Erzeugt wird es mit `npm run wahlgliederung -- --termin 2026` (aus den
Wahlpräsentationen) bzw. `-- --termin 2021 --db <bestand>` (aus Ergebnisdaten).

Die **Gegenprobe** (`src/lib/abdeckung.ts`, `npm run abdeckung`) hält das
Verzeichnis gegen das, was die Anwendung führt, und trennt drei Fälle: Die
Wahlleitung hat veröffentlicht und wir bilden es nicht ab (unser Fehler); die
Wahlleitung hat nichts veröffentlicht (keine Lücke bei uns, aber sichtbar statt
stillschweigend); die Anwendung führt mehr als das Verzeichnis (Verzeichnis
nachziehen). Der Vergleich mit einem früheren Termin (`--vergleich 2021`) sagt,
was fehlen könnte — als Maßstab, nie als Ersatz.

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
| `npm run e2e` | Playwright gegen den gebauten Server: Karten, Koalitionsrechner, Live-Nachladen, Durchklicken, Mobilbreiten, Dashboard, API und MCP |
| `npm run check` | `astro check` |
| `npm run kassetten` | Die Kassetten des Ansagedienstes neu aufnehmen – einmal mit echtem `OPENAI_API_KEY`, aus der Umgebung oder aus einer `.env` im Projektverzeichnis (steht in `.gitignore`) |

Der Ansagedienst geht **vom Server** aus hinaus. Geprüft wird er deshalb nicht
im Browser, sondern mit vitest im selben Prozess: `nock.back` fängt `fetch` ab
und spielt die Antworten aus `test/kassetten/` ab (`test/ansage-kette.test.ts`).
Ohne `KASSETTEN` gilt der Modus `lockdown` – kein Aufruf verlässt den Prozess,
und eine Anfrage ohne Aufnahme scheitert laut, statt sich etwas auszudenken.
In der CI wird damit keine Inferenz bezahlt.

Verglichen wird über Verfahren und Pfad, **nicht über den Anfragetext**. Der
trägt den ganzen Moderationskontext; verglich man ihn mit, verfiele jede
Kassette, sobald sich ein Wort an der Anweisung ändert. Was die Anwendung
wirklich geschickt hat, schreibt die Kassette trotzdem mit, und die Tests
prüfen es.

Der E2E-Lauf bekommt **keinen** Schlüssel: Der Ansageweg ist dort inert, und
Playwright prüft nur, was ein Browser zeigt – Einblender, Ton nach der ersten
Geste, und die Leiste, die sagt, wenn es still bleibt.

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
| `MODERATIONEN_JE_MINUTE` / `_JE_STUNDE` | `20` / `200` | Bremse vor dem Textmodell, je Prozess und nicht je Zuschauer |
| `ANSAGEN_JE_MINUTE` / `_JE_STUNDE` | `40` / `300` | dasselbe vor dem Sprachmodell |
| `WAHLEN_DEMO` | – | `1` schaltet die Generalprobe ein (docs/demo.md) |
| `WAHLEN_DEMO_ZYKLUS` | `600` | Sekunden je Durchlauf der Generalprobe |
| `WAHLEN_DEMO_BEHOERDEN` | alle des Standard-Kreises | Wahlleitungen, die mitspielen |

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

**Der Bildstand steht auf einem eigenen Zweig `ausgerollt`, nicht auf `main`.**
Ein Merge auf `main` baut das Image, schiebt es nach GHCR und trägt es dort in
beide Overlays ein – Produktion und Generalprobe, immer derselbe Stand. Argo CD
beobachtet diesen Zweig (`targetRevision: ausgerollt` in beiden Applications).

Der Zweig trägt **nur `deploy/`**, sonst nichts – genau das, was Argo CD liest.
Ein Zweig, der den ganzen Baum von `main` mitnähme, müsste bei jedem Deploy
auch `.github/workflows/` mitschreiben, und das ist die eine Art Datei, die der
`GITHUB_TOKEN` je nach Einstellung nicht schreiben darf („refusing to allow a
GitHub App to create or update workflow"). Hier darf er es derzeit; aber die
Ausrollkette am Wahlabend soll nicht daran hängen, ob das so bleibt.

Woher ein Stand kommt, steht deshalb im Commit, nicht im Baum: Jeder Commit auf
`ausgerollt` nennt in seinem Rumpf den `main`-Commit, aus dem er stammt, und das
Bild, das er ausrollt. Die Historie des Zweigs ist damit die Ausrollhistorie.

`main` ist geschützt, dorthin darf die CI nicht schreiben; `ausgerollt` ist es
nicht. Und weil der Ausroll-Commit `main` nie berührt, löst er auch keinen
weiteren Deploy aus.

**Rollback** ist ein Revert auf `ausgerollt` – ohne `main` anzufassen und ohne
PR:

```sh
gh workflow run zurueckrollen.yml -f schritte=1
```

Oder von Hand: den Zweig auf seinen Vorgänger setzen. Argo CD zieht den vorigen
Stand innerhalb von Sekunden wieder hoch. Der nächste Merge auf `main` rollt
wieder vorwärts aus – ein Rollback hält also nur, bis der Fehler auf `main`
behoben ist.

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
