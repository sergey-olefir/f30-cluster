"""Tune the measured parameters of P3 against the references (bake/work/C3/fit_log.json). Not part of the
regenerate command: its result is written back into build.P by hand (the numbers in build.py are the fitted ones)."""
import json, os, sys
import numpy as np
from scipy.optimize import minimize
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, os.path.dirname(HERE))
import qc
from C3 import build as B, qc_run as Q

REFS = {"C3": ["17_physical-cluster_full.comfort.C3@2x", "04_comfort_whole-cluster_mph.comfort.C3", "07_physical-cluster_all-lamps-lit.comfort.C3"],
        "C4": ["17_physical-cluster_full.comfort.C4", "04_comfort_whole-cluster_mph.comfort.C4"]}
W = {"17": 1.0, "04": 1.0, "07": 0.5}
ROIS = {cl: {b: Q.roi_masks(b, cl) for b in REFS[cl]} for cl in REFS}

def setp(path, val):
    d = B.P
    for k in path[:-1]:
        d = d[k]
    if isinstance(path[-1], tuple):
        d[path[-1][0]][path[-1][1]] = float(val)
    else:
        d[path[-1]] = float(val)

def score(elements, roi_key, edges=False):
    tot = 0; n = 0
    for cl in REFS:
        ox, oy = B.layer_origin(cl)
        stack = [(B.el_face(cl, 2), ox, oy, 1.0)] + [(fn(cl, 2), ox, oy, 1.0) for fn in elements]
        for b in REFS[cl]:
            r = qc.run(os.path.join(Q.RECT, b), stack, cl, "fit", rois=["mask:" + ROIS[cl][b][roi_key]], want_edges=edges, sheet=False)
            f = r["fit"]; w = W[b[:2]]
            tot += w * (f["ssim"] - f["dE2000_mean"] / 40.0 - (0.1 * f["edge_px_err"] if edges and f["edge_px_err"] else 0)); n += w
    return tot / n

def run(name, params, x0, elements, roi_key, iters=60, edges=False):
    def obj(x):
        for p, v in zip(params, x): setp(p, v)
        return -score(elements, roi_key, edges)
    s0 = -obj(x0)
    res = minimize(obj, x0, method="Nelder-Mead", options={"maxfev": iters, "xatol": 1e-4, "fatol": 1e-4, "initial_simplex": None})
    for p, v in zip(params, res.x): setp(p, v)
    print(name, "score", round(s0, 4), "->", round(-res.fun, 4), dict(zip([str(p) for p in params], np.round(res.x, 4))))
    return {"params": [str(p) for p in params], "x": res.x.tolist(), "score0": s0, "score": -res.fun}

if __name__ == "__main__":
    which = sys.argv[1:] or ["ticks", "arc", "bezel", "zones"]
    log = {}
    if "ticks" in which:
        T = ("ticks",)
        log["ticks"] = run("ticks", [("scale", "a0"), ("scale", "pitch"), ("scale", "dx"), ("ticks", ("major_r", 0)), ("ticks", ("major_r", 1)),
                                     ("ticks", ("minor_r", 0)), ("ticks", ("minor_r", 1)), ("ticks", "major_w"), ("ticks", "minor_w"), ("ticks", "minor_gain")],
                           [B.P["scale"]["a0"], B.P["scale"]["pitch"], B.P["scale"]["dx"], *B.P["ticks"]["major_r"], *B.P["ticks"]["minor_r"],
                            B.P["ticks"]["major_w"], B.P["ticks"]["minor_w"], B.P["ticks"]["minor_gain"]], [B.el_ticks], "ticks", iters=220)
    if "arc" in which:
        log["arc"] = run("arc", [("arc", "r"), ("arc", "w"), ("arc", ("rgb", 0)), ("arc", ("fade_in", 0)), ("arc", ("fade_in", 1))],
                         [B.P["arc"]["r"], B.P["arc"]["w"], B.P["arc"]["rgb"][0], *B.P["arc"]["fade_in"]], [B.el_arc], "inner-arc", iters=100)
    if "bezel" in which:
        log["bezel"] = run("bezel", [("bezel", "r_peak"), ("bezel", "sigma"), ("bezel", "base_gain"), ("bezel", "hl_gain"), ("bezel", "hl_peak_cw12"),
                                     ("bezel", "hl_width_deg"), ("bezel", "rim_gain")],
                           [B.P["bezel"][k] for k in ("r_peak", "sigma", "base_gain", "hl_gain", "hl_peak_cw12", "hl_width_deg", "rim_gain")],
                           [B.el_bezel, B.el_bezel_hl], "bezel", iters=150)
    if "zones" in which:
        log["zones"] = run("zones", [("zone", ("bar_r", 0)), ("zone", ("bar_r", 1)), ("zone", ("end_r", 0)), ("zone", ("end_r", 1)), ("zone", "low_to"),
                                     ("zone", "high_from"), ("zone", "gap_deg"), ("zone", "end_over_deg")],
                           [*B.P["zone"]["bar_r"], *B.P["zone"]["end_r"], B.P["zone"]["low_to"], B.P["zone"]["high_from"], B.P["zone"]["gap_deg"], B.P["zone"]["end_over_deg"]],
                           [B.el_zones], "zones", iters=120)
    log["P"] = B.P
    json.dump(log, open(os.path.join(B.ROOT, "bake/work/C3/fit_log.json"), "w"), indent=1)
    print(json.dumps(B.P))
