"""Our wb_dials shapes as a 1x mask, exactly as tools/overlay/plan_dials.py computes them (U: the kept wb elements'
masks, alpha >= 64, big dials cut at y 656, minis moved up 20 px, the sign and "i" windows cut out), plus the simple
disc approximation from the brief, for the y-656 / collar sweep of package D.

  tools/g20sim/D/py tools/g20sim/D/dials_mask.py  -> bake/work/g20sim/D/harness/{ours_dials.png, ours_discs.png, collar.dials.png}
"""
import json
import os
import shutil
import sys

import numpy as np
from PIL import Image, ImageDraw

WT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..'))
sys.path.insert(0, os.path.join(WT, 'tools', 'overlay'))
import plan_dials as pd  # noqa: E402

OUT = os.path.join(WT, 'bake', 'work', 'g20sim', 'D', 'harness')


def main():
    os.makedirs(OUT, exist_ok=True)
    wb = json.load(open(pd.rel('design/overlay/wb_comfort.json')))
    G = {g['id']: g for g in json.load(open(pd.rel('design/overlay/g20_comfort.json')))['elements']}
    kept = [e for e in wb['elements'] if pd.keep(e) and e.get('drawn_on_car', True)]
    U = np.zeros((pd.H, pd.W), bool)
    for e in kept:
        dy = pd.MINI_DY if e.get('anchor') in ('mini.fuel', 'mini.oil') else 0
        m = pd.raster(e, dy)
        if e.get('anchor') in ('speedo', 'tacho'):
            m[pd.CUT_Y:, :] = False
        U |= m
    win_sign = pd.rr_mask(pd.SIGN_WIN['rect'], pd.SIGN_WIN['radius'])
    b = G['assist.info_tacho']['bbox']
    win_i = pd.rr_mask([int(b[0]) - 4, int(b[1]) - 4, int(np.ceil(b[2])) + 4, int(np.ceil(b[3])) + 4], 4)
    U &= ~(win_sign | win_i)
    Image.fromarray((U * 255).astype('uint8')).save(os.path.join(OUT, 'ours_dials.png'))
    # the brief's approximation: discs R 335 at (412, 380), (1508, 380) cut at 656; minis R 70 at (80, 608), (1840, 608)
    im = Image.new('L', (pd.W, pd.H))
    d = ImageDraw.Draw(im)
    for cx, cy, r in ((412, 380, 335), (1508, 380, 335)):
        d.ellipse([cx - r + 1, cy - r + 1, cx + r - 1, cy + r - 1], fill=255)
    d.rectangle([0, pd.CUT_Y, pd.W, pd.H], fill=0)
    for cx, cy, r in ((80, 608, 70), (1840, 608, 70)):
        d.ellipse([cx - r + 1, cy - r + 1, cx + r - 1, cy + r - 1], fill=255)
    D = np.array(im) > 0
    Image.fromarray((D * 255).astype('uint8')).save(os.path.join(OUT, 'ours_discs.png'))
    shutil.copy(pd.rel('design/overlay/collar.dials.png'), os.path.join(OUT, 'collar.dials.png'))
    print('ours (plan_dials U): %d px; discs: %d px; U xor discs: %d px; U - discs %d, discs - U %d' % (
        U.sum(), D.sum(), (U ^ D).sum(), (U & ~D).sum(), (D & ~U).sum()))
    ys, xs = np.nonzero(U)
    print('U bbox x %d..%d y %d..%d; lowest row of the big dials %d' % (xs.min(), xs.max(), ys.min(), ys.max(),
                                                                       np.nonzero(U[:, 300:1700].any(1))[0].max()))
    for name, (x0, x1) in (('speedo', (60, 760)), ('tacho', (1160, 1860))):
        cols = np.nonzero(U[380, x0:x1])[0]
        rows = np.nonzero(U[:, (x0 + x1) // 2])[0]
        print('  %s: row 380 x %d..%d (centre %.1f, R %.1f); column %d y %d..' % (name, x0 + cols.min(), x0 + cols.max(),
              x0 + (cols.min() + cols.max()) / 2, (cols.max() - cols.min() + 1) / 2, (x0 + x1) // 2, rows.min()))


if __name__ == '__main__':
    main()
