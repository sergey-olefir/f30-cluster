"""Package design/f30-font: fit free candidate faces to the F30 6WB's own glyphs.

The problem the G20 package did not have: every F30 6WB reference is a photograph of a bright LCD,
so each glyph's ink is **dilated** by the camera's blur and the panel's bloom. A plain
"size the font so the heights match, then compare widths" comparison (tools/g20spec/fontfit.py)
charges that dilation to the candidate's width and ranks the faces wrong.

So this tool fits two numbers per candidate instead of one:

    measured_w(i) = s * W(i) + d
    measured_h(i) = s * H(i) + d

over all the digits of a run at once -- s the scale (px per em) and d the bloom dilation, both by
least squares. Bloom adds the same d to a glyph's width and its height, so fitting it explicitly
takes it out of the comparison, and what is left -- the residual -- is pure shape. A face whose "1"
is relatively narrow and whose "4" is relatively wide in the same proportions as the photograph's
fits with a small residual whatever the exposure.

The stroke and the advance are then checked against the same s and d, not fitted:

    predicted stem    = s * stem(font) + d      (a stroke blooms like a glyph)
    predicted advance = s * advance(font)       (an advance is a pen move: bloom does not shift it)

so the weight is chosen on the shape and the stroke stays an independent check, as in the G20
package. Weights (and widths, where the face has the axis) are searched on a grid.

No BMW font file is used, downloaded, committed or shipped. Candidates are the repo's own OFL files
plus any extra directory given with --fonts (kept outside the repo).

    UV_CACHE_DIR=bake/work/.uvcache uv run -q --no-project --with pillow --with numpy \
        python -I tools/f30font/fontfit.py --measured design/f30-font/measured.json \
        --fonts <dir> --run rev_digits
"""
import argparse
import json
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))

# label, file, axes to drive (None = a static face)
DEFAULT_CANDIDATES = [
    ('Arimo', 'Arimo[wght].ttf', {'wght': 400}),
    ('Roboto', 'Roboto-wdth-wght.subset.ttf', {'wght': 400, 'wdth': 100}),
    ('Inter', 'Inter.ttf', {'wght': 400}),
    ('NotoSans', 'NotoSans.ttf', {'wght': 400, 'wdth': 100}),
    ('NotoSansDisplay', 'NotoSansDisplay.ttf', {'wght': 400, 'wdth': 100}),
    ('OpenSans', 'OpenSans.ttf', {'wght': 400, 'wdth': 100}),
    ('IBMPlexSans', 'IBMPlexSans.ttf', {'wght': 400}),
    ('FiraSans', 'FiraSans-Regular.ttf', None),
    ('FiraSansBold', 'FiraSans-Bold.ttf', None),
    ('PTSans', 'PTSans-Regular.ttf', None),
    ('PTSansBold', 'PTSans-Bold.ttf', None),
    ('Rubik', 'Rubik.ttf', {'wght': 400}),
    ('Manrope', 'Manrope.ttf', {'wght': 400}),
    ('Commissioner', 'Commissioner.ttf', {'wght': 400}),
    ('GolosText', 'GolosText.ttf', {'wght': 400}),
    ('Onest', 'Onest.ttf', {'wght': 400}),
    ('Archivo', 'Archivo.ttf', {'wght': 400, 'wdth': 100}),
    ('PublicSans', 'PublicSans.ttf', {'wght': 400}),
    ('Mulish', 'Mulish.ttf', {'wght': 400}),
    ('Jost', 'Jost.ttf', {'wght': 400}),
    ('Barlow', 'Barlow-Medium.ttf', None),
    ('BarlowSemiCond', 'BarlowSemiCondensed-Medium.ttf', None),
]
PAD = 40
EM = 200.0          # render at this em; s then comes out as "photo px per 200 px em"


def axis_names(f):
    try:
        return [a['name'].decode() if isinstance(a['name'], bytes) else a['name']
                for a in f.get_variation_axes()]
    except OSError:
        return []


def load(path, axes, size):
    f = ImageFont.truetype(path, size)
    if axes:
        names = axis_names(f)
        if names:
            vals = []
            for n in names:
                k = {'Weight': 'wght', 'Width': 'wdth', 'Optical size': 'opsz', 'Slant': 'slnt',
                     'Italic': 'ital'}.get(n, n)
                vals.append(axes.get(k, _axis_default(f, n)))
            try:
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


