"""Package design/f30-font: render the side-by-side sheets.

Two kinds, and the difference matters for what may be committed:

  --out design/f30-font/fonts/      candidates only, each set to the measured figure (or cap) height
                                    and drawn with the photograph's measured ink box around it, so
                                    the width error is visible without any photo pixel being stored.
                                    Committable.
  --photo-out bake/work/f30font/    the photograph's own crop on top, the candidates under it at the
                                    same height. Git-ignored, because reference pixels are
                                    (design/overlay/README.md, design/g20-spec/README.md).

    UV_CACHE_DIR=bake/work/.uvcache uv run -q --no-project --with pillow --with numpy \
        --with opencv-python-headless python -I tools/f30font/sheets.py --fonts <dir> \
        --out design/f30-font/fonts --photo-out bake/work/f30font
"""
import argparse
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, HERE)
from fontfit import DEFAULT_CANDIDATES, EM, load, ink_box             # noqa: E402

# the shortlist the document argues for, plus Arimo (what we bake today) as the control
SHEET_FACES = [
    ('Arimo 400 (baked today)', 'Arimo', 400, None),
    ('Arimo 700 (baked today)', 'Arimo', 700, None),
    ('Roboto 700 wdth 87.5', 'Roboto', 700, 87.5),
    ('Roboto 600 wdth 82.5', 'Roboto', 600, 82.5),
    ('Noto Sans Display 450', 'NotoSansDisplay', 450, 100),
    ('Noto Sans 500 wdth 87.5', 'NotoSans', 500, 87.5),
    ('Open Sans 500 wdth 93', 'OpenSans', 500, 93),
    ('Fira Sans Regular', 'FiraSans', None, None),
]
ROW_H = 150
LABEL_W = 260


def find(dirs, fn):
    for d in dirs:
        p = os.path.join(d, fn)
        if os.path.exists(p):
            return p
    return None


