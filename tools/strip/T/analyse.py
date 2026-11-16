"""Package T: from the glyph tables (bake/work/strip/T/meas/*.json, tools/strip/T/batch.py) to per-field typography,
corrected for each photo's ink dilation.

THE DILATION. Every photo of 2026-11-16 holds BMW's white text at or over the camera's highlight shoulder (the stroke
profile is flat-topped, plateau 0.92 linear), so its half-max edges sit OUTSIDE the true ones by b px per edge, the
same b for every edge of text of one brightness in one photo. Calibrated on photo 60, where our own text of known
geometry is photographed in the same exposure: the grid's yellow labels (red channel, saturated like BMW's white;
tools/strip/T/calib60.py) give b60. For any other photo p, b_p = b60 + (h_p - h_60) / 2, with h the median height of
the row's digits (range + clock: the same face, size and brightness in every photo). Then
    true height / width / stem = measured - 2 b_p;   true top = top + b_p;   true bottom (baseline) = bottom - b_p;
centres and advances need no correction. b_p applies to text as bright as the row's digits; dimmer text (units,
which BMW draws grey) is flagged.

Output: bake/work/strip/T/analysis.json (numbers only; strings are not copied), and a table on stdout.

    python3 -I tools/strip/T/analyse.py --fields <fields.json>     (needs numpy)
"""
import argparse
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import common as C  # noqa: E402

MEAS = os.path.join(C.ROOT, 'bake', 'work', 'strip', 'T', 'meas')
FLAT = set('1247')        # digits whose top is flat (no overshoot) - '4' apex is flat in grotesques
ROUND = set('035689')


def load(photo, field):
    p = os.path.join(MEAS, '%s_%s.json' % (photo, field))
    return json.load(open(p)) if os.path.exists(p) else None


def chars_of(text):
    return [c for c in text if c != ' ']


def paired(m):
    """[(char, glyph)] when the glyph count matches the transcription, else None."""
    cs = chars_of(m['text'])
    gs = m['glyphs']
    if len(cs) != len(gs):
        return None
    return list(zip(cs, gs))


def ref_one(photo):
    """(height, stem) of the clock's leading '1' - the one glyph every photo's clock shares."""
    m = load(photo, 'clock')
    pr = paired(m) if m else None
    if not pr or pr[0][0] != '1':
        return None, None
    g = pr[0][1]
    return g['y1'] - g['y0'], g['stem_h']


HEIGHTS = ('fig_h_flat', 'fig_h_round', 'cap_h', 'x_h', 'asc_h', 'dotted_h', 'capdesc_h', 'xdesc_h')
WIDTHS = ('stem_digits', 'cap_stem', 'x_stem')


