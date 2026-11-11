"""P1 / C1 speed dial (COMFORT): regenerate every asset, preview, QC result and the manifest.

    cd bake/src && $PY -m C1.build            ($PY = uv run -q --no-project --with opencv-python-headless
                                               --with numpy --with pillow python)
Writes:
    apps/f30_cluster/hud/baked/C1/*.png       soft layers (@0.5x, baked)
    bake/work/C1/proc/*.png                   1x previews of the procedural (crisp) layers (not shipped)
    bake/work/C1/stack_*.png, qc_*.png        composed previews and QC review sheets
    bake/work/C1/qc.json                      every QC result
    bake/manifest/C1.json
"""
import json
import zlib
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from common import imageio  # noqa: E402
import qc  # noqa: E402
from C1 import draw, params as P  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
BAKED = os.path.join(ROOT, "apps", "f30_cluster", "hud", "baked")
OUT = os.path.join(BAKED, "C1")
WORK = os.path.join(ROOT, "bake", "work", "C1")
RECT = os.path.join(ROOT, "bake", "work", "rect")
MANIFEST = os.path.join(ROOT, "bake", "manifest", "C1.json")

SOURCES = {
    "speedo.face": ["05_comfort_tach-closeup.png", "04_comfort_whole-cluster_mph.png", "03_three-modes_photo_bimmerstop.png", "02_three-modes_clean-render.png"],
    "speedo.face-shadow": ["13_ticks_closeup.png", "05_comfort_tach-closeup.png"],
    "speedo.floor-shade": ["05_comfort_tach-closeup.png", "17_physical-cluster_full.png", "04_comfort_whole-cluster_mph.png"],
    "speedo.tick-groove": ["13_ticks_closeup.png", "05_comfort_tach-closeup.png", "03_three-modes_photo_bimmerstop.png"],
    "speedo.tick-groove-rim": ["05_comfort_tach-closeup.png", "03_three-modes_photo_bimmerstop.png", "04_comfort_whole-cluster_mph.png", "13_ticks_closeup.png"],
    "speedo.ticks": ["13_ticks_closeup.png", "12_speedo_signs_overspeed-wedge.png", "03_three-modes_photo_bimmerstop.png", "05_comfort_tach-closeup.png", "17_physical-cluster_full.png"],
    "speedo.inner-disc": ["05_comfort_tach-closeup.png", "04_comfort_whole-cluster_mph.png", "03_three-modes_photo_bimmerstop.png", "17_physical-cluster_full.png", "14_inner-rings_closeup.png"],
    "speedo.inner-ring": ["05_comfort_tach-closeup.png", "04_comfort_whole-cluster_mph.png", "03_three-modes_photo_bimmerstop.png", "14_inner-rings_closeup.png"],
    "speedo.floor": ["17_physical-cluster_full.png", "05_comfort_tach-closeup.png", "03_three-modes_photo_bimmerstop.png"],
    "speedo.soft-glow": ["13_ticks_closeup.png", "17_physical-cluster_full.png", "05_comfort_tach-closeup.png", "04_comfort_whole-cluster_mph.png"],
    "speedo.hub-well": ["15_hub-needle_closeup.png", "05_comfort_tach-closeup.png"],
    "speedo.bezel": ["05_comfort_tach-closeup.png", "04_comfort_whole-cluster_mph.png", "03_three-modes_photo_bimmerstop.png", "13_ticks_closeup.png", "17_physical-cluster_full.png", "02_three-modes_clean-render.png"],
}
EVIDENCE = {"speedo.face": "ok", "speedo.face-shadow": "ok", "speedo.floor-shade": "weak", "speedo.tick-groove": "strong",
            "speedo.tick-groove-rim": "strong", "speedo.ticks": "strong", "speedo.inner-disc": "ok", "speedo.inner-ring": "ok",
            "speedo.floor": "ok", "speedo.soft-glow": "ok", "speedo.hub-well": "weak", "speedo.bezel": "ok"}