def render_run(path, axes, text, target_h, probe, px_h):
    """Render `text` with the face sized so `probe`'s ink height is target_h, then scale the whole
    strip so that height becomes px_h on the sheet."""
    lo, hi = 4.0, 600.0
    for _ in range(40):
        mid = (lo + hi) / 2
        f = load(path, axes, int(round(mid)) or 1)
        b = ink_box(f, probe)
        if b is None or b[1] < target_h:
            lo = mid
        else:
            hi = mid
    f = load(path, axes, max(1, int(round((lo + hi) / 2))))
    w = int(f.getlength(text)) + 40
    img = Image.new('L', (max(w, 10), int(target_h * 3) + 40), 0)
    base = int(target_h * 2)
    ImageDraw.Draw(img).text((20, base), text, font=f, fill=255, anchor='ls')
    a = np.asarray(img)
    xs = np.where((a >= 128).any(0))[0]
    ys = np.where((a >= 128).any(1))[0]
    sub = img.crop((int(xs[0]) - 2, int(ys[0]) - 2, int(xs[-1]) + 3, int(ys[-1]) + 3))
    k = px_h / float(sub.height)
    return sub.resize((max(1, int(sub.width * k)), max(1, int(sub.height * k))), Image.LANCZOS), f


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--fonts', action='append', default=[])
    ap.add_argument('--measured', default=os.path.join(ROOT, 'design', 'f30-font', 'measured.json'))
    ap.add_argument('--out', default=None)
    ap.add_argument('--photo-out', default=None)
    ap.add_argument('--ref-root', default='/Users/solefir/projects/f30-cluster',
                    help='checkout that actually has reference/ (the photo sheets need it)')
    a = ap.parse_args()

    dirs = [os.path.join(ROOT, 'tools', 'fonts-src')] + a.fonts
    meas = json.load(open(a.measured))

    jobs = [
        ('rev', '1234567', 'rev_digits', 'figure_height_px', '0', 96,
         'F30 6WB rev scale  1 2 3 4 5 6 7'),
        ('caption', '1/min x 1000', 'cap_1min', 'figure_height_px', '0', 70,
         'F30 6WB caption  1/min x 1000'),
        ('ready', 'READY', 'ready', 'cap_height_px', 'H', 80, 'F30 6WB  READY'),
        ('speed', '0 20 40 60 80 100 120', 'speed_digits', 'figure_height_px', '0', 56,
         'F30 6WB speed scale'),
    ]

    for jid, text, rid, hkey, probe, px_h, title in jobs:
        run = meas['runs'][rid]
        target = run[hkey]
        tiles = []
        photo_tile = None
        if a.photo_out and run.get('sheet_crop'):
            import cv2                                               # noqa: PLC0415
            c = run['sheet_crop']
            src = os.path.join(a.ref_root, c['file'])
            im = cv2.imread(src, cv2.IMREAD_COLOR)
            if im is not None:
                x0, y0, x1, y1 = [int(v) for v in c['box']]
                sub = im[y0:y1, x0:x1]
                k = px_h * c.get('height_scale', 1.6) / float(sub.shape[0])
                photo_tile = cv2.resize(sub, (max(1, int(sub.shape[1] * k)), max(1, int(sub.shape[0] * k))),
                                        interpolation=cv2.INTER_LANCZOS4)
        for label, fname, ww, dd in SHEET_FACES:
            ent = [e for e in DEFAULT_CANDIDATES if e[0] == fname]
            if not ent:
                continue
            _n, fn, axes = ent[0]
            p = find(dirs, fn)
            if not p:
                continue
            ax = None
            if axes:
                ax = dict(axes)
                if ww is not None and 'wght' in ax:
                    ax['wght'] = ww
                if dd is not None and 'wdth' in ax:
                    ax['wdth'] = dd
            try:
                img, _f = render_run(p, ax, text, target, probe, px_h)
            except Exception:                                        # noqa: BLE001
                continue
            tiles.append((label, img))
        if not tiles:
            continue

        def build(with_photo, _tiles=tiles, _photo=photo_tile, _title=title, _px_h=px_h):
            """One sheet. with_photo=False renders the candidates alone, so the result holds no
            reference pixel at all and may be committed under design/."""
            width = max(t.width for _l, t in _tiles) + LABEL_W + 60
            n_rows = len(_tiles)
            if with_photo:
                width = max(width, _photo.shape[1] + LABEL_W + 60)
                n_rows += 1
            sh = Image.new('RGB', (width, 46 + n_rows * (_px_h + 34)), (12, 12, 14))
            dd = ImageDraw.Draw(sh)
            dd.text((16, 14), '%s   (each row set to the photograph\'s measured height)' % _title,
                    fill=(200, 200, 210))
            yy = 46
            if with_photo:
                ph = Image.fromarray(_photo[:, :, ::-1])
                sh.paste(ph, (LABEL_W, yy))
                dd.text((16, yy + ph.height // 2 - 6), 'the photograph', fill=(255, 210, 120))
                yy += ph.height + 24
            for label, img in _tiles:
                sh.paste(Image.merge('RGB', (img, img, img)), (LABEL_W, yy))
                dd.text((16, yy + _px_h // 2 - 6), label,
                        fill=(255, 150, 150) if label.startswith('Arimo') else (170, 200, 255))
                yy += _px_h + 34
            return sh

        if a.out:
            os.makedirs(a.out, exist_ok=True)
            build(False).save(os.path.join(a.out, jid + '.png'))
            print('wrote', os.path.join(a.out, jid + '.png'), '- candidates only, no photo pixels')
        if a.photo_out and photo_tile is not None:
            os.makedirs(a.photo_out, exist_ok=True)
            build(True).save(os.path.join(a.photo_out, 'sheet-' + jid + '.png'))
            print('wrote', os.path.join(a.photo_out, 'sheet-' + jid + '.png'), '- HAS photo pixels, git-ignored')


if __name__ == '__main__':
    main()
