#!/usr/bin/env python3
"""The strip lead (2026-11-16): the before / after defect table per zone, from the three zone packages' diff outputs.

    python3 tools/strip/lead_table.py <before dir> <after dir> [--json out.json]

Each dir holds what the zone diffs write: diff_wb_dials.json, diff_wb_sport_dials.json (ZL, tools/strip/ZL/diff.py),
diff.json (ZC, tools/strip/ZC/diff.py; with "cases") and zr_diff.json (ZR, tools/strip/ZR/diff.py --out). Per zone,
layout and mode, over every state: CLIP px, LEAK px (and the light that gets through, in px of stock white), SAFETY px
(ZL: any alpha of ours within 3 px of a belt or airbag telltale; ZR's "SAFETY" is alpha under the gear, an element BMW
draws OVER a theme, which hides nothing - shown apart as "over"), DOUBLE (count of our texts beside visible BMW ink of
the same job) and the worst seam (luminance step, white text = 1). Each class: the sum over states and the worst state.
"""
import json
import os
import sys


def zl(d):
    out = {}
    for lay in ('wb_dials', 'wb_sport_dials'):
        f = os.path.join(d, 'diff_%s.json' % lay)
        if not os.path.exists(f):
            continue
        for k, st in json.load(open(f))['states'].items():
            mode, state = k.split('/', 1)
            seam = max([abs(s['lum_out_minus_in']) for s in st['SEAM']['top']] or [0])
            out[(lay, mode, state)] = {'CLIP': st['CLIP']['px'], 'LEAK': st['LEAK']['px'], 'LEAK_light': st['LEAK']['sum_visible_light'],
                                       'SAFETY': st['SAFETY']['px'], 'DOUBLE': len(st['DOUBLE']), 'SEAM': seam,
                                       'clip_where': [w['element'] for w in st['CLIP'].get('where', [])[:3]],
                                       'leak_where': [w['element'] for w in st['LEAK'].get('where', [])[:3]]}
    return out


def zc(d):
    f = os.path.join(d, 'diff.json')
    out = {}
    if not os.path.exists(f):
        return out
    for c in json.load(open(f))['cases']:
        k = (c['layout'], c['mode'], c['state'])
        r = out.setdefault(k, {'CLIP': 0.0, 'LEAK': 0.0, 'LEAK_light': 0.0, 'SAFETY': 0.0, 'DOUBLE': 0, 'SEAM': 0.0,
                               'clip_where': set(), 'leak_where': set(), 'photos': 0})
        r['photos'] += 1
        for el, e in c['elements'].items():
            if e.get('CLIP_px'):
                r['CLIP'] = max(r['CLIP'], 0) + e['CLIP_px']
                r['clip_where'].add(el)
            if e.get('LEAK_px'):
                r['LEAK'] += e['LEAK_px']
                r['LEAK_light'] += e.get('LEAK_light', 0)
                r['leak_where'].add(el)
        r['DOUBLE'] = max(r['DOUBLE'], len(c.get('DOUBLE') or []))
        r['SEAM'] = max([r['SEAM']] + [s['dY_max_cell_p95'] for s in c.get('SEAMS_top') or []])
    for r in out.values():                     # the mean over the photos the state is compared with
        n = r.pop('photos')
        for k in ('CLIP', 'LEAK', 'LEAK_light'):
            r[k] = round(r[k] / n, 1)
        r['clip_where'], r['leak_where'] = sorted(r['clip_where']), sorted(r['leak_where'])
    return out


def zr(d):
    f = os.path.join(d, 'zr_diff.json')
    out = {}
    if not os.path.exists(f):
        return out
    for k, c in json.load(open(f))['cases'].items():
        lay, mode, state = k.split('/')
        # BMW's mode label and marker are covered on purpose since the owner's decisions 2 and 7: apart, as "decided"
        dec = ('assist.mode_label', 'assist.info_tacho')
        clip = sum(v['px'] for k2, v in c['CLIP'].items() if k2 not in dec)
        out[(lay, mode, state)] = {'CLIP': round(clip, 1), 'decided': round(sum(v['px'] for k2, v in c['CLIP'].items() if k2 in dec), 1), 'LEAK': c['LEAK']['px'], 'LEAK_light': c['LEAK']['sum_visible_white_px'],
                                   'SAFETY': 0.0, 'over': sum(v['px'] for v in c['SAFETY'].values()),
                                   'DOUBLE': sum(1 for v in c['DOUBLE_px'].values() if v > 0),
                                   'SEAM': max([s.get('step_p95_white', s.get('step_mean_white', 0)) for s in c['SEAM']] or [0]),
                                   'clip_where': sorted(k2 for k2, v in c['CLIP'].items() if v['px'] > 0),
                                   'leak_where': [b['box'] for b in c['LEAK']['blobs'][:2]]}
    return out


def summary(rows):
    s = {}
    for (lay, mode, state), r in rows.items():
        g = s.setdefault((lay, mode), {'states': 0})
        g['states'] += 1
        for k in ('CLIP', 'LEAK', 'LEAK_light', 'SAFETY', 'DOUBLE', 'SEAM', 'over', 'decided'):
            if k not in r:
                continue
            g[k + '_sum'] = round(g.get(k + '_sum', 0) + r[k], 2)
            if r[k] > g.get(k + '_max', (0, ''))[0]:
                g[k + '_max'] = (r[k], state)
    return s


def main():
    before, after = sys.argv[1], sys.argv[2]
    res = {}
    for name, fn in (('ZL', zl), ('ZC', zc), ('ZR', zr)):
        b, a = fn(before), fn(after)
        res[name] = {'before': {'%s/%s' % k: v for k, v in summary(b).items()}, 'after': {'%s/%s' % k: v for k, v in summary(a).items()},
                     'after_states': {'%s/%s/%s' % k: v for k, v in a.items()}}
        for when, sm in (('before', res[name]['before']), ('after', res[name]['after'])):
            for k, g in sorted(sm.items()):
                cols = []
                for c in ('CLIP', 'decided', 'LEAK', 'SAFETY', 'DOUBLE', 'SEAM', 'over'):
                    if c + '_sum' in g:
                        mx = g.get(c + '_max', (0, '-'))
                        cols.append('%s %s (max %s %s)' % (c, g[c + '_sum'], mx[0], mx[1]))
                print('%-3s %-6s %-22s n=%-2d %s' % (name, when, k, g['states'], ' | '.join(cols)))
    if '--json' in sys.argv:
        json.dump(res, open(sys.argv[sys.argv.index('--json') + 1], 'w'), indent=1, default=list)


if __name__ == '__main__':
    main()
