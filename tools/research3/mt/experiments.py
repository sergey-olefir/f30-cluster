"""research3 MT: every texture option measured in the rendered frame, against today's render.

    UV_CACHE_DIR=bake/work/.uvcache uv run -q --no-project --with numpy --with pillow --with moderngl --with etcpak \\
        --with texture2ddecoder python -I tools/research3/mt/experiments.py [snaps dir] [out.json] [--only a,b] [--images]

A snapshot of a state (snapshots.py) is replayed with package O's renderer (tools/strip/O/render.py: the app's real
fragment shaders through moderngl, stacked as the bench page stacks them) twice: as it is, and with some scene
textures replaced by a variant (another size, R8 luma + tint, ETC2 decoded exactly as the GPU would, premultiplied
opaque RGB, a shared texture) and, where the variant needs it, the shader edited the way the proposal would edit
shared/shaders.js (R8: .r times a tint; a padded ETC2 texture: its box uniform grown to cover the padding). The frame
difference (premultiplied colour and coverage, 0..255, over the whole 1920 x 720 panel) is the cost in picture
quality; bytes and pixel memory are cluster-render's accounting of the variant's assets. --images writes the
difference images (x8) to bake/work/research3/MT/diffs/.
"""
import copy
import json
import math
import os
import re
import sys
import zlib

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, '..', '..', 'shots'))
sys.path.insert(0, os.path.join(HERE, '..', '..', 'strip', 'O'))
import texlib as TL      # noqa: E402
import accounting as AC  # noqa: E402
import render as RD      # noqa: E402
import paint as PA       # noqa: E402

WORK = os.path.join(TL.ROOT, 'bake', 'work', 'research3', 'MT')
BOX_OF = {'u_base': 'u_baseR', 'u_deco': 'u_decoR', 'u_t0': 'u_r0', 'u_t1': 'u_r1', 'u_t2': 'u_r2', 'u_s0': 'u_r0', 'u_s1': 'u_r1'}
RGBA_TEX = ['speedo', 'tacho', 'speedo_d', 'tacho_d', 'window', 'horizon', 'bar', 'range_seg', 'ed_seg', 'fuel', 'oil',
            'sign_limit', 'sign_nopass']
DIALS = ['speedo', 'tacho', 'speedo_d', 'tacho_d', 'fuel', 'oil']
PREMUL_OK = DIALS + ['window']        # sampled as mix(black, rgb, a): premultiplied opaque RGB gives the same frame


class Snap(PA.SnapZ):
    """A snapshot with its own texture overrides and editable layers (deep copies)."""
    def __init__(self, d, tag='base'):
        super().__init__(d)
        self.layers = copy.deepcopy(self.layers)
        self.by_key = {l['key']: l for l in self.layers}
        self.ovr = {}
        self.tag = tag
        self.dir = d + '#' + tag              # the renderer's texture cache key

    def pixels(self, key):
        if key in self.ovr:
            return self.ovr[key]
        l = self.by_key[key]
        f = os.path.join(self.pxdir, 'px', key.replace(':', '_') + '.z')
        if not os.path.exists(f):
            return None
        raw = np.frombuffer(zlib.decompress(open(f, 'rb').read()), dtype=np.uint8)
        return raw.reshape(l['ih'], l['iw'], 4)


class Renderer(RD.Renderer):
    def texture(self, snap, key):
        ck = (snap.dir, key)
        if ck not in self.texcache:
            px = snap.pixels(key)
            if px is None:
                return None
            px = RD.canvas_roundtrip(np.ascontiguousarray(px))
            t = self.ctx.texture((px.shape[1], px.shape[0]), 4, np.ascontiguousarray(px).tobytes())
            t.filter = (self.mgl.LINEAR, self.mgl.LINEAR)
            t.repeat_x = False
            t.repeat_y = False
            self.texcache[ck] = t
        return self.texcache[ck]

    def drop(self, snap):
        for ck in [k for k in self.texcache if k[0] == snap.dir]:
            self.texcache.pop(ck).release()


def frame(R, snap):
    c = R.compose(snap, region=(0, 0, 1920, 720), s=1, per_layer=False)
    bad = [l for l in c['layers'] if l.get('alpha') is None and l['kind'] == 'effect' and 'note' in l and l['note']]
    return c['prem'], c['alpha'], bad


