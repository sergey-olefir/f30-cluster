"""VT: rank free faces against the references' text, per text role, by measured deviation.

For every candidate face and axis setting (weight, and width where the face has a width axis) and every sample of a
role in <meas>/meas.json (tools/twin-dial/vt/glyphs.py), the sample's string is rendered and segmented the same way
as the photo, and the photo's glyph boxes are fitted with

    photo edge = s * candidate edge + t (+/- e)          x0 - e, x1 + e, y0 - e, y1 + e per glyph
    photo stem = s * candidate stem + 2 e

(s the size, t the position, e the bloom of the bright LCD on one edge; least squares, per sample). The deviation is
the rms residual of all box edges in % of the sample's tallest glyph: it carries every glyph's width, height,
position (so the spacing) and the stroke. Squareness is reported apart: the fill of the outer contour of 0 / O / D
over its box (1 = a square, 0.785 = an ellipse), the candidate rendered at the photo's own scale and blurred like the
rectified photo (sigma 1 px) before thresholding at half, as the photo was. score = sqrt(box^2 + (100 * d_fill)^2).

Coverage: whether the face has every character tools/bake_fonts.py bakes for car-supplied text (CAR_TEXT plus Latin).

    python -I tools/twin-dial/vt/fit.py --fonts <dir> [--role label] [--top 12] [--out results.json]
"""
import argparse
import glob
import json
import os
import sys

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
sys.path.insert(0, HERE)
import glyphs as G  # noqa: E402

RS = 160            # render size for the box fit
UA_UPPER = 'АБВГҐДЕЄЖЗИІЇЙКЛМНОПРСТУФХЦЧШЩЬЮЯ'
UA_LOWER = 'абвгґдеєжзиіїйклмнопрстуфхцчшщьюя'
CAR_PUNCT = ",;!?()'\"%&#*=_’‘«»„“”–—№…"
WIDE = 'ЁЪЫЭЎёъыэў' + 'ÄÖÜßäöüÀÂÇÉÈÊËÎÏÔÙÛàâçéèêëîïôùûÁÍÓÚÑáíóúñĄĆĘŁŃŚŹŻąćęłńśźżČĎĚŇŘŠŤŮŽčďěňřšťůž'
CAR_SET = UA_UPPER + UA_LOWER + CAR_PUNCT + WIDE + 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'


def axes_of(f):
    try:
        ax = f.get_variation_axes()
    except Exception:                                                              # noqa: BLE001
        return []
    out = []
    for a in ax:
        n = a['name'].decode() if isinstance(a['name'], bytes) else a['name']
        out.append({'name': n, 'min': a['minimum'], 'max': a['maximum'], 'default': a['default']})
    return out


TAGS = {'Weight': 'wght', 'Width': 'wdth'}


def configs(path):
    f = ImageFont.truetype(path, 20)
    ax = axes_of(f)
    names = [TAGS.get(a['name'], a['name']) for a in ax]
    if 'wght' not in names:
        return [(None, None)] if not ax else [(None, None)]
    wa = ax[names.index('wght')]
    ws = [w for w in range(300, 851, 50) if wa['min'] <= w <= wa['max']]
    ds = [None]
    if 'wdth' in names:
        da = ax[names.index('wdth')]
        ds = sorted(set([d for d in (75, 87.5, 100, 112.5, 125, 137.5, 150) if da['min'] <= d <= da['max']]))
    return [(w, d) for w in ws for d in ds]


_fcache = {}


def font(path, size, w, d):
    f = ImageFont.truetype(path, size)
    if w is not None:
        ax = axes_of(f)
        vals = []
        for a in ax:
            t = TAGS.get(a['name'], a['name'])
            vals.append(w if t == 'wght' else d if (t == 'wdth' and d is not None) else a['default'])
        f.set_variation_by_axes(vals)
    return f


def render_mask(f, text, pad):
    w = int(f.getlength(text)) + 2 * pad
    h = int(f.size * 2.2) + 2 * pad
    img = Image.new('L', (max(w, 8), h), 0)
    ImageDraw.Draw(img).text((pad, pad + f.size * 1.4), text, font=f, fill=255, anchor='ls')
    return np.asarray(img, np.float32) / 255.0


