"""Package H: are two reference photos the same exposure?

For each pair (a, b): both photos go to grey, b is resized to a's size (the aspect ratios must match), and an
affine ECC alignment is fitted at a's resolution (on a 1024-px-wide copy, then refined at full size). Reported:
the fitted transform (identity = the same framing), the normalised cross-correlation after alignment over the
whole frame and over the panel's bottom fifth, and the median absolute grey difference. Two copies of one frame
(one a re-encode or a downscale of the other) give NCC > 0.99 and an identity transform; two frames of a burst
from a hand-held phone give a small shift and NCC that drops where the image has fine detail.

Prints numbers only (no pixels leave the machine). Run with the repo's uv convention:
  UV_CACHE_DIR=... uv run -q --no-project --with opencv-python-headless --with numpy python -I \
      tools/strip/H/same_frame.py reference/g20/10_*.jpg reference/g20/60_*.png ...
(arguments are pairs).
"""
import sys
import cv2
import numpy as np


def grey(path):
    im = cv2.imread(path, cv2.IMREAD_GRAYSCALE)
    if im is None:
        raise SystemExit("cannot read " + path)
    return im


def ncc(a, b, m=None):
    a = a.astype(np.float64); b = b.astype(np.float64)
    if m is not None:
        a = a[m]; b = b[m]
    a -= a.mean(); b -= b.mean()
    return float((a * b).sum() / np.sqrt((a * a).sum() * (b * b).sum()))


def compare(pa, pb):
    A, B = grey(pa), grey(pb)
    ha, wa = A.shape; hb, wb = B.shape
    if abs(wa / ha - wb / hb) > 0.01:
        return dict(err="aspect differs %dx%d vs %dx%d" % (wa, ha, wb, hb))
    # work at a's size, or at most 2048 wide
    s = min(1.0, 2048.0 / wa)
    W, H = int(round(wa * s)), int(round(ha * s))
    a = cv2.resize(A, (W, H), interpolation=cv2.INTER_AREA)
    b = cv2.resize(B, (W, H), interpolation=cv2.INTER_AREA)
    raw = ncc(a, b)
    warp = np.eye(2, 3, dtype=np.float32)
    crit = (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 200, 1e-6)
    try:
        # coarse first
        f = 1024.0 / W
        ac = cv2.resize(a, None, fx=f, fy=f, interpolation=cv2.INTER_AREA).astype(np.float32)
        bc = cv2.resize(b, None, fx=f, fy=f, interpolation=cv2.INTER_AREA).astype(np.float32)
        _, wc = cv2.findTransformECC(ac, bc, warp.copy(), cv2.MOTION_AFFINE, crit, None, 5)
        wc[:, 2] /= f
        _, warp = cv2.findTransformECC(a.astype(np.float32), b.astype(np.float32), wc, cv2.MOTION_AFFINE, crit,
                                       None, 3)
    except cv2.error as e:
        return dict(err="ECC failed: %s" % str(e).splitlines()[-1], ncc_raw=raw)
    bw = cv2.warpAffine(b, warp, (W, H), flags=cv2.INTER_LINEAR + cv2.WARP_INVERSE_MAP)
    m = np.zeros_like(a, bool); m[int(H * 0.1):int(H * 0.9), int(W * 0.1):int(W * 0.9)] = True
    lo = np.zeros_like(a, bool); lo[int(H * 0.55):int(H * 0.8), int(W * 0.1):int(W * 0.9)] = True
    d = np.abs(a.astype(int) - bw.astype(int))[m]
    return dict(size_a="%dx%d" % (wa, ha), size_b="%dx%d" % (wb, hb), ncc_raw=round(raw, 4),
                ncc_aligned=round(ncc(a, bw, m), 4), ncc_lower_band=round(ncc(a, bw, lo), 4),
                median_abs_grey=float(np.median(d)), p95_abs_grey=float(np.percentile(d, 95)),
                warp=[[round(float(x), 4) for x in r] for r in warp])


def main():
    args = sys.argv[1:]
    for i in range(0, len(args) - 1, 2):
        r = compare(args[i], args[i + 1])
        name = lambda p: p.rsplit("/", 1)[-1][:2]
        print(name(args[i]), "vs", name(args[i + 1]), r)


if __name__ == "__main__":
    main()
