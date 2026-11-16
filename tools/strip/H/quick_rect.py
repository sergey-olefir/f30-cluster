"""Package H: a quick, PROVISIONAL registration of a stock photo onto an existing panel rect, for claim checks only.

Package R owns registration; this exists so the claims can be checked before R publishes. Method: SIFT on the
photo (downscaled so its panel scale is ~1.5 photo px per panel px) against a reference rect in panel px
(bake/work/overlay/rect/<id>.png, package B's model, rms ~1 px), Lowe ratio 0.75, RANSAC homography (3 px),
matches restricted to the reference's static content (the dial frames, scales and numerals: everything outside the
map/centre box and the bottom strip, so nothing that changes between photos votes). Writes the 1920x720 warp to
the given output path (git-ignored: bake/work/strip/H/ or the scratchpad) and prints the inlier count and the
inlier residual in panel px. No lens term: expect 1-3 px near the panel's corners.

Usage: ... python -I tools/strip/H/quick_rect.py <photo> <reference rect.png> <out.png> [--strip]
--strip lets the strip's static ink vote too (dial bottom lines, hooks or rail; reference and photo must be in the
same hook / rail state): without it the strip is extrapolated from the dials and was seen to be off by up to ~9 px
in x at the strip's ends (tools/strip/H/local_shift.py).
"""
import sys
import cv2
import numpy as np


def main(photo, ref, out, strip=False):
    P = cv2.imread(photo, cv2.IMREAD_COLOR)
    R = cv2.imread(ref, cv2.IMREAD_COLOR)
    s = 2900.0 / P.shape[1]
    Ps = cv2.resize(P, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
    g1 = cv2.cvtColor(Ps, cv2.COLOR_BGR2GRAY)
    g2 = cv2.cvtColor(R, cv2.COLOR_BGR2GRAY)
    m2 = np.full(g2.shape, 255, np.uint8)
    m2[130:560, 560:1360] = 0           # the centre (map, car picture, messages)
    if strip:
        # the strip's static ink votes (dial bottom lines, hooks or rail); everything in it that changes does not
        for x0, y0, x1, y1 in ((120, 655, 480, 720), (480, 570, 600, 680), (480, 655, 700, 720), (755, 618, 1185, 720),
                               (1195, 650, 1720, 720), (1232, 578, 1300, 636), (1830, 600, 1920, 670)):
            m2[y0:y1, x0:x1] = 0
    else:
        m2[540:720, :] = 0              # the strip itself: it is what we want to look at, not what may vote
    m2[300:460, 380:620] = 0            # the digital speed readout
    m2[300:460, 1200:1650] = 0          # the mode label / gear / black box area
    sift = cv2.SIFT_create(nfeatures=20000)
    k1, d1 = sift.detectAndCompute(g1, None)
    k2, d2 = sift.detectAndCompute(g2, m2)
    mt = cv2.BFMatcher().knnMatch(d1, d2, k=2)
    good = [a for a, b in mt if a.distance < 0.75 * b.distance]
    src = np.float32([k1[m.queryIdx].pt for m in good]) / s
    dst = np.float32([k2[m.trainIdx].pt for m in good])
    H, inl = cv2.findHomography(src, dst, cv2.RANSAC, 3.0, maxIters=20000)
    inl = inl.ravel().astype(bool)
    pr = cv2.perspectiveTransform(src[inl].reshape(-1, 1, 2), H).reshape(-1, 2)
    res = np.linalg.norm(pr - dst[inl], axis=1)
    W = cv2.warpPerspective(P, H, (1920, 720), flags=cv2.INTER_AREA)
    cv2.imwrite(out, W)
    # photo px per panel px, at the strip's middle
    Hi = np.linalg.inv(H)
    a = cv2.perspectiveTransform(np.float32([[[900, 630]], [[1000, 630]]]), Hi).reshape(-1, 2)
    print(dict(matches=len(good), inliers=int(inl.sum()), rms=round(float(np.sqrt((res ** 2).mean())), 2),
               p90=round(float(np.percentile(res, 90)), 2), photo_px_per_panel_px=round(float(np.linalg.norm(a[1] - a[0]) / 100), 3)))


if __name__ == "__main__":
    main(*sys.argv[1:4], strip="--strip" in sys.argv[4:])
