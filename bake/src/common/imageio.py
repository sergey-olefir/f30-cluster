"""PNG I/O with straight (non-premultiplied) alpha, dithering, half-res variants, the memory formula.

Conventions: images in memory are float32 arrays 0..1, RGBA straight alpha, shape (h, w, 4), sRGB-encoded colour.
"""
import json
import os
import numpy as np
from PIL import Image


def bytes_by_8wh(w, h):
    """The theme's pixel-memory formula (brief §3): every image counted twice -> w*h*8 bytes."""
    return int(w) * int(h) * 8


def dither_quantise(x, seed=0):
    """float 0..1 -> uint8 with +-0.5 LSB triangular (TPDF) dither: no banding in slow gradients."""
    rng = np.random.default_rng(seed)
    n = rng.random(x.shape) - rng.random(x.shape)            # triangular in -1..1
    return np.clip(np.floor(np.asarray(x, np.float64) * 255.0 + 0.5 + n * 0.5), 0, 255).astype(np.uint8)


def to_uint8(x, dither=True, seed=0):
    if dither:
        return dither_quantise(x, seed)
    return np.clip(np.floor(np.asarray(x, np.float64) * 255.0 + 0.5), 0, 255).astype(np.uint8)


def rgba(color, alpha):
    """Constant straight-alpha colour (r, g, b in 0..1) with an alpha map (h, w) -> (h, w, 4) float."""
    h, w = alpha.shape
    out = np.empty((h, w, 4), np.float32)
    out[..., :3] = np.asarray(color, np.float32)
    out[..., 3] = alpha
    return out


def write_png(path, img, dither=True, seed=0):
    """img float (h,w,4) straight alpha (or (h,w,3) / (h,w)); colour of fully transparent pixels is set to the
    nearest-meaningful value (kept as given) - straight alpha, never premultiplied."""
    os.makedirs(os.path.dirname(os.path.abspath(path)) or ".", exist_ok=True)
    a = np.asarray(img)
    if a.dtype != np.uint8:
        a = to_uint8(a, dither=dither, seed=seed)
    if a.ndim == 3 and a.shape[2] == 1:
        a = a[..., 0]
    Image.fromarray(a).save(path, optimize=True)        # L / RGB / RGBA inferred from the shape
    return path


def read_png(path):
    """-> float32 (h, w, 4) RGBA straight alpha 0..1 (RGB / L promoted, alpha 1)."""
    im = Image.open(path)
    im = im.convert("RGBA")
    return np.asarray(im, dtype=np.float32) / 255.0


def half_res(img):
    """Exact 2x2 box downscale of a straight-alpha image (done premultiplied, returned straight). Odd sizes padded."""
    a = np.asarray(img, np.float32)
    h, w = a.shape[:2]
    if h % 2 or w % 2:
        a = np.pad(a, ((0, h % 2), (0, w % 2), (0, 0)), mode="edge")
    pm = a.copy()
    pm[..., :3] *= pm[..., 3:4]
    s = pm.reshape(a.shape[0] // 2, 2, a.shape[1] // 2, 2, 4).mean(axis=(1, 3))
    al = s[..., 3:4]
    s[..., :3] = np.where(al > 1e-6, s[..., :3] / np.maximum(al, 1e-6), 0.0)
    return s


def upscale2(img, w, h):
    """Bilinear 2x upscale back to (w, h) the way the GPU would sample a @0.5x layer (premultiplied)."""
    import cv2
    a = np.asarray(img, np.float32).copy()
    a[..., :3] *= a[..., 3:4]
    u = cv2.resize(a, (w, h), interpolation=cv2.INTER_LINEAR)
    al = u[..., 3:4]
    u[..., :3] = np.where(al > 1e-6, u[..., :3] / np.maximum(al, 1e-6), 0.0)
    return u


def tight_crop(img, thresh=1.0 / 255.0):
    """Crop to the bbox of alpha > thresh. Returns (cropped, x0, y0)."""
    al = img[..., 3]
    ys, xs = np.nonzero(al > thresh)
    if len(xs) == 0:
        return img[:1, :1], 0, 0
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    return img[y0:y1, x0:x1], int(x0), int(y0)


def over(dst, src, x, y):
    """Alpha-over (straight alpha, sRGB-encoded maths like cluster-render's normal blending) of src onto dst
    (both float (h,w,4)) at panel offset x, y. In place on dst; returns dst."""
    H, W = dst.shape[:2]
    h, w = src.shape[:2]
    x0, y0 = max(0, x), max(0, y)
    x1, y1 = min(W, x + w), min(H, y + h)
    if x1 <= x0 or y1 <= y0:
        return dst
    s = src[y0 - y:y1 - y, x0 - x:x1 - x]
    d = dst[y0:y1, x0:x1]
    sa = s[..., 3:4]
    da = d[..., 3:4]
    oa = sa + da * (1 - sa)
    oc = np.where(oa > 1e-6, (s[..., :3] * sa + d[..., :3] * da * (1 - sa)) / np.maximum(oa, 1e-6), 0)
    d[..., :3] = oc
    d[..., 3:4] = oa
    return dst


def manifest_entry(**kw):
    """Small helper: returns a dict with bytes_by_8wh filled from w/h (and scale) - see bake/manifest/schema.json."""
    e = dict(kw)
    if "w" in e and "h" in e:
        s = e.get("scale", 1.0)
        e["bytes_by_8wh"] = bytes_by_8wh(round(e["w"] * s), round(e["h"] * s))
    return e


def write_json(path, obj):
    os.makedirs(os.path.dirname(os.path.abspath(path)) or ".", exist_ok=True)
    with open(path, "w") as f:
        json.dump(obj, f, indent=1)
        f.write("\n")
