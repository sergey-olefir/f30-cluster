"""Package T: fit OUR face (Roboto variable, tools/fonts-src, SIL OFL) to each BMW text kind of the strip, as it
would be baked (tools/bake_fonts.py: Pillow, hinted, tabular digits at the widest digit's advance, integer advances)
and laid out (shared/hud_text.js: no kerning, glyphs snapped to whole pixels).

For each kind, every (wdth, wght, size) of a grid is rendered and laid out on the very strings the photos show
(--strings: a git-ignored file, the strings are never copied anywhere else) and compared with the measured,
dilation-corrected glyph ink boxes (bake/work/strip/T/analysis.json, tools/strip/T/analyse.py):
    e_h    the hinted cap / figure height minus BMW's
    e_x    x-height minus BMW's (letters)
    e_s    stem minus BMW's (weak: BMW's stems carry +-0.4 px)
    e_g    rms of every glyph's ink left and right edge after the best common x shift (advances + widths + shapes)
    e_w    rms of the whole string's ink width
Score = |e_h| + |e_x| + 0.5 |e_s| + e_g. Prints the best per kind and writes bake/work/strip/T/fit.json.

No BMW font is used: the only face here is Roboto.

    uv run ... --with pillow --with numpy python -I tools/strip/T/fitfont.py --strings <json> [--kind row]
"""
import argparse
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import common as C  # noqa: E402
import ours as O  # noqa: E402

FILE = 'Roboto-wdth-wght.subset.ttf'
# kind: fields, the height probe and BMW's target (from analysis.json "fit", filled in at run time), the k of the
# field's dilation (1 = as bright as the row's digits; fitted in analyse.py)
KINDS = {
    'row':   {'fields': ['range', 'clock', 'temp'], 'probe': '0', 'h': ('clock', 'fig_h_round'), 'k': 1.0,
              'stem': ('clock', 'stem_digits'), 'sizes': (38, 48)},
    'road':  {'fields': ['street'], 'probe': 'П', 'h': ('street', 'cap_h'), 'x': ('street', 'x_h'), 'k': 0.88,
              'stem': ('street', 'cap_stem'), 'sizes': (34, 48)},
    'msg':   {'fields': ['msg1', 'msg2b', 'msg2a'], 'probe': 'П', 'h': ('msg2a', 'cap_h'), 'x': ('msg1', 'x_h'),
              'k': 0.88, 'stem': ('msg2b', 'x_stem'), 'sizes': (28, 40)},
    'unit_c': {'fields': ['temp_u'], 'probe': 'C', 'h': ('temp_u', 'cap_h'), 'k': 0.57, 'sizes': (26, 40)},
    'unit_km': {'fields': ['range_u'], 'probe': 'k', 'h': None, 'k': 0.57, 'sizes': (26, 40)},
    'sign':  {'fields': ['sign'], 'probe': '0', 'h': ('sign', 'fig_h_round'), 'k': 0.0, 'stem': ('sign', 'stem_digits'),
              'sizes': (30, 44)},
    'mode':  {'fields': ['mode_l1', 'mode_l2'], 'probe': 'C', 'h': ('mode_l1', 'cap_h'), 'k': 1.0, 'sizes': (24, 34)},
}


def target(fit, ref, k):
    if not ref:
        return None
    rec = fit.get(ref[0], {}).get(ref[1])
    if not rec:
        return None
    if 'true' in rec and ref[0] not in ('msg1', 'msg2a', 'msg2b'):
        return rec['true']
    # single-photo fields: interpolate between the k = 1 and k = 0.75 corrections
    return rec['true_k1'] + (rec['true_k075'] - rec['true_k1']) * (1 - k) / 0.25