# element ROI (C1 dial frame) and angle for QC, and whether edges count
ROI = {
    "speedo.face": (["ring:0.52:0.77", "box:70:38:684:428"], None, False),
    "speedo.face-shadow": (["ring:0.93:0.985"], None, False),
    "speedo.floor-shade": (["ring:0.50:0.78", "box:70:470:684:250"], None, False),
    "speedo.tick-groove": (["ring:0.80:0.985"], None, True),
    "speedo.tick-groove-rim": (["ring:0.79:0.83"], None, True),
    "speedo.ticks": (["ring:0.81:0.95"], None, True),
    "speedo.inner-disc": (["ring:0.44:0.53", "box:70:38:684:420"], None, True),
    "speedo.inner-ring": (["ring:0.30:0.37", "box:70:38:684:420"], None, True),
    "speedo.floor": (["ring:0.15:0.47", "box:300:440:224:80"], None, True),
    "speedo.soft-glow": (["ring:0.86:0.96"], None, False),
    "speedo.hub-well": (["ring:0.15:0.30", "box:70:38:684:400"], None, False),
    "speedo.bezel": (["ring:0.94:1.02"], None, True),
    "stack": (["ring:0.0:1.0"], None, True),
}
REFS = ["05_comfort_tach-closeup.comfort.C2", "04_comfort_whole-cluster_mph.comfort.C1",
        "03_three-modes_photo_bimmerstop.comfort.C1", "17_physical-cluster_full.comfort.C1",
        "12_speedo_signs_overspeed-wedge.comfort.C1", "02_three-modes_clean-render.comfort.C1"]
PRIMARY_REF = {"speedo.ticks": "12_speedo_signs_overspeed-wedge.comfort.C1",
               "speedo.tick-groove-rim": "03_three-modes_photo_bimmerstop.comfort.C1",
               "speedo.tick-groove": "03_three-modes_photo_bimmerstop.comfort.C1",
               "speedo.soft-glow": "03_three-modes_photo_bimmerstop.comfort.C1",
               "speedo.floor": "05_comfort_tach-closeup.comfort.C2"}
# the rev dial (05) has another scale: compare the stack with it only off the tick band
STACK_ROI_REV = ["ring:0.0:0.79"]
DEFAULT_REF = "05_comfort_tach-closeup.comfort.C2"
BASE_IDS = ["speedo.face", "speedo.face-shadow", "speedo.floor-shade", "speedo.tick-groove", "speedo.hub-well"]


def even_crop(img):
    """Tight crop on alpha, the origin snapped to even px so the @0.5x file maps 2:1 onto the panel."""
    al = img[..., 3]
    ys, xs = np.nonzero(al > 0.5 / 255.0)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    x0 -= x0 % 2; y0 -= y0 % 2
    x1 += (x1 - x0) % 2; y1 += (y1 - y0) % 2
    return img[y0:y1, x0:x1], int(x0), int(y0)


def mirror_layers(layers):
    """Mirror a C1 layer stack about the speedo's centre and move it onto the rev dial (C2), to compare it with the
    C2 crops (05, 13) whose geometry is the speedo's mirror image."""
    out = []
    for img, x, y, s in layers:
        if isinstance(img, str):
            img = imageio.read_png(img)
        w_panel = img.shape[1] / s
        out.append((img[:, ::-1].copy(), int(round(1920 - x - w_panel)), y, s))
    return out


def mirror_rois(rois):
    out = []
    for r in rois:
        if r.startswith("box:"):
            x, y, w, h = (float(t) for t in r[4:].split(":"))
            out.append("box:%d:%d:%d:%d" % (1920 - x - w, y, w, h))
        else:
            out.append(r)
    return out


def run_qc(name, layers, ref, rois, edges):
    mir = ".C2" in ref
    lay = mirror_layers(layers) if mir else layers
    rr = mirror_rois(rois) if mir else rois
    res = qc.run(os.path.join(RECT, ref), lay, "C2" if mir else "C1", name, rois=rr, want_edges=edges, out_dir=WORK)
    m = res["metrics"]
    return {"ref": res["ref"], "roi": rois + (["mirrored onto C2"] if mir else []), "sheet": res.get("sheet"),
            "ssim": res["fit"]["ssim"], "dE2000_mean": res["fit"]["dE2000_mean"], "edge_px_err": res["fit"]["edge_px_err"],
            "luma_bias": m.get("luma_bias"), "valid_px": m.get("valid_px")}


