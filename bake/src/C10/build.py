"""C10 background: the panel outside the dials and the centre window. One baked, opaque, soft layer @0.5x.

Model (fitted, numbers in the manifest): colour(x, y) = base_rgb + halo_rgb * h(r), r = distance to the nearer big
dial centre in R units, h = 1 for r <= r0, exp(-(r - r0) / w) beyond. No vertical gradient and no corner vignette:
none is measurable on the drawn TFT background (the lifts in 17 / 03 / 04 corners are housing, glare and flare; see
docs/BAKE-C9-overlays.md section 1). Fit references: 02 (clean render, primary) and 04 (dark-room photo); 17 is
veiling glare (documented, not fitted).

    cd bake/src && $PY -m C10.build
"""
import json, os, sys
import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.dirname(HERE)
ROOT = os.path.abspath(os.path.join(SRC, "..", ".."))
sys.path.insert(0, SRC)
from common import geom, imageio  # noqa: E402
from C10.refgeom import outside_mask, dials_in_panel  # noqa: E402
import qc  # noqa: E402

RECT = os.path.join(ROOT, "bake", "work", "rect")
WORK = os.path.join(ROOT, "bake", "work", "C10")
BAKED = os.path.join(ROOT, "apps", "f30_cluster", "hud", "baked")
OUT_FILE = "C10/panel.background.albedo@0.5x.png"
FIT_REFS = [("02_three-modes_clean-render", "comfort"), ("04_comfort_whole-cluster_mph", "comfort")]
CHECK_REFS = FIT_REFS + [("17_physical-cluster_full", "comfort"), ("03_three-modes_photo_bimmerstop", "comfort")]
R0 = 1.04          # the halo starts where the dial's own bezel spill ends (C1 / C2 own r < 1.04)


def load(stem, mode):
    a = cv2.imread(os.path.join(RECT, f"{stem}.{mode}.PANEL.png"))[..., ::-1].astype(np.float64)
    bits = cv2.imread(os.path.join(RECT, f"{stem}.{mode}.PANEL.maskbits.png"), cv2.IMREAD_GRAYSCALE)
    return a, bits


def rdist(D, shape=(720, 1920)):
    yy, xx = np.mgrid[0:shape[0], 0:shape[1]]
    r = np.full(shape, 9.0)
    for cl in ("C1", "C2"):
        cx, cy, R = D[cl]
        r = np.minimum(r, np.hypot(xx + 0.5 - cx, yy + 0.5 - cy) / R)
    return r


def bg_mask(stem, mode):
    m, D = outside_mask(stem, mode, big=R0, mini=1.10)
    a, bits = load(stem, mode)
    ok = m & ((bits & 7) == 0)
    yy = np.mgrid[0:720, 0:1920][0]
    ok &= (yy >= 40) & (yy < 560)      # outside the 6WB TFT the PANEL crops show housing (top band, bottom ledge)
    # objects that are not background: telltale lamps, housing edges, reflections (luma > the area's median + 24,
    # dilated 6 px; relative so the veiled photo 17 keeps its haze level)
    L = a @ np.array([0.2126, 0.7152, 0.0722])
    obj = cv2.dilate((L > np.median(L[ok]) + 24).astype(np.uint8), np.ones((13, 13), np.uint8)) > 0
    ok &= ~obj
    return ok, D, a


