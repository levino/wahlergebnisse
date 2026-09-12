"""Lädt einen kleinen, aber vollständigen Ausschnitt der echten votemanager-
Dateien als Test-Fixtures (test/fixtures/votemanager/…, Pfade wie auf dem
Server). Die Tests und der Mock-Server (test/mock-votemanager.ts) arbeiten
ausschließlich damit – kein Netz in der CI.

  python3 scripts/fixtures_holen.py
"""
import json, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from geo_common import fetch

BASE = "https://wahlen.kreis-hi.de/wahlen"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "test", "fixtures", "votemanager")

# (Termin, Behörde, API-Pfad, Wahl-Ordner)
AUSWAHL = [
    # Kommunalwahl 2016 – der Vergleichstermin der Generalprobe. Nur die
    # Gemeindewahl, und nur Nordstemmen: Daran hängt der Nachweis, dass die
    # Probe in die echte Hochrechnung läuft und nicht in die Fortschreibung.
    ("20160911", "03254026", "api/praesentation", ["wahl_6"]),
    ("20210912", "03254000", "api/praesentation", ["wahl_28", "wahl_31"]),
    ("20210912", "03254026", "api/praesentation", ["wahl_27", "wahl_28", "wahl_29", "wahl_31"]),
    ("20260913", "03254000", "daten/api", ["wahl_44", "wahl_45"]),
    ("20260913", "03254026", "daten/api", ["wahl_51", "wahl_52", "wahl_53"]),
    # Bürgermeisterwahl 2020 – nur Nordstemmen, mit Stichwahl
    ("20200913", "03254026", "api/praesentation", ["wahl_24", "wahl_26"]),
    # Zwei Vorwerte von Direktwahlen (scripts/quellen/nds-vorwerte.json). Sie
    # sind der Beleg dafür, dass ein Amt seinen Vergleichswert außerhalb der
    # Kommunalwahl haben kann – und dass er je Behörde woanders liegt:
    # Bad Salzdetfurth hat seinen Bürgermeister am 16.12.2018 gewählt (mit
    # Stichwahl am 06.01.2019), Algermissen seinen am 05.03.2023, und 2021 stand
    # in beiden Städten kein Bürgermeister zur Wahl. Ohne diese Termine stünde
    # neben ihrer Bürgermeisterwahl 2026 überhaupt kein Vorwert.
    ("20181216", "03254005", "api/praesentation", ["wahl_13", "wahl_14"]),
    ("20230305", "03254003", "daten/api", ["wahl_39"]),
    # Bad Salzdetfurth 2026 – die Gegenprobe: Neben der Bürgermeisterwahl
    # gehört die von 2018, neben die Stadtratswahl die Kommunalwahl 2021. Ohne
    # diese Behörde ließe sich nicht zeigen, dass beide Vergleiche gleichzeitig
    # stimmen müssen.
    ("20260913", "03254005", "daten/api", ["wahl_78", "wahl_80"]),
]
EINZELN = ["termin.json", "config.json", "wahlraeume_uebersicht.json", "neuste_ergebnisse.json", "open_data.json"]

def speichern(rel, body):
    ziel = os.path.join(OUT, rel)
    os.makedirs(os.path.dirname(ziel), exist_ok=True)
    with open(ziel, "wb") as f:
        f.write(body)

def listing(url):
    html = fetch(url).decode("utf-8", "replace")
    return re.findall(r'<a href="([^"?/][^"]*\.json)">', html)

n = 0
for termin, ags, api, wahlen in AUSWAHL:
    for datei in EINZELN:
        try:
            speichern(f"{termin}/{ags}/{api}/{datei}", fetch(f"{BASE}/{termin}/{ags}/{api}/{datei}"))
            n += 1
        except Exception as e:
            print("übersprungen", termin, ags, datei, e)
    # Open-Data-CSVs: daraus kommen die Listenplätze der Bewerber.
    # Achtung, die Datei liegt je Schema woanders: in v22 bei der API, in v26
    # bei den CSVs (siehe openDataUrl in src/data/termine.ts). Wer sie in v26
    # bei der API sucht, bekommt 404 – und damit keine Listenplätze.
    try:
        csv_basis = f"{termin}/{ags}/" + ("praesentation" if api.startswith("api") else "daten/opendata")
        od_pfad = f"{termin}/{ags}/{api}/open_data.json" if api.startswith("api") else f"{csv_basis}/open_data.json"
        od_roh = fetch(f"{BASE}/{od_pfad}")
        speichern(od_pfad, od_roh)
        od = json.loads(od_roh)
        for c in od.get("csvs", []):
            try:
                speichern(f"{csv_basis}/{c['url']}", fetch(f"{BASE}/{csv_basis}/{c['url']}"))
                n += 1
            except Exception as e:
                print("  CSV übersprungen", c["url"], e)
    except Exception as e:
        print("  open_data.json übersprungen", ags, e)

    for wahl in wahlen:
        for datei in listing(f"{BASE}/{termin}/{ags}/{api}/{wahl}/"):
            if datei.startswith("gesamtansicht") or datei.startswith("wahlbeteiligung") or datei.startswith("neueste"):
                continue  # für die App irrelevant, spart Platz
            speichern(f"{termin}/{ags}/{api}/{wahl}/{datei}", fetch(f"{BASE}/{termin}/{ags}/{api}/{wahl}/{datei}"))
            n += 1
        print(termin, ags, wahl, "fertig", flush=True)
print(n, "Dateien nach", OUT)
