"""P3: the two mini gauges, C3 (fuel) and C4 (oil temperature), COMFORT, G20 geometry (R 70).

One command regenerates every file of C3 and C4 (assets, merged images, manifests):

    cd bake/src && $PY -m C3.build            # then: $PY -m C3.qc_run  (fit numbers -> manifests + report)

Everything is drawn here from numbers measured on the rectified crops (bake/src/C3/measure/*.py);
no reference pixel is copied. The geometry is written in the FUEL convention (C3 as it stands: scale on the left,
0 low right, clockwise to 1/1 at the top); C4 is its left-right mirror (u -> -u), only its zones and pictogram differ.

Frames (all in R units of the mini gauge, y down):
  bezel frame  origin = the bezel centre = the theme's gauge centre (80, 628) / (1840, 628).
  scale frame  origin = bezel centre + (SCALE_DX, 0): the ticks, the inner arc and the zones are concentric about a
               point 0.046 R toward the main dial (measured in 17, 04, 07, both gauges; see the report).
Angles: cw12 degrees (clockwise from 12 o'clock), fuel convention.
"""
import json
import math
import os
import sys

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from common import imageio  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
BAKED = os.path.join(ROOT, "apps", "f30_cluster", "hud", "baked")
MAN = os.path.join(ROOT, "bake", "manifest")

R = 70.0
GAUGES = {
    "C3": {"name": "fuel", "c": (80.0, 628.0), "mirror": False},
    "C4": {"name": "oil", "c": (1840.0, 628.0), "mirror": True},
}
BOX = 144                                   # layer box, panel px (covers r <= 1.028 R)

# ---------------------------------------------------------------- measured parameters (fuel convention)
P = {  # measured (bake/src/C3/measure/*.py), then tuned with C3.fit against 17 / 04 / 07 (fit_log.json)
    "face": {"r_out": 0.955, "rgb": [0.012, 0.016, 0.024]},
    "bezel": {"r_peak": 0.977, "sigma": 0.0197, "rim_r": 0.910, "rim_sigma": 0.014, "rim_gain": 0.18,
              "gap_from": 27.0, "gap_to": 121.0, "gap_soft_deg": 3.0,
              "rgb": [0.80, 0.81, 0.83], "base_gain": 0.24,
              "hl_peak_cw12": 224.5, "hl_width_deg": 41.2, "hl_gain": 0.57},
    "scale": {"dx": 0.0458, "dy": 0.0, "a0": 157.05, "pitch": 9.132, "n": 20, "major_every": 5},
    "ticks": {"major_r": [0.635, 0.807], "major_w": 0.0416, "minor_r": [0.714, 0.773], "minor_w": 0.023,
              "rgb": [0.93, 0.93, 0.93], "minor_gain": 0.83},
    "arc": {"r": 0.591, "w": 0.030, "rgb": [0.50, 0.51, 0.53],
            "fade_in": [161.2, 171.4], "fade_out": [336.0, 348.0]},
    "zone": {"bar_r": [0.708, 0.798], "end_r": [0.658, 0.800], "end_w": 0.030, "gap_deg": 2.5,
             "low_to": 0.1174, "high_from": 0.8882, "end_over_deg": 1.0,
             "red": [0.86, 0.24, 0.21], "blue": [0.18, 0.60, 0.93]},
}

