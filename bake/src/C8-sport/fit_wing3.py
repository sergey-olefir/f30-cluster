"""Wing centreline in the upper-left dial frame: |v - v0| = vt - s*(u - 1) + m/2*(sqrt((u-uc)^2 + b^2) - (u-uc)).
Tail slope s, extra slope m before the corner at uc (roundness b). Fitted to 03's four wings (mirrored)."""
import json, itertools, numpy as np
d = json.load(open("/Users/solefir/projects/f30-cluster/bake/work/C8-sport/measure_wings.json"))
def fit(stem, umax=1.12):
    U, V, S, K = [], [], [], []
    for k, pts in d[stem]["wings"].items():
        sg = -1 if "upper" in k else 1
        for p in pts:
            if p["u"] > umax or p["peak"] < 60 or p["fwhm_px"] > 25 or np.hypot(p["u"], p["v"]) < 0.995: continue
            if sg * p["v"] < 0.15: continue
            U.append(p["u"]); V.append(p["v"]); S.append(sg); K.append(k)
    U, V, S = map(np.array, (U, V, S))
    best = None
    for v0 in np.arange(-0.01, 0.0201, 0.0025):
        for s, m, uc, b in itertools.product(np.arange(0.15, 0.36, 0.01), np.arange(0.4, 3.0, 0.1),
                                             np.arange(0.80, 0.95, 0.005), np.arange(0.005, 0.12, 0.005)):
            f = -s * (U - 1.0) + m / 2 * (np.sqrt((U - uc) ** 2 + b * b) - (U - uc))
            vt = np.mean(S * (V - v0) - f)
            e = np.mean((v0 + S * (vt + f) - V) ** 2)
            if best is None or e < best[0]: best = (e, v0, vt, s, m, uc, b)
    e, v0, vt, s, m, uc, b = best
    f = -s * (U - 1.0) + m / 2 * (np.sqrt((U - uc) ** 2 + b * b) - (U - uc))
    res = (v0 + S * (vt + f) - V) * 335
    print(stem, "n %d rms %.2f px; v0 %.4f vt %.4f s %.2f m %.2f uc %.3f b %.3f" % (len(U), np.sqrt(np.mean(res ** 2)), v0, vt, s, m, uc, b))
    for k in sorted(set(K)):
        mk = np.array(K) == k
        print("   %-8s rms %.2f px mean %.2f px" % (k, np.sqrt(np.mean(res[mk] ** 2)), res[mk].mean()))
    return best
fit("03_three-modes_photo_bimmerstop")
