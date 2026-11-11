"""Fit the wing centreline |v|(u) = vt - s*(u - 1) + c*exp(-(u - 0.78)/lam) to 03's four wings (mirrored into the
upper-left frame), plus width / level tables. Prints the result; params.py holds the adopted numbers."""
import json, itertools, numpy as np
d = json.load(open("/Users/solefir/projects/f30-cluster/bake/work/C8-sport/measure_wings.json"))
for stem in ("03_three-modes_photo_bimmerstop", "02_three-modes_clean-render"):
    U, V, P, F = [], [], [], []
    for k, pts in d[stem]["wings"].items():
        for p in pts:
            if p["u"] > 1.15 or p["peak"] < 60 or p["fwhm_px"] > 25: continue
            # drop the inner part that runs along the bezel (r < 1.0) and the shelf line
            if np.hypot(p["u"], p["v"]) < 0.995: continue
            U.append(p["u"]); V.append(abs(p["v"])); P.append(p["peak"]); F.append(p["fwhm_px"])
    U, V, P, F = map(np.array, (U, V, P, F))
    best = None
    for vt, s, c, lam in itertools.product(np.arange(0.40, 0.65, 0.005), np.arange(0.15, 0.40, 0.01),
                                           np.arange(0.0, 0.25, 0.01), np.arange(0.02, 0.12, 0.005)):
        m = vt - s * (U - 1.0) + c * np.exp(-(U - 0.78) / lam)
        e = np.mean((m - V) ** 2)
        if best is None or e < best[0]: best = (e, vt, s, c, lam)
    e, vt, s, c, lam = best
    print(stem, "n=%d rms %.4f R (%.2f px)" % (len(U), np.sqrt(e), np.sqrt(e) * 335), "vt %.3f s %.2f c %.2f lam %.3f" % (vt, s, c, lam))
    for u0 in np.arange(0.76, 1.16, 0.02):
        m = np.abs(U - u0) < 0.011
        if m.any(): print("   u %.2f |v| %.3f peak %5.1f fwhm %4.1f n %d" % (u0, V[m].mean(), P[m].mean(), F[m].mean(), m.sum()))
