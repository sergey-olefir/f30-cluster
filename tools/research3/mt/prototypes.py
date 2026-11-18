"""research3 MT: the two prototypes as the bench draws them, against today's build, state by state.

    UV_CACHE_DIR=bake/work/.uvcache uv run -q --no-project --with numpy --with pillow --with moderngl \\
        python -I tools/research3/mt/prototypes.py [base snaps] [r8 snaps] [etc2 snaps] [out.json] [--images]

The snapshots are frozen by snapshots.py from the real app on the bench: today's (config.sceneTex off) and the same
states with BENCH_CONFIG {"sceneTex": "r8"} / {"sceneTex": "etc2"}, so the frames below are the engine's own (its
shader edits, its assets, the bench's ETC2 decode), not a model of it. Each pair is replayed (tools/strip/O/render.py)
and compared over the whole 1920 x 720 panel; the pixel memory is the bench's own count.
"""
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import experiments as EX   # noqa: E402
import texlib as TL        # noqa: E402

WORK = os.path.join(TL.ROOT, 'bake', 'work', 'research3', 'MT')
MOVING = [(742, 634, 950, 680), (335, 665, 459, 700)]     # the clock's boxes (paint.py CLOCK_BOXES): the minute moves


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    base = args[0] if args else os.path.join(WORK, 'snaps', 'base')
    modes = {'r8': args[1] if len(args) > 1 else os.path.join(WORK, 'snaps', 'r8'),
             'etc2': args[2] if len(args) > 2 else os.path.join(WORK, 'snaps', 'etc2')}
    out = args[3] if len(args) > 3 else os.path.join(WORK, 'prototypes.json')
    images = '--images' in sys.argv
    R = EX.Renderer()
    res = {}
    for mode, d in modes.items():
        res[mode] = {}
        for st in sorted(os.listdir(d)):
            if not os.path.exists(os.path.join(d, st, 'scene.json')) or not os.path.exists(os.path.join(base, st, 'scene.json')):
                continue
            b, v = EX.Snap(os.path.join(base, st), 'b'), EX.Snap(os.path.join(d, st), mode)
            # the needles move by themselves (smoothing): give each of the variant's dials the needle and fill angles
            # the base froze, so the difference is the textures' alone (the layer's rect identifies the widget)
            by_rect = {(l['x'], l['y'], l['w'], l['h']): l for l in b.layers if l['kind'] == 'effect'}
            for l in v.layers:
                o = by_rect.get((l['x'], l['y'], l['w'], l['h'])) if l['kind'] == 'effect' else None
                if not o:
                    continue
                for k in ('u_dyn',):
                    if k in o['uniforms'] and k in l['uniforms']:
                        l['uniforms'][k] = dict(o['uniforms'][k])
                if 'u_fill' in o['uniforms'] and 'u_fill' in l['uniforms']:
                    fv, ov = l['uniforms']['u_fill']['v'], o['uniforms']['u_fill']['v']
                    l['uniforms']['u_fill'] = {'v': [ov[0], ov[1]] + fv[2:], 'type': None}
            P0, A0, bad0 = EX.frame(R, b)
            P1, A1, bad1 = EX.frame(R, v)
            for x0, y0, x1, y1 in MOVING:          # the clock may have turned between the two runs
                for a in (P0, P1):
                    a[y0:y1, x0:x1] = 0
                for a in (A0, A1):
                    a[y0:y1, x0:x1] = 0
            m, dimg = EX.diff(P0, A0, P1, A1, [0, 0, 1920, 720])
            m['not_drawn'] = [x['key'] + ': ' + x['note'] for x in bad1] or None
            assets = [(l.get('format') or 'rgba8', l['iw'], l['ih']) for l in v.layers if l['kind'] == 'asset']
            res[mode][st] = {'diff': m, 'bench_pixels': v.meta.get('pixels'), 'bench_pixels_today': b.meta.get('pixels'),
                             'asset_bytes': sum(TL.raw_bytes(f, w, h) for f, w, h in assets),
                             'asset_bytes_today': sum(TL.raw_bytes(l.get('format') or 'rgba8', l['iw'], l['ih']) for l in b.layers if l['kind'] == 'asset'),
                             'assets': ['%s %dx%d' % a for a in assets]}
            print('%-5s %-15s pm %9s -> %9s  assets %8d -> %8d B  max %6.1f  >8 %6d  >16 %6d  psnr %s %s' % (
                mode, st, b.meta.get('pixels'), v.meta.get('pixels'), res[mode][st]['asset_bytes_today'], res[mode][st]['asset_bytes'],
                m['max'], m['px_gt8'], m['px_gt16'], m.get('psnr_in_rect'), m['not_drawn'] or ''), flush=True)
            if images:
                from PIL import Image
                os.makedirs(os.path.join(WORK, 'proto'), exist_ok=True)
                Image.fromarray(np.clip(dimg * 8, 0, 255).astype(np.uint8)).save(os.path.join(WORK, 'proto', '%s__%s.diff.png' % (mode, st)))
                Image.fromarray(np.clip(np.round(P1 * 255), 0, 255).astype(np.uint8)).save(os.path.join(WORK, 'proto', '%s__%s.png' % (mode, st)))
                Image.fromarray(np.clip(np.round(P0 * 255), 0, 255).astype(np.uint8)).save(os.path.join(WORK, 'proto', 'today__%s.png' % st))
            R.drop(b)
            R.drop(v)
    json.dump(res, open(out, 'w'), indent=1)
    print('->', out)


if __name__ == '__main__':
    main()
