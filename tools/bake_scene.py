#!/usr/bin/env python3
"""Packs the baked 6WB layers (apps/f30_cluster/hud/baked/, made by bake/src) into the RGBA scene textures the
cluster themes sample as cluster-render assets: apps/f30_cluster/hud/scene/<name>.json = {w, h, rgba: base64}.
    cd bake/src && ./P9/py.sh ../../tools/bake_scene.py        (needs numpy, pillow)
    cd bake/src && ./P9/py.sh ../../tools/bake_scene.py tacho tacho_d     (only those scene textures)
Straight (not premultiplied) alpha. Our own drawings; no photo pixels."""
import base64, json, os, sys
import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
BAKED = os.path.join(ROOT, 'apps', 'f30_cluster', 'hud', 'baked')
OUT = os.path.join(ROOT, 'apps', 'f30_cluster', 'hud', 'scene')
STACK = json.load(open(os.path.join(ROOT, 'bake', 'work', 'P9', 'stack_comfort.json')))
BY_ID = {l['id']: l for l in STACK}
ONLY = set(sys.argv[1:])          # scene texture names to write (none given: all of them)


def live(id_):
    """The procedural elements drawn here from their package's code, not read from bake/work (a git-ignored render that
    may be older than the code). car4 L: the tacho's gear tray (bake/src/C2 params.PBOX, draw.pbox), one drawing for
    every layout's tacho texture ("tacho", "tacho_d")."""
    if id_ == 'tacho.p-box':
        sys.path.insert(0, os.path.join(ROOT, 'bake', 'src'))
        from common import geom
        from C2 import draw
        x0, y0, w, h = geom.crop_box('C2')
        l = BY_ID[id_]
        if (l['x'], l['y']) != (x0, y0):
            raise SystemExit('%s: the stack puts it at %r, C2 draws its box at %r' % (id_, (l['x'], l['y']), (x0, y0)))
        return draw.pbox(draw.Canvas(x0, y0, w, h, 1)).astype(np.float32)
    return None


def load(rel):
    """A baked file (relative to hud/baked) or a package's 1x procedural render (bake/work/...)."""
    f = os.path.join(ROOT, rel) if rel.startswith('bake/') else os.path.join(BAKED, rel)
    return np.asarray(Image.open(f).convert('RGBA'), dtype=np.float32) / 255.0


def up(a, s):
    """Scale by s (> 1: bilinear up)."""
    if s == 1:
        return a
    h, w = a.shape[:2]
    pm = a.copy(); pm[..., :3] *= pm[..., 3:4]
    ims = [Image.fromarray(pm[..., i]).resize((int(round(w * s)), int(round(h * s))), Image.BILINEAR) for i in range(4)]
    o = np.stack([np.asarray(i) for i in ims], -1)
    o[..., :3] = np.where(o[..., 3:4] > 1e-4, o[..., :3] / np.maximum(o[..., 3:4], 1e-4), 0)
    return o


def over(canvas, img, x, y, opacity=1.0):
    """Straight-alpha 'over' of img onto canvas at (x, y) (clipped)."""
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
    rgb = (s[..., :3] * sa + d[..., :3] * da * (1 - sa)) / np.maximum(oa, 1e-6)
    d[..., :3] = rgb
    d[..., 3:4] = oa


def put(canvas, id_, ox, oy, opacity=1.0):
    l = BY_ID[id_]
    a = live(id_)
    if a is None:
        a = up(load(l['file']), 1.0 / l['scale'] if l['scale'] < 1 else 1.0)
    over(canvas, a, l['x'] - ox, l['y'] - oy, opacity * l.get('opacity', 1.0))


def save(name, a):
    if ONLY and name not in ONLY:
        return
    a = np.clip(np.round(a * 255.0), 0, 255).astype(np.uint8)
    h, w = a.shape[:2]
    os.makedirs(OUT, exist_ok=True)
    json.dump({'w': w, 'h': h, 'rgba': base64.b64encode(a.tobytes()).decode('ascii')}, open(os.path.join(OUT, name + '.json'), 'w'))
    print('%-12s %4d x %-4d  %.2f MiB as an asset' % (name, w, h, w * h * 8 / 1048576.0))


def mini(name, pre, pict, ox, oy):
    c = np.zeros((144, 144, 4), np.float32)
    for part in ('face', 'zones', 'ticks', 'inner-arc', 'bezel', 'bezel-highlight'):
        put(c, pre + '.' + part, ox, oy)
    put(c, pict, ox, oy, 0.85)               # P5's pictogram, dimmed (BAKE-REPORT 3.2)
    save(name, c)


