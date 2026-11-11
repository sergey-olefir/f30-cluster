"""Try width / level tables for the wing against 03 (QC on the wing ROI); prints the scores."""
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, os.path.dirname(HERE)); sys.path.insert(0, HERE)
import build, draw, params as P
g = build.ref_geo("03")
mw = build.panel_mask(os.path.join(build.WORK, "roi_wings_03.png"), g, "wings")
V = {
 "base": (P.WING["width"], P.WING["level"]),
 "wider_tail": ([(0.76, 7.0), (0.84, 11.0), (0.88, 10.0), (0.92, 6.0), (0.98, 4.5), (1.06, 3.5), (1.13, 2.0)], P.WING["level"]),
 "wider_dim": ([(0.76, 7.0), (0.84, 12.0), (0.88, 11.0), (0.92, 7.0), (0.98, 5.0), (1.06, 4.0), (1.13, 2.5)],
               [(0.76, 0.80), (0.84, 1.0), (0.90, 0.95), (0.96, 0.72), (1.02, 0.55), (1.08, 0.35), (1.13, 0.0)]),
 "wide_soft": ([(0.76, 8.0), (0.84, 13.0), (0.88, 12.0), (0.92, 8.0), (0.98, 6.0), (1.06, 5.0), (1.13, 3.0)],
               [(0.76, 0.75), (0.84, 0.95), (0.90, 0.90), (0.96, 0.65), (1.02, 0.50), (1.08, 0.30), (1.13, 0.0)]),
}
for k, (w, l) in V.items():
    p = dict(P.WING); p["width"] = w; p["level"] = l
    lay = []
    for C in ("C1", "C2"):
        for part in ("upper", "lower"):
            img, x0, y0, _, _ = draw.wing(g, C, part, p=p)
            lay.append((img, x0, y0, 1.0))
    r = build.run_qc(build.STEMS["03"] + ".sport.PANEL", lay, "PANEL", "tune." + k, ["mask:" + mw], edges=True)
    print(k, r["fit"]["ssim"], r["fit"]["dE2000_mean"], r["fit"]["edge_px_err"])