def main():
    os.makedirs(OUT, exist_ok=True); os.makedirs(os.path.join(WORK, "proc"), exist_ok=True)
    bx, by, bw, bh = P.BOX
    imgs = draw.render_all()
    files = {}          # id -> (layer tuple for qc, manifest geometry)
    for k, (fn, z, kind) in draw.SOFT.items():
        crop, x0, y0 = even_crop(imgs[k])
        half = imageio.half_res(crop)
        fn_ = f"{k}.{kind}@0.5x.png"
        imageio.write_png(os.path.join(OUT, fn_), half, seed=zlib.crc32(k.encode()) & 0xFFFF)
        files[k] = dict(file=f"C1/{fn_}", x=bx + x0, y=by + y0, w=crop.shape[1], h=crop.shape[0], scale=0.5,
                        fw=half.shape[1], fh=half.shape[0], layer=(os.path.join(OUT, fn_), bx + x0, by + y0, 0.5), z=z, kind=kind,
                        cls="baked")
    for k, (fn, z, kind) in draw.CRISP.items():
        crop, x0, y0 = even_crop(imgs[k])
        pth = os.path.join(WORK, "proc", f"{k}.{kind}.png")
        imageio.write_png(pth, crop)
        files[k] = dict(file=None, x=bx + x0, y=by + y0, w=crop.shape[1], h=crop.shape[0], scale=1.0, fw=0, fh=0,
                        layer=(pth, bx + x0, by + y0, 1.0), z=z, kind=kind, cls="procedural",
                        preview=os.path.relpath(pth, ROOT))
    order = sorted(files, key=lambda k: files[k]["z"])
    stack = [files[k]["layer"] for k in order]

    # the proposed merge: every soft albedo / shadow layer flattened into one @0.5x base image (shadows burnt in)
    fx, fy, fw, fh = files["speedo.face"]["x"], files["speedo.face"]["y"], files["speedo.face"]["w"], files["speedo.face"]["h"]
    base = np.zeros((fh, fw, 4), np.float32)
    for k in [k for k in order if k in BASE_IDS]:
        img = imageio.read_png(files[k]["layer"][0])
        img = imageio.upscale2(img, files[k]["w"], files[k]["h"])
        imageio.over(base, img, files[k]["x"] - fx, files[k]["y"] - fy)
    imageio.write_png(os.path.join(OUT, "speedo.base.albedo@0.5x.png"), imageio.half_res(base), seed=7)

    # composed preview (panel box over black) for the report
    canvas = np.zeros((bh, bw, 4), np.float32); canvas[..., 3] = 1
    for k in order:
        img = imageio.read_png(files[k]["layer"][0]); s = files[k]["scale"]
        if s != 1.0:
            img = imageio.upscale2(img, files[k]["w"], files[k]["h"])
        imageio.over(canvas, img, files[k]["x"] - bx, files[k]["y"] - by)
    imageio.write_png(os.path.join(WORK, "stack_preview.png"), canvas)
    boost = canvas.copy(); boost[..., :3] = np.clip(boost[..., :3] * 4.0, 0, 1)
    imageio.write_png(os.path.join(WORK, "stack_preview_x4.png"), boost)

    # QC: each element with the layers up to it ("alone") and in the full stack, on the primary ref; the stack on all
    results = {}
    for k in order + ["stack"]:
        rois, ang, edges = ROI[k]
        ref = PRIMARY_REF.get(k, DEFAULT_REF)
        if k == "stack":
            results[k] = {r: run_qc("stack", stack, r, STACK_ROI_REV if ".C2" in r else rois, True) for r in REFS}
            results[k]["05_bezel"] = run_qc("stack.bezel", stack, "05_comfort_tach-closeup.comfort.C2", ["ring:0.94:1.02"], True)
            continue
        upto = [files[j]["layer"] for j in order if files[j]["z"] <= files[k]["z"]]
        results[k] = {"alone": run_qc(k, upto, ref, rois, edges),
                      "stack": run_qc(k + ".in-stack", stack, ref, rois, edges)}
        if k == "speedo.ticks":
            results[k]["alone_roll12"] = tick_qc_rolled(files, order, 1.67)
        if ref != "04_comfort_whole-cluster_mph.comfort.C1" and k != "speedo.ticks":
            results[k]["stack_04"] = run_qc(k + ".in-stack", stack, "04_comfort_whole-cluster_mph.comfort.C1", rois, edges)
    imageio.write_json(os.path.join(WORK, "qc.json"), results)

    # manifest
    layers = []
    for i, k in enumerate(order):
        f = files[k]
        fit = results[k]["stack"]
        e = {"id": k, "cluster": "C1", "z": f["z"], "kind": f["kind"], "class": f["cls"], "frame": "panel",
             "x": f["x"], "y": f["y"], "w": f["w"], "h": f["h"], "scale": f["scale"], "file": f["file"],
             "bytes_by_8wh": imageio.bytes_by_8wh(f["fw"], f["fh"]) if f["file"] else 0,
             "stack_below": order[:i][-2:], "stack_above": order[i + 1:i + 3],
             "sources": SOURCES[k], "evidence": EVIDENCE[k],
             "light": {"dir_deg": P.LIGHT["key_dir_deg"], "key": P.LIGHT["key"]},
             "fit": {"ssim": fit["ssim"], "dE2000_mean": fit["dE2000_mean"], "edge_px_err": fit["edge_px_err"],
                     "ref": fit["ref"], "roi": fit["roi"], "sheet": fit["sheet"]},
             "params": params_for(k)}
        if f["cls"] == "procedural":
            e["params"]["preview_1x"] = f["preview"]
        layers.append(e)
    soft = [k for k in order if files[k]["file"]]
    albedo_ids = BASE_IDS
    images = [
        {"file": "C1/speedo.base.albedo@0.5x.png", "from_ids": albedo_ids,
         "x": files["speedo.face"]["x"], "y": files["speedo.face"]["y"], "w": files["speedo.face"]["w"], "h": files["speedo.face"]["h"],
         "scale": 0.5, "bytes_by_8wh": imageio.bytes_by_8wh(files["speedo.face"]["fw"], files["speedo.face"]["fh"])},
        {"file": "C1/speedo.soft-glow.glow@0.5x.png", "from_ids": ["speedo.soft-glow"],
         "x": files["speedo.soft-glow"]["x"], "y": files["speedo.soft-glow"]["y"], "w": files["speedo.soft-glow"]["w"],
         "h": files["speedo.soft-glow"]["h"], "scale": 0.5,
         "bytes_by_8wh": imageio.bytes_by_8wh(files["speedo.soft-glow"]["fw"], files["speedo.soft-glow"]["fh"])},
        {"file": "(effect layer: WBDIAL-style shader, no image)", "from_ids": [k for k in order if not files[k]["file"]],
         "w": 0, "h": 0, "bytes_by_8wh": 0},
    ]
    man = {"cluster": "C1", "package": "P1", "mode": "comfort", "R": P.R_PX,
           "generator": "cd bake/src && uv run -q --no-project --with opencv-python-headless --with numpy --with pillow python -m C1.build",
           "layers": layers,
           "composition": {"images": images, "layer_count": 3,
                           "bytes_by_8wh_total": sum(im["bytes_by_8wh"] for im in images)},
           "open_questions": OPEN_QUESTIONS,
           "notes": ("Soft layers are shipped separately (for relighting) but proposed merged into 2 images: base albedo "
                     "(face, groove, shadows multiplied in) and one glow. Crisp layers (groove rim, ticks, disc edge, inner ring, "
                     "floor lip, bezel) are procedural: params in R units here and in bake/src/C1/params.py; 1x previews in "
                     "bake/work/C1/proc/. Shipped-files total if not merged: %d B." % sum(
                         imageio.bytes_by_8wh(files[k]["fw"], files[k]["fh"]) for k in soft))}
    imageio.write_json(MANIFEST, man)
    print(json.dumps({k: {kk: (vv if not isinstance(vv, dict) else {x: vv.get(x) for x in ("ssim", "dE2000_mean", "edge_px_err", "luma_bias")})
                          for kk, vv in v.items()} for k, v in results.items()}, indent=1))