def measured(an, field, photo, k):
    """Glyph ink [x0, x1] corrected with dilation k * b_x (analysis.json holds them corrected with k = 1)."""
    for r in an['fields'].get(field, []):
        if r['photo'] == photo:
            bx = r['b'][0]
            return [(g['x0'] - bx + k * bx, g['x1'] + bx - k * bx) for g in r['glyphs']]
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--strings', required=True)
    ap.add_argument('--kind', action='append', default=[])
    ap.add_argument('--wdth', default='75,81.25,87.5,93.75,100')
    ap.add_argument('--wght', default='300,350,400,450,500,550,600,650')
    ap.add_argument('--step', type=float, default=0.5)
    ap.add_argument('--top', type=int, default=6)
    a = ap.parse_args()
    an = json.load(open(os.path.join(C.ROOT, 'bake', 'work', 'strip', 'T', 'analysis.json')))
    strings = json.load(open(a.strings))
    fit = an['fit']
    result = {}
    for kind, K in KINDS.items():
        if a.kind and kind not in a.kind:
            continue
        th = target(fit, K.get('h'), K['k'])
        tx = target(fit, K.get('x'), K['k'])
        ts = target(fit, K.get('stem'), K['k'])
        cases = []
        for f in K['fields']:
            for ph, s in strings.get(f, {}).items():
                m = measured(an, f, ph, K['k'])
                if m:
                    cases.append((f, ph, s, m))
        chars = ''.join(sorted((set(''.join(c[2] for c in cases)) | set('0123456789ПНоxHC')) - {' '})) + ' '
        rows = []
        for wd in [float(v) for v in a.wdth.split(',')]:
            for wg in [float(v) for v in a.wght.split(',')]:
                for size in np.arange(K['sizes'][0], K['sizes'][1] + 1e-6, a.step):
                    try:
                        cf = O.candidate(FILE, float(size), [wg, wd], chars=chars)
                    except Exception:                                      # noqa: BLE001
                        continue
                    g = cf['glyphs']
                    h = -g[K['probe']]['top'] if 'top' in g[K['probe']] else None
                    xh = -g['о']['top'] if 'о' in g and 'top' in g['о'] else None
                    stem = g['П']['stem_h'] if K['probe'] == 'П' else g['1']['stem_h'] if K['probe'] == '0' else g[K['probe']].get('stem_h')
                    eg, ew = [], []
                    for f, ph, s, m in cases:
                        lay = O.layout_ink(cf, s, 0, 2000, 'left')
                        if len(lay) == len(m):
                            pred = np.array([[l, r] for _, l, r in lay])
                            meas = np.array(m)
                            d = meas - pred
                            sh = np.median(d)
                            eg += list((d - sh).ravel())
                        ew.append((lay[-1][2] - lay[0][1]) - (m[-1][1] - m[0][0]))
                    e_h = (h - th) if (h is not None and th is not None) else 0.0
                    e_x = (xh - tx) if (xh is not None and tx is not None) else 0.0
                    e_s = (stem - ts) if (stem is not None and ts is not None) else 0.0
                    e_g = float(np.sqrt(np.mean(np.square(eg)))) if eg else float(np.sqrt(np.mean(np.square(ew))))
                    e_w = float(np.sqrt(np.mean(np.square(ew)))) if ew else 0.0
                    score = abs(e_h) + abs(e_x) + 0.5 * abs(e_s) + e_g
                    rows.append({'wdth': wd, 'wght': wg, 'size': float(size), 'h': h, 'x_h': xh, 'stem': stem,
                                 'e_h': round(e_h, 2), 'e_x': round(e_x, 2), 'e_s': round(e_s, 2),
                                 'e_g': round(e_g, 2), 'e_w': round(e_w, 2), 'score': round(score, 3),
                                 'advance_digit': g['0']['advance'] if '0' in g else None})
        rows.sort(key=lambda r: r['score'])
        result[kind] = {'target': {'h': th, 'x_h': tx, 'stem': ts, 'probe': K['probe'], 'k': K['k']},
                        'cases': [(f, ph) for f, ph, _, _ in cases], 'best': rows[:a.top]}
        print('\n== %s  target h %s x %s stem %s  (%d strings)' % (kind, th and round(th, 2), tx and round(tx, 2),
                                                                   ts and round(ts, 2), len(cases)))
        for r in rows[:a.top]:
            print('   wdth %-6s wght %-5s size %-5s  h %s x %s stem %.2f  e_h %+.2f e_x %+.2f e_s %+.2f  e_g %.2f e_w %.2f  adv0 %s'
                  % (r['wdth'], r['wght'], r['size'], r['h'], r['x_h'], r['stem'] or 0, r['e_h'], r['e_x'], r['e_s'],
                     r['e_g'], r['e_w'], r['advance_digit']))
    p = os.path.join(C.ROOT, 'bake', 'work', 'strip', 'T', 'fit.json')
    old = json.load(open(p)) if os.path.exists(p) else {}
    old.update(result)
    json.dump(old, open(p, 'w'), indent=1, ensure_ascii=False)
    print('->', p)


if __name__ == '__main__':
    main()
