"""Package C (G20 sim): measure the stock G20 icons and texts on the rectified photos.

For each element of design/overlay/g20_comfort.json (groups telltale, bottom-row, assist-message) and each photo:
ink bbox (Otsu on max(RGB) in the element's bbox + 8 px), core colour (median of the brightest half of the ink),
the background around it, and the halo (mean max(RGB) above background in 1-px rings outside the ink).
Writes bake/work/g20sim/C/measure.json. Read-only on the photos; nothing is shipped from here.

Run: UV_CACHE_DIR=bake/work/.uvcache uv run -q --no-project --with opencv-python-headless --with numpy \
     python bake/src/G20/icons/measure.py
"""
import json
import os

import cv2
import numpy as np

WT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', '..'))
RECT = '/Users/solefir/projects/f30-cluster/bake/work/overlay/rect/'
OUT = os.path.join(WT, 'bake', 'work', 'g20sim', 'C', 'measure.json')
PHOTOS = ['08', '09', '14']
SKIP = {'structure', 'map-nav', 'overlay'}


def measure(img, box, pad=8):
    x0, y0, x1, y1 = [int(round(v)) for v in box]
    X0, Y0, X1, Y1 = max(0, x0 - pad), max(0, y0 - pad), min(1920, x1 + pad), min(720, y1 + pad)
    crop = img[Y0:Y1, X0:X1].astype(np.float32)
    mx = crop.max(2)
    u8 = np.clip(mx, 0, 255).astype(np.uint8)
    t, _ = cv2.threshold(u8, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    ink = mx > t
    if ink.sum() < 5:
        return None
    ys, xs = np.nonzero(ink)
    lum = mx[ink]
    core = crop[ink][lum >= np.median(lum)]
    bg = crop[~cv2.dilate(ink.astype(np.uint8), np.ones((9, 9), np.uint8)).astype(bool)]
    bgc = np.median(bg, 0) if len(bg) else np.zeros(3)
    halo = []
    prev = ink.astype(np.uint8)
    for r in range(1, 6):
        d = cv2.dilate(ink.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1)))
        ring = (d > 0) & (prev == 0)
        prev = d
        halo.append(round(float(mx[ring].mean() - bgc.max()), 1) if ring.any() else None)
    return {'otsu': int(t), 'ink_bbox': [int(X0 + xs.min()), int(Y0 + ys.min()), int(X0 + xs.max() + 1), int(Y0 + ys.max() + 1)],
            'core_rgb': [int(v) for v in np.median(core, 0)[::-1]], 'core_p90_rgb': [int(v) for v in np.percentile(core, 90, 0)[::-1]],
            'bg_rgb': [int(v) for v in bgc[::-1]], 'halo_rings': halo, 'ink_px': int(ink.sum())}


def main():
    d = json.load(open(os.path.join(WT, 'design', 'overlay', 'g20_comfort.json')))
    ims = {p: cv2.imread(RECT + p + '.png') for p in PHOTOS}
    out = {}
    for e in d['elements']:
        if e['group'] in SKIP:
            continue
        out[e['id']] = {'bbox': e['bbox'], 'per_photo': {p: measure(ims[p], e['bbox']) for p in PHOTOS}}
        print(e['id'], e['bbox'])
        for p in PHOTOS:
            print('   ', p, out[e['id']]['per_photo'][p])
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(out, open(OUT, 'w'), indent=1)


if __name__ == '__main__':
    main()
