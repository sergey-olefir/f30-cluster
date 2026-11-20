"""tools/shots/acc/shots.py - ACC View's map-target pictures and the contact sheet (round 1120 AA2).

    node tools/shots/acc/shots.js
    UV_CACHE_DIR=$F30/bake/work/.uvcache uv run -q --no-project --with pillow --with numpy --with moderngl \
        python tools/shots/acc/shots.py [<dir>]          (default bake/work/r1120/acc-app)

For each map/<state>.json that shots.js wrote: the lane and the car rendered by the app's own effect shaders
(apps/acc_view/shaders, through tools/acc-view/lane_gl.py: GLSL ES 1.00 shimmed to 4.10 on the Mac's GPU, 3 x 3 samples a
pixel) with the uniforms main.js sends, then the two image sheets over them, in z order, on the black 1088 x 480 map
target -> map/<state>.png. Then contact.png: every state, the centre page and the map target's core (x 334..754,
y 44..416), day and night.
"""
import base64
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'acc-view'))
from lane_gl import GL  # noqa: E402

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'bake', 'work', 'r1120', 'acc-app')


def over(dst, src, x, y):
    h, w = src.shape[:2]
    x0, y0, x1, y1 = max(0, x), max(0, y), min(dst.shape[1], x + w), min(dst.shape[0], y + h)
    if x1 <= x0 or y1 <= y0:
        return
    s = src[y0 - y:y1 - y, x0 - x:x1 - x]
    a = s[..., 3:4]
    dst[y0:y1, x0:x1] = dst[y0:y1, x0:x1] * (1 - a) + s[..., :3] * a


def uni(u):
    out = {}
    for k, v in u.items():
        if k == 'u_size':
            continue
        out[k] = [tuple(v[i:i + 4]) for i in range(0, len(v), 4)] if len(v) > 4 else tuple(v)
    return out


def main():
    gl = GL()
    mdir = os.path.join(OUT, 'map')
    names = sorted(f[:-5] for f in os.listdir(mdir) if f.endswith('.json'))
    for n in names:
        d = json.load(open(os.path.join(mdir, n + '.json')))
        img = np.zeros((480, 1088, 3), np.float32)
        x, y, w, h = d['lane']['rect']
        over(img, gl.render('acc_lane', w, h, uni(d['lane']['u']), ss=3), x, y)
        over(img, gl.render('acc_obj', w, h, uni(d['obj']['u']), ss=3), x, y)
        if d['car']:
            x, y, w, h = d['car']['rect']
            over(img, gl.render('acc_car', w, h, uni(d['car']['u']), ss=4), x, y)
        x, y, w, h = d['ego']['rect']
        over(img, gl.render('acc_car', w, h, uni(d['ego']['u']), ss=4), x, y)
        for k in ('text', 'pill'):
            x, y, w, h = d[k]['rect']
            px = np.frombuffer(base64.b64decode(d[k]['px']), np.uint8).reshape(h, w, 4).astype(np.float32) / 255.0
            over(img, px, x, y)
        Image.fromarray((np.clip(img, 0, 1) * 255 + 0.5).astype('uint8')).save(os.path.join(mdir, n + '.png'))
    # the contact sheet: a row per state: centre day, centre night (0.4), map core day, map core night (0.56)
    font = ImageFont.truetype(os.path.join(ROOT, 'tools', 'fonts-src', 'NotoSans-wght.subset.ttf'), 22)
    states = sorted(set(n.rsplit('_', 1)[0] for n in names))
    cw, ch = 640, 208
    mw, mh = 235, 208
    W, RH = 40 + 2 * (cw + 16) + 2 * (mw + 16), ch + 36
    sheet = Image.new('RGB', (W, 60 + RH * len(states)), (40, 42, 46))
    dr = ImageDraw.Draw(sheet)
    dr.text((20, 16), 'ACC View 0.1.0 - direction E: centre page day / night, map target core day / night (14 states, 7 scenes)', fill=(230, 230, 230), font=font)
    for i, st in enumerate(states):
        y = 60 + i * RH
        dr.text((20, y), st, fill=(200, 200, 200), font=font)
        x = 40
        for night in ('day', 'night'):
            c = Image.open(os.path.join(OUT, 'centre', st + '_' + night + '.png')).convert('RGB').resize((cw, ch), Image.LANCZOS)
            sheet.paste(c, (x, y + 30))
            x += cw + 16
        for night in ('day', 'night'):
            m = Image.open(os.path.join(mdir, st + '_' + night + '.png')).crop((334, 44, 754, 416)).resize((mw, mh), Image.LANCZOS)
            sheet.paste(m, (x, y + 30))
            x += mw + 16
    sheet.save(os.path.join(OUT, 'contact.png'))
    print('%d map pictures and contact.png in %s' % (len(names), os.path.relpath(OUT, ROOT)))


if __name__ == '__main__':
    main()
