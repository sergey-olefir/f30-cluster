"""research3 MB: what each app's layers put over BMW's gear letter, the gap round it, the box, BMW's map and its message
panel, in every traced state - by layer RECTANGLE and by composited PIXEL.

    UV_CACHE_DIR=<main checkout>/bake/work/.uvcache uv run -q --no-project --with numpy --with moderngl \\
        python -I tools/research3/mb/geometry.py <run dir> [<run dir> ...] [--json <out.json>]

Reads the snapshots tools/research3/mb/trace.py saved (<run>/snap/<step>/), replays them with package O's renderer
(tools/strip/O/render.py: the app's real shaders on the Mac's GPU, as bench/page.html draws them) at scale 1, and per
region prints: the layers whose rectangle touches it (class, z, kind, rect), the composite alpha (max, mean, share of
pixels with alpha >= 0.5 and >= 0.98) and the mean colour where our alpha is high. Pixels are a bench number (fp32,
no fp16); rectangles and which layer is where transfer to the car as they are.
"""
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'strip', 'O'))
import render as R   # noqa: E402

REGIONS = {
    # BMW's gear letter in the bottom row while a theme is up (design/overlay/g20_comfort.json assist.gear)
    'gear': (1398, 668, 1424, 703),
    # the window other themes leave round it (bimmer-lab; Twin Dial's SPEC)
    'gap': (1380, 660, 1460, 720),
    # the KOMBI's black box (shared/visible.js, bench README; the overlay catalogue has 1422,320 - 1612,440)
    'box': (1406, 342, 1597, 419),
    # BMW's own gear letter's stock place, inside the box (assist.gear_centre)
    'gear_centre': (1496, 320, 1543, 395),
    # BMW's map in the cluster (map.region, the hull of its drawn roads)
    'map': (555, 155, 1395, 612),
    # BMW's check-control panel (assist.cc_panel)
    'cc_panel': (699, 603, 1223, 700),
}


def hit(l, r):
    return l['x'] < r[2] and r[0] < l['x'] + l['w'] and l['y'] < r[3] and r[1] < l['y'] + l['h']


def covers(l, r):
    return l['x'] <= r[0] and l['y'] <= r[1] and l['x'] + l['w'] >= r[2] and l['y'] + l['h'] >= r[3]


def measure(rnd, snapdir):
    sn = R.Snapshot(snapdir)
    out = {'label': sn.meta.get('label'), 'activeName': (sn.meta.get('probe') or {}).get('activeName') if False else None,
           'layers_total': len([l for l in sn.drawn()]), 'regions': {}}
    p = json.load(open(os.path.join(snapdir, 'scene.json'))).get('probe') or {}
    out['settings'] = {k: (p.get('settings') or {}).get(k) for k in ('hudLayout', 'g20', 'byMode', 'bottomRow')}
    drawn = sn.drawn()
    out['rects'] = [{'key': l['key'], 'kind': l['kind'], 'class': l['class'], 'z': l['z'],
                     'rect': [l['x'], l['y'], l['x'] + l['w'], l['y'] + l['h']]} for l in drawn]
    for name, r in REGIONS.items():
        comp = rnd.compose(sn, region=r, s=1, per_layer=True)
        A = comp['alpha']
        hi = A >= 0.98
        prem = comp['prem']
        col = (prem[hi].mean(axis=0) / np.maximum(A[hi].mean(), 1e-6) * 255).round().tolist() if hi.any() else None
        lays = []
        for e in comp['layers']:
            l = sn.by_key[e['key']]
            a = e.get('alpha')
            lays.append({'key': e['key'], 'kind': e['kind'], 'class': l['class'], 'z': l['z'],
                         'rect': [l['x'], l['y'], l['x'] + l['w'], l['y'] + l['h']], 'covers_region': covers(l, r),
                         'alpha_max': None if a is None else round(float(a.max()), 3),
                         'alpha_mean': None if a is None else round(float(a.mean()), 3), 'note': e.get('note')})
        out['regions'][name] = {
            'rect': list(r), 'layers_touching': len([x for x in drawn if hit(x, r)]),
            'alpha_max': round(float(A.max()), 3), 'alpha_mean': round(float(A.mean()), 3),
            'share_ge_0.5': round(float((A >= 0.5).mean()), 3), 'share_ge_0.98': round(float(hi.mean()), 3),
            'colour_where_opaque': col, 'layers': lays}
    return out


def main():
    runs = [a for a in sys.argv[1:] if not a.startswith('--') and not a.endswith('.json')]
    rnd = R.Renderer()
    res = {}
    for run in runs:
        sd = os.path.join(run, 'snap')
        steps = sorted(os.listdir(sd), key=lambda s: os.path.getmtime(os.path.join(sd, s)))
        res[os.path.basename(run)] = {}
        for st in steps:
            m = measure(rnd, os.path.join(sd, st))
            res[os.path.basename(run)][st] = m
            print('== %s / %s  %s  layers %d' % (os.path.basename(run), st, json.dumps(m['settings']), m['layers_total']))
            for name, g in m['regions'].items():
                ls = ['%s %s/%s z%s %s%s a%s' % (x['key'], x['kind'][0], x['class'][:4], x['z'], x['rect'], ' FULL' if x['covers_region'] else '', x['alpha_max'])
                      for x in g['layers']]
                print('   %-11s touch %d  amax %.3f amean %.3f >=.5 %.3f >=.98 %.3f col %s | %s' % (
                    name, g['layers_touching'], g['alpha_max'], g['alpha_mean'], g['share_ge_0.5'], g['share_ge_0.98'],
                    g['colour_where_opaque'] and [int(c) for c in g['colour_where_opaque']], '; '.join(ls)))
    if '--json' in sys.argv:
        p = sys.argv[sys.argv.index('--json') + 1]
        os.makedirs(os.path.dirname(os.path.abspath(p)), exist_ok=True)
        json.dump(res, open(p, 'w'), indent=1)
        print('wrote', p)


if __name__ == '__main__':
    main()
