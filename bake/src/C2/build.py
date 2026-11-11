"""P2 / C2 rev dial (COMFORT): regenerate every asset, preview, QC sheet, the manifest and the QC table.

    cd bake/src && $PY -m C2.build            (about 1-2 minutes)

Writes apps/f30_cluster/hud/baked/C2/*.png (baked, @0.5x soft layers), bake/work/C2/proc/*.png (renders of the
procedural elements, for QC and review only: not shipped), bake/work/C2/qc_*.png sheets, bake/manifest/C2.json and
bake/work/C2/qc_table.json.
"""
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from common import geom, imageio  # noqa: E402
import qc  # noqa: E402
from C2 import draw as D  # noqa: E402
from C2 import params as P  # noqa: E402

ROOT = qc.ROOT
BAKED = os.path.join(ROOT, "apps", "f30_cluster", "hud", "baked", "C2")
WORK = os.path.join(ROOT, "bake", "work", "C2")
PROC = os.path.join(WORK, "proc")
RECT = os.path.join(ROOT, "bake", "work", "rect")
BOX = geom.crop_box("C2")                     # [1146, 18, 724, 702]
REF05 = os.path.join(RECT, "05_comfort_tach-closeup.comfort.C2")
REF17 = os.path.join(RECT, "17_physical-cluster_full.comfort.C2")
REF04 = os.path.join(RECT, "04_comfort_whole-cluster_mph.comfort.C2")
REF13 = os.path.join(RECT, "13_ticks_closeup.comfort.C2@4x")
REF03 = os.path.join(RECT, "03_three-modes_photo_bimmerstop.comfort.C2")

# element id -> (z, kind, class, draw fn, baked?, sources, evidence, light, params)
L135 = {"dir_deg": 125, "key": 1.0}
ELEMENTS = [
    ("tacho.face", 1, "albedo", "baked", D.face, True, ["05", "04", "03"], "ok", L135, P.FACE),
    ("tacho.face-shadow", 2, "shadow", "baked", D.face_shadow, True, ["05", "13"], "ok", None, P.FACE_SHADOW),
    ("tacho.floor-shade", 2.5, "shadow", "baked", D.floor_shade, True, ["05", "17"], "ok", None, P.FLOOR_SHADE),
    ("tacho.tick-groove", 3, "highlight", "procedural", D.groove, False, ["13", "05", "04"], "strong", L135, P.GROOVE),
    ("tacho.red-zone", 4, "albedo", "procedural", D.red_zone, False, ["05", "17"], "ok", None, P.RED),
    ("tacho.ticks", 5, "albedo", "procedural", D.ticks, False, ["13", "05", "17", "04"], "strong", None,
     {**P.TICKS, "scale": P.SCALE}),
    ("tacho.tick-spots", 5.1, "glow", "baked", D.spots, True, ["13"], "ok", None, P.SPOTS),
    ("tacho.off-arc", 5.7, "albedo", "procedural", D.off_arc, False, ["05", "17", "04", "03"], "ok", None, P.OFF),
    ("tacho.inner-disc", 6, "albedo", "baked", D.inner_disc, True, ["05", "04", "17"], "ok", L135, P.DISC),
    ("tacho.inner-disc-rim", 6.1, "highlight", "procedural", D.disc_rim, False, ["05", "04"], "ok", L135, P.DISC),
    ("tacho.inner-ring", 7, "albedo", "procedural", D.inner_ring, False, ["05"], "weak", L135, P.RING),
    ("tacho.floor", 8, "albedo", "baked", D.floor, True, ["05", "17"], "ok", None, P.FLOOR),
    ("tacho.floor-edge", 8.1, "highlight", "procedural", D.floor_edge, False, ["05"], "weak", None, P.FLOOR),
    ("tacho.p-box", 8.5, "albedo", "procedural", D.pbox, False, ["05"], "ok", None, P.PBOX),
    ("tacho.hub-well", 9, "shadow", "baked", D.hub_well, True, ["05", "04"], "weak", None, P.HUB),
    ("tacho.hub-ring", 9.1, "albedo", "procedural", D.hub_ring, False, ["05", "15"], "ok", None, P.HUB),
    ("tacho.bezel", 11, "highlight", "procedural", D.bezel, False, ["13", "05", "04", "06"], "ok",
     {"dir_deg": 110, "key": 1.0, "note": "two-lobed gloss: 340 cw12 (math 110) narrow, 148 cw12 (math 302) broad"}, P.BEZEL),
]
SRC = {"05": "05_comfort_tach-closeup.png", "04": "04_comfort_whole-cluster_mph.png", "03": "03_three-modes_photo_bimmerstop.png",
       "13": "13_ticks_closeup.png", "17": "17_physical-cluster_full.png", "06": "06_comfort_wide_with-wheel.png",
       "15": "15_hub-needle_closeup.png", "02": "02_three-modes_clean-render.png"}

