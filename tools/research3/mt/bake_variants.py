"""research3 MT prototypes: the lighter encodings of f30_cluster's scene textures, beside today's files.

    UV_CACHE_DIR=bake/work/.uvcache uv run -q --no-project --with numpy --with pillow --with etcpak \\
        python -I tools/research3/mt/bake_variants.py

Writes apps/f30_cluster/hud/scene/<name>@r8.json, <name>@r8c.json and <name>@etc2.json from the RGBA8 <name>.json
(nothing is re-rendered: every variant is a re-encoding of today's pixels). shared/hud.js reads them only while
app.json config.sceneTex is "r8" or "etc2" (off by default: null).

  "r8" (prototype A, the Twin Dial technique carried further), every format the car already draws:
    range_seg, ed_seg   R8 alpha (they are white with a soft coverage: lossless)            enc "a8"
    window              R8 of its premultiplied colour over one tint (max error 2.7 / 255)   enc "tint", "tint": [r, g, b]
    speedo, tacho, speedo_d, tacho_d, fuel, oil
                        R8 value (max channel of the premultiplied colour, full size) + its colour at a quarter of the size
                        (<name>@r8c.json, RGBA8, V-weighted mean of colour / value): chroma subsampling. The dial shaders
                        mix over a black face, so premultiplied colour alone is the whole picture      enc "v8"
  "etc2" (prototype B): cluster-render's compressed format (PROTOCOL.md: etc2rgb, 8 bytes a 4 x 4 block, charged once to
    the pixel memory, sent whole once). The dials, the minis and the window premultiplied over black and opaque, padded to
    multiples of 4 ("src": the size before padding; the engine grows the box uniform by the same ratio)   enc "pm"
    (range_seg / ed_seg take their "@r8" file in this mode too)
Encoder: etcpak (BSD); its output is checked by decoding it again (texture2ddecoder) when that is installed.
"""
import base64
import json
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import texlib as TL   # noqa: E402

DIALS = ['speedo', 'tacho', 'speedo_d', 'tacho_d', 'fuel', 'oil']
CHROMA_K = 4


def premul(rgba):
    f = rgba.astype(np.float64) / 255.0
    return f[..., :3] * f[..., 3:4]


def write(name, obj):
    p = os.path.join(TL.SCENE, name + '.json')
    json.dump(obj, open(p, 'w'), separators=(',', ':'))
    return os.path.getsize(p)


def b64(a):
    return base64.b64encode(np.ascontiguousarray(a).tobytes()).decode('ascii')


def value_chroma(rgba):
    pm = premul(rgba)
    V = pm.max(-1)
    h, w = V.shape
    W, H = (w + CHROMA_K - 1) // CHROMA_K, (h + CHROMA_K - 1) // CHROMA_K
    # area-weighted means over each chroma texel's footprint (exactly w / W texels wide): colour = sum(rgb) / sum(V)
    num = [np.asarray(Image.fromarray(pm[..., c].astype(np.float32)).resize((W, H), Image.BOX)) for c in range(3)]
    den = np.asarray(Image.fromarray(V.astype(np.float32)).resize((W, H), Image.BOX))
    C = np.stack([np.where(den > 1e-6, n / np.maximum(den, 1e-6), 1.0) for n in num], -1)
    cm = np.zeros((H, W, 4), np.uint8)
    cm[..., :3] = np.clip(np.round(np.clip(C, 0, 1) * 255), 0, 255).astype(np.uint8)
    cm[..., 3] = 255
    return np.clip(np.round(V * 255), 0, 255).astype(np.uint8), cm


def tint(rgba):
    pm = premul(rgba)
    v = pm.reshape(-1, 3)
    _, _, vt = np.linalg.svd(v[v.any(1)], full_matrices=False)
    t = np.abs(vt[0])
    L = v @ t / (t @ t)
    t = t * L.max()
    L = pm @ t / (t @ t)
    return np.clip(np.round(L * 255), 0, 255).astype(np.uint8), [round(float(x), 6) for x in t]


def etc2rgb(rgba):
    import etcpak
    h, w = rgba.shape[:2]
    H, W = (h + 3) // 4 * 4, (w + 3) // 4 * 4
    src = np.zeros((H, W, 4), np.uint8)
    src[:h, :w, :3] = np.clip(np.round(premul(rgba) * 255), 0, 255).astype(np.uint8)
    src[..., 3] = 255
    data = etcpak.compress_etc2_rgb(src.tobytes(), W, H)
    assert len(data) == (W // 4) * (H // 4) * 8
    err = None
    try:
        import texture2ddecoder as T
        dec = np.frombuffer(T.decode_etc2(data, W, H), np.uint8).reshape(H, W, 4)[..., [2, 1, 0]].astype(int)
        err = int(np.abs(dec - src[..., :3].astype(int)).max())
    except ImportError:
        pass
    return data, W, H, err


def main():
    total = {}
    for n in ('range_seg', 'ed_seg'):
        rgba, _ = TL.load(n)
        assert (rgba[..., :3][rgba[..., 3] > 0] == 255).all(), n + ' is not white'
        h, w = rgba.shape[:2]
        total[n + '@r8'] = write(n + '@r8', {'w': w, 'h': h, 'format': 'r8', 'enc': 'a8', '_about': n + '.json\'s alpha as R8 (research3 MT)', 'r8': b64(rgba[..., 3])})
    rgba, _ = TL.load('window')
    L, t = tint(rgba)
    h, w = rgba.shape[:2]
    total['window@r8'] = write('window@r8', {'w': w, 'h': h, 'format': 'r8', 'enc': 'tint', 'tint': t,
                                             '_about': 'window.json premultiplied over black, as R8 over one tint (research3 MT)', 'r8': b64(L)})
    for n in DIALS:
        rgba, _ = TL.load(n)
        h, w = rgba.shape[:2]
        V, cm = value_chroma(rgba)
        total[n + '@r8'] = write(n + '@r8', {'w': w, 'h': h, 'format': 'r8', 'enc': 'v8', 'chroma': n + '@r8c',
                                             '_about': n + '.json premultiplied over black: its value (max channel) as R8; the colour in ' + n + '@r8c (research3 MT)',
                                             'r8': b64(V)})
        total[n + '@r8c'] = write(n + '@r8c', {'w': cm.shape[1], 'h': cm.shape[0], 'enc': 'chroma',
                                               '_about': 'the colour of ' + n + '@r8 at 1/%d size (research3 MT)' % CHROMA_K, 'rgba': b64(cm)})
    for n in DIALS + ['window']:
        rgba, _ = TL.load(n)
        h, w = rgba.shape[:2]
        data, W, H, err = etc2rgb(rgba)
        total[n + '@etc2'] = write(n + '@etc2', {'w': W, 'h': H, 'src': [w, h], 'format': 'etc2rgb', 'enc': 'pm',
                                                 '_about': n + '.json premultiplied over black, opaque, etc2rgb (etcpak; research3 MT); decode error max %s' % err,
                                                 'etc2': base64.b64encode(data).decode('ascii')})
    for k, v in sorted(total.items()):
        print('%-16s %8d bytes on disk' % (k, v))
    print('total', sum(total.values()))


if __name__ == '__main__':
    main()