def ink_box(f, ch):
    """Ink width/height of one character at the loaded size, from a real render (not getbbox,
    which rounds)."""
    w = int(f.getlength(ch)) + 2 * PAD
    img = Image.new('L', (max(w, 10), int(EM * 2.4) + 2 * PAD), 0)
    base = int(EM * 1.5) + PAD
    ImageDraw.Draw(img).text((PAD, base), ch, font=f, fill=255, anchor='ls')
    a = np.asarray(img) >= 128
    xs = np.where(a.any(0))[0]
    ys = np.where(a.any(1))[0]
    if not len(xs):
        return None
    return (float(xs[-1] + 1 - xs[0]), float(ys[-1] + 1 - ys[0]),
            float(base - ys[0]), float(xs[0] - PAD))


def counter_of(f, ch='0'):
    """Width and height of the largest enclosed hole in a glyph (the counter of 0/4/6/8/P/R)."""
    import cv2                                                        # noqa: PLC0415
    w = int(f.getlength(ch)) + 2 * PAD
    img = Image.new('L', (max(w, 10), int(EM * 2.4) + 2 * PAD), 0)
    base = int(EM * 1.5) + PAD
    ImageDraw.Draw(img).text((PAD, base), ch, font=f, fill=255, anchor='ls')
    a = (np.asarray(img) >= 128).astype(np.uint8)
    n, _lab, stats, _c = cv2.connectedComponentsWithStats(1 - a, 8)
    best = None
    for i in range(1, n):
        x, y, ww, hh, area = stats[i]
        if x == 0 or y == 0 or x + ww >= a.shape[1] or y + hh >= a.shape[0]:
            continue                       # touches the border: that is the page, not a counter
        if best is None or area > best[2]:
            best = (float(ww), float(hh), area)
    return (best[0], best[1]) if best else None


def stem_of(f, ch='1'):
    """Median horizontal ink run of a character: the stem for '1', 'I', 'l'."""
    w = int(f.getlength(ch)) + 2 * PAD
    img = Image.new('L', (max(w, 10), int(EM * 2.4) + 2 * PAD), 0)
    base = int(EM * 1.5) + PAD
    ImageDraw.Draw(img).text((PAD, base), ch, font=f, fill=255, anchor='ls')
    a = np.asarray(img) >= 128
    runs = []
    for line in a:
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


