"""research3 MT: the inventory of f30_cluster's scene textures, every measurement made on the texture itself.

    UV_CACHE_DIR=bake/work/.uvcache uv run -q --no-project --with numpy --with pillow --with etcpak --with texture2ddecoder \\
        python -I tools/research3/mt/inventory.py [out.json]

Per texture: size, format, bytes (one upload, the package's base64 JSON, cluster-render's pixel memory), where it is
sampled (layouts, shader, sampler, condition), its alpha (empty / opaque / soft and the box of what is not empty),
its colour (constant, grey, one tint), entropy and zlib / PNG size, mirror and radial symmetry, and its texture-space
error under each candidate encoding (half, quarter size; R8 luma + tint; ETC2 RGBA / RGB). The error the driver sees
is measured in the rendered frame by tools/research3/mt/experiments.py; this file only says which textures qualify.
"""
import io
import json
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import texlib as TL   # noqa: E402

# Where each texture is sampled (read off shared/hud.js _create / _sceneNeeds / _wbUses and the layouts; the bench's
# asset lists in tools/research3/mt/accounting.py confirm it per state).
USES = {
    'speedo': [('wb_comfort', 'speedo', 'WBDIAL u_base (kind 3: the whole static dial)', 'always')],
    'tacho': [('wb_comfort', 'tacho', 'WBDIAL u_base (kind 3)', 'always')],
    'speedo_d': [('wb_dials', 'speedo', 'WBDIAL u_base (kind 3)', 'always')],
    'tacho_d': [('wb_dials', 'tacho', 'WBDIAL u_base (kind 3)', 'always')],
    'window': [('wb_comfort', 'bg', 'WBBACK u_t0 (the middle window and the bar under it, half size)', 'while BMW\'s map is not shown in the window (stockMap off)')],
    'horizon': [('wb_comfort', 'bg', 'WBBACK u_t1 (the horizon line)', 'while BMW\'s map is not shown in the window (stockMap off)')],
    'bar': [('wb_comfort', 'bg', 'WBBACK u_t2 (the glass foot line)', 'only with wbFoot "glass" (default "hair": never uploaded)')],
    'range_seg': [('wb_comfort', 'speedo', 'WBDIAL u_deco (bottom arc segments, alpha only)', 'always')],
    'ed_seg': [('wb_comfort', 'tacho', 'WBDIAL u_deco (bottom arc segments, alpha only)', 'always')],
    'fuel': [(l, 'fuel', 'WBDIAL u_base (mini, kind 1)', 'always') for l in ('wb_comfort', 'wb_dials', 'wb_sport', 'wb_eco')],
    'oil': [(l, 'oilt', 'WBDIAL u_base (mini, kind 1)', 'always') for l in ('wb_comfort', 'wb_dials', 'wb_sport', 'wb_eco')],
    'sign_limit': [(l, 'signs', 'WBSIGN u_s0', 'always (shown while a limit is known)') for l in ('wb_comfort', 'wb_dials', 'wb_sport')],
    'sign_nopass': [(l, 'signs', 'WBSIGN u_s1', 'always (shown while overtaking is banned)') for l in ('wb_comfort', 'wb_dials', 'wb_sport')],
    'collar_r8': [('wb_dials', 'bg', 'WBBACK u_t0 (collar coverage, R8)', 'always')],
    'strip_mask': [('wb_dials', 'bg', 'WBBACK u_t2 (strip mask lanes, R8, nearest)', 'always')],
    'collar': [],
    'cover': [],
}
NOTES = {
    'collar': 'not sampled by any layout since package M (collar_r8 replaced it); still in the package',
    'cover': 'not sampled by any layout since package M (the strip mask draws that black); still in the package',
    'bar': 'sampled only when the foot line is "glass"; the layouts ship "hair"',
}


def alpha_stats(a):
    n = a.size
    nz = np.argwhere(a > 0)
    box = [int(nz[:, 1].min()), int(nz[:, 0].min()), int(nz[:, 1].max()) + 1, int(nz[:, 0].max()) + 1] if len(nz) else None
    return {'empty': round(float((a == 0).mean()), 4), 'opaque': round(float((a == 255).mean()), 4),
            'soft': round(float(((a > 0) & (a < 255)).mean()), 4), 'box': box,
            'box_area_frac': round((box[2] - box[0]) * (box[3] - box[1]) / n, 4) if box else 0}


