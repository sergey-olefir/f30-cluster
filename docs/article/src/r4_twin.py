"""Revision 4: Twin Dial's face, one byte per pixel, and what the shader makes of it.
Left: the shipped R8 face (apps/twin_dial/hud/scene/face_tacho.json) as stored. Middle: the same bytes decoded by
tools/twin-dial/face_shade.py, the numpy reference the GPU shader (shaders.js TDIAL) equals to 0.000 codes outside the
needle (docs/twin-dial/r3b/B1-REPORT.md). Right: the materials by radius.

Usage: python -I r4_twin.py <repo> <images_dir>   -> twin-r8-face_{uk,en}.png"""
import json
import math
import os
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
REPO, OUT = sys.argv[1:3]
sys.path.insert(0, os.path.join(REPO, 'tools', 'twin-dial'))

import numpy as np                                     # noqa: E402
from PIL import Image, ImageDraw                        # noqa: E402

import r4common as rc                                  # noqa: E402
import face_shade as fs                                # noqa: E402

L = {
    'uk': {
        'title': 'Twin Dial: один байт на піксель, колір додає шейдер',
        'raw': 'R8 як зберігається: 616 × 560, 337 КБ, 0,66 MiB у пам\'яті',
        'dec': 'ті самі байти після декодування (numpy-еталон шейдера)',
        'mat': 'Матеріал визначає радіус ρ = r/R і сам байт g:',
        'rows': [
            ('ρ 0,5795–0,9375', 'смуга шкали: тонування 0,76 : 1 : 1,064 (лінійне світло)'),
            ('ρ 0,893–0,9375', 'смуга поділок: власне тонування (98, 109, 111), код 109'),
            ('ρ 0,924–0,934', 'світла лінія смуги, код 124'),
            ('ρ ≥ 0,975', 'обідок: завжди «чорнило»; червоний від червоної зони'),
            ('ρ 0,544 ± 0,004', 'внутрішній обідок'),
            ('g ≥ 0,70…0,85', '«чорнило»: поділки, цифри, підписи (код 255)'),
        ],
        'law': 'Яскравість смуги, запечена в байт: Y = 0,0188·e^(4,60(ρ−0,60))·e^(0,59(1−cos θ))',
        'red': 'Червоне від 6500 об/хв не запечене: його кут — uniform, тож зміна налаштування не потребує нової текстури.',
    },
    'en': {
        'title': 'Twin Dial: one byte per pixel, the shader adds the colour',
        'raw': 'R8 as stored: 616 × 560, 337 KB, 0.66 MiB in memory',
        'dec': 'the same bytes decoded (the shader\'s numpy reference)',
        'mat': 'The material follows from the radius ρ = r/R and the byte g:',
        'rows': [
            ('ρ 0.5795–0.9375', 'scale band: tint 0.76 : 1 : 1.064 (linear light)'),
            ('ρ 0.893–0.9375', 'tick strip: its own tint (98, 109, 111), code 109'),
            ('ρ 0.924–0.934', 'the strip\'s bright line, code 124'),
            ('ρ ≥ 0.975', 'bezel: always "ink"; red from the red zone on'),
            ('ρ 0.544 ± 0.004', 'inner rim'),
            ('g ≥ 0.70…0.85', '"ink": ticks, numerals, labels (code 255)'),
        ],
        'law': 'The band\'s brightness, baked into the byte: Y = 0.0188·e^(4.60(ρ−0.60))·e^(0.59(1−cos θ))',
        'red': 'The red from 6500 rpm is not baked: its angle is a uniform, so changing the setting needs no new texture.',
    },
}


def main():
    face = rc.scene_rgba(REPO, 'twin_dial', 'face_tacho')
    reg = json.load(open(os.path.join(REPO, 'apps', 'twin_dial', 'hud', 'scene', 'face_tacho.regions.json')))
    col = fs.shade(face, reg, redline_rpm=6500.0)
    h, w = face.shape
    for lang in ('uk', 'en'):
        t = L[lang]
        W, H = 1960, 800
        im = Image.new('RGB', (W, H), rc.BG)
        pen = rc.Pen(REPO, im)
        pen.text((40, 30), t['title'], 36, bold=True)
        s = 0.98
        tw, th = int(w * s), int(h * s)
        for i, (arr, lab) in enumerate(((np.stack([face] * 3, -1), t['raw']), (col, t['dec']))):
            x = 40 + i * (tw + 30)
            pen.text((x, 92), lab, 19, rc.TXT, True)
            im.paste(Image.fromarray(arr).resize((tw, th), Image.LANCZOS), (x, 126))
            pen.d.rectangle((x - 1, 125, x + tw, 126 + th), outline=rc.LINE, width=1)
        # radius guides on the raw face
        cx, cy, R = 40 + reg['centre_face_px'][0] * s, 126 + reg['centre_face_px'][1] * s, reg['R_px'] * s
        cols = [rc.AMBER, rc.BLUE, rc.VIOLET, rc.RED, rc.GREEN]
        for (rr, c) in zip((0.5795, 0.893, 0.929, 0.99, 0.544), cols):
            a0 = -90 - 143
            pen.d.arc((cx - rr * R, cy - rr * R, cx + rr * R, cy + rr * R), a0, -90 + 143, fill=c, width=2)
        x0 = 40 + 2 * (tw + 30)
        pen.text((x0, 92), t['mat'], 19, rc.TXT, True)
        y = 136
        for i, (a, b) in enumerate(t['rows']):
            c = (cols + [rc.TXT])[i]
            pen.d.rectangle((x0, y + 4, x0 + 18, y + 22), fill=c)
            pen.text((x0 + 30, y), a, 18, c, True)
            pen.text((x0 + 30, y + 26), b, 16, rc.TXT)
            y += 66
        # the byte histogram (log), the codes that carry meaning marked
        hb = np.bincount(face.ravel(), minlength=256).astype(np.float64)
        hx0, hy0, hx1, hy1 = x0, y + 20, W - 40, y + 210
        pen.d.rectangle((hx0, hy0, hx1, hy1), outline=rc.LINE, width=1)
        lg = np.log10(hb + 1)
        for v in range(256):
            bx = hx0 + (hx1 - hx0) * (v + 0.5) / 256
            bh = (hy1 - hy0 - 6) * lg[v] / lg.max()
            pen.d.line((bx, hy1, bx, hy1 - bh), fill=(120, 128, 140), width=2)
        for v, c in ((6, rc.TXT), (47, rc.TXT), (109, rc.BLUE), (124, rc.VIOLET), (227, rc.TXT), (255, rc.TXT)):
            bx = hx0 + (hx1 - hx0) * (v + 0.5) / 256
            pen.text((bx, hy1 + 6), str(v), 14, c, anchor='ma')
        pen.text((hx0, hy0 - 22), 'log₁₀(кількість пікселів) за значенням байта' if lang == 'uk' else 'log₁₀(pixel count) by byte value', 15, rc.DIM)
        pen.text((40, 126 + th + 20), t['law'], 19)
        pen.text((40, 126 + th + 52), t['red'], 18, rc.DIM)
        im.save(os.path.join(OUT, 'twin-r8-face_%s.png' % lang))
    print('ok', face.shape, len(face.tobytes()))


if __name__ == '__main__':
    main()