# QC plan: element -> list of (ref, rois, angle, edges)
QC_PLAN = {
    "tacho.face": [(REF05, ["ring:0.52:0.78"], "20:140", False), (REF04, ["ring:0.52:0.78"], "20:140", False)],
    "tacho.face-shadow": [(REF05, ["ring:0.86:0.952"], "340:130", False), (REF13, ["ring:0.86:0.952"], None, False)],
    "tacho.floor-shade": [(REF05, ["ring:0.50:0.78"], "95:75", False)],
    "tacho.tick-groove": [(REF05, ["ring:0.795:0.86"], "300:200", True), (REF13, ["ring:0.795:0.86"], None, True)],
    "tacho.red-zone": [(REF05, ["ring:0.85:0.925"], "112:22", True)],
    "tacho.ticks": [(REF05, ["ring:0.80:0.92"], None, True), (REF13, ["ring:0.80:0.92"], None, True),
                    (REF17, ["ring:0.80:0.92"], None, True), (REF04, ["ring:0.80:0.92"], None, True)],
    "tacho.tick-spots": [(REF13, ["ring:0.905:0.95"], None, False), (REF05, ["ring:0.905:0.95"], "340:150", False)],
    "tacho.off-arc": [(REF05, ["ring:0.80:0.92"], "226:26", True), (REF17, ["ring:0.80:0.92"], "226:26", True)],
    "tacho.inner-disc": [(REF05, ["ring:0.36:0.47"], "300:200", False), (REF04, ["ring:0.36:0.47"], "300:200", False)],
    "tacho.inner-disc-rim": [(REF05, ["ring:0.45:0.52"], "300:200", True), (REF04, ["ring:0.45:0.52"], "300:200", True)],
    "tacho.inner-ring": [(REF05, ["ring:0.30:0.36"], "300:200", True)],
    "tacho.floor": [(REF05, ["ring:0.15:0.47", "box:1508:450:200:120"], None, True)],
    "tacho.floor-edge": [(REF05, ["box:1520:440:140:30"], None, True)],
    "tacho.p-box": [(REF05, ["box:1395:540:230:80"], None, True)],
    "tacho.hub-well": [(REF05, ["ring:0.14:0.32"], "300:200", False)],
    "tacho.hub-ring": [(REF05, ["ring:0.10:0.16"], None, True)],
    "tacho.bezel": [(REF05, ["ring:0.95:1.02"], "330:180", True), (REF13, ["ring:0.95:1.02"], None, True),
                    (REF04, ["ring:0.95:1.02"], None, True), (REF17, ["ring:0.95:1.02"], None, True)],
}


def even_tight(img_half):
    """tight crop of a @0.5x image -> (crop, ix, iy) in half-res px."""
    return imageio.tight_crop(img_half, thresh=0.5 / 255.0)


