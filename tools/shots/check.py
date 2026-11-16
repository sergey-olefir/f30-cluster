"""tools/shots: the sanity check of the replay on this build (docs/AGENT-BRIEF-shots.md section 6).

    UV_CACHE_DIR=... uv run -q --no-project --with numpy --with pillow --with moderngl --with scipy \\
        python -I tools/shots/check.py <run folder> <the owner's bench screenshot 69.png>

1. The drawing rule: bench/page.html's stacking (filter on target / visible / not waiting / not an asset, sort by
   class then z, start at the last exclusive layer, then each layer drawn with its opacity, scale and rotation) is
   compared, line by line, with what tools/strip/O/render.py implements, and the kept snapshots are searched for
   anything the replay does not model (a layer scaled or rotated, a shader that does not compile, an unbound sampler).
2. The pixels, the way package O did (tools/strip/O/check69.py): the snapshot of comfort-g20-ours with no message
   ever read (the state of the owner's bench screenshot 69.png: all6WB over the green matte) is replayed and
   registered to the screenshot; the visible matte fraction there must equal 1 - our coverage.
   The screenshot was taken on an earlier build, so differences where the strip changed since are expected.
3. The baseline of comfort-g20-ours is replayed twice from its snapshot (two renderer instances) and compared with
   the picture the run saved, to show the pipeline is deterministic.
"""
import json
import os
import re
import sys
import tempfile
import zlib

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, '..', 'strip', 'O'))
import paint   # noqa: E402
import render as RD   # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))


def rule_check():
    page = open(os.path.join(ROOT, 'bench', 'page.html')).read()
    want = [
        r"scene\.filter\(\(l\) => l\.target === view && l\.visible && l\.state !== 'waiting' && l\.kind !== 'asset'\)",
        r"\.sort\(\(a, b\) => \(CLASS_ORDER\[a\.class\] - CLASS_ORDER\[b\.class\]\) \|\| \(a\.z - b\.z\)\)",
        r"hud\.forEach\(\(l, i\) => \{ if \(l\.exclusive\) start = i; \}\)",
        r"ctx\.globalAlpha = l\.opacity === undefined \? 1 : l\.opacity",
    ]
    found = [bool(re.search(w, page)) for w in want]
    co = re.search(r'CLASS_ORDER\s*=\s*(\{[^}]*\})', page)
    return {'page_rule_lines_found': found, 'page_class_order': co.group(1) if co else None,
            'replay_class_order': RD.CLASS_ORDER}


def to_raw(snapdir):
    """Our snapshot (zlib pixels) -> package O's format (raw pixels), for check69.py."""
    d = tempfile.mkdtemp(prefix='shots-check-')
    os.makedirs(os.path.join(d, 'px'))
    meta = json.load(open(os.path.join(snapdir, 'scene.json')))
    json.dump(meta, open(os.path.join(d, 'scene.json'), 'w'))
    for f in os.listdir(os.path.join(snapdir, 'px')):
        open(os.path.join(d, 'px', f[:-2] + '.raw'), 'wb').write(zlib.decompress(open(os.path.join(snapdir, 'px', f), 'rb').read()))
    return d


