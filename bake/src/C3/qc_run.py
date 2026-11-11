"""P3 QC: every C3 / C4 element alone and in the composed stack, against 17 / 04 / 07, through bake/src/qc.py.

    cd bake/src && $PY -m C3.qc_run

ROIs are our own L8 masks (crop-sized, bake/work/<C>/roi_*.png): element region (in the bezel or the eccentric scale
frame, fuel convention, mirrored for C4) AND NOT the exclusions: the needle (dynamic; bright pixels inside 0.6 R,
dilated), live text ("0", "1/1"), and the main dial's bezel passing through the open side (r > 0.9 R there).
Writes the fit into bake/manifest/C3.json / C4.json (the element entry's `fit` = in-stack numbers against the primary
reference, `fit.alone` = alone, `fit.by_ref` = every reference) and bake/work/C3/qc_summary.json.
"""
import json
import os
import sys

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import qc  # noqa: E402
from C3 import build as B  # noqa: E402

ROOT = B.ROOT
RECT = os.path.join(ROOT, "bake", "work", "rect")
WORK = os.path.join(ROOT, "bake", "work")

REFS = {
    "C3": ["17_physical-cluster_full.comfort.C3@2x", "04_comfort_whole-cluster_mph.comfort.C3",
           "07_physical-cluster_all-lamps-lit.comfort.C3"],
    "C4": ["17_physical-cluster_full.comfort.C4", "04_comfort_whole-cluster_mph.comfort.C4",
           "07_physical-cluster_all-lamps-lit.comfort.C4"],
}
PRIMARY = {"C3": "04_comfort_whole-cluster_mph.comfort.C3", "C4": "04_comfort_whole-cluster_mph.comfort.C4"}


def ref_grid(base, cl):
    meta = json.load(open(os.path.join(RECT, base + ".json")))
    bx = meta["box"]
    im = cv2.imread(os.path.join(RECT, base + ".png"))
    k = im.shape[0] / bx[3]
    h, w = im.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float64)
    X, Y = bx[0] + (xx + 0.5) / k, bx[1] + (yy + 0.5) / k
    c = B.GAUGES[cl]["c"]
    u, v = (X - c[0]) / B.R, (Y - c[1]) / B.R
    if B.GAUGES[cl]["mirror"]:
        u = -u
    return im, u, v, k


def exclusions(base, cl):
    im, u, v, k = ref_grid(base, cl)
    r = np.hypot(u, v)
    ang = B.cw12(u, v)
    L = im.mean(2)
    s = B.P["scale"]
    rs = np.hypot(u - s["dx"], v - s["dy"])
    face = np.median(L[(r > 0.3) & (r < 0.5)])
    needle = ((L > face + 0.35 * (L[rs < 0.53].max() - face)) & (rs < 0.555)).astype(np.uint8)
    needle = cv2.dilate(needle, np.ones((int(5 * k) | 1, int(5 * k) | 1), np.uint8)) > 0
    needle |= r < 0.20                                     # the needle's hub
    text = (r > 0.6) & (r < 0.95) & (B.ang_dist(ang, 140.0) < 11)        # "0" (fuel) - also blanked on C4
    if cl == "C3":
        text |= (r > 0.6) & (r < 0.95) & ((ang > 333) | (ang < 2))        # "1/1"
    other = (r > 0.9) & (ang > 15) & (ang < 132)           # the main dial's bezel through the open side
    other |= r > 1.04
    return u, v, r, ang, needle | text | other, k


def roi_masks(base, cl):
    u, v, r, ang, excl, k = exclusions(base, cl)
    s = B.P["scale"]
    rs = np.hypot(u - s["dx"], v - s["dy"])
    angs = B.cw12(u - s["dx"], v - s["dy"])
    ib = B.ICONS[cl]["bbox"]
    uu = -u if B.GAUGES[cl]["mirror"] else u                  # icons are in the gauge's own orientation
    icon = (uu > ib[0] - 0.05) & (uu < ib[2] + 0.05) & (v > ib[1] - 0.05) & (v < ib[3] + 0.05)
    zones = (rs > 0.6) & (rs < 0.86) & (angs > 148) & (angs < 182)
    if cl == "C4":
        zones |= (rs > 0.6) & (rs < 0.86) & (angs > 314) & (angs < 348)
    out = {
        "face": ((r < 0.55) | ((r > 0.84) & (r < 0.92))) & ~icon & ~zones,
        "bezel": (r > 0.88) & (r < 1.03) & ((ang > 128) | (ang < 18)),
        "inner-arc": (rs > 0.55) & (rs < 0.635) & (angs > 160) & (angs < 352),
        "ticks": (rs > 0.6) & (rs < 0.85) & (angs > 182) & (angs < (314 if cl == "C4" else 333)),
        "zones": zones,
        "pictogram": icon,
        "stack": r < 1.03,
    }
    out["bezel-highlight"] = out["bezel"]
    paths = {}
    os.makedirs(os.path.join(WORK, cl), exist_ok=True)
    for key, m in out.items():
        m = m & ~excl
        p = os.path.join(WORK, cl, f"roi_{key}__{base}.png")
        cv2.imwrite(p, (m * 255).astype(np.uint8))
        paths[key] = p
    return paths


