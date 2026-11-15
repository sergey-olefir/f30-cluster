"""Package design/f30-font: scale-free shape ratios for the F30 6WB's glyphs and for each candidate.

The fit in tools/f30font/fontfit.py is a least squares and therefore a black box. This prints the
same evidence as plain numbers anyone can check by eye: a digit's ink width over the figure height,
for every digit, plus x-height/cap, the advance over the figure height and the stroke over the
figure height. Ratios do not depend on how big the text was in the photograph, so the F30 column
and the candidate columns are directly comparable.

Also prints each variable face's axis ranges, and whether the file covers Cyrillic (U+0410), which
decides whether a face could ever carry a street name or a check-control message.

    UV_CACHE_DIR=bake/work/.uvcache uv run -q --no-project --with pillow --with numpy \
        python -I tools/f30font/fingerprint.py --fonts <dir> --axes
"""
import argparse
import json
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
import sys                                                            # noqa: E402
sys.path.insert(0, HERE)
from fontfit import DEFAULT_CANDIDATES, EM, load, ink_box, stem_of    # noqa: E402

DIGITS = '0123456789'


def has_cyrillic(path):
    try:
        from fontTools.ttLib import TTFont                            # noqa: PLC0415
        f = TTFont(path, lazy=True)
        for t in f['cmap'].tables:
            if 0x0410 in t.cmap:
                return True
        return False
    except Exception:                                                 # noqa: BLE001
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--fonts', action='append', default=[])
    ap.add_argument('--measured', default=os.path.join(ROOT, 'design', 'f30-font', 'measured.json'))
    ap.add_argument('--settings', default=None,
                    help='comma list face:wght:wdth to print instead of each face\'s default')
    ap.add_argument('--axes', action='store_true', help='print the variable axes and Cyrillic cover')
    a = ap.parse_args()

    dirs = [os.path.join(ROOT, 'tools', 'fonts-src')] + a.fonts

    def find(fn):
        for d in dirs:
            p = os.path.join(d, fn)
            if os.path.exists(p):
                return p
        return None

    if a.axes:
        print('%-18s %-34s %-9s %s' % ('face', 'axes (min..default..max)', 'cyrillic', 'file'))
        for name, fn, _ax in DEFAULT_CANDIDATES:
            p = find(fn)
            if not p:
                continue
            f = ImageFont.truetype(p, 64)
            try:
                axs = ', '.join('%s %g..%g..%g' % (
                    (x['name'].decode() if isinstance(x['name'], bytes) else x['name'])[:6],
                    x['minimum'], x['default'], x['maximum']) for x in f.get_variation_axes())
            except OSError:
                axs = 'static'
            cy = has_cyrillic(p)
            print('%-18s %-34s %-9s %s' % (name, axs[:34], {True: 'yes', False: 'NO', None: '?'}[cy], fn))
        print()

    meas = json.load(open(a.measured))
    runs = meas['runs']

    # --- the F30 column, straight from the photographs -----------------------------------------
    rev = runs['rev_digits']
    fig = rev['figure_height_px']
    print('F30 6WB rev-scale digits (image 05, figure height %.2f px): ink width / figure height' % fig)
    for c, (w, h) in rev['glyphs'].items():
        print('   %s  w %6.2f  h %6.2f   w/h %.3f   w/fig %.3f' % (c, w, h, w / h, w / fig))
    print('   stem/fig %.3f   (stem %.2f px)' % (rev['stem_px'] / fig, rev['stem_px']))
    cap = runs['cap_1min']
    print('   caption run: x-height/figure %.3f, advance/figure %.3f'
          % (cap['x_height_px'] / cap['figure_height_px'], cap['advance_px'] / cap['figure_height_px']))
    sp = runs['speed_digits']
    print('   speed run:   advance/figure %.3f' % (sp['advance_px'] / sp['figure_height_px']))
    print()

    # --- the candidates ------------------------------------------------------------------------
    sets = []
    if a.settings:
        for item in a.settings.split(','):
            parts = item.split(':')
            sets.append((parts[0], float(parts[1]) if len(parts) > 1 and parts[1] else None,
                         float(parts[2]) if len(parts) > 2 and parts[2] else None))
    else:
        sets = [(n, None, None) for n, _f, _a in DEFAULT_CANDIDATES]

    print('%-20s %-13s %s' % ('face', 'setting', '  '.join('%5s' % d for d in '1234567') +
                              '   x/cap  adv/fig  stem/fig'))
    for label, ww, dd in sets:
        ent = [c for c in DEFAULT_CANDIDATES if c[0] == label]
        if not ent:
            continue
        name, fn, axes = ent[0]
        p = find(fn)
        if not p:
            continue
        ax = None
        if axes:
            ax = dict(axes)
            if ww is not None and 'wght' in ax:
                ax['wght'] = ww
            if dd is not None and 'wdth' in ax:
                ax['wdth'] = dd
        f = load(p, ax, int(EM))
        row = []
        figh = ink_box(f, '0')[1]
        for c in '1234567':
            b = ink_box(f, c)
            row.append(b[0] / figh)
        capb = ink_box(f, 'H')
        xb = ink_box(f, 'x')
        adv = max(f.getlength(c) for c in DIGITS)
        st = stem_of(f, '1')
        print('%-20s %-13s %s   %.3f   %.3f    %.3f'
              % (name, '%s/%s' % (ww or '-', dd or '-'),
                 '  '.join('%5.3f' % v for v in row),
                 xb[1] / capb[1], adv / figh, st / figh))


if __name__ == '__main__':
    main()