# the in-gauge pictograms (our own generic shapes; proportions from 04 / 17 / 07), bezel frame, R units,
# in each gauge's OWN orientation (not mirrored): polygons are lists of (u, v); "holes" are cut out.
ICONS = {
    "C3": {  # fuel pump + filler-side arrow, upper right of the fuel gauge
        "fill": [
            [(0.135, -0.790), (0.255, -0.790), (0.255, -0.615), (0.135, -0.615)],                  # body
            [(0.120, -0.615), (0.270, -0.615), (0.270, -0.590), (0.120, -0.590)],                  # foot
            [(0.255, -0.765), (0.300, -0.725), (0.300, -0.640), (0.285, -0.625), (0.270, -0.640),  # hose + nozzle
             (0.280, -0.650), (0.280, -0.717), (0.255, -0.740)],
            [(0.322, -0.728), (0.322, -0.652), (0.372, -0.690)],                                   # arrow
        ],
        "holes": [[(0.155, -0.768), (0.235, -0.768), (0.235, -0.700), (0.155, -0.700)]],         # window
        "bbox": [0.120, -0.790, 0.372, -0.590],
    },
    "C4": {  # oil can, upper left of the oil gauge
        "fill": [
            [(-0.250, -0.690), (-0.090, -0.690), (-0.075, -0.595), (-0.250, -0.595)],             # can body
            [(-0.205, -0.735), (-0.150, -0.735), (-0.150, -0.690), (-0.205, -0.690)],             # neck
            [(-0.225, -0.750), (-0.130, -0.750), (-0.130, -0.732), (-0.225, -0.732)],             # lid
            [(-0.250, -0.680), (-0.335, -0.718), (-0.342, -0.700), (-0.250, -0.650)],             # spout
            [(-0.090, -0.680), (-0.040, -0.700), (-0.025, -0.660), (-0.040, -0.620), (-0.078, -0.612),
             (-0.080, -0.632), (-0.050, -0.640), (-0.042, -0.663), (-0.050, -0.680), (-0.087, -0.665)],  # handle
        ],
        "drop": (-0.330, -0.635, 0.020),                                                           # cx, cy, r
        "holes": [],
        "bbox": [-0.342, -0.750, -0.025, -0.595],
    },
}


# ---------------------------------------------------------------- sampling helpers
def grid(cl, ss):
    """Supersampled dial-frame coordinates (fuel convention) for the gauge's BOX x BOX layer."""
    g = GAUGES[cl]
    ox, oy = layer_origin(cl)
    o = (np.arange(ss) + 0.5) / ss
    xs = (np.arange(BOX)[:, None] + o[None, :]).ravel() + ox
    ys = (np.arange(BOX)[:, None] + o[None, :]).ravel() + oy
    X, Y = np.meshgrid(xs, ys)
    u = (X - g["c"][0]) / R
    v = (Y - g["c"][1]) / R
    if g["mirror"]:
        u = -u
    return u, v


def layer_origin(cl):
    c = GAUGES[cl]["c"]
    return int(round(c[0] - BOX / 2)), int(round(c[1] - BOX / 2))


def down(a, ss):
    return a.reshape(BOX, ss, BOX, ss).mean(axis=(1, 3)).astype(np.float32)


def cw12(u, v):
    return np.degrees(np.arctan2(u, -v)) % 360.0


def ang_dist(a, b):
    return np.abs((a - b + 180.0) % 360.0 - 180.0)


def scale_angle(frac):
    s = P["scale"]
    return s["a0"] + frac * s["pitch"] * s["n"]


def seg_cov(u, v, cu, cv, ang, r0, r1, hw):
    """Coverage of a radial bar about (cu, cv) at angle ang, r0..r1, half width hw (hard edge, supersampled)."""
    a = math.radians(ang)
    tx, ty = math.sin(a), -math.cos(a)
    du, dv = u - cu, v - cv
    along = du * tx + dv * ty
    across = np.abs(-du * ty + dv * tx)
    return ((along >= r0) & (along <= r1) & (across <= hw)).astype(np.float32)


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


# ---------------------------------------------------------------- elements
def el_face(cl, ss=4):
    u, v = grid(cl, ss)
    r = np.hypot(u, v)
    a = down((r <= P["face"]["r_out"]).astype(np.float32), ss)
    return imageio.rgba(P["face"]["rgb"], a)


def bezel_profile(u, v):
    b = P["bezel"]
    r = np.hypot(u, v)
    ang = cw12(u, v)
    prof = np.exp(-0.5 * ((r - b["r_peak"]) / b["sigma"]) ** 2) + b["rim_gain"] * np.exp(-0.5 * ((r - b["rim_r"]) / b["rim_sigma"]) ** 2)
    # the open side (toward the main dial): soft angular ends
    inside_gap = smooth(b["gap_from"] - b["gap_soft_deg"], b["gap_from"] + b["gap_soft_deg"], ang) * \
        (1 - smooth(b["gap_to"] - b["gap_soft_deg"], b["gap_to"] + b["gap_soft_deg"], ang))
    return np.clip(prof, 0, 1) * (1 - inside_gap), ang