def fit_scale_dilation(rows, weights):
    """Weighted least squares for the model

        measured = s * model + bloom * d

    where `rows` is a list of (model_value, measured_value, blooms) and `blooms` is 1 for a quantity
    the panel's bloom dilates (a glyph's ink width or height, a stroke) and 0 for one it does not
    (an advance, which is a pen move). The dilation is constrained to d >= 0: a negative bloom is
    unphysical, and leaving it free lets a too-light weight pretend to be a bolder face photographed
    with negative blur, which is exactly the degeneracy this fit exists to remove.

    Returns s, d and the weighted residuals.
    """
    M = np.array([r[0] for r in rows], float)
    Y = np.array([r[1] for r in rows], float)
    B = np.array([r[2] for r in rows], float)
    Wt = np.sqrt(np.array(weights, float))
    A = np.stack([M, B], 1) * Wt[:, None]
    sol, *_ = np.linalg.lstsq(A, Y * Wt, rcond=None)
    s, d = float(sol[0]), float(sol[1])
    if d < 0:                       # re-solve with the bloom pinned at zero
        Ad = (M * Wt)[:, None]
        sol2, *_ = np.linalg.lstsq(Ad, Y * Wt, rcond=None)
        s, d = float(sol2[0]), 0.0
    res = (Y - (s * M + d * B)) * Wt
    return s, d, res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--measured', default=os.path.join(ROOT, 'design', 'f30-font', 'measured.json'))
    ap.add_argument('--fonts', action='append', default=[])
    ap.add_argument('--run', action='append', default=[])
    ap.add_argument('--weights', default='300,350,400,450,500,550,600,650,700,750,800,900')
    ap.add_argument('--widths', default='100')
    ap.add_argument('--top', type=int, default=10)
    ap.add_argument('--json-out', default=None)
    a = ap.parse_args()

    meas = json.load(open(a.measured))
    dirs = [os.path.join(ROOT, 'tools', 'fonts-src')] + a.fonts

    def find(fn):
        for d in dirs:
            p = os.path.join(d, fn)
            if os.path.exists(p):
                return p
        return None

    wghts = [float(v) for v in a.weights.split(',')]
    wdths = [float(v) for v in a.widths.split(',')]
    allout = {}
    for rid, run in meas['runs'].items():
        if a.run and rid not in a.run:
            continue
        glyphs = run['glyphs']                       # {"1": [w, h], ...}
        chars = list(glyphs)
        w = np.array([glyphs[c][0] for c in chars], float)
        h = np.array([glyphs[c][1] for c in chars], float)
        fig = run.get('figure_height_px')
        print('\n== run %-12s %s   (%s, %s)' % (rid, ''.join(chars), run['source'], run['kind']))
        nobs = 2 * len(chars) + (1 if run.get('stem_px') else 0) + (1 if run.get('advance_px') else 0)
        print('   photo: %d glyphs, figure height %s, stem %s, advance %s  -> %d observations, %d dof'
              % (len(chars), fig, run.get('stem_px'), run.get('advance_px'), nobs, nobs - 2))
        if nobs - 2 < 6:
            print('   NOTE: too few degrees of freedom to rank faces on; reported for reference only.')
        rows = []
        for name, fn, axes in DEFAULT_CANDIDATES:
            path = find(fn)
            if path is None:
                continue
            base = dict(axes) if axes else None
            combos = [(None, None)] if not base else [(ww, dd) for ww in wghts for dd in wdths]
            best = None
            for ww, dd in combos:
                ax = None
                if base:
                    ax = dict(base)
                    if 'wght' in ax:
                        ax['wght'] = ww
                    if 'wdth' in ax and dd is not None:
                        ax['wdth'] = dd
                try:
                    f = load(path, ax, int(EM))
                    boxes = [ink_box(f, c) for c in chars]
                except Exception:                                     # noqa: BLE001
                    continue
                if any(b is None for b in boxes):
                    continue
                n = len(chars)
                obs, weights = [], []
                for i, b in enumerate(boxes):
                    obs.append((b[0], w[i], 1.0))        # ink width  (bloomed)
                    weights.append(1.0)
                    obs.append((b[1], h[i], 1.0))        # ink height (bloomed)
                    weights.append(1.0)
                # the stroke and the advance are observations too, not afterthoughts: the stroke is
                # what separates the weights and the advance is the one bloom-free length there is
                st = adv = None
                if run.get('stem_px'):
                    st = stem_of(f, run.get('stem_char', '1'))
                    obs.append((st, run['stem_px'], 1.0))
                    weights.append(max(2.0, n / 2.0))
                if run.get('advance_px'):
                    adv = max(f.getlength(c) for c in '0123456789')
                    obs.append((adv, run['advance_px'], 0.0))
                    weights.append(max(2.0, n / 2.0))
                # a counter shrinks by the bloom that grows the ink: coefficient -1, which is what
                # actually determines d and therefore the weight
                cerr = []
                for cc, (cw, ch) in (run.get('counters') or {}).items():
                    cb = counter_of(f, cc)
                    if cb is None:
                        continue
                    obs.append((cb[0], cw, -1.0))
                    weights.append(max(2.0, n / 2.0))
                    obs.append((cb[1], ch, -1.0))
                    weights.append(max(2.0, n / 2.0))
                    cerr.append((cc, cb))
                s, d, res = fit_scale_dilation(obs, weights)
                if s <= 0:
                    continue
                rms = float(np.sqrt((res ** 2).mean()))
                rec = {'font': name, 'wght': ww, 'wdth': dd, 's': s, 'd': d, 'n_obs': len(obs),
                       'rms_px': rms, 'rms_pct_of_figure': 100 * rms / fig if fig else None}
                if st is not None:
                    rec['stem_pred'] = s * st + d
                    rec['stem_dev_pct'] = 100 * (rec['stem_pred'] - run['stem_px']) / run['stem_px']
                if adv is not None:
                    rec['adv_pred'] = s * adv
                    rec['adv_dev_pct'] = 100 * (rec['adv_pred'] - run['advance_px']) / run['advance_px']
                if best is None or rms < best[0]:
                    best = (rms, rec)
            if best:
                rows.append(best[1])
        rows.sort(key=lambda r: r['rms_px'])
        print('   %-17s %-6s %-6s %7s %6s %7s %8s %9s' %
              ('face', 'wght', 'wdth', 'scale', 'bloom', 'rms px', 'rms %fig', 'stem dev'))
        for r in rows[:a.top]:
            print('   %-17s %-6s %-6s %7.3f %6.2f %7.3f %8s %9s%s' %
                  (r['font'], r['wght'] or '-', r['wdth'] or '-', r['s'], r['d'], r['rms_px'],
                   ('%.2f%%' % r['rms_pct_of_figure']) if r['rms_pct_of_figure'] else '-',
                   ('%+.1f%%' % r['stem_dev_pct']) if 'stem_dev_pct' in r else '-',
                   ('   adv %+.1f%%' % r['adv_dev_pct']) if 'adv_dev_pct' in r else ''))
        allout[rid] = rows
    if a.json_out:
        os.makedirs(os.path.dirname(os.path.abspath(a.json_out)) or '.', exist_ok=True)
        json.dump(allout, open(a.json_out, 'w'), indent=1)
        print('\n-> ' + a.json_out)


if __name__ == '__main__':
    main()
