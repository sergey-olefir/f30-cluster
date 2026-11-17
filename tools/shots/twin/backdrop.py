"""tools/shots/twin: BMW's own parts of the G20 cluster, drawn as bold stand-ins, under and over our layers.

The browser bench draws the stock cluster with bench/g20/g20sim.js (our own drawings fitted to car photos); the gallery
renders without a browser, so this is its headless counterpart for the parts SPEC 3.3 names, at the SPEC's own numbers:

  under us (seen only where we are see-through):
    belt group     [497, 660, 688, 720]      saturated cyan box with two belt marks
    side lamps     seven boxes (box + 3 px)  alternating amber / green / blue boxes with a dot
    message panel  zc.panel (the window polygon eroded 3 px), drawn only while the car shows a message: a grey panel
                   with the words BMW MESSAGE PANEL (so "half" of it under our text is obvious)
  over us (BMW draws the gear letter over a theme):
    gear letter    [1398, 668, 1424, 703]    a big yellow letter, inside the gap of [1380, 660, 1460, 720]

They are not BMW's artwork (no photo, no maker's bitmap): boxes at measured places. A pixel of ours that lands on one is a
leak, and the colour says which. Needs numpy and Pillow.
"""
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', '..', 'strip', 'O'))
import twin_audit as TA   # noqa: E402

W, H = 1920, 720
LAMP_COL = [(255, 176, 0), (60, 220, 90), (60, 140, 255), (255, 176, 0), (255, 60, 60), (60, 220, 90), (60, 140, 255)]


def _font(size):
    for p in ('/System/Library/Fonts/Supplemental/Arial Bold.ttf', '/System/Library/Fonts/Helvetica.ttc', '/Library/Fonts/Arial.ttf'):
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                pass
    return ImageFont.load_default()


def under(message_shown):
    """RGB float (H, W, 3): what BMW's parts look like beneath us."""
    g = TA.geometry()
    im = Image.new('RGB', (W, H), (0, 0, 0))
    d = ImageDraw.Draw(im)
    x0, y0, x1, y1 = g['belt']
    d.rectangle([x0, y0, x1 - 1, y1 - 1], fill=(0, 200, 255))
    for k in range(3):
        d.line([x0 + 20, y0 + 12 + k * 14, x1 - 20, y0 + 12 + k * 14], fill=(0, 60, 90), width=3)
    for i, (a, b, c, e) in enumerate(g['lamps']):
        d.rectangle([a, b, c - 1, e - 1], fill=LAMP_COL[i % len(LAMP_COL)])
        cx, cy = (a + c) // 2, (b + e) // 2
        d.ellipse([cx - 6, cy - 6, cx + 6, cy + 6], fill=(20, 20, 20))
    if message_shown:
        panel = TA.polygon_mask(g['polygon'], 3)
        arr = np.asarray(im).copy()
        arr[panel] = (70, 78, 90)
        im = Image.fromarray(arr)
        d = ImageDraw.Draw(im)
        ys, xs = np.where(panel)
        d.text(((xs.min() + xs.max()) // 2, (ys.min() + ys.max()) // 2), 'BMW MESSAGE PANEL', font=_font(30), fill=(240, 240, 240), anchor='mm')
    return np.asarray(im).astype(np.float32) / 255.0


def over(img, letter='D'):
    """BMW's gear letter, drawn over everything (img float (H, W, 3), changed in place)."""
    im = Image.fromarray(np.round(np.clip(img, 0, 1) * 255).astype(np.uint8))
    d = ImageDraw.Draw(im)
    d.text((1411, 686), letter, font=_font(46), fill=(255, 215, 0), anchor='mm')
    return np.asarray(im).astype(np.float32) / 255.0