def names_of(snap, H):
    """scene texture name -> [(asset key)] in this snapshot (by content)."""
    out = {}
    for k, sha in snap.meta.get('px_sha1', {}).items():
        n = H.get(sha)
        if n:
            out.setdefault(n, []).append(k)
    return out


def binders(snap, key):
    """[(layer, sampler)] that sample the asset `key`."""
    return [(l, s) for l in snap.layers if l['kind'] == 'effect' for s, k in (l.get('binds') or {}).items() if k == key]


def diff(P0, A0, P1, A1, rect=None):
    d = np.maximum(np.abs(P1 - P0).max(-1), np.abs(A1 - A0)) * 255.0
    out = {'max': round(float(d.max()), 2), 'px_gt2': int((d > 2).sum()), 'px_gt8': int((d > 8).sum()), 'px_gt16': int((d > 16).sum())}
    if rect:
        x0, y0, x1, y1 = rect
        r = d[y0:y1, x0:x1]
        out['mean_in_rect'] = round(float(r.mean()), 3)
        out['p99_in_rect'] = round(float(np.percentile(r, 99)), 2)
        p0 = np.concatenate([P0[y0:y1, x0:x1], A0[y0:y1, x0:x1, None]], -1) * 255.0
        p1 = np.concatenate([P1[y0:y1, x0:x1], A1[y0:y1, x0:x1, None]], -1) * 255.0
        mse = float(((p1 - p0) ** 2).mean())
        out['psnr_in_rect'] = round(10 * math.log10(255.0 ** 2 / mse), 2) if mse > 0 else None
        out['rect'] = rect
    return out, d


# ---------------------------------------------------------------- shader edits
def define(fs, name, vec):
    return '#define %s vec3(%s)\n' % (name, ', '.join('%.6f' % v for v in vec)) + fs


def patch_r8_base(l, tint, tint_red=None, red=None):
    fs = l['fs']
    if tint_red is None:
        fs = fs.replace('bs = texture2D(u_base, bu);', 'bs = vec4(texture2D(u_base, bu).r * MT_TINT, 1.0);')
    else:
        fs = fs.replace('bs = texture2D(u_base, bu);',
                        'bs = vec4(texture2D(u_base, bu).r * ((inSweep && frac >= u_redFrom - %.5f && d > %.4f * R) ? MT_TINTR : MT_TINT), 1.0);' % red)
        fs = define(fs, 'MT_TINTR', tint_red)
    l['fs'] = define(fs, 'MT_TINT', tint)


def patch_r8_deco(l):
    l['fs'] = l['fs'].replace('texture2D(u_deco, du).a', 'texture2D(u_deco, du).r')


def patch_r8_window(l, tint):
    l['fs'] = define(l['fs'].replace('vec4 t = texture2D(u_t0, u0);', 'vec4 t = vec4(texture2D(u_t0, u0).r * MT_TINT, 1.0);'), 'MT_TINT', tint)


def grow_box(l, sampler, w0, h0, w1, h1):
    """A texture padded from w0 x h0 to w1 x h1 texels: its box uniform grows by the same ratio (top-left fixed)."""
    u = l['uniforms'][BOX_OF[sampler]]
    x, y, w, h = u['v']
    u['v'] = [x, y, w * w1 / w0, h * h1 / h0]


# ---------------------------------------------------------------- texture variants
def premul_opaque(rgba):
    f = rgba.astype(np.float64)
    out = np.empty_like(rgba)
    out[..., :3] = np.clip(np.round(f[..., :3] * f[..., 3:4] / 255.0), 0, 255).astype(np.uint8)
    out[..., 3] = 255
    return out


def r8_of(L):
    """An R8 asset as the car samples it: (r, 0, 0, 1)."""
    o = np.zeros(L.shape + (4,), np.uint8)
    o[..., 0] = L
    o[..., 3] = 255
    return o


