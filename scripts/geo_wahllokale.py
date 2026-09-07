"""Wahllokale (Wahlräume) beider Termine mit Koordinaten.

Adressen kommen aus votemanager (2021: wahlraum_<id>.json je Behörde, 2026:
daten/opendata/opendata-wahllokale.csv). Geocodiert wird einmalig über
Nominatim (OSM, ODbL) mit einem Cache je Adresse (scripts/geocode-cache.json).

Ergebnis: src/data/geo/wahllokale.geo.json — Point-Features mit
  termin, behoerde (AGS), wahlbezirk (Nr.), wahlraum (votemanager-Id, nur 2021), name, adresse
"""
import csv, io, json, os, re, sys, time, urllib.parse
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from geo_common import fetch, fetch_json, write_geojson

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "src", "data", "geo", "wahllokale.geo.json")
CACHE = os.path.join(HERE, "geocode-cache.json")
BEHOERDEN = ["03254002","03254003","03254005","03254008","03254011","03254014","03254017","03254020","03254021",
             "03254022","03254026","03254028","03254029","03254032","03254042","03254044","03254045","032545406"]
BASE = "https://wahlen.kreis-hi.de/wahlen"

cache = json.load(open(CACHE)) if os.path.exists(CACHE) else {}

import urllib.error

def nominatim(q):
    """Nominatim mit Backoff bei 429; danach Photon (komoot) als zweite Quelle."""
    for wartezeit in (0, 30, 90):
        try:
            time.sleep(wartezeit)
            res = fetch_json("https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(
                {"q": q + ", Deutschland", "format": "jsonv2", "limit": 1, "countrycodes": "de"}))
            time.sleep(1.6)
            if res:
                return [float(res[0]["lat"]), float(res[0]["lon"])]
            break
        except urllib.error.HTTPError as e:
            if e.code != 429:
                raise
            print("  429 von Nominatim, warte …", flush=True)
    try:
        ph = fetch_json("https://photon.komoot.io/api/?" + urllib.parse.urlencode({"q": q, "limit": 1, "lang": "de"}))
        time.sleep(1.0)
        f = (ph.get("features") or [None])[0]
        if f and f["properties"].get("countrycode") == "DE":
            lon, lat = f["geometry"]["coordinates"]
            return [float(lat), float(lon)]
    except Exception as e:
        print("  Photon-Fehler:", e, flush=True)
    return None

def varianten(key):
    """Schreibweisen, die Geocoder verstehen: ohne vorangestellten Ortsteil, ohne doppelten Ortsnamen, ohne Hausnummer."""
    out = [key]
    teile = [t.strip() for t in key.split(",")]
    if len(teile) >= 3:
        out.append(", ".join(teile[1:]))          # "Moritzberg, Bergstraße 60, 31137 Hildesheim" → ohne Ortsteil
    out.append(re.sub(r"\b(\w+)\1\b", r"\1", key))    # "SarstedtSarstedt" → "Sarstedt"
    out.append(re.sub(r"(\d{5}\s+[^\s-]+)-.*$", r"\1", key))  # "31167 Bockenem-Bornum am Harz" → "31167 Bockenem"
    out.append(re.sub(r"\s+\d+\s*[a-zA-Z]?(?=,)", "", key, count=1))  # ohne Hausnummer
    seen, uniq = set(), []
    for v in out:
        if v and v not in seen:
            seen.add(v); uniq.append(v)
    return uniq

def geocode(addr):
    key = re.sub(r"\s+", " ", addr).strip()
    if cache.get(key) is not None:
        return cache[key]
    hit = None
    for v in varianten(key):
        hit = nominatim(v)
        if hit:
            break
    cache[key] = hit
    json.dump(cache, open(CACHE, "w"), ensure_ascii=False, indent=0)
    return hit

def lokale_2021(ags):
    api = f"{BASE}/20210912/{ags}/api/praesentation"
    ue = fetch_json(f"{api}/wahlraeume_uebersicht.json")
    out = []
    for w in ue["wahlraeume"]:
        r = fetch_json(f"{api}/wahlraum_{w['id']}.json")
        bez = w["bezirke"][0]
        out.append({"termin": "2021", "behoerde": ags, "wahlbezirk": bez.split(" - ")[0].strip(), "wahlraum": w["id"], "bezirk": bez,
                    "ortsteil": w["bezirke"][1] if len(w["bezirke"]) > 1 else "",
                    "name": r["titel"], "adresse": f"{r.get('strasse_hnr','')}, {r.get('plz_ort','')}".strip(", ")})
    return out

def lokale_2026(ags):
    raw = fetch(f"{BASE}/20260913/{ags}/daten/opendata/opendata-wahllokale.csv").decode("utf-8-sig")
    out = []
    for row in csv.DictReader(io.StringIO(raw), delimiter=";"):
        if row.get("Bezirk-Art", "W") != "W":
            continue
        out.append({"termin": "2026", "behoerde": ags, "wahlbezirk": row["Bezirk-Nr"], "wahlraum": None, "bezirk": row["Bezirk-Name"],
                    "ortsteil": "", "name": row["Wahlraum-Bezeichnung"], "adresse": row["Wahlraum-Adresse"]})
    return out

feats = []
for ags in BEHOERDEN:
    for fn in (lokale_2021, lokale_2026):
        try:
            rows = fn(ags)
        except Exception as e:
            print("FEHLER", fn.__name__, ags, e, flush=True)
            continue
        for r in rows:
            ll = geocode(r["adresse"]) if r["adresse"] else None
            if not ll:
                print("  nicht geocodiert:", r["termin"], ags, r["name"], r["adresse"], flush=True)
            feats.append({"type": "Feature", "properties": r,
                          "geometry": {"type": "Point", "coordinates": [ll[1], ll[0]]} if ll else None})
        print(ags, fn.__name__, len(rows), flush=True)
write_geojson(OUT, feats)
