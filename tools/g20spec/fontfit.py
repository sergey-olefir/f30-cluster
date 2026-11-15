"""Package design/g20-spec: fit free candidate faces to the stock G20 text runs measured on the photos.

For each run in design/g20-spec/measured.json ("runs"), and each candidate font and axis setting, the
tool sizes the font so its rendered cap height (or figure height, for digit runs) matches the one
measured on the photo, then measures the same quantities on its own crisp render:

    ink width of the whole run, per-glyph ink boxes, glyph-to-glyph advances, x-height / cap,
    stem weight / cap

and reports the deviation from the photo. Width and advance are what separate the candidates; the
height is matched by construction. With --strip it also writes a comparison image: the photo crop on
top, each candidate under it at the same scale, aligned on the baseline and the first ink edge.

No BMW font is used, downloaded or shipped. Candidates are the repo's own OFL files plus any extra
directory given with --fonts (kept outside the repo).

    UV_CACHE_DIR=bake/work/.uvcache uv run -q --no-project --with pillow --with opencv-python-headless \
        --with numpy python -I tools/g20spec/fontfit.py --root <main> --measured design/g20-spec/measured.json \
        --fonts <dir> --run street34 --strip out.png
"""
import argparse
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))

# candidate, file, axes (None = static), label
DEFAULT_CANDIDATES = [
    ('Roboto', 'Roboto-wdth-wght.subset.ttf', {'wdth': 100, 'wght': 400}),
    ('Roboto 87.5w', 'Roboto-wdth-wght.subset.ttf', {'wdth': 87.5, 'wght': 400}),
    ('Arimo', 'Arimo[wght].ttf', {'wght': 400}),
    ('Inter', 'Inter.ttf', {'wght': 400}),
    ('NotoSans', 'NotoSans.ttf', {'wdth': 100, 'wght': 400}),
    ('OpenSans', 'OpenSans.ttf', {'wdth': 100, 'wght': 400}),
    ('IBMPlexSans', 'IBMPlexSans.ttf', {'wdth': 100, 'wght': 400}),
    ('FiraSans', 'FiraSans-Regular.ttf', None),
    ('PTSans', 'PTSans-Regular.ttf', None),
    ('Rubik', 'Rubik.ttf', {'wght': 400}),
    ('Manrope', 'Manrope.ttf', {'wght': 400}),
    ('Commissioner', 'Commissioner.ttf', {'wght': 400}),
    ('GolosText', 'GolosText.ttf', {'wght': 400}),
    ('Onest', 'Onest.ttf', {'wght': 400}),
    ('Archivo', 'Archivo.ttf', {'wdth': 100, 'wght': 400}),
    ('PublicSans', 'PublicSans.ttf', {'wght': 400}),
    ('Mulish', 'Mulish.ttf', {'wght': 400}),
    ('NotoSansDisplay', 'NotoSansDisplay.ttf', {'wdth': 100, 'wght': 400}),
    ('Jost', 'Jost.ttf', {'wght': 400}),
]
PAD = 60


def load(path, axes, size):
    f = ImageFont.truetype(path, size)
    if axes:
        try:
            names = [a['name'].decode() if isinstance(a['name'], bytes) else a['name']
                     for a in f.get_variation_axes()]
            vals = []
            for n in names:
                k = {'Weight': 'wght', 'Width': 'wdth', 'Optical size': 'opsz', 'Slant': 'slnt'}.get(n, n)
                vals.append(axes.get(k, _axis_default(f, n)))
            f.set_variation_by_axes(vals)
        except OSError:
            pass
    return f


def _axis_default(f, name):
    for a in f.get_variation_axes():
        n = a['name'].decode() if isinstance(a['name'], bytes) else a['name']
        if n == name:
            return a['default']
    return 400


def render(path, axes, size, text):
    f = load(path, axes, size)
    w = int(f.getlength(text)) + 2 * PAD
    img = Image.new('L', (max(w, 10), int(size * 2.6) + 2 * PAD), 0)
    d = ImageDraw.Draw(img)
    base = int(size * 1.6) + PAD
    d.text((PAD, base), text, font=f, fill=255, anchor='ls')
    return np.asarray(img), base


