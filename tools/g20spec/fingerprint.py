"""Package design/g20-spec: shape fingerprints of the candidate faces, against the photo's.

The ratios below do not depend on the size a run is set at, so they compare a candidate with the
stock face directly:

    x/cap          x-height over cap height (Cyrillic 'о' over 'П', Latin 'x' over 'H')
    stem/cap       median horizontal ink run of 'П' over its cap height
    fig/cap        figure height ('0') over cap height
    adv/fig        digit advance over figure height (tabular check: the advance of '1' against '0')
    one_narrow     advance of '1' minus advance of '0', in units of the figure height

Measured on the photos (see design/g20-spec/measured.json):
    street label   x/cap 0.735-0.745, stem/cap 0.105-0.118
    bottom values  stem/fig 0.166, adv/fig 0.760, the '1' about 2 px (0.06 fig) narrower than '0'
    message        x/cap 0.769, stem/cap 0.198

    UV_CACHE_DIR=bake/work/.uvcache uv run -q --no-project --with pillow --with numpy \
        python -I tools/g20spec/fingerprint.py --fonts <dir>
"""
import argparse
import os
import sys

import numpy as np
from PIL import ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import fontfit as F  # noqa: E402

SIZE = 200.0


def h_of(path, ax, ch):
    img, base = F.render(path, ax, SIZE, ch)
    k = F.ink_metrics(img)
    return (base - k['y0']) if k else 0.0


def adv_of(path, ax, ch):
    f = F.load(path, ax, int(SIZE))
    return float(f.getlength(ch))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--root', default=os.path.abspath(os.path.join(HERE, '..', '..')))
    ap.add_argument('--fonts', action='append', default=[])
    ap.add_argument('--weights', default='300,400,500,600,700')
    a = ap.parse_args()
    dirs = [os.path.join(a.root, 'tools', 'fonts-src')] + a.fonts
    print('%-18s %-5s  %-6s %-7s %-7s %-7s %-7s' % ('font', 'wght', 'x/cap', 'stem/cap', 'fig/cap', 'adv/fig', "1 vs 0"))
    for name, fn, axes in F.DEFAULT_CANDIDATES:
        path = None
        for d in dirs:
            if os.path.exists(os.path.join(d, fn)):
                path = os.path.join(d, fn)
                break
        if path is None:
            continue
        for w in ([None] if not axes else [float(v) for v in a.weights.split(',')]):
            ax = None
            if axes:
                ax = dict(axes)
                if 'wght' in ax:
                    ax['wght'] = w
            try:
                cap = h_of(path, ax, 'П')
                if cap <= 0:
                    cap = h_of(path, ax, 'H')
                    xh = h_of(path, ax, 'x')
                else:
                    xh = h_of(path, ax, 'о')
                fig = h_of(path, ax, '0')
                img, _ = F.render(path, ax, SIZE, 'П' if cap else 'H')
                stem = F.stem_width(img)
                a0, a1 = adv_of(path, ax, '0'), adv_of(path, ax, '1')
            except Exception:                                                   # noqa: BLE001
                continue
            if not cap or not fig:
                continue
            print('%-18s %-5s  %-6.3f %-8.3f %-7.3f %-7.3f %+.3f'
                  % (name, w if w else '-', xh / cap, stem / cap, fig / cap, a0 / fig, (a1 - a0) / fig))


if __name__ == '__main__':
    main()
