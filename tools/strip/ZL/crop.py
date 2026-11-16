"""Package ZL: warp a panel box out of a photo through ZL's local model (HL.json; '60L' for photo 60).

    UV_CACHE_DIR=bake/work/.uvcache uv run -q --no-project --with opencv-python-headless --with numpy \
        python -I tools/strip/ZL/crop.py --photo 61 --box 487 571 588 672 --scale 8 --out bake/work/strip/zone-L/x.png
Box in continuous panel coords. --out must be under bake/work/ (photo pixels never go into the repo).
"""
import argparse
import os
import sys

import cv2

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import lmodel as LM  # noqa: E402


def load(photo):
    if photo == '60':
        return LM.load('60L')
    return LM.load(photo, os.path.join(LM.ROOT, 'bake', 'work', 'strip', 'zone-L', 'HL.json'))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--photo', required=True)
    ap.add_argument('--box', nargs=4, type=float, required=True)
    ap.add_argument('--scale', type=float, default=8)
    ap.add_argument('--out', required=True)
    a = ap.parse_args()
    if 'bake/work' not in os.path.abspath(a.out):
        sys.exit('crop: --out must be under bake/work/')
    lm, ph, e = load(a.photo)
    cv2.imwrite(a.out, lm.warp(ph, a.box, a.scale))


if __name__ == '__main__':
    main()
