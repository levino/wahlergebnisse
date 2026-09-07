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
    ("20210912", "03254000", "api/praesentation", ["wahl_28", "wahl_31"]),
    ("20210912", "03254026", "api/praesentation", ["wahl_27", "wahl_28", "wahl_29", "wahl_31"]),
    ("20260913", "03254000", "daten/api", ["wahl_44", "wahl_45"]),
    ("20260913", "03254026", "daten/api", ["wahl_51", "wahl_52", "wahl_53"]),
    # Bürgermeisterwahl 2020 – nur Nordstemmen, mit Stichwahl
    ("20200913", "03254026", "api/praesentation", ["wahl_24", "wahl_26"]),
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
    # Open-Data-CSVs: daraus kommen die Listenplätze der Bewerber
    try:
        od = json.loads(fetch(f"{BASE}/{termin}/{ags}/{api}/open_data.json"))
        csv_basis = f"{termin}/{ags}/" + ("praesentation" if api.startswith("api") else "daten/opendata")
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