def el_bezel(cl, ss=4):
    u, v = grid(cl, ss)
    prof, ang = bezel_profile(u, v)
    a = down(prof * P["bezel"]["base_gain"], ss)
    return imageio.rgba(P["bezel"]["rgb"], a)


def el_bezel_hl(cl, ss=4):
    """The light on the tube: white with alpha, brightest low on the outer side (lower left on C3, lower right on C4)."""
    u, v = grid(cl, ss)
    prof, ang = bezel_profile(u, v)
    b = P["bezel"]
    g = np.exp(-(ang_dist(ang, b["hl_peak_cw12"]) / b["hl_width_deg"]) ** 2)
    a = down(prof * g * b["hl_gain"], ss)
    return imageio.rgba((1.0, 1.0, 1.0), a)


def el_arc(cl, ss=4):
    u, v = grid(cl, ss)
    s, c = P["scale"], P["arc"]
    r = np.hypot(u - s["dx"], v - s["dy"])
    ang_b = cw12(u, v)
    cov = (np.abs(r - c["r"]) <= c["w"] / 2).astype(np.float32)
    fade = smooth(c["fade_in"][0], c["fade_in"][1], ang_b) * (1 - smooth(c["fade_out"][0], c["fade_out"][1], ang_b))
    fade = fade * (ang_b > 90)
    return imageio.rgba(c["rgb"], down(cov * fade, ss))


def tick_list(cl):
    s = P["scale"]
    out = []
    zones = zone_list(cl)
    for k in range(s["n"] + 1):
        frac = k / s["n"]
        ang = scale_angle(frac)
        if k == 0 or k == s["n"]:
            continue                      # 0: the zone's end tick; top end: "1/1" (live text) or the hot zone
        if any(z0 - 1e-6 <= frac <= z1 + 1e-6 for z0, z1, _ in zones):
            continue                      # under a zone bar
        out.append((k, ang, k % s["major_every"] == 0))
    return out


def el_ticks(cl, ss=4):
    u, v = grid(cl, ss)
    s, t = P["scale"], P["ticks"]
    cov = np.zeros_like(u, dtype=np.float32)
    lum = np.zeros_like(u, dtype=np.float32)
    for k, ang, major in tick_list(cl):
        r0, r1 = t["major_r"] if major else t["minor_r"]
        hw = (t["major_w"] if major else t["minor_w"]) / 2
        c = seg_cov(u, v, s["dx"], s["dy"], ang, r0, r1, hw)
        cov = np.maximum(cov, c)
        lum = np.maximum(lum, c * (1.0 if major else t["minor_gain"]))
    a = down(cov, ss)
    g = np.where(a > 1e-6, down(lum, ss) / np.maximum(a, 1e-6), 1.0)
    out = imageio.rgba(t["rgb"], a)
    out[..., :3] *= g[..., None]
    return out


def zone_list(cl):
    z = P["zone"]
    if cl == "C3":
        return [(0.0, z["low_to"], "red")]
    return [(0.0, z["low_to"], "blue"), (z["high_from"], 1.0, "red")]


def el_zones(cl, ss=4):
    u, v = grid(cl, ss)
    s, z = P["scale"], P["zone"]
    du, dv = u - s["dx"], v - s["dy"]
    r = np.hypot(du, dv)
    ang = cw12(du, dv)
    col = np.zeros(u.shape + (3,), np.float32)
    cov = np.zeros_like(u, dtype=np.float32)
    for f0, f1, name in zone_list(cl):
        rgb = np.array(z[name], np.float32)
        a0, a1 = scale_angle(f0), scale_angle(f1)
        end_at_low = f0 == 0.0
        end_ang = a0 - z["end_over_deg"] if end_at_low else a1 + z["end_over_deg"]
        bar_from = (end_ang + z["gap_deg"]) if end_at_low else a0
        bar_to = a1 if end_at_low else (end_ang - z["gap_deg"])
        bar = ((r >= z["bar_r"][0]) & (r <= z["bar_r"][1]) & (ang >= bar_from) & (ang <= bar_to)).astype(np.float32)
        tick = seg_cov(u, v, s["dx"], s["dy"], end_ang, z["end_r"][0], z["end_r"][1], z["end_w"] / 2)
        c = np.maximum(bar, tick)
        col = np.where(c[..., None] > 0, rgb, col)
        cov = np.maximum(cov, c)
    a = down(cov, ss)
    pm = np.stack([down(col[..., i] * cov, ss) for i in range(3)], -1)
    out = np.zeros((BOX, BOX, 4), np.float32)
    out[..., :3] = np.where(a[..., None] > 1e-6, pm / np.maximum(a[..., None], 1e-6), 0)
    out[..., 3] = a
    return out