def above_strip(shot_path, snapdir):
    """check69.py's comparison over the dials (panel y 100-530) as well as the strip: the strip changed since the
    screenshot (the strip mask), the dials did not, so the dials say how well the replay matches the page."""
    from PIL import Image
    from scipy import ndimage, optimize
    shot = np.asarray(Image.open(shot_path).convert('RGB')).astype(np.float64) / 255.0
    full = paint.Painter().compose(paint.SnapZ(snapdir), (0, 0, 1920, 720), 1, per_layer=False)
    A, prem = full['alpha'].astype(np.float64), full['prem'].astype(np.float64)
    g = shot[..., 1] - np.maximum(shot[..., 0], shot[..., 2])
    matte = np.median(shot[g > 0.5], axis=0)

    def predict(p, region):
        s, ox, oy = p
        x0, y0, x1, y1 = region
        U, V = np.meshgrid(np.arange(int(ox + x0 * s), int(ox + x1 * s)), np.arange(int(oy + y0 * s), int(oy + y1 * s)))
        X, Y = (U + 0.5 - ox) / s - 0.5, (V + 0.5 - oy) / s - 0.5
        a = ndimage.map_coordinates(A, [Y, X], order=1, mode='nearest')
        pc = np.stack([ndimage.map_coordinates(prem[..., c], [Y, X], order=1, mode='nearest') for c in range(3)], -1)
        ok = (V < shot.shape[0]) & (U < shot.shape[1])
        obs = shot[np.clip(V, 0, shot.shape[0] - 1), np.clip(U, 0, shot.shape[1] - 1)]
        return obs, pc + matte * (1 - a)[..., None], a, ok

    def cost(p):
        obs, pred, a, ok = predict(p, (100, 100, 1820, 530))
        return float(np.mean((obs - pred)[ok] ** 2))
    best = min(((cost((s, ox, oy)), s, ox, oy) for s in np.arange(1.124, 1.136, 0.002) for ox in np.arange(46, 56, 1.0)
                for oy in np.arange(72, 80, 1.0)))
    res = optimize.minimize(cost, best[1:], method='Nelder-Mead', options={'xatol': 1e-4, 'fatol': 1e-9, 'maxiter': 300})
    for name, reg in (('dials (y 100-530)', (100, 100, 1820, 530)), ('strip (y 540-720)', (0, 540, 1920, 720))):
        obs, pred, a, ok = predict(res.x, reg)
        vis_obs = (obs[..., 1] - pred[..., 1] + matte[1] * (1 - a)) / matte[1]
        dd = np.abs(vis_obs - (1 - a))[ok]
        col = np.abs(obs - pred)[ok]
        print('   %s, registered on the dials (scale %.5f, offset %.2f, %.2f): visible-fraction |obs - pred| mean %.4f, '
              'p50 %.4f, p95 %.4f, share > 0.1 %.4f; colour |obs - pred| mean %.4f, p50 %.4f'
              % (name, res.x[0], res.x[1], res.x[2], dd.mean(), np.percentile(dd, 50), np.percentile(dd, 95), (dd > 0.1).mean(),
                 col.mean(), np.percentile(col, 50)))


def main():
    run, shot = sys.argv[1], sys.argv[2]
    print('1. drawing rule:', json.dumps(rule_check()))
    sdir = os.path.join(run, 'sanity')
    unread = os.path.join(sdir, 'A__comfort-g20-ours__message__cc-never')
    base = os.path.join(sdir, 'A__comfort-g20-ours__baseline__baseline')
    for d in (unread, base):
        S = paint.SnapZ(d)
        odd = [l['key'] for l in S.drawn() if l.get('sx') not in (None, 1) or l.get('sy') not in (None, 1) or l.get('rotate') not in (None, 0)]
        print('   %s: %d layers drawn, scaled/rotated: %s' % (os.path.basename(d), len(S.drawn()), odd or 'none'))
    # 2. package O's own comparison against the screenshot
    import check69
    raw = to_raw(unread)
    print('2. check69 (69.png vs the replay of %s):' % os.path.basename(unread), flush=True)
    sys.argv = ['check69.py', shot, raw]
    check69.main()
    above_strip(shot, unread)
    # 3. determinism: two fresh renderers on the baseline, and the saved picture
    S = paint.SnapZ(base)
    a = paint.Painter().compose(S, (0, 0, 1920, 720), 1, per_layer=False)
    b = paint.Painter().compose(S, (0, 0, 1920, 720), 1, per_layer=False)
    d_ab = float(np.abs(a['prem'] - b['prem']).max()), float(np.abs(a['alpha'] - b['alpha']).max())
    man = json.load(open(os.path.join(run, 'manifest.json')))['pictures']
    e = [p for p in man if p['id'] == 'A/comfort-g20-ours/baseline/baseline'][0]
    from PIL import Image
    saved = np.asarray(Image.open(os.path.join(run, e['file'])).convert('RGB')).astype(np.float32) / 255.0
    photo = np.asarray(Image.open(os.path.join(paint.PHOTO_DIR, e['backdrop'] + '.png')).convert('RGB')).astype(np.float32) / 255.0
    again = np.clip(a['prem'] + photo * (1 - a['alpha'][..., None]), 0, 1)
    d_saved = np.abs(np.round(again * 255) - np.round(saved * 255))
    print('3. baseline replayed twice: max |diff| prem %.6f, alpha %.6f; vs the saved picture: max %d/255, %d px differ'
          % (d_ab[0], d_ab[1], int(d_saved.max()), int((d_saved.max(axis=2) > 0).sum())))


if __name__ == '__main__':
    main()