def tick_qc_rolled(files, order, droll):
    """QC only: 12's own roll puts its majors 1.67 deg clockwise of the nominal 230 + v (12 majors 231.6 .. 131.5,
    pitch 19.99 deg). Re-render the tick layer with that roll so the edge error measures shape, not the photo's roll."""
    s0 = P.SCALE["start"]
    try:
        P.SCALE["start"] = s0 + droll
        g = draw.Grid(draw.SS)
        img = draw.ticks(g)
        pm = img.copy(); pm[..., :3] *= pm[..., 3:4]; pm = g.down(pm)
        a = pm[..., 3:4]; pm[..., :3] = np.where(a > 1e-6, pm[..., :3] / np.maximum(a, 1e-6), 0)
    finally:
        P.SCALE["start"] = s0
    bx, by = P.BOX[:2]
    lay = [files[j]["layer"] for j in order if files[j]["z"] < files["speedo.ticks"]["z"]] + [(pm, bx, by, 1.0)]
    return run_qc("speedo.ticks.roll12", lay, "12_speedo_signs_overspeed-wedge.comfort.C1", ["ring:0.81:0.91"], True)


def params_for(k):
    m = {
        "speedo.face": {"face": P.FACE, "disc_fill": {x: P.DISC[x] for x in ("r", "fill_rgb", "fill_edge_rgb", "fill_from")},
                        "below_floor": {x: P.FLOOR[x] for x in ("below_rgb", "below_r0", "below_r1")}, "floor_dy": P.FLOOR["dy"], "outer_r": 1.0},
        "speedo.face-shadow": P.FACE_SHADOW,
        "speedo.floor-shade": P.FLOOR_SHADE,
        "speedo.tick-groove": P.GROOVE,
        "speedo.tick-groove-rim": {"r": P.GROOVE["r_in"], "w": P.GROOVE["rim_w"], "rgb": P.GROOVE["rim_rgb"], "light": P.LIGHT},
        "speedo.ticks": {"scale": P.SCALE, "ticks": P.TICKS, "fringe": P.FRINGE,
                         "angle_cw12": "start + kmh * deg_per_kmh, kmh = 0, 2, .. 260; major kmh % 20 == 0, mid kmh % 10 == 0"},
        "speedo.inner-disc": {x: P.DISC[x] for x in ("r", "edge_w", "edge_rgb")} | {
            "open_at_bottom": "drawn only where v < floor dy (0.245 R): the arc ends at cw12 +-120.2 deg", "light": P.LIGHT},
        "speedo.inner-ring": P.RING | {"open_at_bottom": "ends at cw12 +-137.9 deg (v = 0.245 R)", "light": P.LIGHT},
        "speedo.floor": {x: P.FLOOR[x] for x in ("dy", "lip_rgb", "lip_w")} | {"half_length_u": 0.421},
        "speedo.soft-glow": {"tick_spot": P.TICK_SPOT, "tick_halo": P.TICK_HALO,
                             "disc_halo": {x: P.DISC[x] for x in ("halo_scale", "halo_rgb", "halo_a")},
                             "ring_halo": {x: P.RING[x] for x in ("halo_scale", "halo_a")},
                             "floor_glow": {x: P.FLOOR[x] for x in ("glow_rgb", "glow_a", "glow_pow")}},
        "speedo.hub-well": P.HUB_WELL | {"hub_ring": P.HUB_RING},
        "speedo.bezel": P.BEZEL | {"inner_rim": P.BEZEL_INNER_RIM},
    }
    return json.loads(json.dumps(m[k]))


OPEN_QUESTIONS = [
    "Light: the bezel ridge in the photos is brightest at the top (cw12 ~8) and the lower outer side (cw12 ~232), and "
    "the lobes mirror between the two dials (05 vs 04/03), so they are drawn, not glass reflections; the groove rim "
    "points to a key from the top / upper left (math 84-127). Adopted: key 115 deg math for rims and tubes, two-lobed "
    "bezel gloss. The brief's 'upper left key + low right second light' is NOT what the photos show for the bezel.",
    "Floor-shade (z 2.5) is weak: 05 shows the darkening below the horizon, 04 and 03 do not; kept at alpha 0.45.",
    "Hub well: no visible vignette in 05/15 beyond the red hub glow (dynamic); kept weak (alpha 0.30).",
    "Ticks are measured partly on the rev dial (13, 05, mirrored); the speedo's own widths in 12 / 03 are blur-limited.",
    "17 has veiling glare (face L 50-72): its dE is not a fit target; levels follow 05 / 04 / 03.",
    "02 (clean render) puts the disc at 0.568 R and floor at 0.134 R: not followed (photos agree on 0.487 / 0.245).",
]

if __name__ == "__main__":
    main()