def main():
    os.makedirs(BAKED, exist_ok=True)
    os.makedirs(PROC, exist_ok=True)
    x0, y0, w, h = BOX
    cv1 = D.Canvas(x0, y0, w, h, 1)
    meta13 = json.load(open(REF13 + ".json"))
    b13 = meta13["box"]
    cv4 = D.Canvas(b13[0], b13[1], b13[2] * 4, b13[3] * 4, 4)

    rend1, rend4, entries = {}, {}, []
    for (eid, z, kind, cls, fn, baked, srcs, ev, light, prm) in ELEMENTS:
        img = fn(cv1)
        rend1[eid] = img
        e = {"id": eid, "cluster": "C2", "z": z, "kind": kind, "class": cls, "frame": "panel",
             "sources": [SRC[s] for s in srcs], "evidence": ev}
        if light:
            e["light"] = light
        if baked:
            half = imageio.half_res(img)
            crop, ix, iy = even_tight(half)
            fname = f"{eid}.{kind}@0.5x.png"
            imageio.write_png(os.path.join(BAKED, fname), crop)
            fh, fw = crop.shape[:2]
            e.update({"x": x0 + 2 * ix, "y": y0 + 2 * iy, "w": 2 * fw, "h": 2 * fh, "scale": 0.5,
                      "file": f"C2/{fname}", "bytes_by_8wh": imageio.bytes_by_8wh(fw, fh)})
            # what QC sees = the shipped file
            rend1[eid] = ("file", os.path.join(BAKED, fname), e["x"], e["y"])
        else:
            imageio.write_png(os.path.join(PROC, f"{eid}.{kind}.png"), img)
            crop, ix, iy = imageio.tight_crop(img, 0.5 / 255)
            e.update({"x": x0 + ix, "y": y0 + iy, "w": crop.shape[1], "h": crop.shape[0], "scale": 1.0, "file": None,
                      "bytes_by_8wh": 0})
            rend4[eid] = fn(cv4)
        e["params"] = jsonable(prm)
        entries.append(e)

    ids = [e["id"] for e in entries]
    for i, e in enumerate(entries):
        e["stack_below"] = ids[:i][-1:] if i else []
        e["stack_above"] = ids[i + 1:i + 2]

    def layers_upto(eid, k):
        zmax = next(e["z"] for e in entries if e["id"] == eid)
        out = []
        for e in entries:
            if e["z"] > zmax:
                continue
            rr = rend1[e["id"]]
            if isinstance(rr, tuple):
                out.append((rr[1], rr[2], rr[3], 0.5))
            elif k == 4:
                out.append((rend4[e["id"]], b13[0], b13[1], 4.0))
            else:
                out.append((rr, x0, y0, 1.0))
        return out

    table = {}
    for e in entries:
        res_list = []
        for (ref, rois, angle, edges) in QC_PLAN.get(e["id"], []):
            k = 4 if ref == REF13 else 1
            res = qc.run(ref, layers_upto(e["id"], k), "C2", e["id"], rois=rois, roi_angle=angle, want_edges=edges)
            res_list.append({"ref": os.path.relpath(ref, ROOT), "roi": rois + ([f"angle {angle}"] if angle else []),
                             "fit": res["fit"], "sheet": res.get("sheet"), "valid_px": res["metrics"].get("valid_px"),
                             "banding": res["metrics"].get("banding")})
        table[e["id"]] = res_list
        if res_list:
            f0 = res_list[0]
            e["fit"] = {**f0["fit"], "ref": f0["ref"], "roi": f0["roi"], "sheet": f0["sheet"]}
            if len(res_list) > 1:
                e["params"]["_fit_other_refs"] = [{"ref": os.path.basename(r["ref"]), **r["fit"]} for r in res_list[1:]]
    # the composed stack
    stack = []
    for ref in (REF05, REF17, REF04, REF03):
        for roi in (["ring:0:0.97"], ["ring:0:1.02"]):
            res = qc.run(ref, layers_upto("tacho.bezel", 1), "C2", "stack" + roi[0].replace(":", "_"), rois=roi, want_edges=True)
            stack.append({"ref": os.path.relpath(ref, ROOT), "roi": roi, "fit": res["fit"], "sheet": res.get("sheet")})
    res = qc.run(REF13, layers_upto("tacho.bezel", 4), "C2", "stack_13", rois=["ring:0.78:1.02"], want_edges=True)
    stack.append({"ref": os.path.relpath(REF13, ROOT), "roi": ["ring:0.78:1.02"], "fit": res["fit"], "sheet": res.get("sheet")})
    # A/B: the current theme (bench) against the same refs
    ab = []
    ours = os.path.join(RECT, "ours_bench.comfort.C2.png")
    if os.path.exists(ours):
        img = imageio.read_png(ours)
        for ref in (REF05, REF17):
            r_ = qc.run(ref, [(img, x0, y0, 1.0)], "C2", "AB_ours_bench", rois=["ring:0:0.97"], want_edges=True)
            ab.append({"ref": os.path.relpath(ref, ROOT), "fit": r_["fit"]})
    table["_stack"] = stack
    table["_ab_ours_bench"] = ab

    # full composed preview (panel crop) for the report
    comp = qc.compose(layers_upto("tacho.bezel", 1), BOX, 1)
    imageio.write_png(os.path.join(WORK, "composed_C2.png"), np.concatenate([comp, np.ones(comp.shape[:2] + (1,))], -1))

    composition = composition_proposal(entries)
    man = {"cluster": "C2", "package": "P2", "mode": "comfort", "R": 335,
           "generator": "cd bake/src && $PY -m C2.build",
           "layers": entries, "composition": composition,
           "open_questions": OPEN_QUESTIONS,
           "notes": NOTES}
    imageio.write_json(os.path.join(ROOT, "bake", "manifest", "C2.json"), man)
    imageio.write_json(os.path.join(WORK, "qc_table.json"), table)
    print_table(entries, table)


