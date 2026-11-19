"""Revision 4: two baked one-byte-per-pixel assets of f30_cluster, as stored.
Top: the bottom strip's R8 mask atlas (apps/f30_cluster/hud/scene/strip_mask.json, tools/strip/bake_mask.py), its
lanes as the JSON names them. Bottom: the message font's glyph atlas (apps/f30_cluster/hud/fonts/wb_msg.json,
tools/bake_fonts.py): coverage bytes the car blits, it never rasterises a font.

Usage: python -I r4_masks.py <repo> <images_dir>   -> masks-glyphs_{uk,en}.png"""
import base64
import json
import os
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
REPO, OUT = sys.argv[1:3]

import numpy as np                                     # noqa: E402
from PIL import Image                                  # noqa: E402

import r4common as rc                                  # noqa: E402

L = {
    'uk': {
        'title': 'Байт на піксель: маска нижньої смуги і атлас гліфів',
        'm': 'Маска смуги: R8 1908 × 353, 1,28 MiB у пам\'яті; доріжки стану рядка (перемикання — один uniform)',
        'lanes': {'ours': 'доріжка «наш» (0, 0): наш чорний над рядком BMW', 'bmw': 'доріжка «BMW» і «очікування» (0, 124)',
                  'msg': 'доріжка «повідомлення» (0, 248): дірка на панель BMW, множиться останньою'},
        'key': 'світле = байт 255: наш чорний закриває рядок BMW (у доріжці повідомлення — «залишити»); темне = 0: видно BMW',
        'f': 'Атлас шрифту повідомлень wb_msg: Roboto 35 px, 1024 × 276 байтів покриття, %d гліфів (кирилиця, «», ʼ, №)',
        'foot': 'Обидва файли — JSON із base64: пакет застосунку тримає лише JSON, а авто не потребує ні декодера PNG, ні растеризатора шрифтів.',
    },
    'en': {
        'title': 'One byte per pixel: the bottom strip\'s mask and a glyph atlas',
        'm': 'The strip mask: R8 1908 × 353, 1.28 MiB in memory; one lane per row state (a switch is one uniform)',
        'lanes': {'ours': 'lane "ours" (0, 0): our black over BMW\'s row', 'bmw': 'lane "BMW" and "standby" (0, 124)',
                  'msg': 'lane "message" (0, 248): the hole onto BMW\'s panel, multiplied in last'},
        'key': 'light = byte 255: our black covers BMW\'s row (in the message lane: "keep"); dark = 0: BMW shows',
        'f': 'The message font\'s atlas wb_msg: Roboto 35 px, 1024 × 276 coverage bytes, %d glyphs (Cyrillic, «», ʼ, №)',
        'foot': 'Both files are JSON with base64: the app package holds JSON only, and the car needs neither a PNG decoder nor a font rasteriser.',
    },
}


def main():
    sm = json.load(open(os.path.join(REPO, 'apps', 'f30_cluster', 'hud', 'scene', 'strip_mask.json')))
    mask = np.frombuffer(base64.b64decode(sm['r8']), np.uint8).reshape(sm['h'], sm['w'])
    fj = json.load(open(os.path.join(REPO, 'apps', 'f30_cluster', 'hud', 'fonts', 'wb_msg.json')))
    atlas = np.frombuffer(base64.b64decode(fj['alpha']), np.uint8).reshape(fj['height'], fj['width'])
    for lang in ('uk', 'en'):
        t = L[lang]
        W = 1960
        mw = W - 80
        mh = int(sm['h'] * mw / sm['w'])
        aw = 1024 + 0
        H = 96 + 40 + mh + 70 + 40 + 276 * 1 + 120
        im = Image.new('RGB', (W, H), rc.BG)
        pen = rc.Pen(REPO, im)
        pen.text((40, 30), t['title'], 34, bold=True)
        pen.text((40, 96), t['m'], 19, rc.TXT, True)
        y0 = 132
        vis = np.stack([mask] * 3, -1).astype(np.float32)
        vis = vis * np.array([0.95, 0.80, 0.45])                       # amber-tinted so black reads as black
        im.paste(Image.fromarray(vis.astype(np.uint8)).resize((mw, mh), Image.LANCZOS), (40, y0))
        pen.d.rectangle((39, y0 - 1, 40 + mw, y0 + mh), outline=rc.LINE, width=1)
        s = mw / sm['w']
        for key, ly in (('ours', 0), ('bmw', 124), ('msg', 248)):
            yy = y0 + ly * s
            pen.d.line((40, yy, 40 + mw, yy), fill=rc.BLUE, width=2)
            pen.text((50 if key != 'msg' else 40 + 540 * s + 20, yy + 6), t['lanes'][key], 17, rc.BLUE, True)
        pen.text((40, y0 + mh + 12), t['key'], 17, rc.DIM)
        ya = y0 + mh + 60
        pen.text((40, ya), t['f'] % len(fj['glyphs']), 19, rc.TXT, True)
        im.paste(Image.fromarray(atlas), (40, ya + 34))
        pen.d.rectangle((39, ya + 33, 40 + aw, ya + 34 + atlas.shape[0]), outline=rc.LINE, width=1)
        pen.text((40, ya + 34 + atlas.shape[0] + 24), t['foot'], 18, rc.DIM)
        im.save(os.path.join(OUT, 'masks-glyphs_%s.png' % lang))
    print('ok', mask.shape, atlas.shape, len(fj['glyphs']))


if __name__ == '__main__':
    main()
