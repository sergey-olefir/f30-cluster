import json, itertools, numpy as np
d = json.load(open("/Users/solefir/projects/f30-cluster/bake/work/C8-sport/measure_wings.json"))
stem = "03_three-modes_photo_bimmerstop"
U, V, S = [], [], []
for k, pts in d[stem]["wings"].items():
    sg = -1 if "upper" in k else 1
    for p in pts:
        if p["u"] > 1.12 or p["peak"] < 60 or p["fwhm_px"] > 25 or np.hypot(p["u"], p["v"]) < 0.995: continue
        if sg * p["v"] < 0.3: continue
        U.append(p["u"]); V.append(p["v"]); S.append(sg)
U, V, S = map(np.array, (U, V, S))
best = None
for v0 in np.arange(-0.01, 0.0201, 0.0025):
    for s, c, lam in itertools.product(np.arange(0.15, 0.36, 0.01), np.arange(0.05, 0.40, 0.01), np.arange(0.02, 0.10, 0.0025)):
        f = - s * (U - 1.0) + c * np.exp(-(U - 0.78) / lam)
        # vt by least squares
        vt = np.mean(S * (V - v0) - f)
        e = np.mean((v0 + S * (vt + f) - V) ** 2)
        if best is None or e < best[0]: best = (e, v0, vt, s, c, lam)
e, v0, vt, s, c, lam = best
print("rms %.4f R = %.2f px; v0 %.4f vt %.4f s %.2f c %.2f lam %.4f" % (np.sqrt(e), np.sqrt(e) * 335, v0, vt, s, c, lam))
f = - s * (U - 1.0) + c * np.exp(-(U - 0.78) / lam)
res = v0 + S * (vt + f) - V
for sg in (-1, 1):
    m = S == sg
    print("  side", sg, "rms px %.2f" % (np.sqrt(np.mean(res[m] ** 2)) * 335), "mean px %.2f" % (np.mean(res[m]) * 335))
