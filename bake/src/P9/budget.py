"""P9 budget: layer count and pixel memory (w*h*8) of the current theme and of the proposed baked scene per mode.

The current count re-implements, read-only, shared/hud.js _plan() / rebuild accounting (Nov 2026):
  - every non-image widget (wbback, dial, wbgear, wbsign, ...) is one effect layer (0 bytes);
  - image widgets (text, icon, ...) are packed into sheets per (class, z, conn) in file order, a sheet's box limited to
    maxPx = 1920*720/4 and to packWaste x its members' own area; both limits double while a connection has > 8 layers;
  - a sheet / own image costs w*h*8; glyph atlases (atext) add w*h*2 (none in the wb layouts);
  - assets (cluster_render_client.asset: RGBA8 / R8 sampled by an effect layer) are NOT layers; they cost w*h*bpp*2.
"""
import json
import math
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))
LAYOUTS = os.path.join(ROOT, "apps", "f30_cluster", "hud", "layouts")
IMAGE_TYPES = {"text", "scale", "stripe", "badge", "gridlabels", "icon", "swatchimg"}
LAYER_BUDGET, MAX_CONN, AREA = 8, 4, 1920 * 720
MIB = 1024 * 1024


def _conn(w):
    n = w.get("conn", 0)
    n = int(math.floor(n)) if isinstance(n, (int, float)) else 0
    return max(0, min(MAX_CONN - 1, n))


def _hit(a, b):
    return a["x"] < b["x"] + b["w"] and b["x"] < a["x"] + a["w"] and a["y"] < b["y"] + b["h"] and b["y"] < a["y"] + a["h"]


def plan(widgets, max_px, waste):
    P = []
    for w in widgets:
        klass, z, conn = w.get("class", "content"), w.get("z", 0), _conn(w)
        if w["type"] not in IMAGE_TYPES or w.get("own") is True:
            P.append({"kind": "layer", "w": w, "klass": klass, "z": z, "conn": conn})
            continue
        after = -1
        for i, e in enumerate(P):
            if e["klass"] != klass or e["z"] != z or e["conn"] != conn:
                continue
            if (_hit(e["w"], w) if e["kind"] == "layer" else any(_hit(m, w) for m in e["members"])):
                after = i
        sheet = None
        for i in range(after + 1, len(P)):
            s = P[i]
            if s["kind"] != "sheet" or s["klass"] != klass or s["z"] != z or s["conn"] != conn:
                continue
            x, y = min(s["x"], w["x"]), min(s["y"], w["y"])
            uw, uh = max(s["x"] + s["w"], w["x"] + w["w"]) - x, max(s["y"] + s["h"], w["y"] + w["h"]) - y
            own = sum(m["w"] * m["h"] for m in s["members"]) + w["w"] * w["h"]
            if uw * uh <= max_px and uw * uh <= waste * own:
                sheet = s
                s.update(x=x, y=y, w=uw, h=uh)
                break
        if sheet is None:
            P.append({"kind": "sheet", "klass": klass, "z": z, "conn": conn, "x": w["x"], "y": w["y"], "w": w["w"],
                      "h": w["h"], "members": [w]})
        else:
            sheet["members"].append(w)
    return P


def counts(P):
    c = {}
    for e in P:
        c[e["conn"]] = c.get(e["conn"], 0) + 1
    return [c.get(i, 0) for i in range(max(c) + 1)] if c else []


def current(layout_name):
    lay = json.load(open(os.path.join(LAYOUTS, layout_name + ".json")))
    widgets = [w for w in lay["widgets"] if not w.get("toggle") and not w.get("themes")]
    waste = lay.get("packWaste", math.inf)
    max_px = AREA // 4
    P = plan(widgets, max_px, waste)
    while any(k > LAYER_BUDGET for k in counts(P)) and (max_px != math.inf or waste != math.inf):
        max_px = math.inf if max_px * 2 >= AREA else max_px * 2
        waste = math.inf if waste * 2 > 64 else waste * 2
        P = plan(widgets, max_px, waste)
    effects = [e for e in P if e["kind"] == "layer" and e["w"]["type"] not in IMAGE_TYPES]
    sheets = [e for e in P if e["kind"] == "sheet"]
    px = sum(s["w"] * s["h"] * 8 for s in sheets) + sum(e["w"]["w"] * e["w"]["h"] * 8 for e in P
                                                        if e["kind"] == "layer" and e["w"]["type"] in IMAGE_TYPES)
    return {"layout": layout_name, "widgets": len(widgets), "layers": len(P), "per_connection": counts(P),
            "effects": [{"id": e["w"]["id"], "type": e["w"]["type"], "conn": e["conn"], "box": [e["w"]["x"], e["w"]["y"], e["w"]["w"], e["w"]["h"]]} for e in effects],
            "sheets": [{"conn": s["conn"], "z": s["z"], "box": [s["x"], s["y"], s["w"], s["h"]], "bytes_by_8wh": s["w"] * s["h"] * 8,
                        "members": [m["id"] for m in s["members"]]} for s in sheets],
            "pixel_bytes": px, "pixel_mib": round(px / MIB, 3),
            "sheet_limit_px": None if max_px == math.inf else max_px, "waste": None if waste == math.inf else waste}


def mib(b):
    return round(b / MIB, 3)