def el_icon(cl, ss=8):
    """Pictogram: polygons in the gauge's own orientation (bezel frame), rasterised at ss x."""
    g = GAUGES[cl]
    ox, oy = layer_origin(cl)
    ic = ICONS[cl]
    S = BOX * ss
    sh = 4                                          # cv2 fixed-point fraction bits
    def to_px(pts):
        p = np.array([[((g["c"][0] + uu * R) - ox) * ss, ((g["c"][1] + vv * R) - oy) * ss] for uu, vv in pts])
        return np.round(p * (1 << sh)).astype(np.int32)
    m = np.zeros((S, S), np.uint8)
    for poly in ic["fill"]:
        cv2.fillPoly(m, [to_px(poly)], 255, lineType=cv2.LINE_8, shift=sh)
    if "drop" in ic:
        cu, cv_, rr = ic["drop"]
        p = to_px([(cu, cv_)])[0]
        cv2.circle(m, (int(p[0]), int(p[1])), int(round(rr * R * ss * (1 << sh))), 255, -1, lineType=cv2.LINE_8, shift=sh)
        # pointed top of the drop
        tri = [(cu - rr * 0.95, cv_ - rr * 0.3), (cu + rr * 0.95, cv_ - rr * 0.3), (cu, cv_ - rr * 2.4)]
        cv2.fillPoly(m, [to_px(tri)], 255, lineType=cv2.LINE_8, shift=sh)
    for poly in ic["holes"]:
        cv2.fillPoly(m, [to_px(poly)], 0, lineType=cv2.LINE_8, shift=sh)
    a = m.astype(np.float32).reshape(BOX, ss, BOX, ss).mean(axis=(1, 3)) / 255.0
    return imageio.rgba(P["ticks"]["rgb"], a)


ELEMENTS = [  # id suffix, kind, z, fn, class, half-res?, evidence, sources, note
    ("face", "albedo", 1, el_face, "baked", True, "ok",
     ["04_comfort_whole-cluster_mph.png", "07_physical-cluster_all-lamps-lit.png"], "flat near-black face, slightly blue"),
    ("bezel", "albedo", 11, el_bezel, "baked", False, "strong",
     ["17_physical-cluster_full.png", "04_comfort_whole-cluster_mph.png", "07_physical-cluster_all-lamps-lit.png"],
     "thin tube ring at 0.972 R + dim inner rim at 0.91 R, open on the main-dial side"),
    ("bezel", "highlight", 11.1, el_bezel_hl, "baked", False, "ok",
     ["04_comfort_whole-cluster_mph.png", "17_physical-cluster_full.png"], "angular light on the tube"),
    ("inner-arc", "albedo", 6, el_arc, "baked", False, "ok",
     ["17_physical-cluster_full.png", "04_comfort_whole-cluster_mph.png", "07_physical-cluster_all-lamps-lit.png"],
     "thin grey arc, eccentric (scale frame), fades in at the low end"),
    ("zones", "albedo", 4, el_zones, "baked", False, "ok",
     ["04_comfort_whole-cluster_mph.png", "17_physical-cluster_full.png", "07_physical-cluster_all-lamps-lit.png"],
     "static end zones: end tick + bar"),
    ("ticks", "albedo", 5, el_ticks, "baked", False, "strong",
     ["17_physical-cluster_full.png", "07_physical-cluster_all-lamps-lit.png", "04_comfort_whole-cluster_mph.png"],
     "majors every 5, minors between"),
    ("pictogram", "albedo", 5.5, el_icon, "baked", False, "weak",
     ["04_comfort_whole-cluster_mph.png", "17_physical-cluster_full.png", "07_physical-cluster_all-lamps-lit.png"],
     "generic redrawn pictogram, ~12-22 px: only the bbox and rough massing are measured"),
]