def main():
    # each big dial's whole static stack (P9 stack_comfort: face, shadows, groove, ticks, red zone, OFF arc, discs,
    # rings, floor, glow, P box, hub ring, bezel, and the bottom arc with its pictogram), full size, in the dial layer's
    # box (gen_6wb: centre +- 335). Only the needle, the hub's glow and the over-speed band stay live.
    for name, box, pick in (('speedo', (77, 45), lambda l: l['cluster'] == 'C1' or l['id'] == 'speedo.range-arc.track'),
                            ('tacho', (1173, 45), lambda l: l['cluster'] == 'C2' or l['id'] in ('tacho.ed-arc.track', 'edyn.battery'))):
        c = np.zeros((670, 670, 4), np.float32)
        for l in sorted([l for l in STACK if pick(l)], key=lambda l: l['z']):
            put(c, l['id'], *box)
        save(name, c)
    # "6WB Dials + G20" (docs/OVERLAY-PLAN-DIALS.md): the dials alone, without the bottom arcs and the battery (the G20
    # shows its own range there)
    for name, box, cl in (('speedo_d', (77, 45), 'C1'), ('tacho_d', (1173, 45), 'C2')):
        c = np.zeros((670, 670, 4), np.float32)
        for l in sorted([l for l in STACK if l['cluster'] == cl], key=lambda l: l['z']):
            put(c, l['id'], *box)
        save(name, c)
    # its collar (tools/overlay/plan_dials.py): where our background covers the stock G20 dials that stick out past
    # ours, the band under our dials' faded bottoms and the shade at their inner edges, quarter size. Pure black (empty
    # space is black: docs/AGENT-BRIEF-polish.md 1), its coverage soft already (plan_dials grows and blurs it at full
    # size and keeps it off every G20 item we show), so here only a 4 x 4 box average
    g = Image.open(os.path.join(ROOT, 'design', 'overlay', 'collar.dials.png')).convert('L')
    g = np.asarray(g, dtype=np.float32).reshape(180, 4, 480, 4).mean((1, 3)) / 255.0
    c = np.concatenate([np.zeros((180, 480, 3), np.float32), g[..., None]], -1)
    save('collar', c)
    # package F: the full-size cover (plan_dials.py bottom_cover): black over BMW's bottom lines, hooks and grey dash,
    # 3 px clear of the check-control frame, text and "i". Only its box (plan_dials COVER_BOX = gen_6wb COVER), 1:1
    x0, y0, x1, y1 = 588, 598, 1324, 662
    g = np.asarray(Image.open(os.path.join(ROOT, 'design', 'overlay', 'cover.dials.png')).convert('L'), dtype=np.float32) / 255.0
    if g[:y0].any() or g[y1:].any() or g[:, :x0].any() or g[:, x1:].any():
        raise SystemExit('cover.dials.png has coverage outside its box %r' % ([x0, y0, x1, y1],))
    g = g[y0:y1, x0:x1]
    save('cover', np.concatenate([np.zeros(g.shape + (3,), np.float32), g[..., None]], -1))
    # the middle window and the bar below it, half size, one texture: x 640..1280, y 76..648
    c = np.zeros((572, 640, 4), np.float32)
    put(c, 'window.base', 640, 76)
    put(c, 'infobar.body', 640, 76)
    save('window', c[::2, ::2] * 0 + (c.reshape(286, 2, 320, 2, 4).mean((1, 3))))
    save('horizon', load('C5/window.horizon.albedo.png'))
    # the bar's top line, full size: x 668..1252, y 602..681
    c = np.zeros((79, 584, 4), np.float32)
    put(c, 'infobar.line', 668, 602)
    save('bar', c)
    # the bottom arcs' minor-segment coverage (alpha): the live fill lights them (fuel / consumption)
    save('range_seg', load('C6/range-arc.segments.mask.png'))
    save('ed_seg', load('C6/ed-arc.segments.mask.png'))
    # the road signs (their visibility is live): level, symmetric under the speed hub
    save('sign_limit', load('C7/sign.speed-limit.albedo.png'))
    save('sign_nopass', load('C7/sign.no-overtaking.albedo.png'))
    mini('fuel', 'fuel', 'mini.fuel-pump', 8, 556)
    mini('oil', 'oil', 'mini.oil-can', 1768, 556)


if __name__ == '__main__':
    main()
