"""Package M: does WBBACK draw the same with the strip mask as with today's rectangles? (brief M.3)

Takes scene dumps of the bench (the "scene" message of GET /events: every layer with its fragment shader, live uniforms
and binds; tools/strip/M/lane_states.js writes them), finds the WBBACK layer, and runs its collar path in numpy twice,
over the whole panel, from the engine's own uniforms:
  new    as the layer is now (u_mk / u_mh / u_mo: the lanes, sampled from the baked atlas as the shader does);
  old    the same uniforms with the lanes off, through the code as it was before package M (git 3c8ef46): the
         collar, the cover, the shade, the four patches, the map window, the foot line and u_cc.
Reports, per dump, the largest difference in alpha and in premultiplied colour, in 1/255 steps, and where.

    uv run ... python -I tools/strip/M/verify_mask.py dump1.json [dump2.json ...]
"""
import base64
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'strip'))
import bake_mask as bm  # noqa: E402  (its WBBACK maths: smoothstep, box_out, patch, bilinear)

SCENE = os.path.join(ROOT, 'apps', 'f30_cluster', 'hud', 'scene')


def scene_tex(name):
    j = json.load(open(os.path.join(SCENE, name + '.json')))
    if j.get('format') == 'r8':
        return np.frombuffer(base64.b64decode(j['r8']), np.uint8).reshape(j['h'], j['w']).astype(np.float64) / 255.0
    return np.frombuffer(base64.b64decode(j['rgba']), np.uint8).reshape(j['h'], j['w'], 4)[..., 3].astype(np.float64) / 255.0


def uni(l, k, n=4):
    u = l['uniforms'].get(k)
    if u is None:
        return np.zeros(n)
    v = u['v'] if isinstance(u, dict) else u
    return np.asarray(v, float)


def veil(t):
    u = 1.0 - np.clip(t, 0.0, 1.0)
    return 1.0 - u * u


def foot_line(px, py, f):
    """shaders.js footLine(): rgb and its coverage."""
    L = np.zeros(px.shape + (4,))
    if not (0.5 < f[0] < 2.5):
        return L
    near = np.abs(py - f[1]) < 12.0
    t, dy = (px - f[2]) / (f[3] - f[2]), py - f[1]
    if f[0] < 1.5:
        env = bm.smoothstep(0.0, 0.30, t) * (1.0 - bm.smoothstep(0.70, 1.0, t))
        core, halo = np.clip(1.4 - np.abs(dy), 0.0, 1.0), np.exp(-np.abs(dy) / 2.4)
        L[..., 0], L[..., 1], L[..., 2] = 0.80, 0.85, 0.92
        L[..., 3] = env * np.maximum(0.95 * core, 0.26 * halo)
    else:
        hh, ln = 4.0, f[3] - f[2]
        ax = np.maximum(np.abs(px - (f[2] + f[3]) * 0.5) - (ln * 0.5 - hh), 0.0)
        cov = np.clip(hh + 0.5 - np.hypot(np.minimum(ax, 16.0), dy), 0.0, 1.0)
        lum = 0.06 + 0.72 * np.exp(-(dy + 1.8) ** 2 / 1.4) + 0.40 * np.exp(-(dy - 2.2) ** 2 / 1.0)
        spec = 0.70 + 0.30 * np.exp(-(t - 0.5) ** 2 / 0.06)
        for i, c in enumerate((0.97, 0.98, 1.0)):
            L[..., i] = c * lum * spec
        L[..., 3] = cov
    return L * near[..., None]


def in_box(px, py, b):
    return (b[2] > b[0]) & (px >= b[0]) & (py >= b[1]) & (px < b[2]) & (py < b[3])


