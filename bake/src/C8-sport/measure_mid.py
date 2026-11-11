"""Measure the Sport wings and bridge in the rectified PANEL crops (6WB layout, R units of the nearer dial)."""
import sys, os, json, numpy as np, cv2
W = "/Users/solefir/projects/f30-cluster/bake/work/rect/"
REFS = json.load(open("/Users/solefir/projects/f30-cluster/bake/manifest/refs.json"))["images"]
R = 335.0
def load(stem):
    rgb = cv2.imread(W + stem + ".sport.PANEL.png")[..., ::-1].astype(float)
    bits = cv2.imread(W + stem + ".sport.PANEL.maskbits.png", 0)
    dc = REFS[stem + ".png"]["sections"]["sport"]["window_transform"]["dial_centres_in_panel"]
    return rgb, bits, dc
out = {}
for stem in sys.argv[1:]:
    rgb, bits, dc = load(stem)
    (lx, ly), (rx, ry) = dc
    lum = rgb.min(axis=2)          # "white" part of the wing (red glow has low G/B)
    red = rgb[..., 0] - rgb[..., 1]
    res = {"dial_centres": dc}
    for side, (cx, cy), sgn in (("L", (lx, ly), 1), ("R", (rx, ry), -1)):
        for part, (v0, v1) in (("upper", (-0.95, -0.35)), ("lower", (0.35, 0.95))):
            pts = []
            for u in np.arange(0.80, 1.60, 0.01):
                x = int(round(cx + sgn * u * R))
                ys = np.arange(int(cy + v0 * R), int(cy + v1 * R))
                col = lum[ys, x]
                ok = (bits[ys, x] & 7) == 0
                if not ok.any(): continue
                col = np.where(ok, col, 0)
                i = int(np.argmax(col)); pk = col[i]
                # FWHM above local background
                bg = np.percentile(col, 20)
                half = bg + (pk - bg) / 2
                j0 = i; j1 = i
                while j0 > 0 and col[j0] > half: j0 -= 1
                while j1 < len(col) - 1 and col[j1] > half: j1 += 1
                # sub-pixel centroid of the peak
                lo, hi = max(0, i - 2), min(len(col), i + 3)
                w = np.clip(col[lo:hi] - bg, 0, None)
                yc = ys[lo:hi].dot(w) / max(w.sum(), 1e-6) + 0.5
                pts.append([round(u, 3), round((yc - cy) / R, 4), round(float(pk), 1), round(float(bg), 1), int(j1 - j0)])
            res[side + "_" + part] = pts
    # bridge: vertical profile of the red excess at several x (fraction t of the way from the left bezel to the right)
    br = {}
    xl, xr = lx + R, rx - R
    for t in (0.05, 0.12, 0.2, 0.3, 0.7, 0.8, 0.88, 0.95):
        x = int(round(xl + t * (xr - xl)))
        prof = []
        for v in np.arange(-0.9, 0.95, 0.05):
            y = int(round(ly + v * R))
            m = (bits[y - 3:y + 4, x - 4:x + 5] & 7) == 0
            vals = red[y - 3:y + 4, x - 4:x + 5][m]
            prof.append([round(v, 2), round(float(np.median(vals)), 1) if len(vals) else None])
        br["t%.2f" % t] = prof
    res["bridge_red_minus_green"] = br
    out[stem] = res
json.dump(out, open("/Users/solefir/projects/f30-cluster/bake/work/C8-sport/measure_mid.json", "w"), indent=0)
for stem, res in out.items():
    print(stem, res["dial_centres"])
    for k in ("L_upper", "L_lower", "R_upper", "R_lower"):
        pts = [p for p in res[k] if p[2] - p[3] > 25]
        print(" ", k, " ".join("%.2f:%.3f/%d/%d" % (p[0], p[1], p[2]-p[3], p[4]) for p in pts[::3]))
    for k, prof in res["bridge_red_minus_green"].items():
        print("  bridge", k, " ".join("%.2f:%s" % (v, int(c) if c is not None else '-') for v, c in prof))