def fit():
    bases, prof = [], {}
    for stem, mode in FIT_REFS:
        ok, D, a = bg_mask(stem, mode)
        r = rdist(D)
        far = ok & (r >= 1.16)
        bases.append(np.median(a[far], 0))
        bins = np.arange(R0, 1.30, 0.02)
        prof[stem] = [(float(b), np.median(a[ok & (r >= b) & (r < b + 0.02)], 0).tolist()) for b in bins
                      if (ok & (r >= b) & (r < b + 0.02)).sum() > 100]
    base = np.mean(bases, 0)
    # halo from 02 (the clean render; 04 shows none above its noise): excess over its own far field
    stem = FIT_REFS[0][0]
    b02 = bases[0]
    ex = np.array([[b] + list(np.array(v) - b02) for b, v in prof[stem]])
    lum = ex[:, 1:].mean(1)
    A = np.clip(ex[0, 1:], 0, None)
    sel = lum > 0.3
    if sel.sum() >= 3:
        k = np.polyfit(ex[sel, 0] - R0, np.log(np.maximum(lum[sel], 1e-3)), 1)[0]
        w = float(np.clip(-1.0 / k, 0.02, 0.2)) if k < 0 else 0.06
    else:
        w = 0.06
    return {"base_rgb_255": [round(float(v), 2) for v in base], "base_rgb_per_ref": {s[0][:2]: [round(float(v), 2) for v in b] for s, b in zip(FIT_REFS, bases)},
            "halo_rgb_255": [round(float(v), 2) for v in A], "halo_r0_R": R0, "halo_w_R": round(w, 4),
            "profiles": {k[:2]: [[round(b, 2)] + [round(x, 1) for x in v] for b, v in p] for k, p in prof.items()}}


def render(P, D, shape=(720, 1920)):
    r = rdist(D, shape)
    h = np.where(r <= P["halo_r0_R"], 1.0, np.exp(-(r - P["halo_r0_R"]) / P["halo_w_R"]))
    rgb = np.array(P["base_rgb_255"])[None, None, :] / 255.0 + h[..., None] * np.array(P["halo_rgb_255"])[None, None, :] / 255.0
    img = np.concatenate([np.clip(rgb, 0, 1), np.ones(shape + (1,))], axis=2)
    return img


def run():
    os.makedirs(WORK, exist_ok=True)
    os.makedirs(os.path.join(BAKED, "C10"), exist_ok=True)
    P = fit()
    Dg = {cl: (geom.G20[cl]["c"][0], geom.G20[cl]["c"][1], geom.G20[cl]["R"]) for cl in ("C1", "C2")}
    full = render(P, Dg)
    half = imageio.half_res(full)
    path = os.path.join(BAKED, OUT_FILE)
    imageio.write_png(path, half)
    hh, ww = half.shape[:2]
    res = {"params": P, "file": OUT_FILE, "file_wh": [ww, hh], "bytes_by_8wh": imageio.bytes_by_8wh(ww, hh), "qc": {}}
    for stem, mode in CHECK_REFS:
        ok, D, a = bg_mask(stem, mode)
        mp = os.path.join(WORK, f"bgmask_{stem[:2]}.png")
        cv2.imwrite(mp, (ok * 255).astype(np.uint8))
        base = os.path.join(RECT, f"{stem}.{mode}.PANEL")
        # (a) the shipped file as is (G20 geometry); (b) the same parameters in the reference's own dial geometry
        r1 = qc.run(base, [(path, 0, 0, 0.5)], "C10", "panel.background", rois=[f"mask:{mp}"], ignore_bits=7, want_edges=False)
        own = render(P, D)
        r2 = qc.run(base, [(own, 0, 0, 1.0)], "C10", "panel.background.refgeom", rois=[f"mask:{mp}"], ignore_bits=7, want_edges=False)
        res["qc"][stem[:2]] = {"shipped": {**r1["fit"], "luma_bias": r1["metrics"].get("luma_bias"), "dE2000_p95": r1["metrics"].get("dE2000_p95"),
                                           "valid_px": r1["metrics"].get("valid_px"), "banding": r1["metrics"].get("banding"), "sheet": r1.get("sheet"), "ref": r1["ref"]},
                               "ref_geometry": {**r2["fit"], "luma_bias": r2["metrics"].get("luma_bias"), "dE2000_p95": r2["metrics"].get("dE2000_p95"), "sheet": r2.get("sheet")}}
        print(stem[:2], "shipped", r1["fit"], "bias", r1["metrics"].get("luma_bias"), "| refgeom", r2["fit"])
    json.dump(res, open(os.path.join(WORK, "c10_fit.json"), "w"), indent=1)
    write_manifest(res)
    print(json.dumps(P))
    return res


