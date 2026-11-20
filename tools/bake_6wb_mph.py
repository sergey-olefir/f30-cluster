#!/usr/bin/env python3
"""r1120 PS2 (docs/r1120/PS-REPORT.md "PS2"): 6WB Comfort's speed dial in mph, US style: 0..160 mph on the same 260 degrees
(1.625 deg per mph), majors every 20 mph, mids every 10, minors every 2. Writes apps/f30_cluster/hud/scene/speedo_mph.json and
speedo_d_mph.json (the Dials + G20 variant), and their @etc2 files when etcpak is there (config.sceneTex "etc2").

    cd bake/src && UV_CACHE_DIR=../work/.uvcache uv run -q --no-project --with opencv-python-headless --with numpy \\
        --with pillow --with etcpak python ../../tools/bake_6wb_mph.py [--check]

Our own drawing, the same as the km/h face: only the two layers that carry the scale are drawn again, with the mph scale -
the ticks (bake/src/C1 draw.ticks) and the soft glow round them (draw.soft_glow) - and stacked with every other layer of
the km/h face as it is: the shipped @0.5x base (face, shadows, groove, hub well), the procedural rims, discs, floor and
bezel (draw.CRISP, rendered here), and for "speedo" the range arc's track. The stack is P9's (bake/src/P9/layers.py:
dial_c1, arcs), composed as tools/bake_scene.py composes it. The numerals are text in the layout (design/gen_6wb.py).

--check: compose the km/h face the same way and report how far it is from today's speedo.json (the P9 stack file that
tools/bake_scene.py reads is not in this checkout; this is the evidence that the stack is rebuilt right). Run from bake/src.
"""
import base64
import json
import os
import sys
import zlib

import numpy as np

SRC = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'bake', 'src'))
ROOT = os.path.abspath(os.path.join(SRC, '..', '..'))
sys.path.insert(0, SRC)
sys.path.insert(0, os.path.join(ROOT, 'tools'))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'research3', 'mt'))
from common import imageio  # noqa: E402
from C1 import draw, params as P  # noqa: E402
from P9 import layers as Ly  # noqa: E402

OUT = os.path.join(ROOT, 'apps', 'f30_cluster', 'hud', 'scene')
WORK = os.path.join(ROOT, 'bake', 'work', 'PS2')
KMH = dict(P.SCALE)
MPH = dict(start=KMH['start'], deg_per_kmh=260.0 / 160.0, vmax=160, minor_kmh=2, mid_kmh=10, major_kmh=20)
BOX = (77, 45)                        # the dial layer's box (gen_6wb: centre +- 335), as tools/bake_scene.py


def even_crop(img):
    al = img[..., 3]
    ys, xs = np.nonzero(al > 0.5 / 255.0)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    x0 -= x0 % 2; y0 -= y0 % 2
    x1 += (x1 - x0) % 2; y1 += (y1 - y0) % 2
    return img[y0:y1, x0:x1], int(x0), int(y0)


def render(scale, tag):
    """The scale's two layers and the other procedural ones, written as C1/build.py writes them (the glow @0.5x, dithered
    with its own seed; the crisp ones 1x). -> { id: (path, x, y, s) }."""
    P.SCALE.clear(); P.SCALE.update(scale)
    bx, by = P.BOX[0], P.BOX[1]
    out = {}
    d = os.path.join(WORK, tag)
    os.makedirs(d, exist_ok=True)
    g1 = draw.Grid(1)
    crop, x0, y0 = even_crop(draw.soft_glow(g1))
    p = os.path.join(d, 'speedo.soft-glow.glow@0.5x.png')
    imageio.write_png(p, imageio.half_res(crop), seed=zlib.crc32(b'speedo.soft-glow') & 0xFFFF)
    out['speedo.soft-glow'] = (p, bx + x0, by + y0, 0.5)
    gs = draw.Grid(draw.SS)
    for k, (fn, z, kind) in draw.CRISP.items():
        img = fn(gs)
        pm = img.copy(); pm[..., :3] *= pm[..., 3:4]
        pm = gs.down(pm)
        a = pm[..., 3:4]
        pm[..., :3] = np.where(a > 1e-6, pm[..., :3] / np.maximum(a, 1e-6), 0)
        crop, x0, y0 = even_crop(pm)
        p = os.path.join(d, '%s.%s.png' % (k, kind))
        imageio.write_png(p, crop)
        out[k] = (p, bx + x0, by + y0, 1.0)
    P.SCALE.clear(); P.SCALE.update(KMH)
    return out


