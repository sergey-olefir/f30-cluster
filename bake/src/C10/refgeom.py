"""Dial circles of a 6WB reference inside its P0 PANEL crop (panel px): photo ellipse centre / ridge radius from
refs.json mapped by the PANEL crop's window transform. R = ridge / 0.99 (P0: the ridge lands at 0.99 R)."""
import json, os
import numpy as np
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))
REFS = json.load(open(os.path.join(ROOT, "bake/manifest/refs.json")))


def dials_in_panel(stem, mode):
    img = REFS["images"][stem + ".png"]
    sec = img["sections"][mode]
    pj = json.load(open(os.path.join(ROOT, "bake/work/rect", f"{stem}.{mode}.PANEL.json")))
    A = np.array(pj["A_photo_to_panel"])
    s = float(np.sqrt(abs(np.linalg.det(A[:, :2]))))
    out = {}
    for cl, d in sec["dials"].items():
        if "photo_centre" not in d:
            continue
        c = A @ np.array([d["photo_centre"][0], d["photo_centre"][1], 1.0])
        ridge = float(np.mean(d["photo_ridge_axes"])) * s
        out[cl] = (float(c[0]), float(c[1]), ridge / d.get("ridge_radius_in_R", 0.99))
    return out


def outside_mask(stem, mode, big=1.04, mini=1.10, window=True, shape=(720, 1920)):
    """True where a pixel is panel background: outside the dials, minis and the centre window."""
    D = dials_in_panel(stem, mode)
    yy, xx = np.mgrid[0:shape[0], 0:shape[1]]
    m = np.ones(shape, bool)
    for cl, (cx, cy, R) in D.items():
        k = big if cl in ("C1", "C2") else mini
        m &= np.hypot(xx - cx, yy - cy) > k * R
    if window and "C1" in D and "C2" in D:
        x0 = D["C1"][0] + 0.80 * D["C1"][2]; x1 = D["C2"][0] - 0.80 * D["C2"][2]
        y0 = D["C1"][1] - 1.0 * D["C1"][2] + 20
        m &= ~((xx > x0) & (xx < x1) & (yy > y0))
    return m, D
