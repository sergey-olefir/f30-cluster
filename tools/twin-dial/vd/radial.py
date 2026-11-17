"""Radial profile of a dial in dial units: median over angle windows of luminance (Rec.709 on sRGB values, 0..1).

Usage: radial.py KEY [th0 th1 ...pairs]   default windows: 240..300 and 60..120 deg (clear of the top numerals)
Prints rho, median luma, median whiteness, 25th/75th percentile.
"""
import sys, numpy as np
sys.path.insert(0, __import__('os').path.dirname(__file__))
from dialfit import DIALS, load, model_map, ell_to_A
import json, os, cv2

OUT = os.path.join(os.path.dirname(__file__), '..', '..', '..', 'bake', 'work', 'twin-dial', 'vd')


def get_model(key):
    f = json.load(open(os.path.join(OUT, f'fit_{key}.json')))
    return f, np.array(f['c']), np.array(f['A'])


def sample(key, th, rho):
    f, c, A = get_model(key)
    im = load(DIALS[key][0])
    x, y = model_map(c, A, th, rho)
    return cv2.remap(im, x, y, cv2.INTER_LINEAR)  # BGR


def luma(p):
    return 0.0722 * p[..., 0] + 0.7152 * p[..., 1] + 0.2126 * p[..., 2]


if __name__ == '__main__':
    key = sys.argv[1]
    w = [float(v) for v in sys.argv[2:]] or [240, 300, 60, 120]
    th = np.concatenate([np.arange(w[i], w[i + 1], 0.25) for i in range(0, len(w), 2)])
    rho = np.arange(0.30, 1.12, 0.005)
    p = sample(key, th, rho)
    L = luma(p)
    for i, r in enumerate(rho):
        print('%.3f  %.3f  %.3f  %.3f' % (r, np.median(L[i]), np.percentile(L[i], 25), np.percentile(L[i], 75)))
