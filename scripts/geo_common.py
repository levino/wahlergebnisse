"""Gemeinsame Helfer für die Geodaten-Skripte (reines Python, keine GIS-Abhängigkeiten)."""
import json, math, re, time, urllib.request, urllib.parse, os

UA = "wahlergebnisse-hildesheim/1.0 (post@levinkeller.de)"

def fetch(url, timeout=120):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()

def fetch_json(url, timeout=120):
    return json.loads(fetch(url, timeout).decode("utf-8"))

# --- Douglas-Peucker (Koordinaten in Grad; Toleranz in Grad) ---
def _dist(p, a, b):
    (x, y), (x1, y1), (x2, y2) = p, a, b
    dx, dy = x2 - x1, y2 - y1
    if dx == 0 and dy == 0:
        return math.hypot(x - x1, y - y1)
    t = max(0.0, min(1.0, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)))
    return math.hypot(x - (x1 + t * dx), y - (y1 + t * dy))

def simplify_ring(pts, tol):
    if len(pts) < 5:
        return pts
    closed = pts[0] == pts[-1]
    core = pts[:-1] if closed else pts
    def dp(seq):
        if len(seq) < 3:
            return seq
        a, b = seq[0], seq[-1]
        idx, dmax = 0, 0.0
        for i in range(1, len(seq) - 1):
            d = _dist(seq[i], a, b)
            if d > dmax:
                idx, dmax = i, d
        if dmax > tol:
            return dp(seq[: idx + 1])[:-1] + dp(seq[idx:])
        return [a, b]
    # Ring in zwei Hälften teilen, damit Start=Ende nicht alles plattmacht
    h = len(core) // 2
    out = dp(core[: h + 1])[:-1] + dp(core[h:] + [core[0]])[:-1]
    if len(out) < 3:
        out = core
    return out + [out[0]]

def simplify_geometry(geom, tol):
    t = geom["type"]
    if t == "Polygon":
        return {"type": t, "coordinates": [simplify_ring([tuple(map(float, c)) for c in r], tol) for r in geom["coordinates"]]}
    if t == "MultiPolygon":
        return {"type": t, "coordinates": [[simplify_ring([tuple(map(float, c)) for c in r], tol) for r in poly] for poly in geom["coordinates"]]}
    return geom

def round_geometry(geom, nd=5):
    def rr(c):
        return [round(c[0], nd), round(c[1], nd)]
    t = geom["type"]
    if t == "Polygon":
        return {"type": t, "coordinates": [[rr(c) for c in r] for r in geom["coordinates"]]}
    if t == "MultiPolygon":
        return {"type": t, "coordinates": [[[rr(c) for c in r] for r in poly] for poly in geom["coordinates"]]}
    return geom

def gml_polygons(fragment):
    """Extrahiert alle gml:Polygon (posList lat lon …) aus einem GML-Feature → Liste von Polygon-Koordinaten [[ring…]] in [lon, lat]."""
    polys = []
    for poly in re.findall(r"<gml:Polygon[^>]*>(.*?)</gml:Polygon>", fragment, re.S):
        rings = []
        for kind in ("exterior", "interior"):
            for ring in re.findall(rf"<gml:{kind}>(.*?)</gml:{kind}>", poly, re.S):
                m = re.search(r"<gml:posList[^>]*>([^<]+)</gml:posList>", ring)
                if not m:
                    continue
                nums = list(map(float, m.group(1).split()))
                pts = [(nums[i + 1], nums[i]) for i in range(0, len(nums) - 1, 2)]  # lat lon → lon lat
                rings.append(pts)
        if rings:
            polys.append(rings)
    return polys

def write_geojson(path, features):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"type": "FeatureCollection", "features": features}, f, ensure_ascii=False, separators=(",", ":"))
    print("wrote", path, os.path.getsize(path), "bytes,", len(features), "features")