def red_region(l, w, h):
    """The tacho's baked red zone, as the shader can test it: inSweep && frac >= redFrom - eps && d > k R (texel centres)."""
    U = {k: v['v'] for k, v in l['uniforms'].items()}
    size = U['u_geo'][:2]
    bx, by, bw, bh = U['u_baseR']
    yy, xx = np.mgrid[0:h, 0:w]
    lx = bx + (xx + 0.5) * bw / w
    ly = by + (yy + 0.5) * bh / h
    px, py = lx - size[0] / 2, size[1] / 2 - ly
    R = min(size) / 2 - 1
    d = np.hypot(px, py)
    a = np.arctan2(px, py)
    start, sweep = U['u_scale'][0], U['u_scale'][1]
    rel = np.mod(a - start + 4 * np.pi, 2 * np.pi)
    frac = rel / sweep
    red_from = U['u_zone'][0]
    eps, k = 0.004, 0.70
    return (rel <= sweep + 0.012) & (frac >= red_from - eps) & (d > k * R), (eps, k)


def r8_tint(rgba, mask=None):
    """Premultiplied rgb ~= L * t (one tint), or two tints split by mask. -> L, t, t_red."""
    f = rgba.astype(np.float64) / 255.0
    pm = f[..., :3] * f[..., 3:4]

    def fit(sel):
        v = pm[sel]
        if not len(v) or not v.any():
            return np.array([1.0, 1.0, 1.0])
        _, _, vt = np.linalg.svd(v, full_matrices=False)
        t = np.abs(vt[0])
        L = v @ t / (t @ t)
        return t * max(L.max(), 1e-6)
    if mask is None:
        t = fit(np.ones(pm.shape[:2], bool))
        L = pm @ t / (t @ t)
        return np.clip(np.round(L * 255), 0, 255).astype(np.uint8), t, None
    t, tr = fit(~mask), fit(mask)
    L = np.where(mask, pm @ tr / (tr @ tr), pm @ t / (t @ t))
    return np.clip(np.round(L * 255), 0, 255).astype(np.uint8), t, tr


def pad4(rgba):
    h, w = rgba.shape[:2]
    H, W = (h + 3) // 4 * 4, (w + 3) // 4 * 4
    out = np.zeros((H, W, 4), np.uint8)
    out[:h, :w] = rgba
    return out


def etc2_padded(rgba, fmt, bleed=False):
    p = pad4(rgba)
    src = TL.bleed(p) if bleed else p
    import etcpak
    import texture2ddecoder as T
    H, W = p.shape[:2]
    if fmt == 'etc2rgba':
        data = etcpak.compress_etc2_rgba(src.tobytes(), W, H)
        dec = np.frombuffer(T.decode_etc2a8(data, W, H), np.uint8).reshape(H, W, 4)[..., [2, 1, 0, 3]].copy()
    else:
        data = etcpak.compress_etc2_rgb(src.tobytes(), W, H)
        dec = np.frombuffer(T.decode_etc2(data, W, H), np.uint8).reshape(H, W, 4)[..., [2, 1, 0, 3]].copy()
        dec[..., 3] = 255
    return dec, len(data)


# A variant: {texture name: function(snap, layerlist, rgba) -> (new rgba, fmt, w, h)} applied to every asset of that
# texture in the snapshot. The function may edit the layers that sample it.
def v_scale(s):
    def f(snap, users, rgba, name):
        h, w = rgba.shape[:2]
        W, H = max(1, int(round(w * s))), max(1, int(round(h * s)))
        if name in ('collar_r8', 'strip_mask'):          # R8: (r, r, r, r) as the bench page gives it; resized as one channel
            from PIL import Image
            a = np.asarray(Image.fromarray(rgba[..., 3]).resize((W, H), Image.BOX))
            return np.repeat(a[..., None], 4, -1), 'r8', W, H
        return TL.resize(rgba, W, H), 'rgba8', W, H
    return f


def v_etc2(fmt, premul=False, bleed=False):
    def f(snap, users, rgba, name):
        h, w = rgba.shape[:2]
        src = premul_opaque(rgba) if premul else rgba
        dec, nb = etc2_padded(src, fmt, bleed)
        for l, smp in users:
            grow_box(l, smp, w, h, dec.shape[1], dec.shape[0])
        return dec, fmt, dec.shape[1], dec.shape[0]
    return f


def v_premul(snap, users, rgba, name):
    h, w = rgba.shape[:2]
    return premul_opaque(rgba), 'rgba8', w, h