def write_manifest(res):
    P = res["params"]
    q = res["qc"]
    f02 = q["02"]["shipped"]
    entry = {"id": "panel.background", "cluster": "C10", "z": 0, "kind": "albedo", "class": "baked", "frame": "panel",
             "x": 0, "y": 0, "w": 1920, "h": 720, "scale": 0.5, "file": OUT_FILE, "bytes_by_8wh": res["bytes_by_8wh"],
             "stack_below": [], "stack_above": [],
             "sources": ["02_three-modes_clean-render.png", "04_comfort_whole-cluster_mph.png", "17_physical-cluster_full.png", "03_three-modes_photo_bimmerstop.png"],
             "evidence": "ok",
             "fit": {"ssim": f02["ssim"], "dE2000_mean": f02["dE2000_mean"], "edge_px_err": None, "ref": f02["ref"],
                     "roi": "mask:bake/work/C10/bgmask_02.png (outside 1.04 R of the big dials, 1.10 R of the minis, the window, y 40-560, bright objects)",
                     "sheet": f02["sheet"]},
             "params": {"notes": "Opaque, the bottom of the whole scene. colour = base + halo * h(r); r = distance to the nearer big dial centre "
                                 "in R units; h = 1 for r <= r0, exp(-(r - r0) / w) beyond. Values are sRGB 0-255 (dithered). No vertical gradient "
                                 "and no vignette are measurable on the drawn background; the halo is seen in 02 only (weak), 04 is flat.",
                        "base_rgb_255": P["base_rgb_255"], "halo_rgb_255": P["halo_rgb_255"], "halo_r0_R": P["halo_r0_R"], "halo_w_R": P["halo_w_R"],
                        "base_rgb_per_ref": P["base_rgb_per_ref"],
                        "qc_all": {k: {"shipped": {kk: v["shipped"][kk] for kk in ("ssim", "dE2000_mean", "luma_bias")},
                                       "ref_geometry": {kk: v["ref_geometry"][kk] for kk in ("ssim", "dE2000_mean", "luma_bias")}} for k, v in q.items()},
                        "alternatives": "procedural: 2 colours + 2 numbers in WBBACK (0 bytes, 0 extra layers); @0.25x file 480x180 = 691200 bytes"}}
    man = {"cluster": "C10", "package": "P8", "mode": "comfort", "R": 335, "generator": "cd bake/src && $PY -m C10.build",
           "layers": [entry],
           "composition": {"images": [{"file": OUT_FILE, "from_ids": ["panel.background"], "x": 0, "y": 0, "w": 960, "h": 360, "scale": 0.5,
                                       "bytes_by_8wh": res["bytes_by_8wh"]}],
                           "layer_count": 1, "bytes_by_8wh_total": res["bytes_by_8wh"]},
           "open_questions": [
               "The fitted background is almost black (base rgb ~0,0.5,1.5 + a 1,1,2 halo). 2.64 MiB (w*h*8) for it is poor value: recommend folding the "
               "4 numbers into the existing WBBACK effect (0 bytes, no new layer) or, if it must be an image, the @0.25x variant (0.66 MiB). P9 decides.",
               "17 (veiling glare, L ~45) and 03 (daylight on the housing) are not fitted: their lift is the glass / housing, documented in C9."],
           "notes": "Fit report: bake/report/C10.md (in bake/report/C9.md). QC sheets: bake/work/C10/qc_panel.background*.png."}
    json.dump(man, open(os.path.join(ROOT, "bake", "manifest", "C10.json"), "w"), indent=1)


if __name__ == "__main__":
    run()
