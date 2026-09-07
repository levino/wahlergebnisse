"""Gemeindegrenzen des Landkreises Hildesheim aus dem BKG-WFS VG250 (© GeoBasis-DE / BKG, dl-de/by-2-0).

Ergebnis: src/data/geo/gemeinden.geo.json — pro Gemeinde ein Feature mit
  ags        8-stelliger Gemeindeschlüssel (03254026)
  behoerde   AGS der votemanager-Behörde (Samtgemeinde-Mitglieder → 032545406)
  name, bez  Name und Bezeichnung (Stadt/Gemeinde)
"""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
from geo_common import fetch_json, simplify_geometry, round_geometry, write_geojson

URL = ("https://sgx.geodatenzentrum.de/wfs_vg250?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature"
       "&TYPENAMES=vg250:vg250_gem&OUTPUTFORMAT=application/json&SRSNAME=EPSG:4326"
       "&CQL_FILTER=sn_l%3D%2703%27%20AND%20sn_r%3D%272%27%20AND%20sn_k%3D%2754%27")
OUT = os.path.join(os.path.dirname(__file__), "..", "src", "data", "geo", "gemeinden.geo.json")
TOL = 0.0004  # ~40 m

d = fetch_json(URL)
feats = []
for f in d["features"]:
    p = f["properties"]
    ars = p["ars"]  # 032545406013 für Eime → Samtgemeinde 032545406
    sg = ars[:9] if ars[5] == "5" else None  # Verbandsschlüssel 5xxx = Samtgemeinde
    feats.append({
        "type": "Feature",
        "properties": {"ags": p["ags"], "behoerde": sg or p["ags"], "name": p["gen"], "bez": p["bez"], "samtgemeinde": bool(sg)},
        "geometry": round_geometry(simplify_geometry(f["geometry"], TOL)),
    })
feats.sort(key=lambda x: x["properties"]["ags"])
write_geojson(OUT, feats)
for f in feats:
    print(f["properties"])
