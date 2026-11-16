"""Package T: write a panel box of a photo at n x to a PNG OUTSIDE the repo (bake/work/strip/T/ or a scratch dir),
for looking at. Photo pixels: never into a tracked path.

    uv run ... python -I tools/strip/T/view.py --photo 61 --box 100 590 1700 715 --scale 2 --out <png>
"""
import argparse
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--photo', required=True)
    ap.add_argument('--box', nargs=4, type=float, required=True)
    ap.add_argument('--scale', type=float, default=2)
    ap.add_argument('--out', required=True)
    ap.add_argument('--grid', type=float, default=0)
    ap.add_argument('--prefer', default=None)
    a = ap.parse_args()
    if os.path.abspath(a.out).startswith(C.ROOT + os.sep) and '/bake/work/' not in os.path.abspath(a.out):
        sys.exit('refusing to write photo pixels inside the repo')
    img, label, _ = C.warp(a.photo, a.box, a.scale, prefer=a.prefer)
    img = (np.clip(img, 0, 1) * 255).astype(np.uint8)[:, :, ::-1].copy()
    if a.grid:
        n = a.scale
        for k in range(int((a.box[2] - a.box[0]) // a.grid) + 1):
            x = int(round((k * a.grid + (-a.box[0]) % a.grid) * n))
            cv2.line(img, (x, 0), (x, 6), (0, 255, 0), 1)
        for k in range(int((a.box[3] - a.box[1]) // a.grid) + 1):
            y = int(round((k * a.grid + (-a.box[1]) % a.grid) * n))
            cv2.line(img, (0, y), (6, y), (0, 255, 0), 1)
    cv2.imwrite(a.out, img)
    print(a.out, img.shape, label)


if __name__ == '__main__':
    main()
