"""Ortsteil-Flächen für den Landkreis Hildesheim.

Zwei Quellen, weil keine allein reicht:
  1. LGLN Gemarkungen (Verwaltungsgrenzen-WFS, © LGLN, dl-de/by-2-0): In den
     Flächengemeinden entspricht eine Gemarkung fast immer dem Ortsteil/der Ortschaft.
     Der WFS kennt keinen brauchbaren Filter, deshalb wird der Landesdatensatz
     seitenweise geladen und auf lk=03254 gefiltert.
  2. OpenStreetMap-Verwaltungsgrenzen (ODbL) für die Ortsteile der Stadt Hildesheim
     (dort sind Gemarkungen und Ortschaften nicht deckungsgleich), per Nominatim.

Ergebnis: src/data/geo/ortsteile.geo.json — Features mit
  ags        8-stelliger Gemeindeschlüssel
  name       Gemarkungs-/Ortsteilname (Zuordnung zu votemanager-Ortsteilen: src/lib/geo.ts)
  quelle     "lgln" | "osm"
"""
import os, re, sys, time, json, urllib.parse
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from geo_common import fetch, fetch_json, gml_polygons, simplify_geometry, round_geometry, write_geojson

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "src", "data", "geo", "ortsteile.geo.json")
TOL = 0.0003
WFS = "https://opendata.lgln.niedersachsen.de/doorman/noauth/verwaltungsgrenzen_wfs"
PAGE = 500

def gemarkungen():
    feats, start = [], 0
    while True:
        url = (f"{WFS}?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=ms:ni_gemarkungen"
               f"&SRSNAME=EPSG:4326&COUNT={PAGE}&STARTINDEX={start}")
        g = fetch(url, timeout=300).decode("utf-8")
        items = re.findall(r'<ms:ni_gemarkungen gml:id="[^"]+">(.*?)</ms:ni_gemarkungen>', g, re.S)
        hit = 0
        for f in items:
            if "<ms:lk>03254<" not in f:
                continue
            hit += 1
            name = re.search(r"<ms:gemarkung>([^<]+)", f).group(1)
            gem = re.search(r"<ms:gem>([^<]+)", f).group(1)
            gemeinde = re.search(r"<ms:gemeinde>([^<]+)", f).group(1)
            polys = gml_polygons(f)
            geom = {"type": "MultiPolygon", "coordinates": polys} if len(polys) > 1 else {"type": "Polygon", "coordinates": polys[0]}
            feats.append({"type": "Feature", "properties": {"ags": gem, "gemeinde": gemeinde, "name": name, "quelle": "lgln"},
                          "geometry": round_geometry(simplify_geometry(geom, TOL))})
        print(f"page start={start}: {len(items)} features, {hit} im LK Hildesheim", flush=True)
        if len(items) < PAGE:
            break
        start += PAGE
    return feats

HILDESHEIM = {
    "Achtum-Uppen": ["Achtum-Uppen"],
    "Bavenstedt": ["Bavenstedt"],
    "Drispenstedt": ["Drispenstedt"],
    "Einum": ["Einum"],
    "Himmelsthür": ["Himmelsthür"],
    "Itzum-Marienburg": ["Itzum", "Marienburg"],
    "Marienburger Höhe-Galgenberg": ["Marienburger Höhe", "Galgenberg"],
    "Moritzberg und Bockfeld": ["Moritzberg", "Bockfeld"],
    "Neuhof-Hildesheimer Wald-Marienrode": ["Neuhof", "Hildesheimer Wald", "Marienrode"],
    "Nordstadt": ["Nordstadt"],
    "Ochtersum": ["Ochtersum"],
    "Oststadt und Stadtfeld": ["Oststadt", "Stadtfeld"],
    "Sorsum": ["Sorsum"],
    "Stadtmitte Neustadt": ["Stadtmitte", "Neustadt"],
}

def osm_hildesheim():
    feats = []
    for ortsteil, queries in HILDESHEIM.items():
        for q in queries:
            url = ("https://nominatim.openstreetmap.org/search?" +
                   urllib.parse.urlencode({"q": f"{q}, Hildesheim", "format": "jsonv2", "polygon_geojson": 1, "limit": 5}))
            res = fetch_json(url)
            time.sleep(1.1)
            hit = next((r for r in res if r.get("category") == "boundary" and r.get("type") == "administrative"
                        and r.get("geojson", {}).get("type") in ("Polygon", "MultiPolygon")
                        and "Hildesheim" in r.get("display_name", "")), None)
            if not hit:
                print("  OSM: keine Grenze für", q, flush=True)
                continue
            feats.append({"type": "Feature",
                          "properties": {"ags": "03254021", "gemeinde": "Hildesheim", "name": ortsteil, "teil": q, "quelle": "osm",
                                         "osm": f"{hit['osm_type']}/{hit['osm_id']}"},
                          "geometry": round_geometry(simplify_geometry(hit["geojson"], TOL))})
            print("  OSM:", ortsteil, "<-", q, hit["osm_type"], hit["osm_id"], flush=True)
    return feats

feats = gemarkungen()
feats += osm_hildesheim()
write_geojson(OUT, feats)