def v_r8_alpha(snap, users, rgba, name):
    for l, smp in users:
        patch_r8_deco(l)
    h, w = rgba.shape[:2]
    return r8_of(rgba[..., 3]), 'r8', w, h


def v_r8_tint(two=False):
    def f(snap, users, rgba, name):
        h, w = rgba.shape[:2]
        mask, red = (None, None)
        if two:
            mask, red = red_region(users[0][0], w, h)
        L, t, tr = r8_tint(rgba, mask)
        for l, smp in users:
            if smp == 'u_base':
                patch_r8_base(l, t, tr, red)
            elif smp == 'u_t0':
                patch_r8_window(l, t)
        return r8_of(L), 'r8', w, h
    return f


def value_chroma(rgba, k):
    """Premultiplied rgb = V * C: V = max(r, g, b) full size (R8), C = rgb / V (each <= 1) averaged V-weighted over k x k
    texels (RGBA8 at 1/k): luma at full resolution, colour at low resolution (chroma subsampling)."""
    f = rgba.astype(np.float64) / 255.0
    pm = f[..., :3] * f[..., 3:4]
    V = pm.max(-1)
    Vq = np.clip(np.round(V * 255), 0, 255).astype(np.uint8)
    h, w = V.shape
    H, W = (h + k - 1) // k, (w + k - 1) // k
    pp = np.zeros((H * k, W * k, 3))
    pp[:h, :w] = pm
    vv = np.zeros((H * k, W * k))
    vv[:h, :w] = V
    num = pp.reshape(H, k, W, k, 3).sum((1, 3))
    den = vv.reshape(H, k, W, k).sum((1, 3))
    C = np.where(den[..., None] > 1e-6, num / np.maximum(den[..., None], 1e-6), 1.0)
    C = np.clip(C, 0, 1)
    cm = np.zeros((H, W, 4), np.uint8)
    cm[..., :3] = np.clip(np.round(C * 255), 0, 255).astype(np.uint8)
    cm[..., 3] = 255
    return Vq, cm, (W * k, H * k)


def v_r8_chroma(k):
    def f(snap, users, rgba, name):
        h, w = rgba.shape[:2]
        V, cm, (cw, ch) = value_chroma(rgba, k)
        ck = 'mt:chroma:%s' % name
        snap.ovr[ck] = cm
        for l, smp in users:
            l['binds']['u_mtC'] = ck
            # the chroma map covers ceil(w / k) * k texels: its box in the base texture's uv is cw / w, ch / h
            l['fs'] = l['fs'].replace('uniform sampler2D u_base;', 'uniform sampler2D u_base;\nuniform sampler2D u_mtC;').replace(
                'bs = texture2D(u_base, bu);',
                'bs = vec4(texture2D(u_base, bu).r * texture2D(u_mtC, bu * vec2(%.6f, %.6f)).rgb, 1.0);' % (w / cw, h / ch))
        snap.extra = getattr(snap, 'extra', []) + [{'name': name + '.chroma', 'format': 'rgba8', 'w': cm.shape[1], 'h': cm.shape[0]}]
        return r8_of(V), 'r8', w, h
    return f


def v_share_dials(snap, users, rgba, name):
    """speedo / tacho = speedo_d / tacho_d with only their bottom-arc box replaced: modelled as the exact texture
    (lossless by construction); its cost is the extra patch texture, accounted separately."""
    h, w = rgba.shape[:2]
    return rgba, 'rgba8', w, h


def v_procedural(snap, users, rgba, name):
    """No baked texture: the shader's own drawing (WBDIAL kind 0, WBBACK u_hasTex 0) with a blank bound."""
    blank = [k for k, l in snap.by_key.items() if l['kind'] == 'asset' and l.get('iw') == 1 and l.get('ih') == 1]
    for l, smp in users:
        if smp == 'u_base':
            f = l['uniforms']['u_fill']['v']
            l['uniforms']['u_fill']['v'] = [f[0], f[1], 0, f[3]]
        elif smp in ('u_t0', 'u_t1', 'u_t2'):
            l['uniforms']['u_hasTex']['v'] = [0]
        if blank:
            l['binds'][smp] = blank[0]
    return None, None, 0, 0


VARIANTS = {}


def add(vid, group, desc, per_tex, states=('comfort', 'g20')):
    VARIANTS[vid] = {'group': group, 'desc': desc, 'per_tex': per_tex, 'states': list(states)}