def main():
    summary = {}
    for cl in ("C3", "C4"):
        mpath = os.path.join(B.MAN, f"{cl}.json")
        man = json.load(open(mpath))
        layers = sorted(man["layers"], key=lambda e: e["z"])
        spec = {e["id"]: (os.path.join(B.BAKED, e["file"]), e["x"], e["y"], e["scale"]) for e in layers}
        stack = [spec[e["id"]] for e in layers]
        merged = os.path.join(B.BAKED, man["composition"]["images"][0]["file"])
        ox, oy = B.layer_origin(cl)
        summary[cl] = {}
        for base in REFS[cl]:
            rois = roi_masks(base, cl)
            rb = os.path.join(RECT, base)
            summary[cl][base] = {}
            for e in layers:
                key = e["id"].split(".", 1)[1]
                roi = ["mask:" + rois[key]]
                crisp = key in ("ticks", "inner-arc", "zones", "pictogram", "bezel")
                alone = qc.run(rb, [spec[e["id"]]], cl, e["id"] + ".alone", rois=roi, ignore_bits=31,
                               want_edges=crisp, sheet=False)
                inst = qc.run(rb, stack, cl, e["id"], rois=roi, ignore_bits=31, want_edges=crisp, sheet=True)
                summary[cl][base][e["id"]] = {"alone": alone["fit"], "stack": inst["fit"], "sheet": inst.get("sheet"),
                                              "valid_px": inst["metrics"].get("valid_px"),
                                              "banding": inst["metrics"].get("banding")}
            full = qc.run(rb, [(merged, ox, oy, 1.0)], cl, f"{B.GAUGES[cl]['name']}.merged",
                          rois=["mask:" + rois["stack"]], want_edges=True, sheet=True)
            summary[cl][base]["merged"] = {"stack": full["fit"], "sheet": full.get("sheet"),
                                           "valid_px": full["metrics"].get("valid_px")}
        for e in man["layers"]:
            byref = {b: summary[cl][b][e["id"]]["stack"] for b in REFS[cl]}
            p = summary[cl][PRIMARY[cl]][e["id"]]
            e["fit"] = dict(p["stack"], ref=os.path.relpath(os.path.join(RECT, PRIMARY[cl]), ROOT),
                            roi=os.path.relpath(os.path.join(WORK, cl, f"roi_{e['id'].split('.', 1)[1]}__{PRIMARY[cl]}.png"), ROOT),
                            sheet=p["sheet"], alone=p["alone"], by_ref=byref)
        man["fit_composed"] = {b: summary[cl][b]["merged"]["stack"] for b in REFS[cl]}
        json.dump(man, open(mpath, "w"), indent=1)
    json.dump(summary, open(os.path.join(WORK, "C3", "qc_summary.json"), "w"), indent=1)
    # print a table
    for cl in summary:
        for base in summary[cl]:
            for lid, d in summary[cl][base].items():
                s = d["stack"]
                a = d.get("alone", {})
                print(f"{cl} {base[:24]:24s} {lid:24s} stack ssim {s['ssim'] if s['ssim'] is None else round(s['ssim'],3)} "
                      f"dE {round(s['dE2000_mean'],2)} edge {s['edge_px_err'] if s['edge_px_err'] is None else round(s['edge_px_err'],2)}"
                      + (f" | alone ssim {round(a['ssim'],3)} dE {round(a['dE2000_mean'],2)}" if a else "")
                      + f"  n={d.get('valid_px')}")


if __name__ == "__main__":
    main()