def up(a, s):
    """tools/bake_scene.py up(): scale by s (> 1: bilinear, premultiplied)."""
    from PIL import Image
    if s == 1:
        return a
    h, w = a.shape[:2]
    pm = a.copy(); pm[..., :3] *= pm[..., 3:4]
    ims = [Image.fromarray(pm[..., i]).resize((int(round(w * s)), int(round(h * s))), Image.BILINEAR) for i in range(4)]
    o = np.stack([np.asarray(i) for i in ims], -1)
    o[..., :3] = np.where(o[..., 3:4] > 1e-4, o[..., :3] / np.maximum(o[..., 3:4], 1e-4), 0)
    return o


def over(canvas, img, x, y, opacity=1.0):
    """tools/bake_scene.py over(): straight-alpha 'over', clipped."""
    h, w = img.shape[:2]
    H, W = canvas.shape[:2]
    x0, y0, x1, y1 = max(x, 0), max(y, 0), min(x + w, W), min(y + h, H)
    if x1 <= x0 or y1 <= y0:
        return
    s = img[y0 - y:y1 - y, x0 - x:x1 - x]
    d = canvas[y0:y1, x0:x1]
    sa = s[..., 3:4] * opacity
    da = d[..., 3:4]
    oa = sa + da * (1 - sa)
    d[..., :3] = (s[..., :3] * sa + d[..., :3] * da * (1 - sa)) / np.maximum(oa, 1e-6)
    d[..., 3:4] = oa


def compose(rendered, with_arc):
    L = Ly.dial_c1(True) + ([Ly.arcs()[0]] if with_arc else [])
    for it in L:
        if it['id'] in rendered:
            p, x, y, s = rendered[it['id']]
            it.update(img=p, x=x, y=y, s=s)
    c = np.zeros((670, 670, 4), np.float32)
    for it in Ly.sort(L):
        a = Ly.load(it)
        a = up(a, 1.0 / it['s'] if it['s'] < 1 else 1.0)
        over(c, a, it['x'] - BOX[0], it['y'] - BOX[1], it.get('opacity', 1.0))
    return np.clip(np.round(c * 255.0), 0, 255).astype(np.uint8)


def save(name, a, about):
    h, w = a.shape[:2]
    json.dump({'w': w, 'h': h, '_about': about, 'rgba': base64.b64encode(a.tobytes()).decode('ascii')}, open(os.path.join(OUT, name + '.json'), 'w'))
    print('%-14s %d x %d RGBA8, %.2f MiB as an asset (counted twice)' % (name, w, h, w * h * 8 / 1048576.0))
    try:
        import bake_variants as BV
        data, W, H, err = BV.etc2rgb(a)
        json.dump({'w': W, 'h': H, 'src': [w, h], 'format': 'etc2rgb', 'enc': 'pm',
                   '_about': name + '.json premultiplied over black, opaque, etc2rgb (etcpak; r1120 PS2 as research3 MT); decode error max %s' % err,
                   'etc2': base64.b64encode(data).decode('ascii')}, open(os.path.join(OUT, name + '@etc2.json'), 'w'))
        print('%-14s etc2rgb %d x %d' % (name + '@etc2', W, H))
    except ImportError:
        print('  (no etcpak: %s@etc2.json not written; config.sceneTex "etc2" then takes the RGBA8 file)' % name)


def today(name):
    j = json.load(open(os.path.join(OUT, name + '.json')))
    return np.frombuffer(base64.b64decode(j['rgba']), np.uint8).reshape(j['h'], j['w'], 4)


def main():
    if '--check' in sys.argv:
        r = render(KMH, 'kmh')
        for name, arc in (('speedo', True), ('speedo_d', False)):
            a = compose(r, arc).astype(int)
            b = today(name).astype(int)
            pa = a[..., :3] * a[..., 3:4] / 255.0
            pb = b[..., :3] * b[..., 3:4] / 255.0
            d = np.abs(pa - pb)
            print('%s: the km/h face rebuilt against today\'s: premultiplied colour max %.1f, mean %.3f, %.2f %% of pixels > 8'
                  % (name, d.max(), d.mean(), 100.0 * (d.max(-1) > 8).mean()))
        return
    r = render(MPH, 'mph')
    about = '6WB Comfort speed dial in mph (0..160, 1.625 deg a mph, majors 20 / mids 10 / minors 2): tools/bake_6wb_mph.py (r1120 PS2)'
    save('speedo_mph', compose(r, True), about)
    save('speedo_d_mph', compose(r, False), about + ', the Dials + G20 variant (no range arc)')


if __name__ == '__main__':
    main()
