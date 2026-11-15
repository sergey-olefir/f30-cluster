"""Package design/f30-font: cut a zoomed crop out of an F30 6WB reference image, to look at.

Writes to bake/work/f30font/ (git-ignored, because reference pixels are). Optionally draws a pixel
grid every --grid image px so a glyph's proportions can be read straight off the picture.

    UV_CACHE_DIR=bake/work/.uvcache uv run -q --no-project --with opencv-python-headless --with numpy \
        python -I tools/f30font/crop.py --img reference/6wb/05_comfort_tach-closeup.png \
        --box 230 490 330 540 --scale 8 --out bake/work/f30font/ready.png
"""
import argparse
import os

import cv2
import numpy as np


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--img', required=True)
    ap.add_argument('--box', nargs=4, type=float, required=True)
    ap.add_argument('--scale', type=int, default=8)
    ap.add_argument('--grid', type=float, default=0, help='draw a line every N image px')
    ap.add_argument('--boost', type=float, default=1.0, help='multiply brightness (dim references)')
    ap.add_argument('--out', required=True)
    a = ap.parse_args()

    img = cv2.imread(a.img, cv2.IMREAD_COLOR)
    if img is None:
        raise SystemExit('cannot read ' + a.img)
    x0, y0, x1, y1 = [int(round(v)) for v in a.box]
    sub = img[max(0, y0):y1, max(0, x0):x1]
    if sub.size == 0:
        raise SystemExit('empty crop')
    n = a.scale
    big = cv2.resize(sub, (sub.shape[1] * n, sub.shape[0] * n), interpolation=cv2.INTER_LANCZOS4)
    if a.boost != 1.0:
        big = np.clip(big.astype(np.float32) * a.boost, 0, 255).astype(np.uint8)
    if a.grid:
        step = int(round(a.grid * n))
        for gx in range(0, big.shape[1], step):
            big[:, gx] = (big[:, gx] * 0.5 + np.array([0, 128, 0]) * 0.5).astype(np.uint8)
        for gy in range(0, big.shape[0], step):
            big[gy, :] = (big[gy, :] * 0.5 + np.array([0, 128, 0]) * 0.5).astype(np.uint8)
    os.makedirs(os.path.dirname(os.path.abspath(a.out)) or '.', exist_ok=True)
    cv2.imwrite(a.out, big)
    print('%s  %dx%d image px -> %dx%d  (%s)' % (a.out, sub.shape[1], sub.shape[0], big.shape[1], big.shape[0], a.img))


if __name__ == '__main__':
    main()
