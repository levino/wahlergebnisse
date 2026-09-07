"""Gemeindegrenzen aller niedersächsischen Kreise aus dem BKG-WFS VG250
(© GeoBasis-DE / BKG, dl-de/by-2-0).

Ergebnis: src/data/geo/gemeinden/<kreis>.geo.json — eine Datei je Kreis
(5-stelliger Kreisschlüssel, z. B. 03254 für den Landkreis Hildesheim), damit
eine Seite nur die Grenzen lädt, die sie zeichnet. Pro Gemeinde ein Feature mit
  ags        8-stelliger Gemeindeschlüssel (03254026)
  behoerde   AGS der votemanager-Behörde (Samtgemeinde-Mitglieder → 032545406)
  name, bez  Name und Bezeichnung (Stadt/Gemeinde)

Der WFS ist ein öffentlicher Dienst: Alle 964 Gemeinden kommen in *einer*
Abfrage, das Rohergebnis landet im Zwischenspeicher unter scripts/.cache/.
Mit --neu wird es verworfen und frisch geholt.

    python3 scripts/geo_gemeinden.py [--neu]
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from geo_common import fetch, simplify_geometry, round_geometry, write_geojson

# gf=4 lässt die reinen Gewässerflächen weg; ohne den Filter lägen an der Küste
# zusätzlich 26 Wasser-Objekte in den Dateien, die keine Gemeinde sind.
URL = ("https://sgx.geodatenzentrum.de/wfs_vg250?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature"
       "&TYPENAMES=vg250:vg250_gem&OUTPUTFORMAT=application/json&SRSNAME=EPSG:4326"
       "&COUNT=2000&CQL_FILTER=sn_l%3D%2703%27%20AND%20gf%3D4")
HIER = os.path.dirname(__file__)
CACHE = os.path.join(HIER, ".cache", "vg250_gem_nds.json")
OUT = os.path.join(HIER, "..", "src", "data", "geo", "gemeinden")
TOL = 0.0004  # ~40 m


def roh(neu=False):
    if not neu and os.path.exists(CACHE):
        print("Zwischenspeicher", CACHE)
        with open(CACHE, "rb") as f:
            return json.loads(f.read().decode("utf-8"))
    d = fetch(URL)
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    with open(CACHE, "wb") as f:
        f.write(d)
    print("geholt", URL, len(d), "Bytes")
    return json.loads(d.decode("utf-8"))


def main():
    d = roh("--neu" in sys.argv)
    if d.get("numberReturned") != d.get("numberMatched"):
        sys.exit(f"WFS hat nur {d.get('numberReturned')} von {d.get('numberMatched')} geliefert")

    je_kreis = {}
    ohne_geometrie = []
    for f in d["features"]:
        p = f["properties"]
        ars = p["ars"]  # 032545406013 für Eime → Samtgemeinde 032545406
        if not f.get("geometry"):
            ohne_geometrie.append((p["ags"], p["gen"]))
            continue
        sg = ars[:9] if ars[5] == "5" else None  # Verbandsschlüssel 5xxx = Samtgemeinde
        je_kreis.setdefault(ars[:5], []).append({
            "type": "Feature",
            "properties": {"ags": p["ags"], "behoerde": sg or p["ags"], "name": p["gen"], "bez": p["bez"], "samtgemeinde": bool(sg)},
            "geometry": round_geometry(simplify_geometry(f["geometry"], TOL)),
        })

    # Alte Einzeldateien wegräumen, sonst bleiben Kreise stehen, die der WFS
    # nicht mehr führt (Gebietsreform).
    os.makedirs(OUT, exist_ok=True)
    for name in sorted(os.listdir(OUT)):
        if name.endswith(".geo.json") and name[:-9] not in je_kreis:
            os.remove(os.path.join(OUT, name))
            print("entfernt", name)

    gesamt = 0
    for kreis in sorted(je_kreis):
        feats = sorted(je_kreis[kreis], key=lambda x: x["properties"]["ags"])
        pfad = os.path.join(OUT, f"{kreis}.geo.json")
        write_geojson(pfad, feats)
        gesamt += os.path.getsize(pfad)
    print(f"\n{len(je_kreis)} Kreise, {sum(len(v) for v in je_kreis.values())} Gemeinden, {gesamt} Bytes gesamt")
    if ohne_geometrie:
        print("\nOhne Geometrie im BKG-Bestand (nicht in den Dateien):")
        for ags, name in ohne_geometrie:
            print(" ", ags, name)


if __name__ == "__main__":
    main()
