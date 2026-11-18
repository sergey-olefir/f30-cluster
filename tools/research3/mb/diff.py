"""research3 MB: the picture an experiment draws against today's, per traced state.

    UV_CACHE_DIR=<main checkout>/bake/work/.uvcache uv run -q --no-project --with numpy --with moderngl --with pillow \\
        python -I tools/research3/mb/diff.py <base run> <experiment run> [--rect x0,y0,x1,y1] [--png <dir>] [--json <out>]

Both runs from tools/research3/mb/trace.py. For every step both have, the whole panel is replayed (tools/strip/O/render.py,
scale 1) and compared: our coverage (alpha) and our premultiplied colour, in 8-bit codes, inside --rect (default the
gear gap 1380,660 - 1460,720) and outside it. Prints the largest difference and how many pixels differ by more than 2
codes in each. --png writes the two composites over black and the difference (x8) per step.
"""
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'strip', 'O'))
import render as R   # noqa: E402


def arg(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


def main():
    base, exp = sys.argv[1], sys.argv[2]
    rect = [int(v) for v in arg('--rect', '1380,660,1460,720').split(',')]
    png = arg('--png')
    rnd = R.Renderer()
    out = {}
    for st in sorted(os.listdir(os.path.join(base, 'snap'))):
        if not os.path.isdir(os.path.join(exp, 'snap', st)):
            continue
        img = []
        for run in (base, exp):
            c = rnd.compose(R.Snapshot(os.path.join(run, 'snap', st)), region=(0, 0, 1920, 720), s=1, per_layer=False)
            img.append(np.concatenate([c['prem'], c['alpha'][..., None]], axis=2) * 255.0)
        d = np.abs(img[0] - img[1]).max(axis=2)
        inside = np.zeros(d.shape, bool)
        inside[rect[1]:rect[3], rect[0]:rect[2]] = True
        row = {'in_max': round(float(d[inside].max()), 2), 'in_px_gt2': int((d[inside] > 2).sum()), 'in_px': int(inside.sum()),
               'out_max': round(float(d[~inside].max()), 2), 'out_px_gt2': int((d[~inside] > 2).sum()),
               'out_bbox_gt2': None}
        ys, xs = np.nonzero((d > 2) & ~inside)
        if len(xs):
            row['out_bbox_gt2'] = [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1]
        out[st] = row
        print('%-14s inside: max %6.2f, %5d of %d px > 2 codes | outside: max %6.2f, %6d px > 2 codes %s' % (
            st, row['in_max'], row['in_px_gt2'], row['in_px'], row['out_max'], row['out_px_gt2'], row['out_bbox_gt2'] or ''))
        if png:
            from PIL import Image
            os.makedirs(png, exist_ok=True)
            for i, n in enumerate(('base', 'exp')):
                Image.fromarray(np.clip(img[i][..., :3], 0, 255).astype(np.uint8)).save(os.path.join(png, '%s-%s.png' % (st, n)))
            Image.fromarray(np.clip(d * 8, 0, 255).astype(np.uint8)).save(os.path.join(png, '%s-diff.png' % st))
    if arg('--json'):
        os.makedirs(os.path.dirname(os.path.abspath(arg('--json'))), exist_ok=True)
        json.dump({'base': os.path.basename(base), 'exp': os.path.basename(exp), 'rect': rect, 'steps': out}, open(arg('--json'), 'w'), indent=1)


if __name__ == '__main__':
    main()
