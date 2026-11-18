"""research3 MT: shared helpers for the texture measurements (numpy, pillow; etcpak / texture2ddecoder for ETC2).

Reads f30_cluster's scene textures (apps/f30_cluster/hud/scene/<name>.json: {w, h, rgba | r8: base64}) and makes the
variants the options of docs/research3/MT-REPORT.md propose. Every variant is returned as RGBA8 (straight alpha), the
way the replay (tools/strip/O/render.py) and the bench page sample it, so a variant drops into a snapshot unchanged.
"""
import base64
import json
import os
import zlib

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
SCENE = os.path.join(ROOT, 'apps', 'f30_cluster', 'hud', 'scene')


def load(name):
    """-> (rgba uint8 (h, w, 4), meta). An R8 texture comes back as the bench page sees it: (r, r, r, r)."""
    j = json.load(open(os.path.join(SCENE, name + '.json')))
    if j.get('format') == 'r8':
        a = np.frombuffer(base64.b64decode(j['r8']), np.uint8).reshape(j['h'], j['w'])
        rgba = np.repeat(a[..., None], 4, -1)
    else:
        rgba = np.frombuffer(base64.b64decode(j['rgba']), np.uint8).reshape(j['h'], j['w'], 4).copy()
    return rgba, j


def raw_bytes(fmt, w, h):
    """Bytes of one whole upload of an asset of that format (cluster-render PROTOCOL.md: etc2rgba 16 B, etc2rgb 8 B a
    4x4 block, w and h padded to multiples of 4)."""
    if fmt in ('etc2rgba', 'etc2rgb'):
        return ((w + 3) // 4) * ((h + 3) // 4) * (16 if fmt == 'etc2rgba' else 8)
    return w * h * (1 if fmt == 'r8' else 4)


def pixel_memory(fmt, w, h):
    """cluster-render's accounting: uncompressed assets count twice their bytes, compressed ones once."""
    b = raw_bytes(fmt, w, h)
    return b if fmt.startswith('etc2') else 2 * b


def b64_json_bytes(fmt, w, h):
    """The scene file on disk / in the package today: base64 of the raw bytes (4/3) plus a little JSON."""
    return 4 * ((raw_bytes(fmt, w, h) + 2) // 3) + 40


# ---------------------------------------------------------------- variants
def resize(rgba, w, h):
    """Premultiplied box/bilinear resize (PIL), back to straight alpha: what tools/bake_scene.py's up() does."""
    from PIL import Image
    f = rgba.astype(np.float32) / 255.0
    pm = f.copy()
    pm[..., :3] *= pm[..., 3:4]
    chans = [np.asarray(Image.fromarray(pm[..., i]).resize((w, h), Image.BOX if w < rgba.shape[1] else Image.BILINEAR))
             for i in range(4)]
    o = np.stack(chans, -1)
    o[..., :3] = np.where(o[..., 3:4] > 1e-4, o[..., :3] / np.maximum(o[..., 3:4], 1e-4), 0)
    return np.clip(np.round(o * 255.0), 0, 255).astype(np.uint8)


def luma(rgb):
    return rgb[..., 0] * 0.299 + rgb[..., 1] * 0.587 + rgb[..., 2] * 0.114


def tint_fit(rgba):
    """The best single tint t (rgb) for rgb ~= L * t, L one byte a pixel (Twin Dial's R8 + tint): least squares over
    the pixels' premultiplied colour. -> (t, L uint8, rgb error stats)."""
    f = rgba.astype(np.float64) / 255.0
    a = f[..., 3]
    c = f[..., :3] * a[..., None]
    m = a > 0
    if not m.any():
        return np.ones(3), np.zeros(rgba.shape[:2], np.uint8), {}
    v = c[m]
    # t = principal direction of the premultiplied colours (through 0), scaled so max L = 1
    u, s, vt = np.linalg.svd(v, full_matrices=False)
    t = np.abs(vt[0])
    L = v @ t / (t @ t)
    k = L.max() if L.max() > 0 else 1.0
    t = t * k
    Lf = np.zeros(rgba.shape[:2])
    Lf[m] = (v @ t) / (t @ t)
    return t, np.clip(np.round(Lf * 255), 0, 255).astype(np.uint8), None


def etc2(rgba, fmt='etc2rgba'):
    """-> (decoded rgba uint8 at the padded size cut back to (h, w), bytes). etcpak's encoder (the best of the two
    open ones here; tools/etc2_test/etc2_encode.py upstream is the other); texture2ddecoder decodes."""
    import etcpak
    import texture2ddecoder as T
    h, w = rgba.shape[:2]
    H, W = (h + 3) // 4 * 4, (w + 3) // 4 * 4
    pad = np.zeros((H, W, 4), np.uint8)
    pad[:h, :w] = rgba
    # alpha-0 texels: their colour never shows straight, but bilinear filtering of straight alpha mixes it in at the
    # edges; give them their nearest visible neighbour's colour (bleed) so the encoder does not spend bits on black
    src = bleed(pad)
    if fmt == 'etc2rgba':
        data = etcpak.compress_etc2_rgba(src.tobytes(), W, H)
        dec = np.frombuffer(T.decode_etc2a8(data, W, H), np.uint8).reshape(H, W, 4)
    else:
        data = etcpak.compress_etc2_rgb(src.tobytes(), W, H)
        dec = np.frombuffer(T.decode_etc2(data, W, H), np.uint8).reshape(H, W, 4)
    dec = dec[..., [2, 1, 0, 3]].copy()      # texture2ddecoder gives BGRA
    if fmt == 'etc2rgb':
        dec[..., 3] = 255
    return dec[:h, :w], len(data)


def bleed(rgba, iters=8):
    """Copy colour into alpha-0 texels from visible neighbours (a few dilation steps); alpha unchanged."""
    out = rgba.copy()
    have = out[..., 3] > 0
    col = out[..., :3].astype(np.float32)
    for _ in range(iters):
        if have.all():
            break
        acc = np.zeros_like(col)
        n = np.zeros(have.shape, np.float32)
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            sh = np.roll(np.roll(have, dy, 0), dx, 1)
            sc = np.roll(np.roll(col, dy, 0), dx, 1)
            acc += sc * sh[..., None]
            n += sh
        new = (~have) & (n > 0)
        col[new] = acc[new] / n[new][:, None]
        have = have | new
    out[..., :3] = np.clip(np.round(col), 0, 255).astype(np.uint8)
    return out


def zsize(b, level=9):
    return len(zlib.compress(bytes(b), level))


def tex_err(a, b):
    """Texture-space error of two straight RGBA8 images, measured as what they put over black (premultiplied rgb) and
    their alpha: max and mean abs (0..255), PSNR of the premultiplied rgb."""
    fa, fb = a.astype(np.float64), b.astype(np.float64)
    pa = fa[..., :3] * fa[..., 3:4] / 255.0
    pb = fb[..., :3] * fb[..., 3:4] / 255.0
    d = np.abs(pa - pb)
    da = np.abs(fa[..., 3] - fb[..., 3])
    mse = float((d ** 2).mean())
    return {'max_rgb': round(float(d.max()), 2), 'mean_rgb': round(float(d.mean()), 3), 'max_a': round(float(da.max()), 2),
            'mean_a': round(float(da.mean()), 3), 'psnr': round(10 * np.log10(255.0 ** 2 / mse), 2) if mse > 0 else None}