def composition_proposal(entries):
    """Option B (recommended): ONE merged @0.5x RGBA image of all baked layers (pre-lit), plus the procedural parts in
    the dial's effect shader (which can also sample the image): 2 layers per dial, ~0.86 MB.
    Option A (relightable): albedo / shade / light images: 3 images + 1 effect layer."""
    baked = [e for e in entries if e.get("file")]
    # merged image bbox = union of baked boxes
    xs0 = min(e["x"] for e in baked); ys0 = min(e["y"] for e in baked)
    xs1 = max(e["x"] + e["w"] for e in baked); ys1 = max(e["y"] + e["h"] for e in baked)
    W, H = int(xs1 - xs0), int(ys1 - ys0)
    b = imageio.bytes_by_8wh((W + 1) // 2, (H + 1) // 2)
    merged = os.path.join(BAKED, "tacho.static.albedo@0.5x.png")
    layers = sorted(baked, key=lambda e: e["z"])
    canvas = np.zeros((H, W, 4), np.float32)
    for e in layers:
        img = imageio.read_png(os.path.join(ROOT, "apps", "f30_cluster", "hud", "baked", e["file"]))
        up = imageio.upscale2(img, e["w"], e["h"])
        imageio.over(canvas, up, int(e["x"] - xs0), int(e["y"] - ys0))
    imageio.write_png(merged, imageio.half_res(canvas))
    return {
        "images": [{"file": "C2/tacho.static.albedo@0.5x.png", "from_ids": [e["id"] for e in layers],
                    "x": int(xs0), "y": int(ys0), "w": W, "h": H, "scale": 0.5, "bytes_by_8wh": b},
                   {"file": "(effect shader, no image)", "from_ids": [e["id"] for e in entries if e["class"] != "baked"],
                    "w": 0, "h": 0, "bytes_by_8wh": 0}],
        "layer_count": 2,
        "bytes_by_8wh_total": b,
        "option_A_relightable": {
            "images": ["tacho.albedo@0.5x (face + inner-disc + floor)", "tacho.shade@0.5x (face-shadow + floor-shade + hub-well)",
                       "tacho.light@0.5x (tick-spots)"],
            "layer_count": 4, "bytes_by_8wh_total": 3 * b,
            "note": "the separate files shipped in C2/ are exactly these inputs; merge per kind at integration"},
        "note": "Option B is what tacho.static.albedo@0.5x.png is (all baked layers pre-composited, straight alpha). "
                "Everything crisp (ticks, groove lip, red zone, OFF arc + mark, disc rim, inner ring, floor edge, P box, hub "
                "ring, bezel) stays in the dial's effect shader with the params in this manifest. The red zone, hub ring "
                "state and the needle are dynamic.",
    }


OPEN_QUESTIONS = [
    "Light direction (P1/P9): the photos show the drawn gloss as a TWO-LOBED pattern along one axis, brightest at "
    "~340 cw12 (math ~110, narrow) and ~148 cw12 (math ~302, broad), dimmest at ~40 cw12; the groove's inner lip is "
    "lit only from the upper left (peak ~335 cw12, monotone fade to the lower right) in 05, 04 and 03. Read: key light "
    "upper-left at math ~110 (not 135), and the lower-right bezel lobe is that light's highlight on the tube's far "
    "flank (or a deliberate second light). The highlight position ACROSS the tube is below the resolution of 05/04/03 "
    "(< 0.002 R), so it cannot be used.",
    "OFF arc radius: 05 puts it at 0.826 R (the inner end of the 0 rpm tick); 17 / 04 / 03 at 0.845-0.88 R in their "
    "frames, which carry a ~0.025 R off-centre of the tick ring toward the lower left. Chosen 0.826 (05, sharpest).",
    "OFF mark: visible only in 17 (at 233 cw12, r 0.82-0.905 after the frame correction); in 05 / 04 / 03 the needle is "
    "parked at ~230 and no separate mark shows at 233. Kept at 233 (weak).",
    "Red zone: 05 shows a bright band at the ticks' outer ends (0.896-0.914) over a dim fill (0.866-0.896) and one "
    "dark gap (7.2k); 17 shows the red over the INNER part (0.825-0.875). Different software or glare; chose 05.",
    "Tick cool fringe: the cyan at the ticks' outer ends in 13 / 05 matches lateral chromatic aberration (the "
    "numerals show the same blue on their outer edges and warm on the inner). Kept faint (k 0.35); could be 0.",
    "Tick ring vs bezel: in 04 / 03 / 05 the tick ring sits ~0.025 R off the bezel centre toward ~235 cw12. Parallax "
    "(bezel in front of the TFT?) or photo geometry; drawn concentric here.",
    "Inner ring (0.33 R) and floor-edge line: weak evidence (05 only, +4..6 L).",
]
NOTES = ("All geometry in R units / cw12 degrees (params). Levels: sRGB / 255 of the exposure-normalised refs "
         "(white 235). Procedural entries: render previews in bake/work/C2/proc/ (not shipped). The rpm scale: 0 rpm at "
         "250.5 cw12, 32.05 deg per 1000 rpm (theme 32.1 within error). The l/100km arc at the bottom is P4 (C6).")


def jsonable(o):
    if isinstance(o, dict):
        return {k: jsonable(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [jsonable(v) for v in o]
    if isinstance(o, (np.floating, float)):
        return round(float(o), 6)
    if isinstance(o, (np.integer,)):
        return int(o)
    return o


def print_table(entries, table):
    print(f"{'element':24s} {'class':10s} {'kind':9s} {'file':40s} {'x,y,w,h':22s} {'sc':4s} {'bytes':>8s} | fits")
    for e in entries:
        fits = "; ".join(f"{os.path.basename(r['ref']).split('_')[0]}: ssim {fmt(r['fit']['ssim'])} dE {fmt(r['fit']['dE2000_mean'])} "
                         f"edge {fmt(r['fit']['edge_px_err'])}" for r in table.get(e["id"], []))
        print(f"{e['id']:24s} {e['class']:10s} {e['kind']:9s} {str(e['file']):40s} "
              f"{int(e['x'])},{int(e['y'])},{int(e['w'])},{int(e['h']):<10} {e['scale']:<4} {e['bytes_by_8wh']:>8d} | {fits}")
    for s in table["_stack"]:
        print("STACK", os.path.basename(s["ref"]), s["roi"], s["fit"])
    for s in table["_ab_ours_bench"]:
        print("A/B ours_bench", os.path.basename(s["ref"]), s["fit"])


def fmt(x):
    return "-" if x is None else f"{x:.3f}"


if __name__ == "__main__":
    main()