def ink_metrics(a, thr=128):
    m = a >= thr
    xs = np.where(m.any(0))[0]
    ys = np.where(m.any(1))[0]
    if not len(xs):
        return None
    return {'x0': int(xs[0]), 'x1': int(xs[-1] + 1), 'y0': int(ys[0]), 'y1': int(ys[-1] + 1),
            'w': int(xs[-1] + 1 - xs[0]), 'h': int(ys[-1] + 1 - ys[0])}


def glyph_boxes(a, thr=128, gap=1):
    """Ink columns split on empty columns; returns [x0, x1, y0, y1] per group, left to right."""
    m = a >= thr
    col = m.any(0)
    out, run = [], None
    empty = 0
    for i, v in enumerate(col):
        if v:
            if run is None:
                run = i
            empty = 0
        else:
            if run is not None:
                empty += 1
                if empty > gap:
                    out.append((run, i - empty + 1))
                    run = None
    if run is not None:
        out.append((run, len(col)))
    res = []
    for x0, x1 in out:
        ys = np.where(m[:, x0:x1].any(1))[0]
        res.append([x0, x1, int(ys[0]), int(ys[-1] + 1)])
    return res


def height_of(path, axes, size, probe):
    a, base = render(path, axes, size, probe)
    k = ink_metrics(a)
    return (base - k['y0']) if k else 0.0


def size_for(path, axes, target_h, probe):
    lo, hi = 4.0, 400.0
    for _ in range(40):
        mid = (lo + hi) / 2
        h = height_of(path, axes, mid, probe)
        if h < target_h:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def stem_width(a, thr=128):
    m = a >= thr
    runs = []
    for line in m:
        idx = np.where(line)[0]
        if not len(idx):
            continue
        s = p = idx[0]
        for v in idx[1:]:
            if v != p + 1:
                runs.append(p - s + 1)
                s = v
            p = v
        runs.append(p - s + 1)
    return float(np.median(runs)) if runs else 0.0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--root', default=os.path.abspath(os.path.join(HERE, '..', '..')))
    ap.add_argument('--measured', default=None)
    ap.add_argument('--fonts', action='append', default=[])
    ap.add_argument('--run', action='append', default=[])
    ap.add_argument('--weights', default='300,350,400,450,500,550,600,700,750,800')
    ap.add_argument('--widths', default='100')
    ap.add_argument('--top', type=int, default=8)
    ap.add_argument('--strip', default=None)
    ap.add_argument('--crops', default=None, help='directory with <run>.png photo crops for the strip')
    a = ap.parse_args()

    meas = json.load(open(a.measured or os.path.join(a.root, 'design', 'g20-spec', 'measured.json')))
    dirs = [os.path.join(a.root, 'tools', 'fonts-src')] + a.fonts

    def find(fn):
        for d in dirs:
            p = os.path.join(d, fn)
            if os.path.exists(p):
                return p
        return None

    wghts = [float(v) for v in a.weights.split(',')]
    wdths = [float(v) for v in a.widths.split(',')]
    for rid, run in meas['runs'].items():
        if a.run and rid not in a.run:
            continue
        probe = run.get('height_probe', 'H')
        target_h = run['height_px']
        print('\n== run %-10s  "%s"   %s = %.2f px, ink width %.2f px (%s)'
              % (rid, run['text'], run.get('height_kind', 'cap'), target_h, run['ink_width_px'], run['source']))
        if run.get('advance_px'):
            print('   photo advance %.2f px' % run['advance_px'])
        rows = []
        for name, fn, axes in DEFAULT_CANDIDATES:
            path = find(fn)
            if path is None:
                continue
            base_axes = dict(axes) if axes else None
            combos = [(None, None)] if not base_axes else [(w, d) for w in wghts for d in wdths]
            best = None
            for w, d in combos:
                ax = None
                if base_axes:
                    ax = dict(base_axes)
                    if 'wght' in ax:
                        ax['wght'] = w
                    if 'wdth' in ax and d is not None:
                        ax['wdth'] = d
                try:
                    size = size_for(path, ax, target_h, probe)
                    img, basey = render(path, ax, size, run['text'])
                except Exception:                                              # noqa: BLE001
                    continue
                k = ink_metrics(img)
                if not k:
                    continue
                gb = glyph_boxes(img)
                adv = None
                if len(gb) >= 2:
                    ds = [gb[i + 1][0] - gb[i][0] for i in range(len(gb) - 1)]
                    adv = float(np.median(ds))
                stem = stem_width(img)
                wdev = abs(k['w'] - run['ink_width_px']) / run['ink_width_px']
                # the weight is chosen on the stroke, so the width stays an independent check
                sel = abs(stem - run['stem_px']) / run['stem_px'] if run.get('stem_px') else wdev
                rec = {'font': name, 'wght': w, 'wdth': d, 'size': round(size, 2), 'w': k['w'],
                       'dev_pct': round(100 * (k['w'] - run['ink_width_px']) / run['ink_width_px'], 1),
                       'stem': round(stem, 2), 'adv': round(adv, 2) if adv else None,
                       'glyphs': len(gb)}
                if run.get('stem_px'):
                    rec['stem_dev_pct'] = round(100 * (stem - run['stem_px']) / run['stem_px'], 1)
                if run.get('advance_px') and adv:
                    rec['adv_dev_pct'] = round(100 * (adv - run['advance_px']) / run['advance_px'], 1)
                if best is None or sel < best[0]:
                    best = (sel, rec, img, basey, k)
            if best:
                rows.append(best)
        rows.sort(key=lambda r: abs(r[1]['dev_pct']))
        for _, rec, _img, _b, _k in rows[:a.top]:
            print('   %-16s wght %-5s size %6.2f  ink w %5d (%+5.1f%%)  stem %4.1f%s%s'
                  % (rec['font'], rec['wght'], rec['size'], rec['w'], rec['dev_pct'], rec['stem'],
                     ' (%+.0f%%)' % rec['stem_dev_pct'] if 'stem_dev_pct' in rec else '',
                     '  adv %.1f (%+.1f%%)' % (rec['adv'], rec['adv_dev_pct']) if 'adv_dev_pct' in rec else ''))
        if a.strip:
            make_strip(a, rid, run, rows[:a.top])


