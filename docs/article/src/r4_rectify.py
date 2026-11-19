"""Revision 4: rectification of a G20 photo onto the 1920 x 720 panel grid, and what the lens adds.
The photo is the owner's own (reference/g20/10_grid_over-stock.jpg: our calibration grid shown on the car's panel),
the rect is tools/overlay/rectify.py's output (bake/work/overlay/rect/10.png) and the model is its H.json entry.
The town name in BMW's bottom row is blurred in both (privacy); nothing else in the crops is personal.

The vectors: for every major grid crossing P, where the best PLAIN homography (H.json H_panel_to_photo) puts the photo
point that the full model (homography + one radial term) maps P to. That is the lens' radial distortion a plain
homography cannot take up; magnified x40.

Usage: python -I r4_rectify.py <repo> <images_dir>   -> rectify_{uk,en}.png"""
import json
import os
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
REPO, OUT = sys.argv[1:3]

import numpy as np                                     # noqa: E402
from PIL import Image, ImageDraw, ImageFilter, ImageOps  # noqa: E402

import r4common as rc                                  # noqa: E402

MAG = 40.0


def blur(im, box, r):
    soft = im.filter(ImageFilter.GaussianBlur(r)).filter(ImageFilter.GaussianBlur(r))
    m = Image.new('L', im.size, 0)
    ImageDraw.Draw(m).rounded_rectangle(box, r, fill=255)
    im.paste(soft, (0, 0), m.filter(ImageFilter.GaussianBlur(r / 3)))
    return im


def tf(H, pts):
    p = np.c_[pts, np.ones(len(pts))] @ np.asarray(H).T
    return p[:, :2] / p[:, 2:3]


class Model:
    def __init__(self, m):
        self.H = np.asarray(m['H_panel_to_undistorted_photo'], np.float64)
        self.k1 = float(m['k1'])
        self.c = np.asarray(m['centre_photo_px'], np.float64)
        self.s = float(m['norm_radius_photo_px'])

    def to_photo(self, P):
        u = tf(self.H, P)
        q = u.copy()
        for _ in range(12):
            d = q - self.c
            q = self.c + (u - self.c) / (1 + self.k1 * (d ** 2).sum(-1, keepdims=True) / self.s ** 2)
        return q


L = {
    'uk': {
        'title': 'Ректифікація: фото панелі → сітка 1920 × 720 пікселів панелі',
        'a': 'фото з місця водія: наша калібрувальна сітка (кожні 100 px) на панелі G20',
        'b': 'те саме фото, переведене в пікселі панелі (гомографія + радіальний член)',
        'vec': 'стрілки ×40: що лишається, якщо взяти лише гомографію (дисторсія об\'єктива телефона)',
        'stats': ['113 вузлів сітки, знайдених NCC; RANSAC, потім МНК',
                  'лише гомографія: rms 2,47 px панелі',
                  'гомографія + k₁: rms 1,21 px (k₁ = −0,027)',
                  'u = c + (q − c)·(1 + k₁·|q − c|² / s²)'],
        'blur': 'назву міста в рядку BMW розмито',
        'max': 'найбільша стрілка: %.1f px',
    },
    'en': {
        'title': 'Rectification: a panel photo → the 1920 × 720 panel pixel grid',
        'a': 'photo from the driver\'s seat: our calibration grid (every 100 px) on the G20 panel',
        'b': 'the same photo mapped to panel pixels (homography + a radial term)',
        'vec': 'arrows ×40: what is left with a homography alone (the phone lens\' distortion)',
        'stats': ['113 grid crossings found by NCC; RANSAC, then least squares',
                  'homography alone: rms 2.47 panel px',
                  'homography + k₁: rms 1.21 px (k₁ = −0.027)',
                  'u = c + (q − c)·(1 + k₁·|q − c|² / s²)'],
        'blur': 'the town name in BMW\'s row is blurred',
        'max': 'largest arrow: %.1f px',
    },
}


def main():
    hj = json.load(open(os.path.join(REPO, 'bake', 'work', 'overlay', 'rect', 'H.json')))['10']
    m = Model(hj['model'])
    Hp = np.asarray(hj['H_panel_to_photo'], np.float64)
    P = np.array([[100 * k + 0.5, 100 * j + 0.5] for j in range(1, 8) for k in range(1, 20)], np.float64)
    q = m.to_photo(P)
    Pp = tf(np.linalg.inv(Hp), q)
    D = Pp - P
    mag = np.hypot(D[:, 0], D[:, 1])
    photo = ImageOps.exif_transpose(Image.open(os.path.join(REPO, 'reference', 'g20', '10_grid_over-stock.jpg'))).convert('RGB')
    photo = blur(photo, (990, 1130, 1160, 1202), 14)
    photo = photo.crop((60, 470, 2030, 1250))
    photo.info.clear()
    rect = Image.open(os.path.join(REPO, 'bake', 'work', 'overlay', 'rect', '10.png')).convert('RGB')
    rect = blur(rect, (895, 652, 1035, 712), 12)
    rect = Image.blend(Image.new('RGB', rect.size, (0, 0, 0)), rect, 0.55)
    d = ImageDraw.Draw(rect)
    for (x, y), (dx, dy), mg in zip(P, D, mag):
        c = (255, int(max(0, 230 - 60 * mg)), 60)
        d.line((x, y, x + MAG * dx, y + MAG * dy), fill=c, width=4)
        d.ellipse((x - 5, y - 5, x + 5, y + 5), fill=(255, 255, 255))
    for lang in ('uk', 'en'):
        t = L[lang]
        W = 1960
        pw = 900
        ph = int(photo.size[1] * pw / photo.size[0])
        rw = W - 80
        rh = int(720 * rw / 1920)
        H = 96 + ph + 60 + rh + 150
        im = Image.new('RGB', (W, H), rc.BG)
        pen = rc.Pen(REPO, im)
        pen.text((40, 30), t['title'], 34, bold=True)
        pen.text((40, 92), t['a'], 18, rc.TXT, True)
        im.paste(photo.resize((pw, ph), Image.LANCZOS), (40, 120))
        sx = 40 + pw + 40
        y = 130
        for i, s in enumerate(t['stats']):
            pen.text((sx, y), s, 21 if i else 21, rc.AMBER if i == 2 else rc.TXT, i == 2)
            y += 40
        mx = t['max'] % mag.max()
        pen.text((sx, y + 10), mx.replace('.', ',') if lang == 'uk' else mx, 19, rc.DIM)
        pen.text((sx, y + 46), t['blur'], 17, rc.DIM)
        yb = 120 + ph + 30
        pen.text((40, yb), t['b'], 18, rc.TXT, True)
        pen.text((40, yb + 26), t['vec'], 17, (255, 170, 60))
        im.paste(rect.resize((rw, rh), Image.LANCZOS), (40, yb + 56))
        pen.d.rectangle((39, yb + 55, 40 + rw, yb + 56 + rh), outline=rc.LINE, width=1)
        im = im.crop((0, 0, W, yb + 56 + rh + 30))
        im.save(os.path.join(OUT, 'rectify_%s.png' % lang))
    print('ok max %.2f rms %.2f px' % (mag.max(), float(np.sqrt((mag ** 2).mean()))))


if __name__ == '__main__':
    main()