def element_params(cl, eid):
    gm = GAUGES[cl]["mirror"]
    base = {"frame_note": "R units, fuel convention (C4 = mirror u -> -u)" + ("; this gauge is mirrored" if gm else ""),
            "R_px": R, "centre_panel": list(GAUGES[cl]["c"])}
    if eid == "face":
        base.update(P["face"])
    elif eid == "bezel":
        base.update(P["bezel"])
        base["light_note"] = "hl_peak_cw12 in the fuel convention: C3 220 (lower left), C4 140 (lower right)"
    elif eid == "inner-arc":
        base.update(P["arc"]); base["scale_centre_offset"] = [P["scale"]["dx"], P["scale"]["dy"]]
        base["fade_note"] = "fade angles are measured about the BEZEL centre"
    elif eid == "ticks":
        base.update(P["ticks"]); base["scale"] = P["scale"]
        base["ticks_cw12"] = [[k, round(a, 2), "major" if m else "minor"] for k, a, m in tick_list(cl)]
    elif eid == "zones":
        base.update(P["zone"]); base["scale"] = P["scale"]
        base["zones"] = [{"from_frac": f0, "to_frac": f1, "color": n, "from_cw12": round(scale_angle(f0), 2),
                          "to_cw12": round(scale_angle(f1), 2)} for f0, f1, n in zone_list(cl)]
        base["dynamic_note"] = ("static: fuel reserve, oil cold and hot bands are fixed scale marks; the theme's "
                                "u_redTo / u_coldTo / u_redFrom can drive the same geometry procedurally")
    elif eid == "pictogram":
        ic = ICONS[cl]
        base.update({"icon": "fuel pump + filler-side arrow" if cl == "C3" else "oil can",
                     "bbox_uv": ic["bbox"], "polygons_uv": ic["fill"], "holes_uv": ic["holes"],
                     "owner_note": "in-gauge placement and a simple rendering; the standalone icon set is P5's (C7)"})
        if "drop" in ic:
            base["drop_uv_r"] = ic["drop"]
    return base


def build(cl, out_layers):
    name = GAUGES[cl]["name"]
    ox, oy = layer_origin(cl)
    stack_ids = [f"{name}.{e[0]}" + ("" if e[1] == "albedo" else "-" + e[1]) for e in ELEMENTS]
    imgs = {}
    for (eid, kind, z, fn, klass, half, ev, src, note), lid in zip(ELEMENTS, stack_ids):
        img = fn(cl)
        imgs[lid] = img
        fname = f"{cl}/{name}.{eid}.{kind}" + ("@0.5x" if half else "") + ".png"
        path = os.path.join(BAKED, fname)
        lx, ly, lw, lh = ox, oy, BOX, BOX
        if half:
            imageio.write_png(path, imageio.half_res(img))
            fw = fh = BOX // 2
        else:
            crop, cx0, cy0 = imageio.tight_crop(img)          # crisp layers: tight crop (brief section 7)
            imageio.write_png(path, crop)
            lx, ly, lw, lh = ox + cx0, oy + cy0, crop.shape[1], crop.shape[0]
            fh, fw = crop.shape[:2]
        lght = {"dir_deg": 235.0 if cl == "C3" else 305.0, "key": 1.0}
        out_layers.append({"id": lid, "cluster": cl, "z": z, "kind": kind, "class": klass, "frame": "panel",
                           "x": lx, "y": ly, "w": lw, "h": lh, "scale": 0.5 if half else 1.0, "file": fname,
                           "bytes_by_8wh": imageio.bytes_by_8wh(fw, fh), "sources": src, "evidence": ev,
                           "light": lght, "params": dict(element_params(cl, eid), note=note)})
    # the proposed merged image: everything static of this gauge in one 1x RGBA (z order)
    order = sorted(zip(ELEMENTS, stack_ids), key=lambda t: t[0][2])
    canvas = np.zeros((BOX, BOX, 4), np.float32)
    for (eid, kind, z, fn, klass, half, *_), lid in order:
        im = imgs[lid]
        if half:  # what the GPU would see
            im = imageio.upscale2(imageio.half_res(im), BOX, BOX)
        imageio.over(canvas, im, 0, 0)
    mfile = f"{cl}/{name}.static.merged.png"
    imageio.write_png(os.path.join(BAKED, mfile), canvas)
    return [lid for (_, lid) in order], mfile


