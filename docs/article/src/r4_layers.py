"""Revision 4: f30_cluster Comfort as an exploded stack of planes, from the shipped bytes.
Planes, bottom to top:
  1. BMW's own scene (grey placeholders: no BMW artwork);
  2. the backdrop effect (WBBACK, connection 0): black, with the baked window, horizon and bar line textures
     (apps/f30_cluster/hud/scene/window, horizon, bar; positions from hud/layouts/wb_comfort.json);
  3. the dial effects' baked bases (WBDIAL samplers: speedo, tacho 670x670, fuel, oil 144x144) and the bottom arcs'
     segment masks;
  4. what the live shader code and the text sheets add on top: the pixels where the bench frame of 0.7.21 differs from
     planes 2+3 composed (needles, hubs, arc fills, numerals, texts, signs) - an extraction for the picture, not a layer
     of the app.

Usage: python -I r4_layers.py <repo> <images_dir> <f30 bench render 1920x720>   -> layers-exploded_{uk,en}.png"""
import os
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
REPO, OUT, BENCH = sys.argv[1:4]

import numpy as np                                     # noqa: E402
from PIL import Image, ImageDraw, ImageFilter          # noqa: E402

import r4common as rc                                  # noqa: E402


def place(canvas, rgba, x, y, w=None, h=None):
    a = rgba.astype(np.float32) / 255.0
    if w is not None and (w, h) != (a.shape[1], a.shape[0]):
        pm = a.copy(); pm[..., :3] *= pm[..., 3:4]
        im = [Image.fromarray(pm[..., i]).resize((w, h), Image.BILINEAR) for i in range(4)]
        pm = np.stack([np.asarray(i) for i in im], -1)
        pm[..., :3] = np.where(pm[..., 3:4] > 1e-4, pm[..., :3] / np.maximum(pm[..., 3:4], 1e-4), 0)
        a = pm
    H, W = canvas.shape[:2]
    hh, ww = a.shape[:2]
    x0, y0, x1, y1 = max(x, 0), max(y, 0), min(x + ww, W), min(y + hh, H)
    sub = canvas[y0:y1, x0:x1]
    rc.over(sub, a[y0 - y:y1 - y, x0 - x:x1 - x])


def coeffs(src, dst):
    A, B = [], []
    for (x, y), (u, v) in zip(dst, src):
        A.append([x, y, 1, 0, 0, 0, -u * x, -u * y]); B.append(u)
        A.append([0, 0, 0, x, y, 1, -v * x, -v * y]); B.append(v)
    return list(np.linalg.solve(np.array(A, float), np.array(B, float)))


def plane(img, W, H, x0, y0, w, skew):
    sw, sh = img.size
    h = int(w * 0.30)
    dst = [(x0 + skew, y0), (x0 + w + skew, y0), (x0 + w, y0 + h), (x0, y0 + h)]
    return img.transform((W, H), Image.PERSPECTIVE, coeffs([(0, 0), (sw, 0), (sw, sh), (0, sh)], dst), Image.BICUBIC), dst


L = {
    'uk': {
        'title': 'f30_cluster Comfort, розкладений на площини (з байтів випущеної 0.7.21)',
        'p': [
            (['4. Живий код і тексти', 'стрілки, осі, смуга перевищення, заповнення', 'дуг (у шейдерах WBDIAL); цифри й підписи —', 'аркуші гліфів (з\'єднання 1 і 2)'], rc.GREEN),
            (['3. Запечені основи циферблатів', 'speedo, tacho 670×670 RGBA: по 3,42 MiB;', 'fuel, oil 144×144; маски дуг 346×68/70', 'їх семплює шейдер WBDIAL (з\'єднання 0)'], rc.AMBER),
            (['2. Тло WBBACK (з\'єднання 0, z 0)', 'чорне; вікно 320×286 (половинний розмір),', 'горизонт 424×10, лінія 584×79;', 'вікно на панель повідомлень BMW'], rc.BLUE),
            (['1. Сцена BMW', 'штатні шкали, лампи, рядок, панель', 'повідомлень (сірі заглушки, не графіка BMW)'], rc.LINE),
        ],
        'foot': 'Разом у стабільному стані 11,41 MiB «пам\'яті пікселів» (рахується двічі) і 21 шар на 3 з\'єднаннях. Площина 4 — різниця кадру бенча і площин 2–3, лише для ілюстрації.',
    },
    'en': {
        'title': 'f30_cluster Comfort taken apart into planes (from the bytes of the released 0.7.21)',
        'p': [
            (['4. Live code and texts', 'needles, hubs, over-speed band, arc fills', '(in the WBDIAL shaders); numerals and labels:', 'glyph sheets (connections 1 and 2)'], rc.GREEN),
            (['3. The dials\' baked bases', 'speedo, tacho 670×670 RGBA: 3.42 MiB each;', 'fuel, oil 144×144; arc masks 346×68/70', 'sampled by the WBDIAL shader (connection 0)'], rc.AMBER),
            (['2. The WBBACK backdrop (connection 0, z 0)', 'black; window 320×286 (half size),', 'horizon 424×10, line 584×79;', 'a window onto BMW\'s message panel'], rc.BLUE),
            (['1. BMW\'s scene', 'stock scales, lamps, row, message panel', '(grey placeholders, not BMW artwork)'], rc.LINE),
        ],
        'foot': 'Settled: 11.41 MiB of "pixel memory" (counted twice) and 21 layers on 3 connections. Plane 4 is the bench frame minus planes 2–3, for the picture only.',
    },
}