def colour_stats(rgba):
    a = rgba[..., 3]
    m = a > 0
    rgb = rgba[..., :3][m].astype(np.int32)
    if not len(rgb):
        return {'visible_px': 0}
    chroma = rgb.max(1) - rgb.min(1)
    uniq = np.unique(rgb, axis=0)
    t, L, _ = TL.tint_fit(rgba)
    # the R8 + tint reconstruction, premultiplied, against the texture's own premultiplied colour
    f = rgba.astype(np.float64) / 255.0
    pm = f[..., :3] * f[..., 3:4]
    rec = (L.astype(np.float64) / 255.0)[..., None] * t[None, None, :]
    err = np.abs(rec - pm)[m] * 255.0
    w = a[m].astype(np.float64) / 255.0
    return {'visible_px': int(m.sum()), 'unique_rgb': int(len(uniq)), 'rgb_constant': bool(len(uniq) == 1),
            'rgb_value': [int(x) for x in uniq[0]] if len(uniq) == 1 else None,
            'chroma_p50': int(np.percentile(chroma, 50)), 'chroma_p99': int(np.percentile(chroma, 99)), 'chroma_max': int(chroma.max()),
            'chroma_gt8_frac': round(float((chroma > 8).mean()), 4),
            'chroma_gt8_weighted': round(float(((chroma > 8) * w).sum() / max(w.sum(), 1e-9)), 4),
            'tint': [round(float(x), 4) for x in t],
            'r8_tint_err_max': round(float(err.max()), 1), 'r8_tint_err_mean': round(float(err.mean()), 3),
            'r8_tint_err_gt4_frac': round(float((err.max(1) > 4).mean()), 4)}


def entropy(b):
    h = np.bincount(np.frombuffer(b, np.uint8), minlength=256).astype(np.float64)
    p = h[h > 0] / h.sum()
    return round(float(-(p * np.log2(p)).sum()), 3)


def png_size(rgba, r8):
    from PIL import Image
    im = Image.fromarray(rgba[..., 0] if r8 else rgba, 'L' if r8 else 'RGBA')
    b = io.BytesIO()
    im.save(b, 'PNG', optimize=True)
    return len(b.getvalue())


def symmetry(rgba):
    f = rgba.astype(np.float64) / 255.0
    pm = np.concatenate([f[..., :3] * f[..., 3:4], f[..., 3:4]], -1) * 255.0
    out = {}
    for name, g in (('mirror_lr', pm[:, ::-1]), ('mirror_ud', pm[::-1])):
        d = np.abs(pm - g).max(-1)
        m = (pm[..., 3] > 0) | (g[..., 3] > 0)
        out[name] = {'mean': round(float(d[m].mean()), 2) if m.any() else 0, 'le4_frac': round(float((d[m] <= 4).mean()), 4) if m.any() else 1}
    h, w = rgba.shape[:2]
    if abs(h - w) <= 2 and h >= 100:
        yy, xx = np.mgrid[0:h, 0:w]
        r = np.sqrt((xx + 0.5 - w / 2) ** 2 + (yy + 0.5 - h / 2) ** 2)
        ri = np.round(r).astype(int)
        prof = np.zeros((ri.max() + 1, 4))
        for c in range(4):
            prof[:, c] = np.bincount(ri.ravel(), pm[..., c].ravel()) / np.maximum(np.bincount(ri.ravel()), 1)
        d = np.abs(pm - prof[ri]).max(-1)
        m = pm[..., 3] > 0
        out['radial'] = {'le4_frac': round(float((d[m] <= 4).mean()), 4), 'mean': round(float(d[m].mean()), 2),
                         'profile_bytes_rgba8': int(prof.shape[0] * 4)}
    return out


