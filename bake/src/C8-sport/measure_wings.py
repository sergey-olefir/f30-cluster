"""Wing centrelines, widths and peak levels in the rectified PANEL crops, in R units of the nearer dial
(left dial frame: u = (x - cx)/R toward the middle, v = (y - cy)/R, y down; right dial mirrored)."""
import sys, json, numpy as np, cv2
W = "/Users/solefir/projects/f30-cluster/bake/work/rect/"
REFS = json.load(open("/Users/solefir/projects/f30-cluster/bake/manifest/refs.json"))["images"]
R = 335.0
WIN = {"02_three-modes_clean-render": {"upper": (-0.80, -0.45), "lower": (0.15, 0.40)},
       "03_three-modes_photo_bimmerstop": {"upper": (-0.75, -0.35), "lower": (0.35, 0.62)},
       "01_three-modes_small": {"upper": (-0.75, -0.35), "lower": (0.35, 0.62)}}
out = {}
for stem, win in WIN.items():
    rgb = cv2.imread(W + stem + ".sport.PANEL.png")[..., ::-1].astype(float)
    bits = cv2.imread(W + stem + ".sport.PANEL.maskbits.png", 0)
    dc = REFS[stem + ".png"]["sections"]["sport"]["window_transform"]["dial_centres_in_panel"]
    lum = rgb.min(axis=2)
    res = {}
    for side, (cx, cy), sgn in (("L", dc[0], 1), ("R", dc[1], -1)):
        for part, (v0, v1) in win.items():
            pts = []
            for u in np.arange(0.70, 1.40, 0.01):
                xf = cx + sgn * u * R
                x = int(np.floor(xf))
                ys = np.arange(int(cy + v0 * R), int(cy + v1 * R))
                col = lum[ys, x].copy()
                col[(bits[ys, x] & 7) != 0] = 0
                bg = float(np.percentile(col, 10))
                i = int(np.argmax(col)); pk = float(col[i])
                if pk - bg < 20:
                    continue
                half = bg + (pk - bg) / 2
                j0, j1 = i, i
                while j0 > 0 and col[j0 - 1] > half: j0 -= 1
                while j1 < len(col) - 1 and col[j1 + 1] > half: j1 += 1
                lo, hi = max(0, i - 3), min(len(col), i + 4)
                w = np.clip(col[lo:hi] - half, 0, None)
                yc = ys[lo:hi].dot(w) / max(w.sum(), 1e-6) + 0.5
                c = rgb[ys[i], x]
                pts.append({"u": round(float(u), 3), "v": round(float((yc - cy) / R), 4), "peak": round(pk - bg, 1),
                            "bg": round(bg, 1), "fwhm_px": int(j1 - j0 + 1), "rgb_peak": [int(t) for t in c]})
            res[side + "_" + part] = pts
    out[stem] = {"dial_centres": dc, "wings": res}
json.dump(out, open("/Users/solefir/projects/f30-cluster/bake/work/C8-sport/measure_wings.json", "w"), indent=0)
for stem, o in out.items():
    print(stem)
    for k, pts in o["wings"].items():
        print("  %-8s" % k, " ".join("%.2f:%.3f/%d/%d" % (p["u"], p["v"], p["peak"], p["fwhm_px"]) for p in pts[::2]))