def main():
    sc = lambda n: rc.scene_rgba(REPO, 'f30_cluster', n)                    # noqa: E731
    back = np.zeros((720, 1920, 4), np.float32)
    back[..., 3] = 1.0
    place(back, sc('window'), 640, 76, 640, 572)
    place(back, sc('horizon'), 748, 452)
    place(back, sc('bar'), 668, 602)
    # the message panel window (layout "cc" box, the opaque layouts): see-through
    m = Image.new('L', (1920, 720), 255)
    ImageDraw.Draw(m).rounded_rectangle((699, 600, 1223, 701), 18, fill=0)
    back[..., 3] *= np.asarray(m, np.float32) / 255.0
    bases = np.zeros((720, 1920, 4), np.float32)
    place(bases, sc('speedo'), 77, 45)
    place(bases, sc('tacho'), 1173, 45)
    place(bases, sc('fuel'), 8, 536)
    place(bases, sc('oil'), 1768, 536)
    # baked composite (2 + 3) as the app draws it before any live code: for the difference
    comp = back.copy()
    rc.over(comp, bases)
    comp_rgb = comp[..., :3] * comp[..., 3:4]
    bench = np.asarray(Image.open(BENCH).convert('RGB').resize((1920, 720)), np.float32) / 255.0
    diff = (bench - comp_rgb).max(-1)              # what the live code ADDS (its shading-only darkening is left out)
    live_a = np.clip((diff - 0.10) / 0.10, 0, 1)
    live_a = np.asarray(Image.fromarray((live_a * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(3)), np.float32) / 255.0
    live = np.concatenate([bench, live_a[..., None]], -1)
    # BMW's scene placeholder (as in the revision-3 layer-stack diagram)
    bmw = Image.new('RGBA', (1920, 720), (34, 36, 42, 255))
    bd = ImageDraw.Draw(bmw)
    for cx in (480, 1440):
        for r, wd in ((300, 6), (250, 3)):
            bd.ellipse((cx - r, 380 - r, cx + r, 380 + r), outline=(110, 116, 128), width=wd)
    bd.rounded_rectangle((760, 160, 1160, 560), 30, fill=(48, 56, 66))
    bd.rounded_rectangle((699, 600, 1223, 701), 18, fill=(70, 74, 82), outline=(200, 200, 200), width=4)
    for x, y in ((600, 690), (1410, 685), (1868, 238)):
        bd.ellipse((x - 18, y - 18, x + 18, y + 18), fill=(200, 60, 50))
    to_img = lambda a: Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8), 'RGBA')   # noqa: E731
    planes = [to_img(live), to_img(bases), to_img(back), bmw]
    for lang in ('uk', 'en'):
        t = L[lang]
        W, H = 1960, 1660
        im = Image.new('RGBA', (W, H), rc.BG + (255,))
        pen = rc.Pen(REPO, im)
        pen.text((40, 34), t['title'], 34, bold=True)
        X0, WW, SK = 60, 1180, 130
        ys = [130, 480, 830, 1180]
        for img, y, (lab, col) in reversed(list(zip(planes, ys, t['p']))):
            pl, dst = plane(img, W, H, X0, y, WW, SK)
            if y >= 830:                                # opaque planes only: a soft drop shadow
                sh = Image.new('RGBA', (W, H), (0, 0, 0, 0))
                ImageDraw.Draw(sh).polygon([(p[0] + 10, p[1] + 18) for p in dst], fill=(0, 0, 0, 110))
                im.alpha_composite(sh.filter(ImageFilter.GaussianBlur(12)))
            fl = Image.new('RGBA', (W, H), (0, 0, 0, 0))
            ImageDraw.Draw(fl).polygon(dst, fill=(255, 255, 255, 12))
            im.alpha_composite(fl)
            im.alpha_composite(pl)
            pen = rc.Pen(REPO, im)
            pen.d.polygon(dst, outline=col, width=3)
            pen.lines((1420, y + 70), lab, 22, bold_first=True)
        pen = rc.Pen(REPO, im)
        foot = t['foot']
        # wrap the footnote in two lines
        cut = foot.rfind(' ', 0, 120)
        pen.text((40, H - 82), foot[:cut], 19, rc.DIM)
        pen.text((40, H - 52), foot[cut + 1:], 19, rc.DIM)
        im.convert('RGB').save(os.path.join(OUT, 'layers-exploded_%s.png' % lang))
    print('ok')


if __name__ == '__main__':
    main()
