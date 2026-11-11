"""Parametrised copy of sift_align.py: SIFT + RANSAC homography between two images (CLAHE first).

  python tools/ref/sift_align_p.py SRC DST OUT.json [--src-mask x0,y0,x1,y1] [--dst-mask x0,y0,x1,y1]

Writes {'H': src->dst 3x3, 'inliers', 'good', 'reproj_rms_px'}. Importable: sift_homography(a, b, ...).
"""
import json
import sys
import cv2
import numpy as np


def _mask(shape, box):
    if box is None:
        return None
    m = np.zeros(shape[:2], np.uint8)
    x0, y0, x1, y1 = box
    m[y0:y1, x0:x1] = 255
    return m


def sift_homography(src, dst, src_box=None, dst_box=None, n=8000, ratio=0.78, thr=5.0):
    g1 = cv2.cvtColor(src, cv2.COLOR_BGR2GRAY) if src.ndim == 3 else src
    g2 = cv2.cvtColor(dst, cv2.COLOR_BGR2GRAY) if dst.ndim == 3 else dst
    cl = cv2.createCLAHE(3.0, (8, 8))
    g1, g2 = cl.apply(g1), cl.apply(g2)
    sift = cv2.SIFT_create(n)
    k1, d1 = sift.detectAndCompute(g1, _mask(g1.shape, src_box))
    k2, d2 = sift.detectAndCompute(g2, _mask(g2.shape, dst_box))
    m = cv2.BFMatcher().knnMatch(d1, d2, k=2)
    good = [a for a, b in m if a.distance < ratio * b.distance]
    s = np.float32([k1[a.queryIdx].pt for a in good])
    d = np.float32([k2[a.trainIdx].pt for a in good])
    H, inl = cv2.findHomography(s, d, cv2.RANSAC, thr)
    inl = inl.ravel().astype(bool)
    p = cv2.perspectiveTransform(s[inl][None], H)[0]
    rms = float(np.sqrt(np.mean(np.sum((p - d[inl]) ** 2, axis=1))))
    return H, {'good': len(good), 'inliers': int(inl.sum()), 'reproj_rms_px': rms}


if __name__ == '__main__':
    a = cv2.imread(sys.argv[1])
    b = cv2.imread(sys.argv[2])
    def box(flag):
        if flag in sys.argv:
            return [int(v) for v in sys.argv[sys.argv.index(flag) + 1].split(',')]
    H, info = sift_homography(a, b, box('--src-mask'), box('--dst-mask'))
    info['H'] = H.tolist()
    json.dump(info, open(sys.argv[3], 'w'), indent=1)
    print(info)