def cand_meas(path, w, d, text):
    f = font(path, RS, w, d)
    a = render_mask(f, text, 20)
    return G.measure_mask(a >= 0.5, text, 1)


NO_BLOOM = False    # --no-bloom: e fixed at 0, the heaviest weight the photo's strokes allow (a bound, not a fit)


def fit_boxes(pairs):
    """pairs: [(photo meas, candidate meas)] of one role, all from the same rectified photo. Joint least squares:
    per sample s, tx, ty; one bloom e shared by the role (the same panel, the same camera, the same threshold rule).
    Glyphs listed in a sample's fit_skip (the references' small raised "%") are segmented but not fitted.
    Returns per sample (rms residual px, s) and e."""
    n = len(pairs)
    rows, rhs, owner = [], [], []
    for k, (ph, ca) in enumerate(pairs):
        skip = ph.get('fit_skip', '')
        for gp, gc in zip(ph['glyphs'], ca['glyphs']):
            if gp['ch'] in skip:
                continue
            for pv, cv, ax, sg in zip(gp['box'], gc['box'], (1, 1, 2, 2), (-1, 1, -1, 1)):
                r = [0.0] * (3 * n + 1)
                r[3 * k], r[3 * k + ax], r[-1] = cv, 1.0, sg
                rows.append(r)
                rhs.append(pv)
                owner.append(k)
        if ph.get('stem') and ca.get('stem') and not skip:
            r = [0.0] * (3 * n + 1)
            r[3 * k], r[-1] = ca['stem'], 2.0
            rows.append(r)
            rhs.append(ph['stem'])
            owner.append(k)
    A, b = np.array(rows, float), np.array(rhs, float)
    sol, *_ = np.linalg.lstsq(A, b, rcond=None)
    if sol[-1] < 0 or NO_BLOOM:
        # a bright LCD photographed only grows its ink (docs/strip/T-REPORT.md: +0.2 to +0.6 px per edge), so e >= 0;
        # the problem is convex in e, so the bounded optimum with e < 0 unconstrained is e = 0
        s0, *_ = np.linalg.lstsq(A[:, :-1], b, rcond=None)
        sol = np.r_[s0, 0.0]
    res = A @ sol - b
    owner = np.array(owner)
    out = [(float(np.sqrt(np.mean(res[owner == k] ** 2))), float(sol[3 * k])) for k in range(n)]
    return out, float(sol[-1])


def fill_at(path, w, d, ch, px_h, ref_ch_h_at_rs):
    """the candidate's fill for one glyph, rendered at the photo's scale (px_h tall), blurred, upsampled, thresholded."""
    size = max(6, int(round(RS * px_h / ref_ch_h_at_rs)))
    f = font(path, size, w, d)
    a = render_mask(f, ch, 8)
    a = cv2.GaussianBlur(a, (0, 0), 1.0)
    a = cv2.resize(a, None, fx=G.UP, fy=G.UP, interpolation=cv2.INTER_CUBIC)
    m = a > 0.5 * a.max()
    return G.fill_ratio(m)