def build_variants():
    # 1. format
    add('r8-segments', 'format', 'range_seg / ed_seg (white, alpha only) as R8: lossless, shader reads .r',
        {n: v_r8_alpha for n in ('range_seg', 'ed_seg')}, ('comfort',))
    add('r8-window', 'format', 'window as R8 premultiplied luma x one tint (WBBACK u_t0)', {'window': v_r8_tint()}, ('comfort',))
    for n in ('speedo', 'speedo_d', 'fuel', 'oil'):
        add('r8-' + n, 'format', '%s as R8 premultiplied luma x one tint' % n, {n: v_r8_tint()},
            ('g20',) if n.endswith('_d') else ('comfort',))
    for n in ('tacho', 'tacho_d'):
        add('r8-' + n, 'format', '%s as R8 luma x one tint' % n, {n: v_r8_tint()}, ('g20',) if n.endswith('_d') else ('comfort',))
        add('r8x2-' + n, 'format', '%s as R8 luma x two tints, the red one where the shader knows the red zone is' % n,
            {n: v_r8_tint(True)}, ('g20',) if n.endswith('_d') else ('comfort',))
    for n in ('collar_r8', 'strip_mask'):
        add('etc2rgba-' + n, 'compression', '%s (R8 mask) as etc2rgba, the mask in every channel' % n, {n: v_etc2('etc2rgba')}, ('g20',))
    for n in DIALS:
        for k in ((2, 4, 8) if n.startswith('tacho') else (4, 8)):
            add('r8c%d-%s' % (k, n), 'format', '%s as R8 value (max channel, premultiplied) + its colour at 1/%d size (RGBA8): chroma subsampling' % (n, k),
                {n: v_r8_chroma(k)}, ('g20',) if n.endswith('_d') else ('comfort',))
    for n in RGBA_TEX:
        st = ('g20',) if n.endswith('_d') else ('comfort-glass',) if n == 'bar' else ('comfort-nopass',) if n.startswith('sign') else ('comfort',)
        add('etc2rgba-' + n, 'compression', '%s as etc2rgba (etcpak), straight alpha' % n, {n: v_etc2('etc2rgba')}, st)
        if n in PREMUL_OK:
            add('etc2rgb-' + n, 'compression', '%s premultiplied, opaque, as etc2rgb (etcpak)' % n, {n: v_etc2('etc2rgb', True)}, st)
            add('premul-' + n, 'format', '%s premultiplied opaque RGBA8 (the identity check for the etc2rgb path)' % n, {n: v_premul}, st)
    # 3. resolution
    for n in RGBA_TEX:
        st = ('g20',) if n.endswith('_d') else ('comfort-glass',) if n == 'bar' else ('comfort-nopass',) if n.startswith('sign') else ('comfort',)
        for s in (0.5, 0.25):
            add('scale%g-%s' % (s, n), 'resolution', '%s at %g of its size, bilinear up in the shader' % (n, s), {n: v_scale(s)}, st)
    for n in ('collar_r8',):
        for s in (0.5,):
            add('scale%g-%s' % (s, n), 'resolution', '%s at %g of its size' % (n, s), {n: v_scale(s)}, ('g20',))
    # 5. procedural
    add('proc-dials', 'procedural', 'speedo / tacho without their baked base (WBDIAL draws its own comfort dial)',
        {'speedo': v_procedural, 'tacho': v_procedural}, ('comfort',))
    add('proc-window', 'procedural', 'window / horizon without textures (WBBACK draws its own comfort window)',
        {'window': v_procedural, 'horizon': v_procedural}, ('comfort',))
    # packages (combined)
    add('pkg-safe', 'package', 'R8 segments + R8 window + premultiplied etc2rgb for nothing (safe and cheap: lossless/near-lossless R8 only)',
        {'range_seg': v_r8_alpha, 'ed_seg': v_r8_alpha, 'window': v_r8_tint()}, ('comfort', 'comfort-night'))
    add('pkg-r8', 'package', 'everything R8 that can be: segments, window, speedo, fuel, oil (one tint), tacho (two tints)',
        {'range_seg': v_r8_alpha, 'ed_seg': v_r8_alpha, 'window': v_r8_tint(), 'speedo': v_r8_tint(), 'tacho': v_r8_tint(True),
         'speedo_d': v_r8_tint(), 'tacho_d': v_r8_tint(True), 'fuel': v_r8_tint(), 'oil': v_r8_tint()},
        ('comfort', 'comfort-night', 'g20', 'sport', 'eco'))
    add('pkg-etc2', 'package', 'dials, minis and window premultiplied etc2rgb; segments R8; signs, horizon etc2rgba',
        {'range_seg': v_r8_alpha, 'ed_seg': v_r8_alpha, 'window': v_etc2('etc2rgb', True), 'speedo': v_etc2('etc2rgb', True),
         'tacho': v_etc2('etc2rgb', True), 'speedo_d': v_etc2('etc2rgb', True), 'tacho_d': v_etc2('etc2rgb', True),
         'fuel': v_etc2('etc2rgb', True), 'oil': v_etc2('etc2rgb', True), 'horizon': v_etc2('etc2rgba'),
         'sign_limit': v_etc2('etc2rgba'), 'sign_nopass': v_etc2('etc2rgba')},
        ('comfort', 'comfort-night', 'comfort-nopass', 'g20', 'sport', 'eco'))
    add('pkg-all', 'package', 'everything texture-side: pkg-etc2 plus the G20 masks (collar, strip mask) etc2rgba',
        {'range_seg': v_r8_alpha, 'ed_seg': v_r8_alpha, 'window': v_etc2('etc2rgb', True), 'speedo': v_etc2('etc2rgb', True),
         'tacho': v_etc2('etc2rgb', True), 'speedo_d': v_etc2('etc2rgb', True), 'tacho_d': v_etc2('etc2rgb', True),
         'fuel': v_etc2('etc2rgb', True), 'oil': v_etc2('etc2rgb', True), 'horizon': v_etc2('etc2rgba'),
         'sign_limit': v_etc2('etc2rgba'), 'sign_nopass': v_etc2('etc2rgba'), 'collar_r8': v_etc2('etc2rgba'), 'strip_mask': v_etc2('etc2rgba')},
        ('comfort', 'comfort-nopass', 'g20', 'g20-bmw', 'sport', 'eco'))
    add('pkg-r8c', 'package', 'prototype A: segments R8, window R8 tint, the six dial textures R8 value + 1/4 colour',
        {'range_seg': v_r8_alpha, 'ed_seg': v_r8_alpha, 'window': v_r8_tint(), **{n: v_r8_chroma(4) for n in DIALS}},
        ('comfort', 'comfort-night', 'g20', 'sport', 'eco'))
    add('pkg-etc2rgba', 'package', 'every RGBA scene texture etc2rgba straight (no shader change but the padded boxes); segments R8',
        {**{n: v_etc2('etc2rgba') for n in RGBA_TEX if n not in ('range_seg', 'ed_seg')}, 'range_seg': v_r8_alpha, 'ed_seg': v_r8_alpha},
        ('comfort', 'comfort-nopass', 'g20', 'sport', 'eco'))