def make_strip(a, rid, run, rows):
    import cv2
    tiles = []
    crop = os.path.join(a.crops or '', rid + '.png') if a.crops else None
    scale = 4
    if crop and os.path.exists(crop):
        ph = cv2.imread(crop, cv2.IMREAD_GRAYSCALE)
        tiles.append(('photo', ph))
    for _, rec, img, basey, k in rows:
        sub = img[max(0, k['y0'] - 6):k['y1'] + 10, max(0, k['x0'] - 6):k['x1'] + 10]
        sub = cv2.resize(sub, None, fx=scale, fy=scale, interpolation=cv2.INTER_NEAREST)
        tiles.append(('%s %s' % (rec['font'], rec['wght'] or ''), sub))
    w = max(t.shape[1] for _, t in tiles) + 260
    h = sum(t.shape[0] + 14 for _, t in tiles) + 20
    out = np.zeros((h, w), np.uint8)
    y = 10
    for label, t in tiles:
        out[y:y + t.shape[0], 250:250 + t.shape[1]] = t
        cv2.putText(out, label, (8, y + t.shape[0] // 2), cv2.FONT_HERSHEY_SIMPLEX, 0.6, 200, 1, cv2.LINE_AA)
        y += t.shape[0] + 14
    path = a.strip if a.strip.endswith('.png') else os.path.join(a.strip, rid + '.png')
    os.makedirs(os.path.dirname(os.path.abspath(path)) or '.', exist_ok=True)
    cv2.imwrite(path, out)
    print('   strip ->', path)


if __name__ == '__main__':
    main()