def variants(name, rgba, r8):
    h, w = rgba.shape[:2]
    out = {}
    for s in (0.5, 0.25):
        W, H = max(1, int(round(w * s))), max(1, int(round(h * s)))
        sm = TL.resize(rgba, W, H)
        back = TL.resize(sm, w, h)
        fmt = 'r8' if r8 else 'rgba8'
        out['scale_%g' % s] = {'w': W, 'h': H, 'bytes': TL.raw_bytes(fmt, W, H), 'pixel_memory': TL.pixel_memory(fmt, W, H),
                               'tex_err_upsampled': TL.tex_err(rgba, back)}
    if not r8:
        t, L, _ = TL.tint_fit(rgba)
        out['r8_tint'] = {'bytes': TL.raw_bytes('r8', w, h), 'pixel_memory': TL.pixel_memory('r8', w, h), 'tint': [round(float(x), 4) for x in t]}
        # R8 alpha only (when the colour is constant: the coverage textures)
        for fmt in ('etc2rgba', 'etc2rgb'):
            dec, nb = TL.etc2(rgba, fmt)
            out[fmt] = {'bytes': nb, 'pixel_memory': TL.pixel_memory(fmt, w, h), 'tex_err': TL.tex_err(rgba, dec)}
    return out


def pair(a, b, flip=False):
    A, _ = TL.load(a)
    B, _ = TL.load(b)
    if flip:
        B = B[:, ::-1]
    if A.shape != B.shape:
        return None
    d = np.abs(A.astype(int) - B.astype(int)).max(-1)
    nz = np.argwhere(d > 0)
    box = [int(nz[:, 1].min()), int(nz[:, 0].min()), int(nz[:, 1].max()) + 1, int(nz[:, 0].max()) + 1] if len(nz) else None
    return {'a': a, 'b': b, 'flipped': flip, 'identical_frac': round(float((d == 0).mean()), 4),
            'le4_frac': round(float((d <= 4).mean()), 4), 'diff_box': box,
            'diff_box_area_frac': round((box[2] - box[0]) * (box[3] - box[1]) / d.size, 4) if box else 0}


def main():
    out_path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(TL.ROOT, 'bake', 'work', 'research3', 'MT', 'inventory.json')
    names = sorted(f[:-5] for f in os.listdir(TL.SCENE) if f.endswith('.json'))
    tex = {}
    for n in names:
        rgba, j = TL.load(n)
        r8 = j.get('format') == 'r8'
        fmt = 'r8' if r8 else 'rgba8'
        h, w = rgba.shape[:2]
        raw = rgba[..., 0].tobytes() if r8 else rgba.tobytes()
        e = {'name': n, 'w': w, 'h': h, 'format': fmt, 'sampling': j.get('sampling', 'bilinear'),
             'bytes_upload': TL.raw_bytes(fmt, w, h), 'pixel_memory': TL.pixel_memory(fmt, w, h),
             'bytes_package_json': os.path.getsize(os.path.join(TL.SCENE, n + '.json')),
             'zlib9': TL.zsize(raw), 'png': png_size(rgba, r8), 'entropy_bits_per_byte': entropy(raw),
             'uses': [{'layout': u[0], 'widget': u[1], 'sampler': u[2], 'when': u[3]} for u in USES.get(n, [])],
             'note': NOTES.get(n), 'alpha': alpha_stats(rgba[..., 3])}
        if not r8:
            e['colour'] = colour_stats(rgba)
            e['channels'] = {c: {'min': int(rgba[..., i].min()), 'max': int(rgba[..., i].max())} for i, c in enumerate('rgba')}
        e['symmetry'] = symmetry(rgba)
        e['variants'] = variants(n, rgba, r8)
        tex[n] = e
        print('%-12s %4dx%-4d %-5s %8d B  pm %8d  zlib %7d  png %7d' % (n, w, h, fmt, e['bytes_upload'], e['pixel_memory'], e['zlib9'], e['png']), flush=True)
    pairs = [pair('speedo', 'speedo_d'), pair('tacho', 'tacho_d'), pair('fuel', 'oil'), pair('fuel', 'oil', True),
             pair('sign_limit', 'sign_nopass'), pair('speedo', 'tacho')]
    json.dump({'textures': tex, 'pairs': [p for p in pairs if p]}, open(out_path, 'w'), indent=1)
    print('->', out_path)


if __name__ == '__main__':
    main()