def wbback(l, lanes, atlas):
    """The collar path of WBBACK (u_hasTex 2) at every pixel centre of the layer: (alpha, premultiplied rgb)."""
    w, h = int(l['w']), int(l['h'])
    px, py = np.meshgrid(np.arange(w) + 0.5, np.arange(h) + 0.5)
    dlv, drv = uni(l, 'u_dl', 3), uni(l, 'u_dr', 3)
    dl = (np.hypot((px - dlv[0]) / dlv[2], (py - dlv[1]) / dlv[2]) - 1.0) * dlv[2]
    dr = (np.hypot((px - drv[0]) / drv[2], (py - drv[1]) / drv[2]) - 1.0) * drv[2]
    between = (px > dlv[0]) & (px < drv[0])
    r0, r1, mk, mh, mo = uni(l, 'u_r0'), uni(l, 'u_r1'), uni(l, 'u_mk'), uni(l, 'u_mh'), uni(l, 'u_mo')
    binds = l.get('binds') or {}
    tex = {}
    for smp, key in binds.items():
        tex[smp] = key
    collar = TEX[tex['u_t0']]
    a = bm.sampled(collar, r0, px, py)
    if r1[2] > 0:
        a = np.maximum(a, bm.sampled(TEX[tex['u_t1']], r1, px, py))
    pats = [uni(l, 'u_pat%d' % i) for i in range(4)]
    soft = uni(l, 'u_patSoft')
    lane_on = lanes and mk[2] > mk[0]
    if not lane_on:
        for i, b in enumerate(pats):
            if b[2] > b[0]:
                a = np.maximum(a, bm.patch(px, py, b, soft[i]))
    else:
        ins = in_box(px, py, mk)
        tx = (np.floor(px - mk[0]) + mo[0]).astype(int)
        ty = (np.floor(py - mk[1]) + mo[1]).astype(int)
        v = atlas[np.clip(ty, 0, atlas.shape[0] - 1), np.clip(tx, 0, atlas.shape[1] - 1)]
        a = np.where(ins, v, a)
    sh, ko = uni(l, 'u_shade'), uni(l, 'u_shadeKo')
    if sh[0] > 0:
        o = np.minimum(dl, dr)
        vy = 1.0 - np.clip((py - sh[2]) / max(sh[3] - sh[2], 1.0), 0.0, 1.0)
        s = sh[0] * np.exp(-np.maximum(o, 0.0) / sh[1]) * vy * np.clip((o + 3.0) / 3.0, 0.0, 1.0)
        if ko[2] > ko[0]:
            s = s * bm.smoothstep(0.0, 2.0, bm.box_out(px, py, ko, 0.0))
        a = np.where(between, np.maximum(a, s), a)
    wb, fd = uni(l, 'u_wbox'), uni(l, 'u_fade')
    if wb[2] > 0:
        ex = np.minimum(px - wb[0], wb[0] + wb[2] - px)
        yb = wb[1] + wb[3]
        qx = 1.0 - np.clip(ex / max(fd[1], 1.0), 0.0, 1.0)
        qy = 1.0 - np.clip(np.minimum((py - wb[1]) / max(fd[0], 1.0), (yb - py) / max(fd[2], 1.0)), 0.0, 1.0)
        vis = veil(1.0 - np.hypot(qx, qy)) * (ex > 0)
        if fd[3] > 0:
            vis = vis * bm.smoothstep(0.0, fd[3], np.minimum(dl, dr))
        mv = (1.0 - vis) * np.clip((np.minimum(dl, dr) + 6.0) / 3.0, 0.0, 1.0)
        mv = mv * (1.0 - bm.smoothstep(yb + 2.0, yb + 4.0, py))
        if ko[2] > ko[0]:
            mv = mv * bm.smoothstep(0.0, 2.0, bm.box_out(px, py, ko, 0.0))
        a = np.where(between, np.maximum(a * (1.0 - vis), mv), a)
    L = foot_line(px, py, uni(l, 'u_foot'))
    a2 = L[..., 3] + a * (1.0 - L[..., 3])
    fc = np.where((L[..., 3] > 0)[..., None], L[..., :3] * L[..., 3:4] / np.maximum(a2, 1e-4)[..., None], 0.0)
    a = np.where(L[..., 3] > 0, a2, a)
    cc = uni(l, 'u_cc')
    if lanes and mh[2] > mh[0]:
        ins = in_box(px, py, mh)
        tx = (np.floor(px - mh[0]) + mo[2]).astype(int)
        ty = (np.floor(py - mh[1]) + mo[3]).astype(int)
        v = atlas[np.clip(ty, 0, atlas.shape[0] - 1), np.clip(tx, 0, atlas.shape[1] - 1)]
        a = a * np.where(ins, v, 1.0)
    elif cc[2] > cc[0]:
        a = a * bm.smoothstep(-0.5, 3.0, bm.box_out(px, py, cc, 8.0))
    return a, fc * a[..., None]


TEX = {}


def main():
    worst = 0.0
    for f in sys.argv[1:]:
        d = json.load(open(f))
        l = next(l for l in d['layers'] if l.get('fs') and 'u_mk' in l['fs'] and 'u_hasTex' in l['fs']
                 and (l['uniforms'].get('u_hasTex') or {}).get('v', [0])[0] == 2)
        # the assets bound to it (the bench keys them "<conn>:<ref>"), by the sampler they are bound to
        mk = l['binds']
        TEX.clear()
        for smp, key in mk.items():
            name = {'u_t0': 'collar', 'u_t1': 'cover', 'u_t2': 'strip_mask'}[smp]
            TEX[key] = scene_tex(name)
        atlas = TEX[mk['u_t2']] if 'u_t2' in mk else None
        a_new, c_new = wbback(l, True, atlas)
        a_old, c_old = wbback(l, False, atlas)
        da = np.abs(a_new - a_old) * 255
        dc = np.abs(c_new - c_old).max(-1) * 255
        j, i = np.unravel_index(np.argmax(da), da.shape)
        worst = max(worst, da.max(), dc.max())
        on = lambda k: list(map(float, uni(l, k)))
        print('%-28s lanes mk %s mh %s mo %s | max |d alpha| %.3f/255 at (%d, %d), max |d rgb*a| %.3f/255, px off > 1/255: %d'
              % (os.path.basename(f), on('u_mk'), on('u_mh'), on('u_mo'), da.max(), i, j, dc.max(), int((da > 1.0).sum())))
    print('worst over all dumps: %.3f/255' % worst)
    return 0 if worst <= 1.0 else 1


if __name__ == '__main__':
    sys.exit(main())