def coverage(path):
    try:
        from fontTools.ttLib import TTFont
    except ImportError:
        return None
    cmap = TTFont(path, lazy=True).getBestCmap()
    miss = [c for c in CAR_SET if ord(c) not in cmap]
    return miss


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--meas', default=os.path.join(ROOT, 'bake', 'work', 'twin-dial', 'vt', 'meas.json'))
    ap.add_argument('--fonts', action='append', default=[])
    ap.add_argument('--role', action='append', default=[])
    ap.add_argument('--top', type=int, default=15)
    ap.add_argument('--out', default=None)
    ap.add_argument('--only', action='append', default=[], help='font file name substrings to keep')
    ap.add_argument('--no-bloom', action='store_true')
    a = ap.parse_args()
    M = json.load(open(a.meas))['samples']
    roles = a.role or sorted(set(v['role'] for v in M.values()))
    files = sorted(glob.glob(os.path.join(ROOT, 'tools', 'fonts-src', '*.ttf')))
    for d in a.fonts:
        files += sorted(p for p in glob.glob(os.path.join(d, '**', '*.ttf'), recursive=True) if 'Italic' not in p)
    if a.only:
        files = [p for p in files if any(o in os.path.basename(p) for o in a.only)]
    global NO_BLOOM
    NO_BLOOM = a.no_bloom
    results = {}
    covs = {}
    for role in roles:
        samples = {k: v for k, v in M.items() if v['role'] == role and v['glyphs']}
        rows = []
        for path in files:
            fam = os.path.basename(path)
            best = None
            for w, d in configs(path):
                pairs, ok = [], True
                for sid, ph in samples.items():
                    try:
                        ca = cand_meas(path, w, d, ph['text'])
                    except Exception:                                              # noqa: BLE001
                        ok = False
                        break
                    if len(ca['glyphs']) != len(ph['glyphs']):
                        ok = False
                        break
                    pairs.append((ph, ca))
                if not ok or not pairs:
                    continue
                fits, es = [None] * len(pairs), []
                for ref in sorted(set(ph['ref'] for ph, _ in pairs)):          # one bloom per photo
                    idx = [i for i, (ph, _) in enumerate(pairs) if ph['ref'] == ref]
                    fr, e = fit_boxes([pairs[i] for i in idx])
                    for i, f_ in zip(idx, fr):
                        fits[i] = f_
                    es.append(e)
                e = float(np.mean(es))
                errs, scales = [], []
                for (sid, ph), (rms, s) in zip(samples.items(), fits):
                    hmax = max(g['box'][3] - g['box'][2] for g in ph['glyphs'] if g['ch'] not in ph.get('fit_skip', ''))
                    errs.append(100 * rms / hmax)
                    scales.append((sid, s))
                blooms = [e]
                box = float(np.sqrt(np.mean(np.square(errs))))
                if best is None or box < best['box']:
                    best = {'file': fam, 'path': path, 'wght': w, 'wdth': d, 'box': round(box, 2),
                            'per_sample': {sid: round(v, 2) for (sid, _), v in zip(scales, errs)},
                            'size_at_R400': {sid: round(RS * s, 2) for sid, s in scales},
                            'bloom': round(float(np.median(blooms)), 2)}
            if best is None:
                continue
            # squareness on the best setting
            dfs = []
            for sid, ph in samples.items():
                for g in ph['glyphs']:
                    if g.get('fill') is None:
                        continue
                    fh = g['box'][3] - g['box'][2]
                    ca = cand_meas(best['path'], best['wght'], best['wdth'], g['ch'])
                    if not ca['glyphs']:
                        continue
                    ch_h = ca['glyphs'][0]['box'][3] - ca['glyphs'][0]['box'][2]
                    fc = fill_at(best['path'], best['wght'], best['wdth'], g['ch'], fh, ch_h)
                    if fc is not None:
                        dfs.append(fc - g['fill'])
            best['d_fill'] = round(float(np.mean(dfs)), 3) if dfs else None
            best['score'] = round(float(np.hypot(best['box'], 100 * (best['d_fill'] or 0))), 2)
            if path not in covs:
                covs[path] = coverage(path)
            best['missing_car_text'] = None if covs[path] is None else len(covs[path])
            rows.append(best)
        rows.sort(key=lambda r: r['score'])
        results[role] = rows
        print('\n== %s  (%d samples: %s)' % (role, len(samples), ', '.join(samples)))
        print('   %-44s %-5s %-6s %6s %7s %6s %5s %s' % ('face', 'wght', 'wdth', 'box%', 'd_fill', 'score', 'bloom', 'miss'))
        for r in rows[:a.top]:
            print('   %-44s %-5s %-6s %6.2f %7s %6.2f %5.2f %s' % (r['file'][:44], r['wght'], r['wdth'], r['box'],
                  r['d_fill'], r['score'], r['bloom'], r['missing_car_text']))
    if a.out:
        for rs in results.values():
            for r in rs:
                r['path'] = os.path.relpath(r['path'], ROOT)
        json.dump(results, open(a.out, 'w'), indent=1, ensure_ascii=False)


if __name__ == '__main__':
    main()
