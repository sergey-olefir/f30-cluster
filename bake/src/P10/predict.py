"""P10 step 5: what a phone sees on the car, for the old and the new panel renders, and the comparison sheets.

Model (g20model.json, fitted on photo 12 with the dial faces included): per channel
    photo_lin = F + g * panel_lin ** gamma
  - at photo 12's own exposure (night mode, white clips at panel ~ 70-90): the prediction to compare with photo 12;
  - "white-matched": divided by (F + g) (the model's panel-white) and scaled to a 6WB photo's white, so that the
    G20's floor stays the fraction F / (F + g) of white: the prediction to compare with that 6WB photo, photo to photo.
Regions are medians (text, needles and BMW's overlays masked); the 6WB values come from their raw dial / window crops.
    ./P10/py.sh -m P10.predict OLD.png NEW.png
"""
import json, os, sys
import cv2
import numpy as np
from P10 import levels as LV
from P10.g20model import masks

ROOT = LV.ROOT
OUT = os.path.join(ROOT, 'bake', 'work', 'P10')
RECT = os.path.join(ROOT, 'bake', 'work', 'rect')
M = json.load(open(os.path.join(OUT, 'g20model.json')))
CH = M['channels']
F = np.array([CH[c]['floor_lin'] for c in 'RGB']); G = np.array([CH[c]['gain'] for c in 'RGB']); GA = np.array([CH[c]['gamma'] for c in 'RGB'])
R = 335.0

# panel regions: (name, kind, spec); ring = (cx, cy, r0, r1, cw12 from, to)
REGIONS = [
    ('speedo face 0.55-0.75 R, top', 'ring', (412, 380, 0.55, 0.75, 270, 90)),
    ('speedo inner disc 0.36-0.46 R, top', 'ring', (412, 380, 0.36, 0.46, 300, 60)),
    ('speedo below the floor 0.30-0.60 R', 'ring', (412, 380, 0.30, 0.60, 120, 240)),
    ('tacho face 0.55-0.75 R, right', 'ring', (1508, 380, 0.55, 0.75, 30, 150)),
    ('window sky', 'box', (800, 150, 1120, 300)),
    ('window floor, lit band (p90)', 'boxq', (850, 470, 1070, 570)),
    ('bar body under the window', 'box', (800, 612, 1120, 642)),
    ('panel background, left', 'box', (30, 240, 90, 300)),
]


def s2l(c):
    return LV.s2l(c)


def l2s(c):
    return LV.l2s(c)


def model(panel_code, white=None):
    v = s2l(panel_code)
    p = F + G * np.power(np.maximum(v, 0), GA)
    if white is None:
        return l2s(np.minimum(p, 1.0))
    return l2s(np.minimum(p / (F + G) * s2l(white), 1.0))


def region_mask(kind, spec, shape=(720, 1920)):
    yy, xx = np.mgrid[0:shape[0], 0:shape[1]]
    if kind == 'ring':
        cx, cy, r0, r1, a0, a1 = spec
        d = np.hypot(xx - cx, yy - cy) / R
        th = (np.degrees(np.arctan2(xx - cx, -(yy - cy))) + 360) % 360
        ang = (th >= a0) | (th <= a1) if a0 > a1 else (th >= a0) & (th <= a1)
        return (d >= r0) & (d <= r1) & ang
    x0, y0, x1, y1 = spec
    m = np.zeros(shape, bool); m[y0:y1, x0:x1] = True
    return m


def stat(img, m, q=50):
    v = img[m]
    if len(v) < 20:
        return None
    if q == 50:
        return np.median(v, 0)
    lum = v @ LV.Y
    return np.median(v[lum >= np.percentile(lum, q - 5)], 0)


def sixwb_regions(stem):
    """The same regions in a 6WB photo's raw crops (dial frame for the dials, C5 crop for the window)."""
    out = {}
    from P10.floors import load
    for name, kind, spec in REGIONS:
        v = None
        if kind == 'ring':
            cl = 'C1' if spec[0] < 960 else 'C2'
            L = load(stem, 'comfort', cl)
            if L is not None:
                raw, bits, rr, th = L
                cx, cy, r0, r1, a0, a1 = spec
                ang = (th >= a0) | (th <= a1) if a0 > a1 else (th >= a0) & (th <= a1)
                m = (bits == 0) & (rr >= r0) & (rr <= r1) & ang
                v = stat(raw, m)
        elif name.startswith('window') or name.startswith('bar'):
            base = os.path.join(RECT, '%s.comfort.C5' % stem)
            if os.path.exists(base + '.raw.png'):
                raw = cv2.imread(base + '.raw.png')[..., ::-1].astype(np.float64)
                bits = cv2.imread(base + '.maskbits.png', cv2.IMREAD_UNCHANGED)
                bx = {'window sky': (150, 100, 410, 300, 50), 'window floor, lit band (p90)': (150, 430, 410, 560, 90),
                      'bar body under the window': (150, 575, 410, 610, 50)}[name]
                x0, y0, x1, y1, q = bx
                m = np.zeros(raw.shape[:2], bool); m[y0:y1, x0:x1] = True
                v = stat(raw, m & (bits == 0), q)
        else:
            v = np.array(LV.floor_of(stem, 'outer'))           # the display black next to the dials
        out[name] = v
    return out