NOTES = ("P3 mini gauges, COMFORT. Geometry in the fuel convention, C4 = mirror. The ticks, inner arc and zones are "
         "concentric about a point 0.046 R toward the main dial from the bezel centre (all three photos, both gauges). "
         "Scale (about that point): 0 at 157.05 cw12, 20 steps of 9.132 deg (sweep 182.6), majors every 5. Text "
         "('0', '1/1') and the needle are live / dynamic and not baked. The per-element files are the relightable "
         "split; the scene would load only <gauge>.static.merged.png (1 layer per gauge). Report: bake/report/C3.md.")
OPEN_QUESTIONS = [
    "Needle pivot: at the bezel centre or at the scale centre (+0.046 R toward the main dial)? The evidence (04 hub "
    "ring) is ambiguous; the needle owner should pivot at the scale centre if the needle tip must hit the ticks.",
    "The bezel is open on the main-dial side (27..121 cw12 on C3, mirrored on C4) because in the 6WB the big "
    "dial's bezel passes there. In the G20 layout the minis do not touch the main dials (9 px gap). Keep the gap "
    "(faithful) or close the ring?",
    "The top end of the fuel scale shows two bars ('11' / '1/1') in 04 / 17 / 02: treated as live text '1/1', no "
    "tick baked at 1/1. If it is a double tick, add two majors at 340 / 349 cw12 (weak).",
    "Theme numbers differ from the measurement: theme start 135 / sweep 185 about the bezel centre, redTo / coldTo "
    "0.10, redFrom 0.90; measured 157.05 / 182.6 about the scale centre, 0.117 / 0.888.",
    "Pictograms are generic re-drawings at ~12-22 px (P5 owns the icon set). The oil icon in 04 / 17 looks like an "
    "oil can with a level/temperature mark (':' and a line); ours is a plain can (weak).",
    "Bezel light: brightest low on the outer side (C3 224 cw12, C4 136 cw12, i.e. away from the cluster centre) "
    "in 04; 17 is flatter and 07 dim. Not consistent with a single upper-left key light.",
]


def stack_links(layers):
    ids = sorted(layers, key=lambda e: e["z"])
    for i, e in enumerate(ids):
        e["stack_below"] = [ids[i - 1]["id"]] if i > 0 else []
        e["stack_above"] = [ids[i + 1]["id"]] if i + 1 < len(ids) else []


def main():
    for cl in ("C3", "C4"):
        layers = []
        order, mfile = build(cl, layers)
        stack_links(layers)
        mpath = os.path.join(MAN, f"{cl}.json")
        old = json.load(open(mpath)) if os.path.exists(mpath) else {}
        # keep fit numbers written by C3.qc_run across rebuilds
        oldfit = {e["id"]: e.get("fit") for e in old.get("layers", []) if e.get("fit")}
        for e in layers:
            if e["id"] in oldfit:
                e["fit"] = oldfit[e["id"]]
        ox, oy = layer_origin(cl)
        man = {"cluster": cl, "package": "P3", "mode": "comfort", "R": R,
               "generator": "cd bake/src && $PY -m C3.build && $PY -m C3.qc_run",
               "layers": layers,
               "composition": {"images": [{"file": mfile, "from_ids": order, "x": ox, "y": oy, "w": BOX, "h": BOX,
                                           "scale": 1.0, "bytes_by_8wh": imageio.bytes_by_8wh(BOX, BOX)}],
                               "layer_count": 1, "bytes_by_8wh_total": imageio.bytes_by_8wh(BOX, BOX)},
               "open_questions": OPEN_QUESTIONS,
               "notes": NOTES}
        if "fit_composed" in old:
            man["fit_composed"] = old["fit_composed"]
        imageio.write_json(mpath, man)
        print(cl, "layers", len(layers), "merged", mfile)


if __name__ == "__main__":
    main()
