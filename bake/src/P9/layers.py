"""P9 layer sources: every delivered layer of P1-P8 as a panel-space (img, x, y, scale) item, and the per-mode stacks
(Comfort, Sport, Eco Pro) built from the packages' proposed compositions.

Read-only use of other packages' outputs:
  apps/f30_cluster/hud/baked/<cluster>/*.png    the shipped (baked) files
  bake/manifest/<cluster>.json                  positions, z, params, composition proposals
  bake/work/C1/proc/*.png, bake/work/C2/proc/*.png   P1 / P2 1x renders of their procedural (shader) parts
  bake/work/C8-sport/*.qc-only.png              P6 1x render of the procedural hairlines
  bake/src/C8-eco/build.py                      imported (not edited) to render P7's procedural fill / marks / ring
"""
import importlib.util
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.dirname(HERE)
sys.path.insert(0, SRC)
from common import geom, imageio  # noqa: E402

ROOT = os.path.abspath(os.path.join(SRC, "..", ".."))
BAKED = os.path.join(ROOT, "apps", "f30_cluster", "hud", "baked")
MAN = os.path.join(ROOT, "bake", "manifest")
WORK = os.path.join(ROOT, "bake", "work")

C2_PROC_BOX = geom.crop_box("C2")          # P2 renders its procedural previews on the C2 crop box (1159, 31, 698, 689)

# which Comfort element a layer belongs to (the keys of C8-sport.json sport_shared_layers / eco tints)
ROLE = {"face": "face", "face-shadow": "face-shadow", "floor-shade": "floor-shade", "tick-groove": "tick-groove",
        "tick-groove-rim": "tick-groove", "ticks": "ticks", "tick-spots": "ticks", "soft-glow": "ticks",
        "inner-disc": "inner-disc", "inner-disc-rim": "inner-disc", "inner-ring": "inner-ring", "floor": "floor",
        "floor-edge": "floor", "hub-well": "hub-well", "hub-ring": "hub-ring", "bezel": "bezel", "red-zone": "red-zone",
        "off-arc": "off-arc", "p-box": "p-box", "base": "base", "static": "base"}


def man(name):
    return json.load(open(os.path.join(MAN, name + ".json")))


def entry(name, eid):
    for e in man(name)["layers"]:
        if e["id"] == eid:
            return e
    raise KeyError(f"{name}:{eid}")


def item(eid, cl, z, img, x, y, s=1.0, src="baked", **kw):
    d = {"id": eid, "cl": cl, "z": float(z), "img": img, "x": int(round(x)), "y": int(round(y)), "s": s, "src": src,
         "opacity": 1.0, "gain": None}
    d.update(kw)
    return d


def baked(name, eid):
    e = entry(name, eid)
    return item(eid, e["cluster"], e["z"], os.path.join(BAKED, e["file"]), e["x"], e["y"], e.get("scale", 1.0),
                "baked", file=e["file"], w=e["w"], h=e["h"])


def comp_file(name, fname, z, eid=None):
    """A composition image (merged file) from a manifest's composition proposal."""
    m = man(name)
    for im in m["composition"]["images"]:
        if im["file"] == fname:
            s = im.get("scale", 1.0)
            w, h = (im["w"], im["h"])
            # P1 / P2 / P3 record the panel size, P5 / P8 (C10, C5, C6) record the file size for @0.5x: normalise
            fw, fh = imageio.read_png(os.path.join(BAKED, fname)).shape[1::-1]
            return item(eid or fname, m["cluster"], z, os.path.join(BAKED, fname), im["x"], im["y"], s, "baked-merged",
                        file=fname, w=int(round(fw / s)), h=int(round(fh / s)), from_ids=im.get("from_ids", []))
    raise KeyError(fname)


def proc_c1(eid):
    e = entry("C1", eid)
    return item(eid, "C1", e["z"], os.path.join(WORK, "C1", "proc", f"{eid}.{e['kind']}.png"), e["x"], e["y"], 1.0,
                "shader-standin")


def proc_c2(eid):
    e = entry("C2", eid)
    bx = C2_PROC_BOX
    return item(eid, "C2", e["z"], os.path.join(WORK, "C2", "proc", f"{eid}.{e['kind']}.png"), bx[0], bx[1], 1.0,
                "shader-standin")


