"""tools/road: Road View painted with its own shaders at the engine's own layer boxes, for the states a bench run could not reach.

The engine draws Road View as effect layers whose pixels depend only on their uniforms (shared/road_ui.js): painting the same
shader with the same uniforms at the same panel box over a bench frame of the theme gives the same pixels the bench would show.
Used by mockups.py for f30_cluster (over an earlier 6WB Comfort bench frame) and Twin Dial's scene when its bench pictures are
missing; every such picture is labelled "painted".
"""
import numpy as np
from PIL import Image

import rv_gl as G

LIGHT = {'none': 0, 'red': 1, 'redAmber': 2, 'amber': 3, 'green': 4, 'flashAmber': 5, 'uncertain': 6}
ARROW = {None: 0, 'left': 1, 'straight': 2, 'right': 3}
CLS = {'car': 1, 'truck': 2, 'two': 3, 'ped': 4, 'cyc': 5}
# the layer boxes and slots of shared/road_ui.js LOOKS (panel px)
STRIP6 = (420, 456, 152, 100, [(53, 49.5, 88, 84), (122, 49.5, 40, 46)])
SCENE6 = (760, 168, 400, 280, (0.10, 30, 4, 100))
SCENETD = (739, 336, 442, 256, (0.06, 34, 4, 100))
LANES = [(5.25, 0, 0, 4), (1.75, 0, 0, 2), (-1.75, 0, 0, 2), (-5.25, 0, 0, 4)]
# the scene's six situations as shots.py feeds them: objects (class, x m, y m), lca sides, light
SITUATIONS = {
    'empty': ([], (), None, True),
    'ahead': ([('car', 26, 0.1, True)], (), None, True),
    'traffic': ([('car', 30, 0.1, True), ('truck', 24, 3.5, False), ('car', 45, -3.5, False), ('two', 60, 3.4, False), ('car', 70, -3.6, False)], (1, -1), None, True),
    'lightRed': ([('car', 14, 0.0, True), ('car', 16, 3.5, False), ('ped', 32, -6.0, False)], (), 'red', True),
    'lightGreen': ([('car', 28, 0.0, True), ('car', 34, -3.5, False)], (), 'green', True),
    'nolanes': ([('car', 26, 0.2, True), ('ped', 14, -4.5, False)], (), None, False),
}

_gl = None


def gl():
    global _gl
    if _gl is None:
        _gl = G.GL()
    return _gl


def over(im, rgba, x, y):
    a = np.asarray(im.convert('RGB')).astype(np.float32) / 255.0
    h, w = rgba.shape[:2]
    al = rgba[..., 3:4]
    a[y:y + h, x:x + w] = rgba[..., :3] * al + a[y:y + h, x:x + w] * (1 - al)
    return Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype('uint8'))


def strip6(im, items, light='none', arrow=None, night=1.0):
    """items: up to 2 of ('light' | sign id), placed in B then C as road_ui.stripUniforms does."""
    a, j = G.atlas('f30_cluster')
    x, y, w, h, slots = STRIP6
    it, ce = [], []
    for i, s in enumerate(slots):
        k = items[i] if i < len(items) else None
        if k is None:
            it.append((0, 0, 0, 0)); ce.append((0, 0, 0, 0))
        elif k == 'light':
            it.append((s[0], s[1], s[3], 2)); ce.append((0, 0, 0, 0))
        else:
            it.append((s[0], s[1], s[2], 1)); ce.append(tuple(j['cells'][k]))
    it.append((0, 0, 0, 0)); ce.append((0, 0, 0, 0))
    r = gl().render('rv_strip_6wb', w, h, {'u_it': it, 'u_ce': ce, 'u_lt': (LIGHT[light], ARROW[arrow], 0, 0), 'u_asz': (j['w'], j['h']), 'u_k': (night, 0, 0, 0)},
                    tex={'u_atlas': ('f30', a)}, ss=3)
    return over(im, r, x, y)


def scene(im, look, name, night=1.0, fg=(0.92, 0.92, 0.92), dim=(0.55, 0.57, 0.6)):
    objs, sides, light, lanes = SITUATIONS[name]
    x, y, w, h, view = SCENE6 if look == '6wb' else SCENETD
    ob = [(o[1], o[2], CLS[o[0]] + (10 if o[3] else 0), 1.0) for o in objs]
    ob += [(5, 3.5 * s, 1, 0.6) for s in sides]
    ob = sorted(ob, key=lambda o: o[0])[:8] or [(0, 0, 0, 0)]
    u = {'u_view': view, 'u_ln': LANES if lanes else [(0, 0, 0, 0)] * 4, 'u_lp': [(110 if lanes else 0, 1, 0, 0)] * 4, 'u_ego': (0, 0, 0, 1.75), 'u_ob': ob,
         'u_lt': (LIGHT[light] if light else 0, 0, 0, 0), 'u_fl': (0 if lanes else 1, 1, 0, 0), 'u_fg': fg, 'u_dim': dim, 'u_k': (night, 0, 0, 0)}
    r = gl().render('rv_scene_6wb' if look == '6wb' else 'rv_scene_td', w, h, u, ss=3)
    return over(im, r, x, y)
