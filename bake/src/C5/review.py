"""C5 redo: the review sheet. For 02, 04 and 03: the reference middle in panel values (C5.target: light above its
own local floor, numerals at the theme's text white) next to OUR bench middle (a headless screenshot of the running
bench, Comfort), the difference, and the centre luma profiles; QC numbers (qc.py, out_dir bake/work/C5/redo) per part.

    cd bake/src && ./P9/py.sh -m C5.review <bench_screenshot.png> [tag]
Writes bake/work/C5/redo/review_<tag>.png and qc_<tag>.json.
"""
import json, os, sys
import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import qc  # noqa: E402
from C5 import target  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
OUT = os.path.join(ROOT, "bake", "work", "C5", "redo")
REFS = ["02_three-modes_clean-render", "04_comfort_whole-cluster_mph", "03_three-modes_photo_bimmerstop"]
PARTS = {"middle": "box:740:400:440:226", "glow": "box:760:410:400:47", "floor": "box:740:462:440:144",
         "line": "box:760:603:400:12", "bar": "box:700:614:520:30", "sky": "box:780:120:360:260"}
VIEW = (680, 380, 560, 280)            # panel box shown in the sheet
LUMA = np.array([0.2126, 0.7152, 0.0722])


def luma_code(rgb):
    lin = np.where(rgb / 255.0 <= 0.04045, rgb / 255.0 / 12.92, ((rgb / 255.0 + 0.055) / 1.055) ** 2.4)
    y = lin @ LUMA
    return 255.0 * np.where(y <= 0.0031308, y * 12.92, 1.055 * np.clip(y, 0, 1) ** (1 / 2.4) - 0.055)


def profile_plot(ref_img, our_img, valid, w=280, h=280):
    """centre (|X| < 30) luma profile over VIEW's rows: reference (orange) vs ours (cyan), y down like the image."""
    pl = np.zeros((h, w, 3), np.uint8)
    for v in (50, 100, 150, 200):
        x = int(v / 255 * (w - 1)); cv2.line(pl, (x, 0), (x, h), (40, 40, 40), 1)
    cols = slice(960 - 30 - VIEW[0], 960 + 30 - VIEW[0])
    pts = {}
    for name, img, col in (("ref", ref_img, (40, 150, 255)), ("ours", our_img, (255, 220, 60))):
        L = luma_code(img[:, cols].astype(np.float64))
        m = valid[:, cols] if name == "ref" else np.ones(L.shape, bool)
        prof = np.array([np.median(L[i][m[i]]) if m[i].any() else np.nan for i in range(L.shape[0])])
        pts[name] = prof
        p = [(int(v / 255 * (w - 1)), int(i * h / len(prof))) for i, v in enumerate(prof) if np.isfinite(v)]
        for a, b in zip(p[:-1], p[1:]):
            if abs(a[1] - b[1]) <= 2:
                cv2.line(pl, a, b, col, 1)
    cv2.putText(pl, "ref", (w - 70, 14), 0, 0.4, (40, 150, 255), 1)
    cv2.putText(pl, "ours", (w - 40, 14), 0, 0.4, (255, 220, 60), 1)
    return pl


def main(bench, tag="bench"):
    shot = cv2.imread(bench)[..., ::-1].astype(np.float32) / 255.0
    lay = np.concatenate([shot, np.ones(shot.shape[:2] + (1,), np.float32)], -1)
    os.makedirs(OUT, exist_ok=True)
    allq, rows = {}, []
    x0, y0, w, h = VIEW
    for stem in REFS:
        target.build(stem, write=True)
        base = os.path.join(ROOT, "bake", "work", "C5", "ref", stem + ".panel.C5")
        q = {}
        for part, roi in PARTS.items():
            try:
                r = qc.run(base, [(lay, 0, 0, 1.0)], "C5", f"redo-{tag}-{part}", [roi], None, 31, part in ("line",),
                           sheet=part == "middle", out_dir=OUT)
            except ValueError:                       # 02: the car / text masks cover the part (its own floor layout)
                continue
            m = r["metrics"]
            q[part] = {"ssim": r["fit"]["ssim"], "dE2000_mean": r["fit"]["dE2000_mean"], "edge_px_err": r["fit"]["edge_px_err"],
                       "luma_bias": m.get("luma_bias"), "luma_rmse": m.get("luma_rmse")}
        allq[stem] = q
        ref = cv2.imread(base + ".png")[..., ::-1]
        bits = cv2.imread(base + ".maskbits.png", cv2.IMREAD_GRAYSCALE)
        bx, by = 680, 39
        rv = ref[y0 - by:y0 - by + h, x0 - bx:x0 - bx + w]
        vv = (bits[y0 - by:y0 - by + h, x0 - bx:x0 - bx + w] & 31) == 0
        ov = (shot[y0:y0 + h, x0:x0 + w] * 255).round().astype(np.uint8)
        diff = np.clip(128 + (ov.astype(int) - rv.astype(int)) * 2, 0, 255).astype(np.uint8)
        diff[~vv] = 0
        pl = profile_plot(rv, ov, vv)
        row = np.hstack([rv, ov, diff, pl]).astype(np.uint8)
        lab = np.zeros((44, row.shape[1], 3), np.uint8)
        t1 = f"{stem[:2]}: ref (panel values) | ours (bench) | diff x2 (128 = 0) | centre luma profile"
        t2 = "  ".join(f"{p} {v['ssim']:.2f}/{v['dE2000_mean']:.1f}/{v['luma_bias']:+.0f}" for p, v in q.items())
        cv2.putText(lab, t1, (6, 16), 0, 0.45, (230, 230, 230), 1)
        cv2.putText(lab, "ssim/dE/luma bias  " + t2, (6, 36), 0, 0.42, (200, 200, 120), 1)
        rows.append(np.vstack([lab, row]))
    sheet = np.vstack(rows)
    cv2.imwrite(os.path.join(OUT, f"review_{tag}.png"), sheet[..., ::-1])
    json.dump(allq, open(os.path.join(OUT, f"qc_{tag}.json"), "w"), indent=1)
    for s, q in allq.items():
        print(s[:2], json.dumps(q))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else "bench")