def role(it):
    return ROLE.get(it["id"].split(".", 1)[1]) if "." in it["id"] else None


# ------------------------------------------------------------------------------------------------------- Comfort
C1_BAKED = ["speedo.face", "speedo.face-shadow", "speedo.floor-shade", "speedo.tick-groove", "speedo.soft-glow",
            "speedo.hub-well"]
C1_PROC = ["speedo.tick-groove-rim", "speedo.ticks", "speedo.inner-disc", "speedo.inner-ring", "speedo.floor",
           "speedo.bezel"]
C1_IN_BASE = ["speedo.face", "speedo.face-shadow", "speedo.floor-shade", "speedo.tick-groove", "speedo.hub-well"]
C2_BAKED = ["tacho.face", "tacho.face-shadow", "tacho.floor-shade", "tacho.tick-spots", "tacho.inner-disc",
            "tacho.floor", "tacho.hub-well"]
C2_PROC = ["tacho.tick-groove", "tacho.red-zone", "tacho.ticks", "tacho.off-arc", "tacho.inner-disc-rim",
           "tacho.inner-ring", "tacho.floor-edge", "tacho.p-box", "tacho.hub-ring", "tacho.bezel"]
MINI_IDS = {"C3": ["fuel.face", "fuel.zones", "fuel.ticks", "fuel.inner-arc", "fuel.bezel", "fuel.bezel-highlight"],
            "C4": ["oil.face", "oil.zones", "oil.ticks", "oil.inner-arc", "oil.bezel", "oil.bezel-highlight"]}
MINI_P3_PICT = {"C3": "fuel.pictogram", "C4": "oil.pictogram"}
MINI_P5_PICT = {"C3": "mini.fuel-pump", "C4": "mini.oil-can"}


def dial_c1(merged):
    if merged:
        out = [comp_file("C1", "C1/speedo.base.albedo@0.5x.png", 1.0, "speedo.base")]
        out.append(baked("C1", "speedo.soft-glow"))
    else:
        out = [baked("C1", i) for i in C1_BAKED]
    return out + [proc_c1(i) for i in C1_PROC]


def dial_c2(merged):
    if merged:
        out = [comp_file("C2", "C2/tacho.static.albedo@0.5x.png", 1.0, "tacho.static")]
    else:
        out = [baked("C2", i) for i in C2_BAKED]
    return out + [proc_c2(i) for i in C2_PROC]


def minis(pict="P5", merged=True):
    """C3 / C4. pict: 'P3' = P3's own merged image (its pictograms inside); 'P5' = P3's layers without its pictogram
    plus P5's icon (re-merged into one image of the same box: same memory)."""
    out = []
    for cl in ("C3", "C4"):
        if pict == "P3" and merged:
            f = "C3/fuel.static.merged.png" if cl == "C3" else "C4/oil.static.merged.png"
            out.append(comp_file(cl, f, 1.0, f"{'fuel' if cl == 'C3' else 'oil'}.static"))
            continue
        lay = [baked(cl, i) for i in MINI_IDS[cl]]
        lay.append(baked(cl, MINI_P3_PICT[cl]) if pict == "P3" else baked("C7", MINI_P5_PICT[cl]))
        if pict != "P3":
            lay[-1]["cl"], lay[-1]["z"] = cl, 5.5
        out += lay
    return out


def window(merged=True):
    out = [comp_file("C5", "C5/window.base.albedo@0.5x.png", 0.0, "window.base"),
           baked("C6", "infobar.body"), baked("C5", "window.horizon"), baked("C6", "infobar.line")]
    return out


def arcs():
    return [baked("C6", "speedo.range-arc.track"), baked("C6", "tacho.ed-arc.track")]


def icons(signs=True):
    out = [baked("C7", "edyn.battery"), baked("C7", "bar.range")]
    if signs:
        out += [baked("C7", "sign.speed-limit"), baked("C7", "sign.no-overtaking")]
        for o in out[-2:]:
            o["src"] = "shader-standin"            # WBSIGN stays procedural (P5's recommendation); visibility is dynamic
    return out


def background():
    return [comp_file("C10", "C10/panel.background.albedo@0.5x.png", -1.0, "panel.background")]


def comfort(merged=True, pict="P5", signs=True):
    L = background() + window() + dial_c1(merged) + dial_c2(merged) + arcs() + minis(pict) + icons(signs)
    return sort(L)