def main(old_path, new_path):
    old = cv2.imread(old_path)[..., ::-1].astype(np.float64)
    new = cv2.imread(new_path)[..., ::-1].astype(np.float64)
    photo = cv2.imread(os.path.join(OUT, 'photo12_rect_panel.png'))[..., ::-1].astype(np.float64)
    ok, _ = masks(cv2.imread(old_path), cv2.imread(os.path.join(OUT, 'photo12_rect_panel.png')))
    ok_text = ok | True
    # text / needle mask only (the region masks decide the rest)
    gr = cv2.cvtColor(cv2.imread(old_path), cv2.COLOR_BGR2GRAY); gp = cv2.cvtColor(cv2.imread(os.path.join(OUT, 'photo12_rect_panel.png')), cv2.COLOR_BGR2GRAY)
    red = lambda im: (im[..., 0] - im[..., 1] > 60)
    t = (gr > 110) | (gp > 170) | red(old) | red(photo)
    t = cv2.dilate(t.astype(np.uint8), np.ones((15, 15), np.uint8)) > 0
    ok_text = ~t
    po, pn = model(old), model(new)
    res = {'model': M['model'], 'regions': {}}
    refs = {'04': '04_comfort_whole-cluster_mph', '03': '03_three-modes_photo_bimmerstop'}
    six = {k: sixwb_regions(v) for k, v in refs.items()}
    whites = {k: LV.floors()[v]['p0_white_luma'] for k, v in refs.items()}
    for name, kind, spec in REGIONS:
        m = region_mask(kind, spec) & ok_text
        q = 90 if kind == 'boxq' else 50
        o, n_, ph = stat(old, m, q), stat(new, m, q), stat(photo, m, q)
        r = {'panel_old': o.round(1).tolist(), 'panel_new': n_.round(1).tolist(), 'photo12': ph.round(1).tolist(),
             'pred_photo12_exposure_old': model(o).round(1).tolist(), 'pred_photo12_exposure_new': model(n_).round(1).tolist(),
             'L_rel_car_old': (np.power(s2l(o), GA)).round(5).tolist(), 'L_rel_car_new': (np.power(s2l(n_), GA)).round(5).tolist()}
        for k in refs:
            v = six[k][name]
            r['6wb_' + k + '_photo'] = None if v is None else np.round(v, 1).tolist()
            r['pred_at_%s_white_old' % k] = model(o, whites[k]).round(1).tolist()
            r['pred_at_%s_white_new' % k] = model(n_, whites[k]).round(1).tolist()
        res['regions'][name] = r
    res['g20_floor_fraction_of_white'] = (F / (F + G)).round(5).tolist()
    for k, v in refs.items():
        Fl = np.array(LV.floor_of(v, 'outer')); W = LV.floors()[v]['p0_white_luma']
        res['6wb_%s_floor_fraction_of_white' % k] = (s2l(Fl) / s2l(W)).round(5).tolist()
    json.dump(res, open(os.path.join(OUT, 'predict.json'), 'w'), indent=1)
    # images: photo-12 exposure, and white-matched to 04
    cv2.imwrite(os.path.join(OUT, 'pred_old_photo12exp.png'), np.clip(po, 0, 255)[..., ::-1].astype(np.uint8))
    cv2.imwrite(os.path.join(OUT, 'pred_new_photo12exp.png'), np.clip(pn, 0, 255)[..., ::-1].astype(np.uint8))
    for k in refs:
        cv2.imwrite(os.path.join(OUT, 'pred_old_at%swhite.png' % k), np.clip(model(old, whites[k]), 0, 255)[..., ::-1].astype(np.uint8))
        cv2.imwrite(os.path.join(OUT, 'pred_new_at%swhite.png' % k), np.clip(model(new, whites[k]), 0, 255)[..., ::-1].astype(np.uint8))
    # print a compact table
    print('%-38s %-16s %-16s | %-16s %-16s %-16s | %-16s %-16s %-16s' % ('region', 'panel old', 'panel new', 'photo 12', 'pred old', 'pred new', '6WB 04', 'pred@04 old', 'pred@04 new'))
    f = lambda a: '-' if a is None else '(%s)' % ','.join('%d' % round(x) for x in a)
    for name, r in res['regions'].items():
        print('%-38s %-16s %-16s | %-16s %-16s %-16s | %-16s %-16s %-16s | 03 %-14s @03 old %-14s new %s' % (
            name, f(r['panel_old']), f(r['panel_new']), f(r['photo12']), f(r['pred_photo12_exposure_old']), f(r['pred_photo12_exposure_new']),
            f(r['6wb_04_photo']), f(r['pred_at_04_white_old']), f(r['pred_at_04_white_new']), f(r['6wb_03_photo']), f(r['pred_at_03_white_old']), f(r['pred_at_03_white_new'])))
    print('floor / white: G20', res['g20_floor_fraction_of_white'], '04', res['6wb_04_floor_fraction_of_white'], '03', res['6wb_03_floor_fraction_of_white'])


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