def fit(res):
    """Per field and metric: measured = true + 2 k b over the photos. b is the per-photo dilation of the row's digits
    (k = 1 by construction for them); k < 1 for text that is dimmer or thinner and so dilates less. With >= 3 photos
    and a b spread >= 0.4 px both are fitted; otherwise true is given for k = 1 and k = 0.75 (the street's fitted k)."""
    out = {}
    for name, rows in res['fields'].items():
        fo = {}
        for metric in HEIGHTS + WIDTHS:
            axis = 1 if metric in HEIGHTS else 0
            pts = [(r['b'][axis], r[metric] + 2 * r['b'][axis]) for r in rows
                   if metric in r and r[metric] == r[metric]]
            if not pts:
                continue
            b = np.array([p[0] for p in pts])
            raw = np.array([p[1] for p in pts])
            rec = {'n': len(pts), 'raw': [round(float(v), 2) for v in raw], 'b': [round(float(v), 2) for v in b]}
            if len(pts) >= 3 and b.max() - b.min() >= 0.4:
                A = np.stack([np.ones_like(b), 2 * b], 1)
                (t, k), *_ = np.linalg.lstsq(A, raw, rcond=None)
                resid = raw - A @ np.array([t, k])
                rec.update({'true': round(float(t), 2), 'k': round(float(k), 2),
                            'rms': round(float(np.sqrt((resid ** 2).mean())), 2)})
            rec['true_k1'] = round(float(np.median(raw - 2 * b)), 2)
            rec['true_k075'] = round(float(np.median(raw - 1.5 * b)), 2)
            fo[metric] = rec
        for key in ('baseline', 'baseline_flat', 'mid_y', 'ink_cx'):
            v = [r[key] for r in rows if key in r and r[key] == r[key]]
            if v:
                fo[key] = {'median': round(float(np.median(v)), 2), 'min': round(float(min(v)), 2),
                           'max': round(float(max(v)), 2), 'per_photo': {r['photo']: round(r[key], 2) for r in rows if key in r}}
        out[name] = fo
        line = []
        for m, rec in fo.items():
            if 'true' in rec:
                line.append('%s %.2f (k %.2f rms %.2f)' % (m, rec['true'], rec['k'], rec['rms']))
            elif 'true_k1' in rec:
                line.append('%s %.2f..%.2f' % (m, rec['true_k1'], rec['true_k075']))
            elif 'median' in rec:
                line.append('%s %.2f [%.2f..%.2f]' % (m, rec['median'], rec['min'], rec['max']))
        print('FIT %-10s ' % name + '; '.join(line))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--fields', required=True)
    ap.add_argument('--b60', type=float, default=None, help='dilation per edge in photo 60 (default: calib60.json)')
    ap.add_argument('--out', default=os.path.join(C.ROOT, 'bake', 'work', 'strip', 'T', 'analysis.json'))
    a = ap.parse_args()
    fields = json.load(open(a.fields))
    cal = os.path.join(C.ROOT, 'bake', 'work', 'strip', 'T', 'calib60.json')
    cj = json.load(open(cal))['saturated_g1.0'] if os.path.exists(cal) else {'b_h': 0.58, 'b_w': 0.51, 'b_stem': 0.55}
    b60y = a.b60 if a.b60 is not None else cj['b_h']
    b60x = a.b60 if a.b60 is not None else (cj['b_w'] + cj['b_stem']) / 2
    h60, s60 = ref_one('60')
    photos = sorted({p for k, f in fields.items() if not k.startswith('_') for p in f['photos']})
    bp = {}
    for p in photos:
        h, s = ref_one(p)
        bp[p] = None if (h is None or h60 is None) else (b60x + (s - s60) / 2.0, b60y + (h - h60) / 2.0)
    print('b60 x %.2f y %.2f  (clock 1 in 60: h %.2f stem %.2f)' % (b60x, b60y, h60, s60))
    print('per-photo dilation (bx, by) px per edge:', {p: tuple(round(x, 2) for x in v) if v else None for p, v in bp.items()})

    res = {'b60': [b60x, b60y], 'ref60': [h60, s60], 'b_photo': bp, 'fields': {}}
    for name, f in fields.items():
        if name.startswith('_'):
            continue
        rows = []
        for p in f['photos']:
            m = load(p, name)
            if not m:
                continue
            pr = paired(m)
            bx, by = bp.get(p) or (0.0, 0.0)
            if f.get('ink') == 'dark':
                bx, by = 0.0, 0.0    # dark digits on the sign's face: their raw height does not follow b (26.5-27.1 for b 0.96-1.33), so no correction
            if not pr:
                print('  %-10s %s: %d glyphs for %d chars - not paired' % (name, p, len(m['glyphs']), len(chars_of(m['text']))))
                continue
            rec = {'photo': p, 'model': m['model'], 'b': [bx, by], 'glyphs': []}
            for c, g in pr:
                cls = 'digit' if c.isdigit() else c
                rec['glyphs'].append({'cls': ('1' if c == '1' else 'flat' if c in FLAT else 'round' if c in ROUND else cls),
                                      'x0': g['x0'] + bx, 'x1': g['x1'] - bx, 'top': g['y0'] + by, 'bottom': g['y1'] - by,
                                      'h': g['y1'] - g['y0'] - 2 * by, 'w': g['x1'] - g['x0'] - 2 * bx,
                                      'stem': (g['stem_h'] - 2 * bx) if g['stem_h'] else None,
                                      'stem_v': (g['stem_v'] - 2 * by) if g['stem_v'] else None,
                                      'cx': (g['x0'] + g['x1']) / 2, 'cy': (g['y0'] + g['y1']) / 2,
                                      'h_raw': g['y1'] - g['y0'], 'stem_raw': g['stem_h']})
            gl = rec['glyphs']
            digs = [g for g in gl if g['cls'] in ('1', 'flat', 'round')]
            if digs:
                rec['fig_h_flat'] = float(np.median([g['h'] for g in digs if g['cls'] in ('1', 'flat')] or [np.nan]))
                rec['fig_h_round'] = float(np.median([g['h'] for g in digs if g['cls'] == 'round'] or [np.nan]))
                rec['baseline_flat'] = float(np.median([g['bottom'] for g in digs if g['cls'] in ('1', 'flat')] or [np.nan]))
                rec['top_flat'] = float(np.median([g['top'] for g in digs if g['cls'] in ('1', 'flat')] or [np.nan]))
                rec['mid_y'] = float(np.median([g['cy'] for g in digs]))
                rec['stem_1'] = [g['stem'] for g in digs if g['cls'] == '1']
                rec['stem_digits'] = float(np.median([g['stem'] for g in digs if g['stem']]))
                rec['digit_cx'] = [g['cx'] for g in digs]
                if len(digs) > 1:
                    rec['pitch_cx'] = [digs[i + 1]['cx'] - digs[i]['cx'] for i in range(len(digs) - 1)]
            for cls, key in (('C', 'cap'), ('x', 'x'), ('d', 'xdesc'), ('D', 'capdesc'), ('i', 'dotted'), ('o', 'ring'),
                             ('a', 'asc'), ('t', 't')):
                gg = [g for g in gl if g['cls'] == cls]
                if gg:
                    rec[key + '_h'] = float(np.median([g['h'] for g in gg]))
                    rec[key + '_top'] = float(np.median([g['top'] for g in gg]))
                    rec[key + '_bottom'] = float(np.median([g['bottom'] for g in gg]))
                    rec[key + '_stem'] = float(np.median([g['stem'] for g in gg if g['stem']] or [np.nan]))
            xb = [g for g in gl if g['cls'] in ('x', 'C', 'i', 'a', 't') or g['cls'] in ('1', 'flat', 'round')]
            if xb:
                rec['baseline'] = float(np.median([g['bottom'] for g in xb]))
            rec['ink_x'] = [gl[0]['x0'], gl[-1]['x1']]
            rec['ink_cx'] = (gl[0]['x0'] + gl[-1]['x1']) / 2
            rec['n'] = len(gl)
            rows.append(rec)
        res['fields'][name] = rows
        for r in rows:
            keys = [k for k in ('fig_h_flat', 'fig_h_round', 'baseline_flat', 'mid_y', 'stem_digits', 'cap_h', 'x_h',
                                'cap_stem', 'x_stem', 'baseline', 'ink_cx') if k in r]
            print('%-10s %s b %+.2f/%+.2f  ink x %.2f-%.2f  ' % (name, r['photo'], r['b'][0], r['b'][1], r['ink_x'][0], r['ink_x'][1])
                  + '  '.join('%s %.2f' % (k, r[k]) for k in keys))
    res['fit'] = fit(res)
    json.dump(res, open(a.out, 'w'), indent=1)
    print('->', a.out)


if __name__ == '__main__':
    main()