def sort(L):
    order = {id(x): i for i, x in enumerate(L)}
    return sorted(L, key=lambda it: (it["z"], order[id(it)]))


# ------------------------------------------------------------------------------------------------------- Sport
def sport(merged=False, band_op=None, bridge_op=None, signs=False, pict="P5"):
    """Comfort stack + P6's sport_shared_layers opacities + the C8-sport layers.
    merged=False: the exact z order from individual files (what a Sport-specific base would look like);
    merged=True: Comfort's merged base images reused as they are (the groove / inner disc / tick spots baked into them
    cannot be hidden), only the shader parts take the opacities."""
    m = man("C8-sport")
    shared = m["sport_shared_layers"]
    ops = {k.split(".", 1)[1]: v.get("opacity", 1.0) for k, v in shared.items() if "opacity" in v}
    ops.setdefault("ticks", 0.0)
    L = comfort(merged=merged, pict=pict, signs=signs)
    for it in L:
        r = role(it)
        if it["cl"] in ("C1", "C2") and r in ops:
            it["opacity"] = float(ops[r])
    prm = {e["id"]: e for e in m["layers"]}
    bop = band_op if band_op is not None else prm["speedo.sport-band"]["params"]["opacity_by_ref"]["default"]
    gop = bridge_op if bridge_op is not None else prm["sport.bridge"]["params"]["opacity_by_ref"]["default"]
    extra = []
    for d in ("speedo", "tacho"):
        b = baked("C8-sport", f"{d}.sport-band")
        b["opacity"] = bop
        extra.append(b)
        hb = os.path.join(WORK, "C8-sport", f"{d}.sport-hairlines.shadow.qc-only.png")
        extra.append(item(f"{d}.sport-hairlines", "C1" if d == "speedo" else "C2", 5.3, hb, b["x"], b["y"], 1.0,
                          "shader-standin"))
    br = baked("C8-sport", "sport.bridge")
    br["opacity"] = gop
    extra.append(br)
    for w in ("l-upper", "l-lower", "r-upper", "r-lower"):
        wi = baked("C8-sport", f"sport.wing-{w}")
        wi["src"] = "shader-standin"                  # P6 recommends the wings procedural in WBBACK
        extra.append(wi)
    return sort(L + extra), {"band_opacity": bop, "bridge_opacity": gop, "shared_opacity": ops}


# ------------------------------------------------------------------------------------------------------- Eco Pro
_ECO = None


def eco_module():
    """P7's build.py imported read-only (its drawing functions and params); main() is not run."""
    global _ECO
    if _ECO is None:
        p = os.path.join(SRC, "C8-eco", "build.py")
        spec = importlib.util.spec_from_file_location("c8eco_build_p9", p)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        _ECO = mod
    return _ECO


def eco_tints():
    e = entry("C8-eco", "eco.tint-shared")["params"]
    meas, prop = e["measured_03"], e["proposed"]
    rim_c = np.array(meas["groove_rim_C1"]["comfort"])
    hub_c = np.array(meas["hub_ring_C1"]["comfort"])
    return {"face": np.array(prop["face_gain_rgb"]),
            "ticks": np.array([prop["ticks_gain"]] * 3),
            "groove_rim": np.array(prop["groove_rim_rgb"]) / rim_c,
            "hub_ring": np.array(prop["hub_ring_rgb"]) / hub_c,
            "hub_ring_rgb": np.array(prop["hub_ring_rgb"])}