def run_variant(R, snaps_dir, vid, H, base_cache, images):
    v = VARIANTS[vid]
    res = {'id': vid, 'group': v['group'], 'desc': v['desc'], 'states': {}}
    for st in v['states']:
        d = os.path.join(snaps_dir, st)
        if not os.path.exists(d):
            continue
        if st not in base_cache:
            b = Snap(d, 'base')
            P0, A0, bad0 = frame(R, b)
            base_cache[st] = (P0, A0, bad0)
        P0, A0, bad0 = base_cache[st]
        s = Snap(d, vid)
        names = names_of(s, H)
        assets = []
        rects = []
        for name, fn in v['per_tex'].items():
            for key in names.get(name, []):
                users = binders(s, key)
                rgba = s.pixels(key)
                if name in ('collar_r8', 'strip_mask'):
                    rgba = rgba.copy()
                new, fmt, w, h = fn(s, users, rgba, name)
                if new is not None:
                    s.ovr[key] = new
                    assets.append({'name': name, 'key': key, 'format': fmt, 'w': w, 'h': h,
                                   'bytes': TL.raw_bytes(fmt, w, h), 'pixel_memory': TL.pixel_memory(fmt, w, h),
                                   'bytes_before': TL.raw_bytes('rgba8' if s.by_key[key].get('format') != 'r8' else 'r8', rgba.shape[1], rgba.shape[0]),
                                   'pixel_memory_before': TL.pixel_memory('rgba8' if s.by_key[key].get('format') != 'r8' else 'r8', rgba.shape[1], rgba.shape[0])})
                for l, _ in users:
                    rects.append((l['x'], l['y'], l['x'] + l['w'], l['y'] + l['h']))
        for e in getattr(s, 'extra', []):
            assets.append({'name': e['name'], 'key': None, 'format': e['format'], 'w': e['w'], 'h': e['h'],
                           'bytes': TL.raw_bytes(e['format'], e['w'], e['h']), 'pixel_memory': TL.pixel_memory(e['format'], e['w'], e['h']),
                           'bytes_before': 0, 'pixel_memory_before': 0})
        if not rects:
            continue
        P1, A1, bad1 = frame(R, s)
        x0, y0 = max(0, min(r[0] for r in rects)), max(0, min(r[1] for r in rects))
        x1, y1 = min(1920, max(r[2] for r in rects)), min(720, max(r[3] for r in rects))
        m, dimg = diff(P0, A0, P1, A1, [int(x0), int(y0), int(x1), int(y1)])
        m['not_drawn'] = [b['key'] + ': ' + b['note'] for b in bad1 if b not in bad0] or None
        uniq = {}
        for a in assets:
            uniq.setdefault((a['name'], a['format'], a['w'], a['h']), a)
        res['states'][st] = {'diff': m, 'assets': list(uniq.values()),
                             'bytes_before': sum(a['bytes_before'] for a in uniq.values()), 'bytes_after': sum(a['bytes'] for a in uniq.values()),
                             'pixel_memory_before': sum(a['pixel_memory_before'] for a in uniq.values()),
                             'pixel_memory_after': sum(a['pixel_memory'] for a in uniq.values())}
        if images:
            from PIL import Image
            os.makedirs(os.path.join(WORK, 'diffs'), exist_ok=True)
            Image.fromarray(np.clip(dimg * 8, 0, 255).astype(np.uint8)).save(os.path.join(WORK, 'diffs', '%s__%s.png' % (vid, st)))
            img = np.clip(np.round(P1 * 255), 0, 255).astype(np.uint8)
            Image.fromarray(img).save(os.path.join(WORK, 'diffs', '%s__%s.frame.png' % (vid, st)))
        R.drop(s)
    return res


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    snaps = args[0] if args else os.path.join(WORK, 'snaps', 'base')
    out = args[1] if len(args) > 1 else os.path.join(WORK, 'experiments.json')
    only = None
    if '--only' in sys.argv:
        only = sys.argv[sys.argv.index('--only') + 1].split(',')
    images = '--images' in sys.argv
    build_variants()
    H = AC.scene_hashes()
    R = Renderer()
    base_cache = {}
    if images:
        from PIL import Image
        os.makedirs(os.path.join(WORK, 'diffs'), exist_ok=True)
    results = {}
    if os.path.exists(out) and only:
        results = json.load(open(out))
    for vid in VARIANTS:
        if only and not any(re.fullmatch(o.replace('*', '.*'), vid) for o in only):
            continue
        r = run_variant(R, snaps, vid, H, base_cache, images)
        results[vid] = r
        for st, x in r['states'].items():
            dm = x['diff']
            print('%-24s %-14s bytes %9d -> %9d  pm %9d -> %9d  max %6.1f  >8: %7d  >16: %6d  psnr %s  %s' % (
                vid, st, x['bytes_before'], x['bytes_after'], x['pixel_memory_before'], x['pixel_memory_after'], dm['max'],
                dm['px_gt8'], dm['px_gt16'], dm.get('psnr_in_rect'), dm['not_drawn'] or ''), flush=True)
    if images:
        from PIL import Image
        for st, (P0, A0, _) in base_cache.items():
            Image.fromarray(np.clip(np.round(P0 * 255), 0, 255).astype(np.uint8)).save(os.path.join(WORK, 'diffs', 'base__%s.frame.png' % st))
    json.dump(results, open(out, 'w'), indent=1)
    print('->', out)


if __name__ == '__main__':
    main()
