"""Own panel->photo homography for photo 08 (P0's SIFT 10->08 chain is degenerate: its PANEL crop is a smear).

Template: photo 09 rectified by P0 (good: SIFT 63 inliers, 1.08 px, checked) = stock theme in panel px.
SIFT template(panel px) -> photo 08, dst mask on the cluster screen. Output H panel->photo 08 and the rect crop.
    cd bake/src && $PY -m C9.align08
"""
import json, os, sys
import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "tools", "ref"))
from sift_align_p import sift_homography  # noqa: E402

WORK = os.path.join(ROOT, "bake", "work", "C9")


def run():
    os.makedirs(WORK, exist_ok=True)
    tpl = cv2.imread(os.path.join(ROOT, "bake/work/rect/09_stock_map_day.g20.PANEL.png"))
    ph = cv2.imread(os.path.join(ROOT, "reference/g20/08_stock_night_warnings-map.jpg"))
    # keep the template to the stock static parts (dial outlines, numerals); drop the map window (content differs)
    src_box = None
    m = np.zeros(tpl.shape[:2], np.uint8)
    m[:, :] = 255
    m[60:600, 600:1300] = 0          # map differs between 08 and 09
    g1 = cv2.cvtColor(tpl, cv2.COLOR_BGR2GRAY)
    g2 = cv2.cvtColor(ph, cv2.COLOR_BGR2GRAY)
    cl = cv2.createCLAHE(3.0, (8, 8))
    g1c, g2c = cl.apply(g1), cl.apply(g2)
    sift = cv2.SIFT_create(12000)
    k1, d1 = sift.detectAndCompute(g1c, m)
    m2 = np.zeros(g2.shape, np.uint8)
    m2[520:1220, 180:1900] = 255     # the cluster screen in photo 08 (by eye on a 1/2 preview)
    k2, d2 = sift.detectAndCompute(g2c, m2)
    mt = cv2.BFMatcher().knnMatch(d1, d2, k=2)
    good = [a for a, b in mt if a.distance < 0.8 * b.distance]
    s = np.float32([k1[a.queryIdx].pt for a in good])
    d = np.float32([k2[a.trainIdx].pt for a in good])
    H, inl = cv2.findHomography(s, d, cv2.RANSAC, 4.0)
    inl = inl.ravel().astype(bool)
    p = cv2.perspectiveTransform(s[inl][None], H)[0]
    rms = float(np.sqrt(np.mean(np.sum((p - d[inl]) ** 2, axis=1))))
    # scale of the photo: photo px per panel px
    J = np.linalg.norm(cv2.perspectiveTransform(np.float32([[[960, 360], [1960, 360]]]), H)[0][1]
                       - cv2.perspectiveTransform(np.float32([[[960, 360]]]), H)[0][0]) / 1000.0
    info = {"good": len(good), "inliers": int(inl.sum()), "reproj_rms_photo_px": round(rms, 3),
            "photo_px_per_panel_px": round(float(J), 4), "reproj_rms_panel_px": round(rms / float(J), 3),
            "H_panel_to_photo": H.tolist(),
            "method": "SIFT (CLAHE) from P0's 09 PANEL rect (stock theme, panel px, map window masked) to photo 08, RANSAC 4 px"}
    warp = cv2.warpPerspective(ph, H, (1920, 720), flags=cv2.INTER_CUBIC | cv2.WARP_INVERSE_MAP)
    cv2.imwrite(os.path.join(WORK, "08_rect_panel.png"), warp)
    json.dump(info, open(os.path.join(WORK, "08_H.json"), "w"), indent=1)
    print({k: v for k, v in info.items() if k != "H_panel_to_photo"})
    return H, warp


if __name__ == "__main__":
    run()
