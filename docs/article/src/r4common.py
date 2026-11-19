"""Shared helpers for the revision-4 pictures (our own drawings and renders only).
Imported by the r4_*.py scripts (each adds this folder to sys.path itself, since they run with python -I)."""
import base64
import json
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFont

BG = (17, 19, 23)
PANEL = (28, 31, 37)
LINE = (88, 96, 110)
TXT = (232, 235, 240)
DIM = (150, 158, 170)
RED = (226, 58, 52)
AMBER = (240, 170, 10)
GREEN = (70, 175, 90)
BLUE = (80, 150, 235)
VIOLET = (165, 120, 235)

_FONT = {}


def font(repo, size, bold=False):
    key = (size, bold)
    if key not in _FONT:
        f = ImageFont.truetype(os.path.join(repo, 'tools', 'fonts-src', 'Arimo[wght].ttf'), size)
        try:
            f.set_variation_by_name('Bold' if bold else 'Regular')
        except Exception:
            pass
        _FONT[key] = f
    return _FONT[key]


class Pen:
    def __init__(self, repo, im):
        self.repo, self.im, self.d = repo, im, ImageDraw.Draw(im)

    def text(self, xy, s, size=24, fill=TXT, bold=False, anchor='la'):
        self.d.text(xy, s, font=font(self.repo, size, bold), fill=fill, anchor=anchor)

    def lines(self, xy, rows, size=22, fill=TXT, bold_first=False, gap=1.3):
        x, y = xy
        for i, r in enumerate(rows):
            self.text((x, y), r, size, fill if (i == 0 or not bold_first) else DIM, bold_first and i == 0)
            y += int(size * gap)
        return y

    def width(self, s, size, bold=False):
        return self.d.textlength(s, font=font(self.repo, size, bold))


def scene_rgba(repo, app, name):
    """A baked scene texture (apps/<app>/hud/scene/<name>.json) as uint8 (h, w, 4) or (h, w) for R8."""
    d = json.load(open(os.path.join(repo, 'apps', app, 'hud', 'scene', name + '.json')))
    w, h = d['w'], d['h']
    if 'rgba' in d:
        return np.frombuffer(base64.b64decode(d['rgba']), np.uint8).reshape(h, w, 4).copy()
    return np.frombuffer(base64.b64decode(d['r8']), np.uint8).reshape(h, w).copy()


def over_black(rgba, boost=1.0):
    """Straight-alpha RGBA (uint8 or float 0..1) over black, optional brightness boost -> RGB uint8."""
    a = rgba.astype(np.float32)
    if a.max() > 1.5:
        a = a / 255.0
    rgb = a[..., :3] * a[..., 3:4] * boost
    return (np.clip(rgb, 0, 1) * 255 + 0.5).astype(np.uint8)


def over(dst, src):
    """float straight alpha over float straight alpha (same shape), in place on dst."""
    sa, da = src[..., 3:4], dst[..., 3:4]
    oa = sa + da * (1 - sa)
    dst[..., :3] = (src[..., :3] * sa + dst[..., :3] * da * (1 - sa)) / np.maximum(oa, 1e-6)
    dst[..., 3:4] = oa


def frame(d, box, col=LINE, w=2):
    d.rectangle(box, outline=col, width=w)