def eco(merged=True, signs=False, pict="P5", fill_span=None):
    """Comfort stack with P7's eco.tint-shared gains + the C8-eco layers of P7's proposed composition. The fill and the
    marks / thin ring are procedural in P7's proposal: rendered here with P7's own functions and params."""
    t = eco_tints()
    L = comfort(merged=merged, pict=pict, signs=signs)
    for it in L:
        if it["cl"] not in ("C1", "C2"):
            continue
        r, leaf = role(it), it["id"].split(".", 1)[1]
        if leaf in ("face", "inner-disc", "floor", "base", "static") or it["id"] == "speedo.tick-groove":
            it["gain"] = t["face"]                 # the face albedo (and the merged bases, which are mostly face)
        elif r == "ticks":
            it["gain"] = t["ticks"]
        elif r == "tick-groove":
            it["gain"] = t["groove_rim"]           # the lit groove rims (procedural)
        elif r == "hub-ring":
            it["recolor"] = t["hub_ring_rgb"]      # red ring -> P7's pale blue (hue swap, brightness kept)
    M = eco_module()
    P = M.PRM
    mk, band = P["marks"], P["band"]
    a_lo, a_hi = mk["end_lo"], mk["end_hi"]
    f_lo, f_hi = fill_span or (mk["zone_lo"], mk["zone_hi"])
    extra = [comp_file("C8-eco", "C8-eco/tacho.eco-static.albedo@0.5x.png", 5.1, "tacho.eco-static"),
             baked("C8-eco", "tacho.eco-glow"), baked("C8-eco", "speedo.eco-glow")]
    bx = M.ring_box("C2", 0.70, 0.935, a_lo, a_hi)
    extra.append(item("tacho.eco-fill", "C2", 5.2, M.arc_layer(bx, "C2", band["fill"], f_lo, f_hi, hair=True),
                      bx[0], bx[1], 1.0, "shader-standin"))
    marks = entry("C8-eco", "tacho.eco-marks")["params"]["marks"]
    bxm = M.ring_box("C2", 0.78, 0.92, -180, 180)
    extra.append(item("tacho.eco-marks", "C2", 5.3, M.marks_layer(bxm, "C2", marks), bxm[0], bxm[1], 1.0,
                      "shader-standin"))
    rp = entry("C8-eco", "tacho.eco-ring")["params"]
    bxr = M.ring_box("C2", 0.83, 0.90, -180, 180)
    extra.append(item("tacho.eco-ring", "C2", 5.05,
                      M.ring_layer(bxr, "C2", rp["r"], rp["fwhm"], rp["rgb_over_black"], rp["span_deg"][0], rp["span_deg"][1]),
                      bxr[0], bxr[1], 1.0, "shader-standin"))
    sp = P["speedo_arc"]
    clip = entry("C8-eco", "speedo.eco-arc-clip")["params"]
    s0 = geom.SPD_START
    s_end = s0 + clip["default_kmh"] * clip["deg_per_kmh"]
    bxs = M.ring_box("C1", 0.42, 0.62, s0, s0 + geom.SPD_SWEEP)
    extra.append(item("speedo.eco-arc", "C1", 6.1, M.arc_layer(bxs, "C1", sp, s0, s_end), bxs[0], bxs[1], 1.0,
                      "shader-standin (P7 file speedo.eco-arc.glow@0.5x clipped at the Eco speed)"))
    return sort(L + extra), {"tints": {k: [round(float(x), 3) for x in v] for k, v in t.items()},
                              "fill_span_deg": [f_lo, f_hi], "eco_kmh": clip["default_kmh"]}


# ------------------------------------------------------------------------------------------------------- render
def load(it):
    img = it["img"]
    a = imageio.read_png(img) if isinstance(img, str) else np.asarray(img, np.float32).copy()
    if it.get("recolor") is not None:
        c = np.asarray(it["recolor"], np.float32)
        a[..., :3] = (c / c.max())[None, None, :] * a[..., :3].max(-1, keepdims=True)
    if it.get("gain") is not None:
        a[..., :3] = np.clip(a[..., :3] * np.asarray(it["gain"], np.float32)[None, None, :], 0, 1)
    if it.get("opacity", 1.0) != 1.0:
        a[..., 3] *= float(it["opacity"])
    return a


def as_qc_layers(L):
    """-> qc.compose / qc.run layer tuples (array, x, y, scale); layers with opacity 0 are dropped."""
    out = []
    for it in L:
        if it.get("opacity", 1.0) <= 0:
            continue
        out.append((load(it), it["x"], it["y"], it["s"]))
    return out


def describe(L):
    rows = []
    for it in L:
        rows.append({"id": it["id"], "cluster": it["cl"], "z": it["z"], "src": it["src"],
                     "file": it.get("file") or (os.path.relpath(it["img"], ROOT) if isinstance(it["img"], str) else "<rendered>"),
                     "x": it["x"], "y": it["y"], "scale": it["s"], "opacity": it.get("opacity", 1.0),
                     "gain": None if it.get("gain") is None else [round(float(g), 3) for g in it["gain"]],
                     "recolor": None if it.get("recolor") is None else [round(float(g), 3) for g in it["recolor"]]})
    return rows
